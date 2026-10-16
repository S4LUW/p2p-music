import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDiscovery } from '../src/discovery.js';
const session = (account, device) => ({ account_id: account, device_id: device });
const body = (letter, ip = '127.0.0.1') => {
  const peerId = '12D3KooW' + letter.repeat(44);
  return { peerId, protocolVersion: 3, addresses: [`/ip4/${ip}/tcp/41001/p2p/${peerId}`] };
};
test('presence expires, isolates private addresses, bounds candidates and removes logout', () => {
  let time = 0;
  const directory = createDiscovery({ now: () => time });
  assert.equal(directory.heartbeat(session('a', '1'), body('A')).activePeers, 1);
  assert.equal(directory.heartbeat(session('b', '2'), body('B')).peers.length, 0);
  assert.equal(directory.heartbeat(session('a', '3'), body('C')).peers.length, 1);
  directory.heartbeat(session('b', '2'), body('B', '8.8.8.8'));
  assert.equal(directory.heartbeat(session('a', '3'), body('C')).peers.length, 2);
  assert.throws(() => directory.heartbeat(session('b', '4'), body('A')), /Identidade/);
  directory.remove(session('a', '1'));
  assert.equal(directory.heartbeat(session('a', '3'), body('C')).activePeers, 2);
  time = 180001;
  assert.equal(directory.heartbeat(session('a', '3'), body('C')).activePeers, 1);
  for (const letter of 'DEFGHJKLMNPQ') directory.heartbeat(session('a', letter), body(letter));
  assert.equal(directory.heartbeat(session('a', '3'), body('C')).peers.length, 8);
});
test('invalid addresses and full directory are rejected', () => {
  const directory = createDiscovery({ capacity: 1 });
  for (const ip of ['0.0.0.0', '169.254.169.254', '224.0.0.1', '999.1.1.1']) assert.throws(() => directory.heartbeat(session('a', '1'), body('A', ip)));
  directory.heartbeat(session('a', '1'), body('A'));
  assert.throws(() => directory.heartbeat(session('a', '2'), body('B')), /ocupado/);
});
