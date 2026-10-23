#!/usr/bin/env bash
set -euo pipefail

echo "Building contracts via stellar-cli..."
cd contracts
stellar contract build
