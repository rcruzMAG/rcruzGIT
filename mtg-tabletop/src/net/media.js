// WebRTC mesh for camera/mic feeds. Each peer's video stream is handed to the
// scene so it can be mapped onto their avatar's face screen. Audio plays
// through hidden <audio> elements. Signaling rides the game WebSocket.

const RTC_CONFIG = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
};

export class MediaMesh {
  constructor(net) {
    this.net = net;
    this.peers = new Map();      // peerId -> {pc, videoEl, audioEl}
    this.localStream = null;
    this.camOn = false;
    this.micOn = false;
    this.deafened = false;
    this.onPeerVideo = null;     // (peerId, videoEl|null)
    this.knownPeers = new Set();

    net.on('rtc', (msg) => this.handleSignal(msg.from, msg.data));
  }

  // Call whenever the room roster changes; opens connections to new peers.
  syncPeers(peerIds) {
    for (const id of peerIds) {
      if (id === this.net.id || this.knownPeers.has(id)) continue;
      this.knownPeers.add(id);
      // deterministic initiator avoids glare: lower id offers
      if (this.net.id < id) this.connectTo(id, true);
    }
    for (const id of [...this.peers.keys()]) {
      if (!peerIds.includes(id)) this.dropPeer(id);
    }
  }

  getPeer(id, create = true) {
    let p = this.peers.get(id);
    if (!p && create) {
      const pc = new RTCPeerConnection(RTC_CONFIG);
      p = { pc, videoEl: null, audioEl: null, pendingCandidates: [] };
      this.peers.set(id, p);

      pc.onicecandidate = (e) => {
        if (e.candidate) this.net.rtc(id, { candidate: e.candidate });
      };
      pc.ontrack = (e) => {
        const stream = e.streams[0];
        if (e.track.kind === 'video') {
          if (!p.videoEl) {
            p.videoEl = document.createElement('video');
            p.videoEl.autoplay = true; p.videoEl.playsInline = true; p.videoEl.muted = true;
          }
          p.videoEl.srcObject = stream;
          p.videoEl.play().catch(() => {});
          this.onPeerVideo?.(id, p.videoEl);
        } else {
          if (!p.audioEl) {
            p.audioEl = document.createElement('audio');
            p.audioEl.autoplay = true;
            document.body.appendChild(p.audioEl);
          }
          p.audioEl.srcObject = stream;
          p.audioEl.muted = this.deafened;
          p.audioEl.play().catch(() => {});
        }
      };
      pc.onconnectionstatechange = () => {
        if (['failed', 'closed'].includes(pc.connectionState)) this.dropPeer(id);
      };
      this.attachLocalTracks(pc);
    }
    return p;
  }

  async connectTo(id, _initiator) {
    const p = this.getPeer(id);
    const offer = await p.pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await p.pc.setLocalDescription(offer);
    this.net.rtc(id, { sdp: p.pc.localDescription });
  }

  async handleSignal(from, data) {
    const p = this.getPeer(from);
    try {
      if (data.sdp) {
        await p.pc.setRemoteDescription(data.sdp);
        for (const c of p.pendingCandidates.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
        if (data.sdp.type === 'offer') {
          const answer = await p.pc.createAnswer();
          await p.pc.setLocalDescription(answer);
          this.net.rtc(from, { sdp: p.pc.localDescription });
        }
      } else if (data.candidate) {
        if (p.pc.remoteDescription) await p.pc.addIceCandidate(data.candidate).catch(() => {});
        else p.pendingCandidates.push(data.candidate);
      }
    } catch (e) {
      console.warn('rtc signal error', e);
    }
  }

  dropPeer(id) {
    const p = this.peers.get(id);
    if (!p) return;
    p.pc.close();
    p.audioEl?.remove();
    this.onPeerVideo?.(id, null);
    this.peers.delete(id);
    this.knownPeers.delete(id);
  }

  attachLocalTracks(pc) {
    if (!this.localStream) return;
    for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);
  }

