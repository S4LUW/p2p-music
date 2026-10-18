import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscovery } from '../src/discovery.js';
const peer = '12D3KooW' + 'A'.repeat(44), relay = '12D3KooW' + 'B'.repeat(44), other = '12D3KooW' + 'C'.repeat(44);
const base = `/ip4/46.202.148.115/tcp/4001/p2p/${relay}`;
const address = `${base}/p2p-circuit/p2p/${peer}`;
const session = {account_id:'a',device_id:'a'}, id = 'a'.repeat(64);
const body = {peerId:peer,protocolVersion:3,addresses:[address],inventory:[[id,1000]],onDemand:true,relaySupport:true};
test('configured circuits are discoverable by capable clients; legacy clients retain direct routes', () => {
 const d = createDiscovery({relays:[base]});
 assert.deepEqual(d.heartbeat(session,body).relays,[base]);
 assert.equal(d.sources({ids:[id],relaySupport:true}).files[id].count,1);
 assert.deepEqual(d.sources({ids:[id],relaySupport:true}).files[id].providers[0].addresses,[address]);
 assert.equal(d.sources({ids:[id]}).files[id].count,0);
 const lan = `/ip4/192.168.1.2/tcp/41001/p2p/${peer}`;
 d.heartbeat(session,{...body,addresses:[address,lan]});
 assert.deepEqual(d.sources({ids:[id]}).files[id].providers[0].addresses,[lan]);
});
test('circuit target must match identity and relay must be configured', () => {
 const d = createDiscovery({relays:[base]});
 assert.throws(()=>d.heartbeat(session,{...body,addresses:[`${base}/p2p-circuit/p2p/${other}`]}));
 assert.throws(()=>d.heartbeat(session,{...body,addresses:[`${base}/p2p-circuit/p2p/${other}/p2p-circuit/p2p/${peer}`]}));
 const removed = createDiscovery(); removed.heartbeat(session,body);
 assert.equal(removed.sources({ids:[id],relaySupport:true}).files[id].count,0);
 assert.throws(()=>createDiscovery({relays:['bad']}));
 assert.throws(()=>createDiscovery({relays:[base,base,base]}));
});
test('preventive replication supports a source available only through relay', () => {
 let time=0; const d = createDiscovery({relays:[base],now:()=>time}); d.heartbeat(session,body); time=31000;
 const receiver = {peerId:other,protocolVersion:3,addresses:[`/ip4/192.168.1.3/tcp/41001/p2p/${other}`],inventory:[],replicationReady:true,onDemand:true,relaySupport:true};
 const reply = d.heartbeat({account_id:'b',device_id:'b'},receiver);
 assert.equal(reply.replication?.peerId,peer);
 assert.deepEqual(reply.replication?.addresses,[address]);
});
