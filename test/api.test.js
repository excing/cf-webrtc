import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import app from '../index.js';

describe('API Routes (Hono)', () => {
  it('POST /api/room/new should return a valid 6-char room code', async () => {
    const res = await app.request('/api/room/new', { method: 'POST' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.code);
    assert.equal(body.code.length, 6);
    assert.ok(typeof body.createdAt === 'number');
  });

  it('GET /api/room/verify/:code should validate correctly', async () => {
    const resValid = await app.request('/api/room/verify/ABC234');
    assert.equal(resValid.status, 200);
    const bodyValid = await resValid.json();
    assert.equal(bodyValid.valid, true);
    assert.equal(bodyValid.code, 'ABC234');

    const resInvalid = await app.request('/api/room/verify/111111');
    assert.equal(resInvalid.status, 200);
    const bodyInvalid = await resInvalid.json();
    assert.equal(bodyInvalid.valid, false);
  });
});
