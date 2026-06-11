#!/bin/bash

set -e
trap 'echo -e "\nStopped by signal $? (SIGINT)"; cleanup_validator; exit 0' INT

# Build the program (anchor-test features) unless --skip-build is given.
if [ "$1" != "--skip-build" ]; then
  anchor build --ignore-keys -- --features anchor-test
fi

# Sync IDL/types from target/ into ts/sdk and stage genesis IDLs for
# anchor.workspace lookups.
bun run program:sync-idl
bun run update-velocity
bun run update-pyth

export ANCHOR_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"

# --- bankrun suites: in-process banks server, no validator needed ---
bankrun_files=(
  depositMax.test.ts
  feeUpdate.test.ts
  managerUpdate.test.ts
  sharesExamples.test.ts
  transferVaultDepositorShares.test.ts
  trustedVault.test.ts
)

for test_file in ${bankrun_files[@]}; do
  bunx ts-mocha -p tsconfig.json --exit -t 1000000 ./tests/${test_file} || exit 1
done

# --- validator suites: need a live local validator (websockets, metaplex
# RPC, airdrops). The script manages its own validator: starts a fresh one
# unless something is already listening on 8899 (then it reuses it and
# leaves it alone — note tests assume fresh genesis, so a dirty reused
# validator can fail spuriously).
validator_files=(
  velocityVaults.ts
)

started_validator=false
cleanup_validator() {
  if [ "$started_validator" = true ]; then
    pkill -f solana-test-validator || true
  fi
}

port_in_use() {
  (exec 3<>/dev/tcp/127.0.0.1/8899) 2>/dev/null && exec 3>&- && return 0
  return 1
}

if ! port_in_use; then
  echo "Starting local validator..."
  solana-test-validator --reset --quiet \
    --bpf-program vELoC1audYbSYVRXn1vPaV8Axoa9oU6BYmNGZZBDZ1P tests/fixtures/velocity.so \
    --bpf-program gSbePebfvPy7tRqimPoVecS2UsBvYv46ynrzWocc92s tests/fixtures/pyth.so \
    --bpf-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s tests/fixtures/metaplex/metaplex.so \
    --bpf-program vAuLTsyrvSfZRuRB3XgvkPwNGgYSs9YRYymVebLKoxR target/deploy/velocity_vaults.so \
    --account PwDiXFxQsGra4sFFTT8r1QWRMd4vfumiWC1jfWNfdYT tests/fixtures/metaplex/PwDiXFxQsGra4sFFTT8r1QWRMd4vfumiWC1jfWNfdYT.json \
    >/dev/null 2>&1 &
  started_validator=true
  # warm up validator (spurious errors may occur if this is not done)
  sleep 7
else
  echo "Reusing validator already listening on 8899 (state may be dirty)"
fi

for test_file in ${validator_files[@]}; do
  bunx ts-mocha -p tsconfig.json --exit -t 1000000 ./tests/${test_file} || {
    cleanup_validator
    exit 1
  }
done

cleanup_validator
