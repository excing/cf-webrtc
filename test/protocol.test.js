import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIGNAL_TYPES,
  CHUNK_CONFIG,
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
});
