/**
 * @file index.js
 * @description Cloudflare Worker 主入口，基于 Hono 路由与 Durable Objects 转发
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { generateRoomCode, isValidRoomCode } from './core/room_code.js';
import { SignalingRoom } from './core/signaling_room.js';

// 导出 Durable Object 类，供 Cloudflare 边缘运行时根据 wrangler.toml 绑定实例化
export { SignalingRoom };

const app = new Hono();

app.use('*', cors());

/**
 * 房间创建接口
 * 生成 6 位无歧义房间短码
 */
app.post('/api/room/new', (c) => {
  const code = generateRoomCode();
  return c.json({
    code,
    createdAt: Date.now(),
  });
});

/**
 * 房间验证接口
 */
app.get('/api/room/verify/:code', (c) => {
  const code = c.req.param('code');
  const valid = isValidRoomCode(code);
  return c.json({
    valid,
    code: valid ? code.trim().toUpperCase() : null,
  });
});

/**
 * WebSocket 信令接入点
 * /ws/:roomId 路由直接打到对应 roomId 的 Durable Object 单例
 */
app.all('/ws/:roomId', async (c) => {
  const roomId = c.req.param('roomId')?.trim()?.toUpperCase();
  if (!roomId || !isValidRoomCode(roomId)) {
    return c.text('Invalid room code', 400);
  }

  if (!c.env.SIGNALING_ROOM) {
    return c.text('Durable Object binding SIGNALING_ROOM not configured', 500);
  }

  // 通过名称哈希得到一致性的 DO 实例 ID
  const id = c.env.SIGNALING_ROOM.idFromName(roomId);
  const roomStub = c.env.SIGNALING_ROOM.get(id);

  // 将原生请求转发给 Durable Object 完成 WebSocket Upgrade
  return roomStub.fetch(c.req.raw);
});

export default app;
