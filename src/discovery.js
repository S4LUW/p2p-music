import { createReplication } from './replication.js';
import { isIPv4 } from 'node:net';
import { randomInt } from 'node:crypto';
import { problem } from './sync.js';

// Ephemeral presence: one API replica, bounded memory, no PostgreSQL writes.
export function createDiscovery({ now = Date.now, capacity = 10000 } = {}) {
  const peers = new Map();
  const replication = createReplication(peers, now);
  function prune() {
    const time = now();
    for (const [id, peer] of peers) if (peer.expires <= time) peers.delete(id);
  }
  function heartbeat(session, body) {
    if (!body || !/^12D3KooW[1-9A-HJ-NP-Za-km-z]{44}$/.test(body.peerId ?? '') || body.protocolVersion !== 3 || !Array.isArray(body.addresses) || body.addresses.length > 8) throw problem(400, 'Presença inválida.');
    const addresses = [...new Set(body.addresses)].map(address => {
      if (typeof address !== 'string' || address.length > 256) throw problem(400, 'Endereço inválido.');
      const match = address.match(/^\/ip4\/([^/]+)\/tcp\/(\d+)\/p2p\/([^/]+)$/);
      if (!match || !isIPv4(match[1]) || +match[2] < 1 || +match[2] > 65535 || match[3] !== body.peerId) throw problem(400, 'Endereço inválido.');
      const [a, b] = match[1].split('.').map(Number);
      if (a === 0 || a >= 224 || (a === 169 && b === 254)) throw problem(400, 'Endereço não permitido.');
      const local = a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
      return { address, local };
    });
    prune();
    const owner = `${session.account_id}:${session.device_id}`;
    const existing = peers.get(body.peerId);
    if (existing && existing.owner !== owner) throw problem(409, 'Identidade já registrada por outro dispositivo.');
    if (!existing && peers.size >= capacity) throw problem(429, 'Diretório ocupado.');
    for (const [id, peer] of peers) if (peer.owner === owner && id !== body.peerId) peers.delete(id);
    const inventory = replication.inventory(body, existing?.inventory);
    peers.set(body.peerId, { owner, account: session.account_id, addresses, inventory, expires: now() + 180000 });
    const candidates = [];
    let seen = 0;
    for (const [peerId, peer] of peers) {
      if (peerId === body.peerId) continue;
      const visible = peer.addresses.filter(a => !a.local || peer.account === session.account_id).map(a => a.address);
      if (!visible.length) continue;
      const candidate = { peerId, addresses: visible };
      const slot = randomInt(++seen);
      if (candidates.length < 8) candidates.push(candidate);
      else if (slot < 8) candidates[slot] = candidate;
    }
    return { activePeers: peers.size, ttlSeconds: 180, peers: candidates, ...replication.plan(body.peerId, body) };
  }
  function remove(session) {
    const owner = `${session.account_id}:${session.device_id}`;
    for (const [id, peer] of peers) if (peer.owner === owner) peers.delete(id);
  }
  return { heartbeat, remove };
}
