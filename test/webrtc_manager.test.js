import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WebRTCManager } from '../public/utils/webrtc_manager.js';

class MockDataChannel {
  constructor() {
    this.readyState = 'open';
    this.sent = [];
    this.binaryType = 'arraybuffer';
  }
  send(data) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 'closed';
  }
}

class MockRTCPeerConnection {
  constructor(config) {
    this.config = config;
    this.connectionState = 'new';
    this.iceConnectionState = 'new';
    this.localDescription = null;
    this.remoteDescription = null;
    this.channels = [];
  }
  createDataChannel(label, opts) {
    const ch = new MockDataChannel();
    this.channels.push(ch);
    return ch;
  }
  async createOffer(opts) {
    return { type: 'offer', sdp: 'dummy-offer', iceRestart: !!opts?.iceRestart };
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'dummy-answer' };
  }
  async setLocalDescription(desc) {
    this.localDescription = desc;
  }
  async setRemoteDescription(desc) {
    this.remoteDescription = desc;
  }
  async addIceCandidate(cand) {}
  close() {
    this.connectionState = 'closed';
  }
}

describe('WebRTCManager Resilience & Keep-alive Logic', () => {
  it('should support ICE restart when network address changes or disconnects', async () => {
    globalThis.RTCPeerConnection = MockRTCPeerConnection;
    globalThis.RTCSessionDescription = class { constructor(init) { Object.assign(this, init); } };

    const signals = [];
    const rtc = new WebRTCManager({
      sendSignal: (type, payload) => signals.push({ type, payload }),
    });

    await rtc.startAsInitiator();
    assert.equal(rtc.isInitiator, true);
    assert.equal(signals.length, 1);
    assert.equal(signals[0].type, 'offer');

    // Trigger ICE Restart
    await rtc.restartIce();
    assert.equal(signals.length, 2);
    assert.equal(signals[1].type, 'offer');
    assert.equal(signals[1].payload.isRestart, true);

    rtc.destroy();
  });
});
