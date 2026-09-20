import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SignalingRoom } from '../core/signaling_room.js';
import { SIGNAL_TYPES, createSignalMessage, parseSignalMessage } from '../public/utils/protocol.js';

class MockWebSocket {
  constructor() {
    this.sentMessages = [];
    this.attachment = null;
    this.closed = false;
  }
  send(msg) {
    this.sentMessages.push(msg);
  }
  close(code, reason) {
    this.closed = true;
    this.closeCode = code;
    this.closeReason = reason;
  }
  serializeAttachment(data) {
    this.attachment = data;
  }
  deserializeAttachment() {
    return this.attachment;
  }
}

class MockDurableObjectState {
  constructor() {
    this.sockets = [];
  }
  getWebSockets() {
    return this.sockets.filter((s) => !s.closed);
  }
  acceptWebSocket(ws, tags) {
    ws.tags = tags;
    this.sockets.push(ws);
  }
}

describe('SignalingRoom Durable Object Domain Logic', () => {
  it('should accept websocket and notify state on fetch', async () => {
    // Mock WebSocketPair global
    globalThis.WebSocketPair = class {
      constructor() {
        this[0] = new MockWebSocket();
        this[1] = new MockWebSocket();
      }
    };

    const ctx = new MockDurableObjectState();
    const room = new SignalingRoom(ctx, {});

    const req1 = new Request('https://domain.com/ws/ABC234?peerId=p1&deviceName=MacBook', {
      headers: { Upgrade: 'websocket' },
    });
    const res1 = await room.fetch(req1);
    assert.equal(res1.status, 101);
    assert.equal(ctx.getWebSockets().length, 1);

    // Verify first peer received ROOM_STATE
    const serverWs1 = ctx.sockets[0];
    const initialMsg = parseSignalMessage(serverWs1.sentMessages[0]);
    assert.equal(initialMsg.type, SIGNAL_TYPES.ROOM_STATE);
    assert.equal(initialMsg.payload.selfPeerId, 'p1');
    assert.equal(initialMsg.payload.peers.length, 0);

    // Second peer joins
    const req2 = new Request('https://domain.com/ws/ABC234?peerId=p2&deviceName=iPhone', {
      headers: { Upgrade: 'websocket' },
    });
    const res2 = await room.fetch(req2);
    assert.equal(res2.status, 101);
    assert.equal(ctx.getWebSockets().length, 2);

    // Verify peer1 received PEER_JOINED
    const peer1JoinedMsg = parseSignalMessage(serverWs1.sentMessages[1]);
    assert.equal(peer1JoinedMsg.type, SIGNAL_TYPES.PEER_JOINED);
    assert.equal(peer1JoinedMsg.payload.peerId, 'p2');
    assert.equal(peer1JoinedMsg.payload.deviceName, 'iPhone');

    // Third peer tries to join -> room is full
    const req3 = new Request('https://domain.com/ws/ABC234?peerId=p3&deviceName=iPad', {
      headers: { Upgrade: 'websocket' },
    });
    const res3 = await room.fetch(req3);
    assert.equal(res3.status, 403);
  });

  it('should relay offer, answer, and candidates to other peers', async () => {
    const ctx = new MockDurableObjectState();
    const room = new SignalingRoom(ctx, {});

    const ws1 = new MockWebSocket();
    ws1.serializeAttachment({ peerId: 'p1', deviceName: 'PC' });
    ctx.sockets.push(ws1);

    const ws2 = new MockWebSocket();
    ws2.serializeAttachment({ peerId: 'p2', deviceName: 'Phone' });
    ctx.sockets.push(ws2);

    // ws1 sends offer
    const offerMsg = createSignalMessage(SIGNAL_TYPES.OFFER, { sdp: 'v=0...' });
    await room.webSocketMessage(ws1, offerMsg);

    // ws2 should receive relayed offer
    assert.equal(ws2.sentMessages.length, 1);
    const relayed = parseSignalMessage(ws2.sentMessages[0]);
    assert.equal(relayed.type, SIGNAL_TYPES.OFFER);
    assert.equal(relayed.payload.sdp, 'v=0...');
    assert.equal(relayed.payload.fromPeerId, 'p1');

    // ws1 should NOT receive its own offer
    assert.equal(ws1.sentMessages.length, 0);
  });

  it('should notify remaining peers on webSocketClose', async () => {
    const ctx = new MockDurableObjectState();
    const room = new SignalingRoom(ctx, {});

    const ws1 = new MockWebSocket();
    ws1.serializeAttachment({ peerId: 'p1', deviceName: 'PC' });
    ctx.sockets.push(ws1);

    const ws2 = new MockWebSocket();
    ws2.serializeAttachment({ peerId: 'p2', deviceName: 'Phone' });
    ctx.sockets.push(ws2);

    // ws1 disconnects
    ws1.closed = true;
    await room.webSocketClose(ws1, 1000, 'Normal closure', true);

    // ws2 should receive PEER_LEFT
    assert.equal(ws2.sentMessages.length, 1);
    const leaveMsg = parseSignalMessage(ws2.sentMessages[0]);
    assert.equal(leaveMsg.type, SIGNAL_TYPES.PEER_LEFT);
    assert.equal(leaveMsg.payload.peerId, 'p1');
  });
});
