# syntax=docker/dockerfile:1
# Build context is the repo root: docker build -f rust/Dockerfile --build-arg BIN=mark-api .
ARG RUST_IMAGE=rust:1.98.1-slim-bookworm
ARG RUNTIME_IMAGE=debian:bookworm-slim

FROM ${RUST_IMAGE} AS builder
ARG BIN=mark-api
ARG MARK_BUILD_SHA=""
ARG MARK_BUILD_REF=""
WORKDIR /build

COPY rust-toolchain.toml ./rust-toolchain.toml
COPY rust/ ./rust/

WORKDIR /build/rust
# Target dir is a cache mount, so the binary is copied out in the same step.
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,target=/build/rust/target,sharing=locked \
    test -n "${BIN}" \
  && MARK_BUILD_SHA="${MARK_BUILD_SHA}" MARK_BUILD_REF="${MARK_BUILD_REF}" \
     cargo build --release --locked --bin "${BIN}" \
  && mkdir -p /build/out \
  && cp "target/release/${BIN}" /build/out/app

FROM ${RUNTIME_IMAGE} AS runtime

# hadolint ignore=DL3008
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends ca-certificates \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1000 mark \
  && useradd --system --uid 1000 --gid 1000 --no-create-home --shell /usr/sbin/nologin mark

COPY --from=builder --chown=root:root --chmod=0755 /build/out/app /usr/local/bin/app

USER 1000:1000
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/app"]
