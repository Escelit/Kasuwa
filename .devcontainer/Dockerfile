FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

# Install basic development dependencies
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y --no-install-recommends \
        build-essential \
        curl \
        git \
        pkg-config \
        libssl-dev \
        ca-certificates \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 & pnpm
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g pnpm@11

# Switch to non-root vscode user for Rust installation
USER vscode
ENV HOME=/home/vscode
ENV PATH="${HOME}/.cargo/bin:${PATH}"

# Install Rust stable and WASM targets
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
    && rustup default stable \
    && rustup target add wasm32v1-none wasm32-unknown-unknown \
    && rustup component add clippy rustfmt

# Install Stellar CLI
RUN cargo install --locked stellar-cli
