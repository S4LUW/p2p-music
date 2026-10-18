FROM rust:1-slim-bookworm AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked

FROM debian:bookworm-slim
RUN groupadd --gid 10001 relay && useradd --uid 10001 --gid 10001 --no-create-home relay && mkdir /data && chown relay:relay /data
COPY --from=build /app/target/release/p2p-music-relay /usr/local/bin/p2p-music-relay
USER 10001:10001
ENV RELAY_DATA_DIR=/data RELAY_PORT=4001
VOLUME ["/data"]
EXPOSE 4001/tcp
ENTRYPOINT ["p2p-music-relay"]
