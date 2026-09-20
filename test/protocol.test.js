import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIGNAL_TYPES,
  CHUNK_CONFIG,
  DEFAULT_ICE_SERVERS,
  createSignalMessage,
  parseSignalMessage,
} from '../public/utils/protocol.js';

describe('Signaling Protocol (SSOT)', () => {
  it('should have standard signal types defined', () => {
    assert.equal(SIGNAL_TYPES.JOIN, 'join');
    assert.equal(SIGNAL_TYPES.OFFER, 'offer');
    assert.equal(SIGNAL_TYPES.ANSWER, 'answer');
    assert.equal(SIGNAL_TYPES.CANDIDATE, 'candidate');
    assert.equal(SIGNAL_TYPES.PEER_JOINED, 'peer-joined');
    assert.equal(SIGNAL_TYPES.PEER_LEFT, 'peer-left');
    assert.equal(SIGNAL_TYPES.ERROR, 'error');
  });

  it('should create valid JSON string message with createSignalMessage', () => {
    const msgStr = createSignalMessage(SIGNAL_TYPES.JOIN, { peerId: 'peer_1', name: 'MacBook' });
    const parsed = JSON.parse(msgStr);
    assert.equal(parsed.type, 'join');
    assert.equal(parsed.payload.peerId, 'peer_1');
    assert.equal(parsed.payload.name, 'MacBook');
    assert.ok(typeof parsed.timestamp === 'number');
  });

  it('should throw error when creating message with unknown type', () => {
    assert.throws(() => {
      createSignalMessage('UNKNOWN_TYPE', {});
    }, /Invalid signal type/);
  });

  it('should successfully parse valid signal message JSON string', () => {
    const raw = JSON.stringify({
      type: SIGNAL_TYPES.OFFER,
      payload: { sdp: 'dummy-sdp' },
      timestamp: 123456789,
    });
    const parsed = parseSignalMessage(raw);
    assert.equal(parsed.type, 'offer');
    assert.equal(parsed.payload.sdp, 'dummy-sdp');
  });

  it('should reject malformed or invalid signal message', () => {
    assert.throws(() => {
      parseSignalMessage('invalid-json');
    }, /Malformed signal message/);

    assert.throws(() => {
      parseSignalMessage(JSON.stringify({ type: 'hack', payload: {} }));
    }, /Unknown signal type/);
  });

  it('should define reasonable chunking and backpressure constants', () => {
    assert.equal(CHUNK_CONFIG.CHUNK_SIZE, 64 * 1024);
    assert.ok(CHUNK_CONFIG.HIGH_WATER_MARK > CHUNK_CONFIG.LOW_WATER_MARK);
    assert.ok(CHUNK_CONFIG.LOW_WATER_MARK >= CHUNK_CONFIG.CHUNK_SIZE);
  });

  it('should configure multi-vendor high-availability ICE/STUN servers', () => {
    assert.ok(Array.isArray(DEFAULT_ICE_SERVERS));
    assert.ok(DEFAULT_ICE_SERVERS.length >= 6);

    const urls = DEFAULT_ICE_SERVERS.map((s) => s.urls);
    // Cloudflare Anycast
    assert.ok(urls.some((u) => u.includes('cloudflare.com')));
    // Google group
    assert.ok(urls.some((u) => u.includes('google.com')));
    // Tencent group (domestic CN)
    assert.ok(urls.some((u) => u.includes('qq.com')));
    // Port 443 fallback (firewall bypass)
    assert.ok(urls.some((u) => u.includes(':443')));
  });
});

