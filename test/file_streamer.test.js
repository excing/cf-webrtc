import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeChunkPacket,
  decodeChunkPacket,
  calculateTotalChunks,
} from '../public/utils/file_streamer.js';
import { CHUNK_CONFIG } from '../public/utils/protocol.js';

describe('File Streamer Binary Packet Protocol', () => {
  it('should calculate total chunks correctly', () => {
    assert.equal(calculateTotalChunks(0, 64 * 1024), 1);
    assert.equal(calculateTotalChunks(64 * 1024, 64 * 1024), 1);
    assert.equal(calculateTotalChunks(64 * 1024 + 1, 64 * 1024), 2);
    assert.equal(calculateTotalChunks(100 * 1024 * 1024, 64 * 1024), 1600);
  });

  it('should encode and decode chunk packet with binary header correctly', () => {
    const rawData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const fileId = 42;
    const chunkIndex = 100;

    const packet = encodeChunkPacket(fileId, chunkIndex, rawData);
    assert.ok(packet instanceof Uint8Array || packet instanceof ArrayBuffer);

    const decoded = decodeChunkPacket(packet);
    assert.equal(decoded.fileId, fileId);
    assert.equal(decoded.chunkIndex, chunkIndex);
    assert.deepEqual(Array.from(decoded.data), [1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
