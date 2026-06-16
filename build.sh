home() {
    cd "$(git rev-parse --show-toplevel)" || exit 1
}

anchor_test=false
if [[ "$1" == "--anchor-test" ]]; then
    anchor_test=true
fi

# return root level of the git repo
home

if [[ $(uname -m) == "arm64" ]]; then
    echo "Running on Apple Silicon, using x86-64 toolchain"
    rustup override set 1.91.1-x86_64-apple-darwin
else
    rustup override set 1.91.1
fi

# check that "solana" returns output from the command line
solana_cli_exists=$(solana --version)
if [[ -z $solana_cli_exists ]]; then
    echo "Installing Agave CLI..."
    sh -c "$(curl -sSfL https://release.anza.xyz/v2.3.11/install)" || exit 1
fi

avm_cli_exists=$(avm --version)
if [[ -z $avm_cli_exists ]]; then
    echo "Please install Anchor here: https://www.anchor-lang.com/docs/installation"
    exit 1
fi

agave-install init 2.3.11 || solana-install init 2.3.11

avm use 1.0.0

# The SBF program build needs platform-tools >= v1.52 (rustc 1.89) to parse the
# edition2024 crates pulled in transitively via the velocity (shadow) dep + Anchor 1.0.
# agave 2.3.11 ships platform-tools v1.48 (rustc 1.84) which can't. Build the .so with
# the 3.1.x cargo-build-sbf; its bytecode stays compatible with the 2.3.11 runtime/validator.
SBF_SOLANA_VERSION=3.1.9
SBF_BIN="$HOME/.local/share/solana/install/releases/${SBF_SOLANA_VERSION}/solana-release/bin"
if [[ ! -x "$SBF_BIN/cargo-build-sbf" ]]; then
    echo "Installing solana ${SBF_SOLANA_VERSION} for the SBF build toolchain..."
    agave-install init "$SBF_SOLANA_VERSION" && agave-install init 2.3.11
fi

cargo build || exit 1

if [[ "$anchor_test" == true ]]; then
    echo "Building with anchor-test"
    PATH="$SBF_BIN:$PATH" anchor build --ignore-keys -- --features anchor-test || exit 1
else
    echo "Building without anchor-test"
    PATH="$SBF_BIN:$PATH" anchor build --ignore-keys || exit 1
fi

cargo fmt || exit 1

yarn && cd ts/sdk && yarn && yarn build || exit 1

home

yarn prettify:fix || exit 1