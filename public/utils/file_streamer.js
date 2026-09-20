/**
 * @file file_streamer.js
 * @description WebRTC DataChannel 文件分片流式传输引擎
 * 具备严格背压流控 (Backpressure Control) 与直接落盘机制，防止内存 OOM
 */

import { CHUNK_CONFIG } from './protocol.js';

const HEADER_SIZE = 8; // 4 字节 fileId + 4 字节 chunkIndex

/**
 * 计算总分片数
 * @param {number} fileSize
 * @param {number} [chunkSize=CHUNK_CONFIG.CHUNK_SIZE]
 * @returns {number}
 */
export function calculateTotalChunks(fileSize, chunkSize = CHUNK_CONFIG.CHUNK_SIZE) {
  if (fileSize <= 0) return 1;
  return Math.ceil(fileSize / chunkSize);
}

/**
 * 封装带有 8 字节二进制包头的分片数据包
 * @param {number} fileId
 * @param {number} chunkIndex
 * @param {Uint8Array} dataBytes
 * @returns {Uint8Array}
 */
export function encodeChunkPacket(fileId, chunkIndex, dataBytes) {
  const packet = new Uint8Array(HEADER_SIZE + dataBytes.byteLength);
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);

  view.setUint32(0, fileId, false); // big-endian
  view.setUint32(4, chunkIndex, false);
  packet.set(dataBytes, HEADER_SIZE);

  return packet;
}

/**
 * 解析带有 8 字节二进制包头的分片数据包
 * @param {ArrayBuffer | Uint8Array} buffer
 * @returns {{ fileId: number, chunkIndex: number, data: Uint8Array }}
 */
export function decodeChunkPacket(buffer) {
  const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (uint8.byteLength < HEADER_SIZE) {
    throw new Error('Packet too small to contain header');
  }

  const view = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);
  const fileId = view.getUint32(0, false);
  const chunkIndex = view.getUint32(4, false);
  const data = uint8.subarray(HEADER_SIZE);

  return { fileId, chunkIndex, data };
}

/**
 * 等待 DataChannel 缓冲区降至低水位 (背压控制)
 * @param {RTCDataChannel} channel
 * @returns {Promise<void>}
 */
export function waitForLowWater(channel) {
  return new Promise((resolve) => {
    if (channel.bufferedAmount <= CHUNK_CONFIG.LOW_WATER_MARK) {
      resolve();
      return;
    }

    channel.bufferedAmountLowThreshold = CHUNK_CONFIG.LOW_WATER_MARK;
    const onLow = () => {
      channel.removeEventListener('bufferedamountlow', onLow);
      resolve();
    };
    channel.addEventListener('bufferedamountlow', onLow);
  });
}

/**
 * 文件发送器
 */
export class FileSender {
  /**
   * @param {RTCDataChannel} channel
   * @param {File} file
   * @param {number} fileId
   * @param {object} callbacks
   * @param {(progress: number, speedBytesPerSec: number) => void} [callbacks.onProgress]
   * @param {() => void} [callbacks.onComplete]
   * @param {(err: Error) => void} [callbacks.onError]
   */
  constructor(channel, file, fileId, callbacks = {}) {
    this.channel = channel;
    this.file = file;
    this.fileId = fileId;
    this.callbacks = callbacks;
    this.totalChunks = calculateTotalChunks(file.size, CHUNK_CONFIG.CHUNK_SIZE);
    this.aborted = false;
  }

  abort() {
    this.aborted = true;
  }

