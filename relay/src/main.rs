use futures::StreamExt;
use libp2p::{SwarmBuilder, identity, noise, swarm::SwarmEvent, yamux};
use std::{error::Error, fs::OpenOptions, io::Write, net::Ipv4Addr, path::Path, time::Duration};

#[derive(libp2p::swarm::NetworkBehaviour)]
struct Behaviour {
    relay: libp2p::relay::Behaviour,
    identify: libp2p::identify::Behaviour,
    autonat: libp2p::autonat::Behaviour,
    limits: libp2p::connection_limits::Behaviour,
}
fn identity(path: &Path) -> Result<identity::Keypair, Box<dyn Error>> {
    if path.exists() {
        return Ok(identity::Keypair::from_protobuf_encoding(&std::fs::read(
            path,
        )?)?);
    }
    let key = identity::Keypair::generate_ed25519();
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(&key.to_protobuf_encoding()?)?;
    file.sync_all()?;
    Ok(key)
}
fn config() -> libp2p::relay::Config {
    libp2p::relay::Config {
        max_reservations: 128,
        max_reservations_per_peer: 1,
        max_circuits: 16,
        max_circuits_per_peer: 4,
        max_circuit_duration: Duration::from_secs(600),
        max_circuit_bytes: 128 * 1024 * 1024,
        ..Default::default()
    }
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let directory = std::env::var("RELAY_DATA_DIR").unwrap_or_else(|_| "/data".into());
    std::fs::create_dir_all(&directory)?;
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(Path::new(&directory).join("relay.lock"))?;
    fs2::FileExt::try_lock_exclusive(&lock)?;
    let key = identity(&Path::new(&directory).join("identity.key"))?;
    let peer = key.public().to_peer_id();
    let ip: Ipv4Addr = std::env::var("RELAY_PUBLIC_IP")?.parse()?;
    if ip.is_unspecified() || ip.is_multicast() || ip.is_broadcast() {
        return Err("Invalid RELAY_PUBLIC_IP".into());
    }
    let port: u16 = std::env::var("RELAY_PORT")
        .unwrap_or_else(|_| "4001".into())
        .parse()?;
    if port == 0 {
        return Err("Invalid RELAY_PORT".into());
    }
    let mut swarm = SwarmBuilder::with_existing_identity(key)
        .with_tokio()
        .with_tcp(
            Default::default(),
            noise::Config::new,
            yamux::Config::default,
        )?
        .with_behaviour(|key| Behaviour {
            relay: libp2p::relay::Behaviour::new(peer, config()),
            identify: libp2p::identify::Behaviour::new(libp2p::identify::Config::new(
                "/p2p-music/relay/1".into(),
                key.public(),
            )),
            autonat: libp2p::autonat::Behaviour::new(
                peer,
                libp2p::autonat::Config {
                    only_global_ips: true,
                    use_connected: false,
                    ..Default::default()
                },
            ),
            limits: libp2p::connection_limits::Behaviour::new(
                libp2p::connection_limits::ConnectionLimits::default()
                    .with_max_pending_incoming(Some(32))
                    .with_max_established(Some(256))
                    .with_max_established_per_peer(Some(4)),
            ),
        })?
        .with_swarm_config(|c| c.with_idle_connection_timeout(Duration::from_secs(90)))
        .build();
    swarm.listen_on(format!("/ip4/0.0.0.0/tcp/{port}").parse()?)?;
    swarm.add_external_address(format!("/ip4/{ip}/tcp/{port}").parse()?);
    println!("P2P_MUSIC_RELAYS=/ip4/{ip}/tcp/{port}/p2p/{peer}");
    println!("Limits: 128 reservations, 16 circuits, 128 MiB and 600 seconds per circuit");
    loop {
        match swarm.select_next_some().await {
            SwarmEvent::NewListenAddr { address, .. } => println!("Listening: {address}"),
            SwarmEvent::Behaviour(BehaviourEvent::Relay(event)) => println!("Relay: {event:?}"),
            SwarmEvent::ListenerError { error, .. } => eprintln!("Listener error: {error}"),
            SwarmEvent::ListenerClosed { reason, .. } => {
                return Err(format!("Listener closed: {reason:?}").into());
            }
            _ => {}
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identity_survives_restart_and_corruption_is_not_silently_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("identity.key");
        let first = identity(&path).unwrap().public().to_peer_id();
        assert_eq!(first, identity(&path).unwrap().public().to_peer_id());
        std::fs::write(&path, b"invalid").unwrap();
        assert!(identity(&path).is_err());
    }
    #[test]
    fn limits_fit_a_music_transfer_and_bound_resource_use() {
        let c = config();
        assert!(c.max_circuit_bytes >= 100 * 1024 * 1024);
        assert_eq!(c.max_circuits, 16);
        assert_eq!(c.max_reservations_per_peer, 1);
    }
}
