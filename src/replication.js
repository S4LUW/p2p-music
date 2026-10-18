import { problem } from './sync.js';

// Single-instance, expiring coordination. Audio never passes through the API.
export function createReplication(peers, now = Date.now) {
  const leases = new Map();
  const firstSeen = new Map();
  const TARGET = 16;
  function inventory(body, previous) {
    if (body.inventory === undefined) return previous;
    if (!Array.isArray(body.inventory) || body.inventory.length > 4096) throw problem(400, 'Inventário inválido.');
    const result = new Map();
    for (const item of body.inventory) {
      if (!Array.isArray(item) || item.length !== 2 || !/^[a-f0-9]{64}$/.test(item[0]) || !Number.isSafeInteger(item[1]) || item[1] < 1 || item[1] > 104857600 || result.has(item[0])) throw problem(400, 'Inventário inválido.');
      result.set(item[0], item[1]);
    }
    let total = result.size;
    for (const peer of peers.values()) if (peer.inventory !== previous) total += peer.inventory?.size ?? 0;
    if (total > 200000) throw problem(429, 'Índice de fontes ocupado.');
    return result;
  }
  function plan(peerId, body) {
    const self = peers.get(peerId);
    const time = now();
    for (const [target, lease] of leases) {
      if (lease.until <= time || !peers.has(target) || !peers.has(lease.peerId) || peers.get(target).inventory?.has(lease.id)) leases.delete(target);
    }
    const sources = new Map();
    for (const [id, peer] of peers) for (const [hash, size] of peer.inventory ?? []) {
      if (!sources.has(hash)) sources.set(hash, []);
      sources.get(hash).push({ peerId: id, size, peer });
    }
    for (const id of firstSeen.keys()) if (!sources.has(id)) firstSeen.delete(id);
    for (const id of sources.keys()) if (!firstSeen.has(id)) firstSeen.set(id, time);
    const counts = Object.fromEntries([...(self.inventory ?? [])].map(([id]) => [id, sources.get(id)?.length ?? 0]));
    const reply = { inventoryRequired: !self.inventory, providerCounts: counts, replication: null, target: TARGET };
    if (!self.inventory) return reply;
    const prior = leases.get(peerId);
    if (prior && body.receiving === prior.id) { prior.until = time + 300000; return reply; }
    if (body.replicationReady !== true || prior) return reply;
    const pending = new Map(); const sending = new Map();
    for (const lease of leases.values()) { pending.set(lease.id, (pending.get(lease.id) ?? 0) + 1); sending.set(lease.peerId, (sending.get(lease.peerId) ?? 0) + 1); }
    const candidates = [...sources].filter(([id, items]) => !self.inventory.has(id) && items.length + (pending.get(id) ?? 0) < TARGET && time - firstSeen.get(id) >= 30000)
      .sort((a, b) => a[1].length - b[1].length || firstSeen.get(a[0]) - firstSeen.get(b[0]));
    for (const [id, items] of candidates) {
      for (const source of items) {
        if ((sending.get(source.peerId) ?? 0) >= 2) continue;
        const addresses = source.peer.addresses.filter(a => !a.circuit || body.relaySupport === true).map(a => a.address);
        if (!addresses.length) continue;
        const task = { id, size: source.size, peerId: source.peerId, addresses };
        leases.set(peerId, { ...task, until: time + 300000 });
        reply.providerCounts[id] = items.length;
        reply.replication = task; return reply;
      }
    }
    return reply;
  }
  return { inventory, plan };
}
