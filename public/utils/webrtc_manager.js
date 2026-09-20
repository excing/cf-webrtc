/**
 * @file webrtc_manager.js
 * @description WebRTC 连接与 DataChannel 生命周期管理器
 * 内置 NAT 保活心跳、ICE Restart 自动重新打洞与抗网络抖动恢复机制
 */

import { SIGNAL_TYPES, DEFAULT_ICE_SERVERS } from './protocol.js';

export { DEFAULT_ICE_SERVERS };

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

    // 保活与自愈定时器
    this.heartbeatInterval = null;
    this.disconnectDebounceTimer = null;
    this.isRestartingIce = false;
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

    // 监听网络状态变化与地址漫游
    this.pc.onconnectionstatechange = () => {
      const state = this.pc ? this.pc.connectionState : 'closed';
      if (this.onStateChange) {
        this.onStateChange(state);
      }

      if (state === 'connected') {
        this.clearDisconnectTimer();
      } else if (state === 'disconnected') {
        // 网络抖动/IP地址变更：防抖等待并尝试 ICE Restart
        this.handleTransientDisconnect();
      } else if (state === 'failed') {
        // 彻底失败时先尝试一次 ICE 重启，若不可挽回才触发断开
        if (this.isInitiator && !this.isRestartingIce) {
          this.restartIce();
        } else {
          this.triggerDisconnected();
        }
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      if (!this.pc) return;
      const iceState = this.pc.iceConnectionState;
      if (iceState === 'disconnected') {
        this.handleTransientDisconnect();
      } else if (iceState === 'connected' || iceState === 'completed') {
        this.clearDisconnectTimer();
      }
    };

    this.pc.ondatachannel = (event) => {
      this.setupDataChannel(event.channel);
    };
  }

  /**
   * 网络瞬断防抖与自动恢复
   */
  handleTransientDisconnect() {
    if (this.disconnectDebounceTimer) return;
    // 给予 3.5 秒网络自愈或 ICE 重启缓冲期，避免瞬断误报
    this.disconnectDebounceTimer = setTimeout(async () => {
      if (this.pc && (this.pc.connectionState === 'disconnected' || this.pc.iceConnectionState === 'disconnected')) {
        if (this.isInitiator && !this.isRestartingIce) {
          console.warn('WebRTC connection disconnected, attempting ICE restart...');
          await this.restartIce();
        } else {
          this.triggerDisconnected();
        }
      }
    }, 3500);
  }

  clearDisconnectTimer() {
    if (this.disconnectDebounceTimer) {
      clearTimeout(this.disconnectDebounceTimer);
      this.disconnectDebounceTimer = null;
    }
  }

  triggerDisconnected() {
    this.clearDisconnectTimer();
    this.stopHeartbeat();
    if (this.onDisconnected) {
      this.onDisconnected();
    }
  }

  /**
   * 配置 DataChannel 事件监听
   * @param {RTCDataChannel} channel
   */
  setupDataChannel(channel) {
    this.dataChannel = channel;
    this.dataChannel.binaryType = 'arraybuffer';

    this.dataChannel.onopen = () => {
      this.clearDisconnectTimer();
      this.startHeartbeat();
      if (this.onConnected) this.onConnected();
    };

    this.dataChannel.onclose = () => {
      this.stopHeartbeat();
      this.triggerDisconnected();
    };

    this.dataChannel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const parsed = JSON.parse(event.data);
          // 拦截内部保活心跳，无需抛给上层业务
          if (parsed.action === 'heartbeat') {
            return;
          }
        } catch (_) {}
        if (this.onTextMessage) this.onTextMessage(event.data);
      } else if (event.data instanceof ArrayBuffer) {
        if (this.onBinaryMessage) this.onBinaryMessage(event.data);
      }
    };
  }

  /**
   * 启动 DataChannel 10 秒保活心跳
   * 持续给两端路由器发送极轻量 UDP 流量，防止 NAT 映射表因空闲被清空
   */
  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        try {
          this.dataChannel.send(JSON.stringify({ action: 'heartbeat', ts: Date.now() }));
        } catch (_) {}
      }
    }, 10000);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * ICE Restart (网络切换/IP变化自动重连)
   * 重新收集全新的 ICE Candidates (新 IP 和端口) 并发送给对端
   */
  async restartIce() {
    if (!this.pc || this.isRestartingIce) return;
    this.isRestartingIce = true;
    try {
      const offer = await this.pc.createOffer({ iceRestart: true });
      await this.pc.setLocalDescription(offer);

      this.sendSignal(SIGNAL_TYPES.OFFER, {
        sdp: offer.sdp,
        type: offer.type,
        isRestart: true,
      });
    } catch (err) {
      console.error('ICE restart offer creation failed:', err);
    } finally {
      setTimeout(() => {
        this.isRestartingIce = false;
      }, 5000);
    }
  }

  /**
   * 发起方：创建 DataChannel 并生成初始 Offer
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
   * 接收方：处理对端的 Offer，并回复 Answer (支持普通与 ICE Restart 重协商)
   * @param {{ sdp: string, type: RTCSdpType, isRestart?: boolean }} offerData
   */
  async handleOffer(offerData) {
    if (!this.pc || !offerData.isRestart) {
      this.isInitiator = false;
      this.initPeerConnection();
    }

    await this.pc.setRemoteDescription(new RTCSessionDescription(offerData));

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
    this.stopHeartbeat();
    this.clearDisconnectTimer();

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
    this.isRestartingIce = false;
  }
}
