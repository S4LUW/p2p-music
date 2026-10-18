import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDiscovery } from '../src/discovery.js';
const session = (account, device) => ({ account_id: account, device_id: device });
const body = (letter, ip = '127.0.0.1') => {
  const peerId = '12D3KooW' + letter.repeat(44);
  return { peerId, protocolVersion: 3, addresses: [`/ip4/${ip}/tcp/41001/p2p/${peerId}`] };
};
test('presence expires, shares addresses across accounts, bounds candidates and removes logout', () => {
  let time = 0;
  const directory = createDiscovery({ now: () => time });
  assert.equal(directory.heartbeat(session('a', '1'), body('A')).activePeers, 1);
  assert.equal(directory.heartbeat(session('b', '2'), body('B')).peers.length, 1);
  assert.equal(directory.heartbeat(session('a', '3'), body('C')).peers.length, 2);
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

test('different accounts receive LAN addresses alongside public addresses', () => {
  const directory = createDiscovery();
  const source = body('A', '192.168.1.113');
  source.addresses.push(`/ip4/54.232.189.113/tcp/41001/p2p/${source.peerId}`);
  directory.heartbeat(session('curator', 'a'), source);
  const result = directory.heartbeat(session('listener', 'b'), body('B', '192.168.1.120'));
  assert.deepEqual(result.peers, [{ peerId: source.peerId, addresses: source.addresses }]);
});

test('source batches count live announcements, cap candidates, exclude self and expire', () => {
 let time = 0; const d = createDiscovery({now: () => time}); const id = 'a'.repeat(64), absent = 'b'.repeat(64);
 for (const letter of 'ABCDEFG') d.heartbeat(session(letter, '1'), {...body(letter, '192.168.1.10'), inventory: [[id, 1000]]});
 const result = d.sources({ids:[id, absent], excludePeer:body('A').peerId});
 assert.equal(result.files[id].count,6); assert.equal(result.files[id].providers.length,4);
 assert(!result.files[id].providers.some(p=>p.peerId===body('A').peerId));
 assert.deepEqual(result.files[absent], {count:0,providers:[]}); assert.equal(result.ttlSeconds,30);
 d.remove(session('B','1')); assert.equal(d.sources({ids:[id]}).files[id].count,6);
 d.heartbeat(session('C','1'), {...body('C'),inventory:[]}); assert.equal(d.sources({ids:[id]}).files[id].count,5);
 time=180001; assert.equal(d.sources({ids:[id]}).files[id].count,0);
 for (const ids of [[], Array(65).fill(id), ['bad']]) assert.throws(()=>d.sources({ids}));
});

test('on-demand heartbeat does not return unsolicited connection candidates', () => {
 const d = createDiscovery();
 d.heartbeat(session('a','1'),body('A'));
 const result=d.heartbeat(session('b','2'),{...body('B'),onDemand:true});
 assert.equal(result.activePeers,2); assert.deepEqual(result.peers,[]);
 assert.equal(d.heartbeat(session('b','2'),body('B')).peers.length,1);
});
