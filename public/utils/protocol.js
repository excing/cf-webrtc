/**
 * @file protocol.js
 * @description WebRTC 信令协议与文件切片传输常量的单一信源 (SSOT)
 * 前后端同构共享，禁止在其他模块硬编码消息类型字符串与阈值。
 */

export const SIGNAL_TYPES = Object.freeze({
  JOIN: 'join',
  ROOM_STATE: 'room-state',
  PEER_JOINED: 'peer-joined',
  PEER_LEFT: 'peer-left',
  OFFER: 'offer',
  ANSWER: 'answer',
  CANDIDATE: 'candidate',
  ERROR: 'error',
  PING: 'ping',
  PONG: 'pong',
});

const VALID_SIGNAL_TYPES = new Set(Object.values(SIGNAL_TYPES));

/**
 * 传输与流控配置
 */
export const CHUNK_CONFIG = Object.freeze({
  // 单片大小 64KB (WebRTC 推荐的安全分片大小)
  CHUNK_SIZE: 64 * 1024,
  // 高水位：当 DataChannel.bufferedAmount 超过 1MB 时暂停读取发送
  HIGH_WATER_MARK: 1024 * 1024,
  // 低水位：当 DataChannel.bufferedAmount 降至 256KB 时恢复发送
  LOW_WATER_MARK: 256 * 1024,
  // 握手超时时间 (ms)
  HANDSHAKE_TIMEOUT_MS: 30000,
});

/**
 * 创建标准信令消息字符串
 * @param {string} type
 * @param {Record<string, any>} payload
 * @returns {string}
 */
export function createSignalMessage(type, payload = {}) {
  if (!VALID_SIGNAL_TYPES.has(type)) {
    throw new Error(`Invalid signal type: ${type}`);
  }
  return JSON.stringify({
    type,
    payload,
    timestamp: Date.now(),
  });
}

/**
 * 解析并校验原始信令消息
 * @param {string | object} raw
 * @returns {{ type: string, payload: any, timestamp: number }}
 */
export function parseSignalMessage(raw) {
  let data;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Malformed signal message: ${err.message}`);
    }
  } else if (raw && typeof raw === 'object') {
    data = raw;
  } else {
    throw new Error('Malformed signal message: input must be string or object');
  }

  if (!data || !VALID_SIGNAL_TYPES.has(data.type)) {
    throw new Error(`Unknown signal type: ${data?.type}`);
  }

  return {
    type: data.type,
    payload: data.payload || {},
    timestamp: data.timestamp || Date.now(),
  };
}
