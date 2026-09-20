/**
 * @file webrtc_manager.js
 * @description WebRTC 连接与 DataChannel 生命周期管理器
 */

import { SIGNAL_TYPES } from './protocol.js';

export const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.qq.com:3478' },
];

export class WebRTCManager {
  /**
   * @param {object} options
   * @param {(signalType: string, payload: any) => void} options.sendSignal
   * @param {() => void} [options.onConnected]
   * @param {() => void} [options.onDisconnected]
   * @param {(data: string) => void} [options.onTextMessage]
   * @param {(data: ArrayBuffer) => void} [options.onBinaryMessage]
   * @param {(state: string) => void} [options.onStateChange]
   * @param {RTCIceServer[]} [options.iceServers]
   */
  constructor(options) {
    this.sendSignal = options.sendSignal;
    this.onConnected = options.onConnected;
    this.onDisconnected = options.onDisconnected;
    this.onTextMessage = options.onTextMessage;
    this.onBinaryMessage = options.onBinaryMessage;
    this.onStateChange = options.onStateChange;
    this.iceServers = options.iceServers || DEFAULT_ICE_SERVERS;

    this.pc = null;
    this.dataChannel = null;
    this.isInitiator = false;
    this.pendingCandidates = [];
  }

  /**
   * 初始化 PeerConnection
   */
  initPeerConnection() {
    if (this.pc) {
      this.destroy();
    }

    this.pc = new RTCPeerConnection({
      iceServers: this.iceServers,
    });

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal(SIGNAL_TYPES.CANDIDATE, { candidate: event.candidate });
      }
    };

    this.pc.onconnectionstatechange = () => {
      if (this.onStateChange) {
        this.onStateChange(this.pc.connectionState);
      }
      if (this.pc.connectionState === 'disconnected' || this.pc.connectionState === 'failed') {
        if (this.onDisconnected) this.onDisconnected();
      }
    };

    this.pc.ondatachannel = (event) => {
      this.setupDataChannel(event.channel);
    };
  }

  /**
   * 配置 DataChannel 事件监听
   * @param {RTCDataChannel} channel
   */
  setupDataChannel(channel) {
    this.dataChannel = channel;
    this.dataChannel.binaryType = 'arraybuffer';

    this.dataChannel.onopen = () => {
      if (this.onConnected) this.onConnected();
    };

    this.dataChannel.onclose = () => {
      if (this.onDisconnected) this.onDisconnected();
    };

    this.dataChannel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        if (this.onTextMessage) this.onTextMessage(event.data);
      } else if (event.data instanceof ArrayBuffer) {
        if (this.onBinaryMessage) this.onBinaryMessage(event.data);
      }
    };
  }

  /**
   * 发起方：创建 DataChannel 并生成 Offer
   */
  async startAsInitiator() {
    this.isInitiator = true;
    this.initPeerConnection();

    const channel = this.pc.createDataChannel('file-transfer', { ordered: true });
    this.setupDataChannel(channel);

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    this.sendSignal(SIGNAL_TYPES.OFFER, {
      sdp: offer.sdp,
      type: offer.type,
    });
  }

  /**
   * 接收方：处理对端的 Offer，并回复 Answer
   * @param {{ sdp: string, type: RTCSdpType }} offerData
   */
  async handleOffer(offerData) {
    this.isInitiator = false;
    this.initPeerConnection();

    await this.pc.setRemoteDescription(new RTCSessionDescription(offerData));

    // 处理提前缓存的候选地址
    while (this.pendingCandidates.length > 0) {
      const cand = this.pendingCandidates.shift();
      await this.pc.addIceCandidate(cand);
    }

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    this.sendSignal(SIGNAL_TYPES.ANSWER, {
      sdp: answer.sdp,
      type: answer.type,
    });
  }

  /**
   * 发起方：处理对端的 Answer
   * @param {{ sdp: string, type: RTCSdpType }} answerData
   */
  async handleAnswer(answerData) {
    if (!this.pc) return;
    await this.pc.setRemoteDescription(new RTCSessionDescription(answerData));

    while (this.pendingCandidates.length > 0) {
      const cand = this.pendingCandidates.shift();
      await this.pc.addIceCandidate(cand);
    }
  }

  /**
   * 处理对端发来的 ICE Candidate
   * @param {RTCIceCandidateInit} candidateData
   */
  async handleCandidate(candidateData) {
    if (!this.pc || !this.pc.remoteDescription) {
      this.pendingCandidates.push(candidateData);
      return;
    }
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidateData));
    } catch (err) {
      console.error('Error adding received ice candidate:', err);
    }
  }

  /**
   * 销毁连接与释放资源
   */
  destroy() {
    if (this.dataChannel) {
      try {
        this.dataChannel.close();
      } catch (_) {}
      this.dataChannel = null;
    }
    if (this.pc) {
      try {
        this.pc.close();
      } catch (_) {}
      this.pc = null;
    }
    this.pendingCandidates = [];
  }
}
