/**
 * @file signaling_room.js
 * @description Cloudflare Durable Object 实现的 WebRTC 信令房间
 * 利用 Cloudflare WebSocket Hibernation API，在信令静默期自动挂起，零额外 CPU/费用开销。
 */

import { SIGNAL_TYPES, createSignalMessage, parseSignalMessage } from '../public/utils/protocol.js';

let BaseDurableObject = class {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
};

try {
  const cf = await import('cloudflare:workers').catch(() => null);
  if (cf?.DurableObject) {
    BaseDurableObject = cf.DurableObject;
  }
} catch (_) {}

function createWebSocketResponse(clientWs) {
  try {
    return new Response(null, {
      status: 101,
      webSocket: clientWs,
    });
  } catch (_) {
    const res = new Response(null, { status: 200 });
    Object.defineProperty(res, 'status', { value: 101 });
    res.webSocket = clientWs;
    return res;
  }
}

export class SignalingRoom extends BaseDurableObject {
  /**
   * @param {DurableObjectState} ctx
   * @param {Record<string, any>} env
   */
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  /**
   * HTTP 请求入口（升级 WebSocket 连接）
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  async fetch(request) {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const url = new URL(request.url);
    const peerId = url.searchParams.get('peerId') || crypto.randomUUID();
    const deviceName = url.searchParams.get('deviceName') || 'Unknown Device';

    const currentSockets = this.ctx.getWebSockets();

    // 检查是否同一个 peerId 重新连接，若有老连接先优雅关闭
    for (const ws of currentSockets) {
      const att = ws.deserializeAttachment();
      if (att && att.peerId === peerId) {
        try {
          ws.close(1000, 'Replaced by new connection');
        } catch (_) {}
      }
    }

    // 刷新现有 socket 列表
    const remainingSockets = this.ctx.getWebSockets();

    // 1对1 传输房间，最大允许 2 个客户端同时在线
    if (remainingSockets.length >= 2) {
      return new Response('Room is full (max 2 peers)', { status: 403 });
    }

    // 创建 WebSocket 对
    const pair = new WebSocketPair();
    const clientWs = pair[0];
    const serverWs = pair[1];

    // 接入 Hibernation API，使用 peerId 标记 socket
    this.ctx.acceptWebSocket(serverWs, [peerId]);

    // 附加客户端元数据
    serverWs.serializeAttachment({
      peerId,
      deviceName,
      joinedAt: Date.now(),
    });

    // 通知房间内已有的对端：新设备加入了
    for (const peerWs of remainingSockets) {
      try {
        peerWs.send(createSignalMessage(SIGNAL_TYPES.PEER_JOINED, {
          peerId,
          deviceName,
        }));
      } catch (err) {
        console.error('Failed to notify existing peer:', err);
      }
    }

    // 收集对端列表并回发给新加入者
    const existingPeers = remainingSockets.map((ws) => {
      const att = ws.deserializeAttachment();
      return {
        peerId: att?.peerId,
        deviceName: att?.deviceName,
      };
    });

    try {
      serverWs.send(createSignalMessage(SIGNAL_TYPES.ROOM_STATE, {
        selfPeerId: peerId,
        peers: existingPeers,
      }));
    } catch (err) {
      console.error('Failed to send initial room state:', err);
    }

    return createWebSocketResponse(clientWs);
  }

  /**
   * WebSocket Hibernation: 收到客户端信令消息
   * @param {WebSocket} ws
   * @param {string | ArrayBuffer} message
   */
  async webSocketMessage(ws, message) {
    let parsed;
    try {
      parsed = parseSignalMessage(typeof message === 'string' ? message : new TextDecoder().decode(message));
    } catch (err) {
      ws.send(createSignalMessage(SIGNAL_TYPES.ERROR, { message: `Invalid message: ${err.message}` }));
      return;
    }

    const { type, payload } = parsed;

    // 心跳保活
    if (type === SIGNAL_TYPES.PING) {
      ws.send(createSignalMessage(SIGNAL_TYPES.PONG, {}));
      return;
    }

    const senderAtt = ws.deserializeAttachment();
    const fromPeerId = senderAtt?.peerId;

    // 将 SDP Offer / Answer / ICE Candidate 消息转发给房间内的其他对端
    if (
      type === SIGNAL_TYPES.OFFER ||
      type === SIGNAL_TYPES.ANSWER ||
      type === SIGNAL_TYPES.CANDIDATE
    ) {
      const relayMessage = createSignalMessage(type, {
        ...payload,
        fromPeerId,
      });

      for (const peerWs of this.ctx.getWebSockets()) {
        if (peerWs !== ws) {
          try {
            peerWs.send(relayMessage);
          } catch (err) {
            console.error(`Failed to relay ${type} message:`, err);
          }
        }
      }
    }
  }

  /**
   * WebSocket Hibernation: 客户端断开连接
   * @param {WebSocket} ws
   * @param {number} code
   * @param {string} reason
   * @param {boolean} wasClean
   */
  async webSocketClose(ws, code, reason, wasClean) {
    const att = ws.deserializeAttachment();
    const peerId = att?.peerId;

    // 通知房间剩余对端：该设备已离开
    for (const peerWs of this.ctx.getWebSockets()) {
      if (peerWs !== ws) {
        try {
          peerWs.send(createSignalMessage(SIGNAL_TYPES.PEER_LEFT, { peerId }));
        } catch (_) {}
      }
    }
  }

  /**
   * WebSocket Hibernation: 发生连接错误
   * @param {WebSocket} ws
   * @param {any} error
   */
  async webSocketError(ws, error) {
    console.error('WebSocket error in SignalingRoom:', error);
    try {
      ws.close(1011, 'Internal server error');
    } catch (_) {}
  }
}
