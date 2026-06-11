# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Toolchain

Pinned versions (strict — the build/test scripts enforce them):

- anchor `1.0.0` (via `avm use 1.0.0`)
- rust `1.91.1` (on Apple Silicon, `rustup override set 1.91.1-x86_64-apple-darwin` — the x86 toolchain is required)
- solana/agave `2.3.11`
- node `>=24`
- bun (package manager — replaced yarn)

`rust-toolchain.toml` and `build.sh` pin these; don't upgrade casually.

### Anchor 1.0 migration status

The codebase has been migrated from Anchor 0.29 to 1.0, and fully rebranded drift → velocity (mirroring the protocol's own rebrand). The `velocity` crate is consumed as a **local path dep** at `../protocol-v2-shadow/programs/velocity` (see `programs/velocity_vaults/Cargo.toml`). `velocity.so` / `pyth.so` fixtures under `tests/fixtures/` were rebuilt from that same protocol repo — they MUST be regenerated whenever you pull protocol changes (`bun run program:build` in the protocol repo uses the right feature set: `--no-default-features --features no-entrypoint,anchor-test`; copy `target/deploy/velocity.so` + `target/idl/velocity.json` into `tests/fixtures/`), or the local validator tests will fail on deserialization. The TS dep is the published `@velocity-exchange/sdk` (pinned in `ts/sdk/package.json`). Once a matching `velocity` crates.io release exists, the Rust path dep can be flipped back too.

**Zero-copy struct layout invariants** (enforced by `drift_macros::assert_no_slop` + `static_assertions::const_assert_eq`): every account struct's content (excluding the 8-byte discriminator) must be a multiple of 16 bytes, and all `u128`/`i128` fields must begin at 16-aligned offsets. Rust ≥ 1.77 made `align_of::<u128>() == 16` on x86_64 but SBF stayed at 8 — violating the invariant causes sizeof-divergence between host tests and on-chain bytes. If you add a field to `Vault` / `VaultDepositor` / `TokenizedVaultDepositor` / `VaultProtocol` / `FeeUpdate`, keep all u128/i128 fields grouped near the top (before any `WithdrawRequest` or sub-struct that embeds a u128) and adjust the trailing `padding` array so `(SIZE - 8) % 16 == 0`. The `assert_no_slop` attribute will fail compilation immediately if you get it wrong. See `docs/alignment-and-native-offsets.md` in the protocol repo for the full rationale.

The pre-anchor1 `.cargo/config.toml` (which forced vendored-sources from a missing `vendor/` directory) has been removed. Re-run `cargo vendor` to regenerate one once deps are stable, if verified builds need it.

## Common commands

Build + run the full anchor test suite (spins up `anchor localnet` in the background, runs jest against it):

```
./test.sh                 # full: build + test
./test.sh --no-build      # reuse last build
./test.sh --detach        # keep validator running after tests
```

Under the hood, `test.sh` calls `build.sh --anchor-test` (which does `anchor build --ignore-keys -- --features anchor-test`) then `bun run anchor-tests`. The `--ignore-keys` flag is required in Anchor 1.0.

Run a single jest test file:

```
ANCHOR_WALLET=~/.config/solana/id.json bun run jest --runInBand --forceExit tests/velocityVaults.ts
```

Note: `bun run anchor-tests` copies fresh IDL/types from `target/` into `ts/sdk/src/{idl,types}/` before running jest — if you edit the Rust program, re-run this (not raw `jest`) so the TS SDK sees new types. Or run `bun run program:sync-idl` manually (`bun run program:build` does anchor build + sync in one go).

Rust unit tests (in-program, no validator): `cargo test` from repo root. There is a large `tests.rs` module in `programs/velocity_vaults/src/` gated on `#[cfg(test)]`.

Lint / format:

```
bun run lint            # eslint (TS)
bun run prettify        # prettier check
bun run prettify:fix    # prettier write
cargo fmt               # rust
```

CLI (manager/depositor operations against a live cluster), run from `ts/sdk/`:

```
cd ts/sdk && bun run cli --help
```

Requires `RPC_URL` + `KEYPAIR_PATH` (or `--url`/`--keypair` flags). See `ts/sdk/README.md` for per-command docs.

## Architecture

This is a Solana Anchor program (`velocity_vaults`, program id `vAuLTsyrvSfZRuRB3XgvkPwNGgYSs9YRYymVebLKoxR`) plus a TypeScript SDK + CLI. Vaults are delegated accounts on top of the Velocity perps/spot protocol: a manager runs strategies on Velocity, depositors hold pro-rata shares in the vault.

### Rust program (`programs/velocity_vaults/src/`)

- `lib.rs` — thin dispatch layer. Every instruction is one function forwarding into `instructions::*`. Start here to find the surface.
- `instructions/` — one file per instruction. Constraint macros live in `constraints.rs`.
- `state/` — account definitions. The heavy logic lives in these, not the instructions:
  - `vault.rs` (~58KB) and `vault_depositor.rs` (~82KB) are the core share-accounting engines (deposits, withdraws, profit share, rebase, fuel distribution). Most behavior changes touch these.
  - `tokenized_vault_depositor.rs` — SPL-token-wrapped depositor position (see `tokenize_shares` / `redeem_tokens` instructions).
  - `vault_protocol.rs` — optional protocol-fee side of a vault (initialized via `initialize_vault_with_protocol`).
  - `fee_update.rs`, `withdraw_request.rs`, `withdraw_unit.rs`, `events.rs`, `traits.rs`, `math.rs`, `account_maps.rs` — supporting types.
- `velocity_cpi.rs` / `token_cpi.rs` — CPI wrappers into velocity program and SPL token.
- `tests.rs` (~127KB) — exhaustive Rust-side unit tests for share-math edge cases; run via `cargo test`.

Three main actor roles show up across instructions: **manager** (runs the vault, has most privileged ix), **depositor** (deposits/withdraws shares), **protocol** (optional fee recipient, with its own `protocol_*` withdraw flow). There is also an `admin_*` set for Velocity-team-controlled fee/class migrations.

Withdrawals are two-phase: `request_withdraw` → wait `redeem_period` → `withdraw`. Same pattern for manager and protocol variants and for insurance-fund stake removal.

### TypeScript SDK (`ts/sdk/src/`)

- `vaultClient.ts` (~103KB) — the primary client; wraps every program instruction plus helpers to fetch/derive accounts. This is what the CLI and tests consume.
- `accounts/`, `accountSubscribers/` — account fetching/subscription layer.
- `addresses.ts` — PDA derivations (vault, vault depositor, tokenized depositor, insurance fund stake, etc.).
- `idl/` and `types/` — **generated**, do not hand-edit. They are copied from `target/` by `bun run program:sync-idl` (invoked automatically by `bun run anchor-tests`).
- `math/`, `parsers/` — view-side helpers.

### CLI (`ts/sdk/cli/`)

`cli.ts` registers commander subcommands; actual work is in `cli/commands/*`. Supports ledger signing via `ledgerWallet.ts` (pass a `usb://ledger/...` path as `--keypair`).

### Tests (`tests/`)

Jest integration tests run against a local validator (started by `test.sh`). `tests/fixtures/` contains the velocity + pyth + metaplex programs and accounts loaded into genesis (see `Anchor.toml`). `velocityVaults.ts` is the broad end-to-end suite; other files target narrower features (fee updates, tokenized shares, trusted vaults, etc.).

## Gotchas

- After editing the Rust program, the TS side will look stale until IDL/types are regenerated. `bun run anchor-tests` handles this; raw `jest` does not.
- `anchor build --ignore-keys` must run with `--features anchor-test` for the integration test suite (done by `build.sh --anchor-test`). Unit tests (`cargo test`) use `#[cfg(test)]` gating independently.
- One fixture-based unit test (`apply_profit_share_on_net_hwm_example`) is `#[ignore]`d — its base64 Vault bytes encode the pre-reorder layout. Re-capture the fixture if/when you need it.
- The macOS "blockstore error" on `anchor test` is fixed by installing `gnu-tar` and putting it ahead of BSD tar on `PATH` (see README).
- On Apple Silicon, the program is built with the x86 rust toolchain — do not switch to aarch64.
- `ahash` is pinned to `0.8.11` in `Cargo.lock`; older `0.8.6` uses the removed `#[feature(stdsimd)]` and will fail to compile on Rust 1.91. If you regenerate `Cargo.lock`, confirm ahash is ≥ 0.8.7.
- The velocity SDK's `adminClient.initializePerpMarket` defaults `oracleSource` to `PythLazer`. Tests mock a regular Pyth oracle, so every call site must pass `OracleSource.PYTH` explicitly — otherwise velocity panics in `oracle.rs` trying to deserialize a Pyth account as a Lazer message.
- One test in `tests/velocityVaults.ts` is `it.skip`d (`Vault profit share is consistent under gradual equity gain`) — blocked on velocity exposing a test-only TWAP setter; see the comment above it and `docs/spot-e2e-coverage-handoff.md`.
- Velocity's AMM-decoupling changes mean: (a) `settle_pnl` under large price divergence requires an `update_amms` ix in the same tx (`AMMNotUpdatedInSameSlot`) — see the `settleWithAmmCrank` helper in `tests/velocityVaults.ts`; (b) after big oracle moves the AMM must be re-cranked (`updateAMMs`) before fills or they abort with `InvalidAmmDetected` — `doWashTrading` in `tests/common/testHelpers.ts` does this each iter.
- The fixture `velocity.so`, the published `@velocity-exchange/sdk`, and the `velocity` path dep MUST be from the same protocol-repo commit — account layouts change between commits (e.g. builder codes PR #68 changed `Order`/`User`), and a mismatch shows up as garbage deserialization (`OrderDoesNotExist`, wrong positions), not a clean error.

## CI

`.github/workflows/main.yml` checks out `protocol-v2-shadow` as a sibling of the vaults checkout (using `secrets.GH_PAT`) so the path deps resolve. The pinned commit is set via `SHADOW_REF` in the workflow `env`. The verified-build job is gated `if: false` until the velocity crate is published — `solana-verify build` vendors crates and can't follow a path dep outside the workspace.
