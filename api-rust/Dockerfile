# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM rust:latest AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cache dependency compilation separately from source
COPY Cargo.toml Cargo.lock ./
# Create a dummy main so `cargo build --release` can cache deps
RUN mkdir src && echo 'fn main(){}' > src/main.rs && touch src/lib.rs && \
    cargo build --release -j1 && \
    rm -rf src

# Now copy real source and rebuild (only app code recompiles, deps are cached)
COPY src ./src
RUN touch src/main.rs src/lib.rs && cargo build --release -j1

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/server ./server

EXPOSE 3001

CMD ["./server"]