  async ensureLocalStream(constraints) {
    const wantVideo = constraints.video && !this.localStream?.getVideoTracks().length;
    const wantAudio = constraints.audio && !this.localStream?.getAudioTracks().length;
    if (!wantVideo && !wantAudio) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: wantVideo ? (constraints.video === true ? { width: 320, height: 240 } : constraints.video) : false,
      audio: wantAudio ? constraints.audio : false,
    });
    if (!this.localStream) this.localStream = new MediaStream();
    for (const track of stream.getTracks()) {
      this.localStream.addTrack(track);
      for (const { pc } of this.peers.values()) pc.addTrack(track, this.localStream);
    }
    await this.renegotiateAll();
  }

  async renegotiateAll() {
    for (const [id, p] of this.peers) {
      if (this.net.id < id) {
        const offer = await p.pc.createOffer();
        await p.pc.setLocalDescription(offer);
        this.net.rtc(id, { sdp: p.pc.localDescription });
      } else {
        // ask the initiator side to renegotiate by re-offering ourselves anyway
        const offer = await p.pc.createOffer();
        await p.pc.setLocalDescription(offer);
        this.net.rtc(id, { sdp: p.pc.localDescription });
      }
    }
  }

  async setCam(on, deviceId) {
    if (on) {
      await this.ensureLocalStream({ video: deviceId ? { deviceId: { exact: deviceId }, width: 320, height: 240 } : true });
      this.localStream.getVideoTracks().forEach(t => { t.enabled = true; });
    } else {
      this.localStream?.getVideoTracks().forEach(t => { t.enabled = false; });
    }
    this.camOn = on;
  }

  async setMic(on, deviceId) {
    if (on) {
      await this.ensureLocalStream({ audio: deviceId ? { deviceId: { exact: deviceId } } : true });
      this.localStream.getAudioTracks().forEach(t => { t.enabled = true; });
    } else {
      this.localStream?.getAudioTracks().forEach(t => { t.enabled = false; });
    }
    this.micOn = on;
  }

  // Switch capture device live (replaceTrack on every peer connection).
  async switchDevice(kind, deviceId) {
    const constraints = kind === 'video'
      ? { video: { deviceId: { exact: deviceId }, width: 320, height: 240 } }
      : { audio: { deviceId: { exact: deviceId } } };
    const fresh = await navigator.mediaDevices.getUserMedia(constraints);
    const newTrack = kind === 'video' ? fresh.getVideoTracks()[0] : fresh.getAudioTracks()[0];
    const old = this.localStream?.getTracks().find(t => t.kind === kind);
    if (old) {
      for (const { pc } of this.peers.values()) {
        const sender = pc.getSenders().find(s => s.track === old);
        if (sender) await sender.replaceTrack(newTrack);
      }
      this.localStream.removeTrack(old);
      old.stop();
    }
    if (!this.localStream) this.localStream = new MediaStream();
    this.localStream.addTrack(newTrack);
    if (!old) await this.renegotiateAll();
  }

  setDeafened(d) {
    this.deafened = d;
    for (const p of this.peers.values()) if (p.audioEl) p.audioEl.muted = d;
  }

  async listDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return {
        cams: devices.filter(d => d.kind === 'videoinput'),
        mics: devices.filter(d => d.kind === 'audioinput'),
      };
    } catch { return { cams: [], mics: [] }; }
  }

  get localVideoEl() {
    if (!this.localStream?.getVideoTracks().length) return null;
    if (!this._localVideoEl) {
      this._localVideoEl = document.createElement('video');
      this._localVideoEl.autoplay = true; this._localVideoEl.playsInline = true; this._localVideoEl.muted = true;
      this._localVideoEl.srcObject = this.localStream;
      this._localVideoEl.play().catch(() => {});
    }
    return this._localVideoEl;
  }
}
