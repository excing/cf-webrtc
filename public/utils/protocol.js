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
 * 默认多厂商联合高可用 STUN 列表 (按厂商网络地域与端口分层容灾)
 */
export const DEFAULT_ICE_SERVERS = Object.freeze([
  // 1. Cloudflare 全球 Anycast 边缘 (与 Worker 部署同网生态，低延迟)
  { urls: 'stun:stun.cloudflare.com:3478' },
  // 2. 国内厂商低延迟节点 (针对中国大陆三大运营商网络优化)
  { urls: 'stun:stun.qq.com:3478' },
  { urls: 'stun:stun.chat.bilibili.com:3478' },
  // 3. Google 官方全球分布式节点群 (高可用灾备)
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  // 4. 支持 443 端口备用节点 (规避企业/校园网对 3478 UDP 端口的封锁)
  { urls: 'stun:stun.nextcloud.com:443' },
  // 5. 国际电信级服务商
  { urls: 'stun:global.stun.twilio.com:3478' },
]);


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
