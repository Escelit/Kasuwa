#!/usr/bin/env bash
set -euo pipefail

echo "Generating TypeScript contract bindings..."

# Ensure contracts are built
if [ ! -f "contracts/target/wasm32v1-none/release/allowance_vault.wasm" ]; then
  echo "Building contracts first..."
  (cd contracts && stellar contract build --package allowance-vault)
fi

stellar contract bindings typescript \
  --wasm contracts/target/wasm32v1-none/release/allowance_vault.wasm \
  --output-dir packages/sdk/src/generated \
  --overwrite

echo "Bindings generated into packages/sdk/src/generated"