  async start() {
    try {
      // 1. 发送文件元数据控制帧
      this.channel.send(
        JSON.stringify({
          action: 'file-meta',
          fileId: this.fileId,
          name: this.file.name,
          size: this.file.size,
          type: this.file.type || 'application/octet-stream',
          totalChunks: this.totalChunks,
        })
      );

      let offset = 0;
      let chunkIndex = 0;
      let sentBytesSinceSample = 0;
      let lastSampleTime = Date.now();
      let currentSpeed = 0;

      // 2. 逐片读取并发送
      while (offset < this.file.size) {
        if (this.aborted) {
          this.channel.send(JSON.stringify({ action: 'file-cancel', fileId: this.fileId }));
          return;
        }

        // 背压检查：缓冲区过大时挂起等待
        if (this.channel.bufferedAmount > CHUNK_CONFIG.HIGH_WATER_MARK) {
          await waitForLowWater(this.channel);
        }

        const slice = this.file.slice(offset, offset + CHUNK_CONFIG.CHUNK_SIZE);
        const arrayBuf = await slice.arrayBuffer();
        const packet = encodeChunkPacket(this.fileId, chunkIndex, new Uint8Array(arrayBuf));

        this.channel.send(packet);

        offset += arrayBuf.byteLength;
        chunkIndex++;
        sentBytesSinceSample += arrayBuf.byteLength;

        // 速度与进度计算 (每 200ms 刷新一次采样)
        const now = Date.now();
        const elapsed = now - lastSampleTime;
        if (elapsed >= 200) {
          currentSpeed = (sentBytesSinceSample / elapsed) * 1000;
          sentBytesSinceSample = 0;
          lastSampleTime = now;
        }

        const progress = Math.min(100, (offset / this.file.size) * 100);
        if (this.callbacks.onProgress) {
          this.callbacks.onProgress(progress, currentSpeed);
        }
      }

      // 等待底层全部冲刷出去
      if (this.channel.bufferedAmount > 0) {
        await waitForLowWater(this.channel);
      }

      // 3. 发送完成标志帧
      this.channel.send(
        JSON.stringify({
          action: 'file-end',
          fileId: this.fileId,
        })
      );

      if (this.callbacks.onComplete) {
        this.callbacks.onComplete();
      }
    } catch (err) {
      if (this.callbacks.onError) {
        this.callbacks.onError(err);
      }
    }
  }
}

/**
 * 文件接收器
 */
export class FileReceiver {
  /**
   * @param {object} meta
   * @param {object} callbacks
   * @param {(progress: number, speedBytesPerSec: number) => void} [callbacks.onProgress]
   * @param {(blob: Blob, meta: object) => void} [callbacks.onComplete]
   */
  constructor(meta, callbacks = {}) {
    this.meta = meta;
    this.callbacks = callbacks;
    this.chunks = [];
    this.receivedBytes = 0;
    this.receivedChunks = 0;
    this.lastSampleTime = Date.now();
    this.bytesSinceSample = 0;
    this.currentSpeed = 0;
    this.writableStream = null;
  }

  /**
   * 写入分片
   * @param {number} chunkIndex
   * @param {Uint8Array} data
   */
  async appendChunk(chunkIndex, data) {
    if (this.writableStream) {
      await this.writableStream.write(data);
    } else {
      this.chunks.push(data);
    }

    this.receivedBytes += data.byteLength;
    this.receivedChunks++;
    this.bytesSinceSample += data.byteLength;

    const now = Date.now();
    const elapsed = now - this.lastSampleTime;
    if (elapsed >= 200) {
      this.currentSpeed = (this.bytesSinceSample / elapsed) * 1000;
      this.bytesSinceSample = 0;
      this.lastSampleTime = now;
    }

    const progress = Math.min(100, (this.receivedBytes / this.meta.size) * 100);
    if (this.callbacks.onProgress) {
      this.callbacks.onProgress(progress, this.currentSpeed);
    }
  }

  /**
   * 完成接收
   * @returns {Promise<Blob | null>}
   */
  async finalize() {
    if (this.writableStream) {
      await this.writableStream.close();
      if (this.callbacks.onComplete) {
        this.callbacks.onComplete(null, this.meta);
      }
      return null;
    }

    const blob = new Blob(this.chunks, { type: this.meta.type });
    if (this.callbacks.onComplete) {
      this.callbacks.onComplete(blob, this.meta);
    }
    return blob;
  }
}
