const socket = io();
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const SUPERCHAT_TIERS = [
  { amount: 2, tier: 1, color: '#5678d4', background: '#dce5ff' },
  { amount: 5, tier: 2, color: '#388f83', background: '#d7f0e8' },
  { amount: 10, tier: 3, color: '#c49b43', background: '#f3e8bd' },
  { amount: 20, tier: 4, color: '#d47742', background: '#f5dece' },
  { amount: 50, tier: 5, color: '#ba547c', background: '#f1d8e2' }
];
let superchatAudioContext;
const FILTERS = {
  normal: { label: 'Normal', css: 'none' },
  grayscale: { label: 'Grayscale', css: 'grayscale(1)' },
  sepia: { label: 'Sepia', css: 'sepia(.85)' },
  cool: { label: 'Cool', css: 'hue-rotate(200deg) saturate(1.6)' },
  warm: { label: 'Warm', css: 'sepia(.35) saturate(1.4)' },
  contrast: { label: 'Contrast', css: 'contrast(1.5)' }
};

function playSuperchatChime() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  try {
    superchatAudioContext ||= new AudioContextClass();
    const context = superchatAudioContext;
    if (context.state !== 'running') return;
    [698.46, 880, 1046.5].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + index * 0.14;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      gain.connect(context.destination);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.22, start + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.42);
      oscillator.start(start);
      oscillator.stop(start + 0.43);
    });
  } catch (error) {
    console.warn('Superchat chime could not be played:', error);
  }
}

function resumeSuperchatAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    superchatAudioContext ||= new AudioContextClass();
    if (superchatAudioContext.state === 'suspended') {
      superchatAudioContext.resume().catch((error) => console.warn('Superchat audio remains muted:', error));
    }
  } catch (error) {
    console.warn('Superchat audio is unavailable:', error);
  }
}

document.addEventListener('pointerdown', resumeSuperchatAudio);
document.addEventListener('keydown', resumeSuperchatAudio);

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '00:00';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function makeRoomId() {
  return Math.random().toString(36).slice(2, 10);
}

function startBroadcast({ onChat, onViewerJoined, onViewerLeft, onSuperchat, onError, onConnectionStatus } = {}) {
  const roomId = makeRoomId();
  const localVideo = document.getElementById('localVideo');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const fileVideo = document.createElement('video');
  const peerConnections = new Map();
  const handleConnect = () => {
    console.info('Socket.IO terhubung ke server:', socket.id);
    onConnectionStatus?.(true);
    onError?.('');
  };
  const handleConnectError = (error) => {
    console.error('Socket.IO broadcaster gagal terhubung:', error);
    onConnectionStatus?.(false);
    onError?.('Server tidak dapat dijangkau. Pastikan halaman dibuka dari alamat HTTPS server dan sertifikat diterima browser.');
  };
  const handleDisconnect = (reason) => {
    if (reason !== 'io client disconnect') {
      console.warn('Socket.IO broadcaster terputus:', reason);
      onConnectionStatus?.(false);
      onError?.('Koneksi ke server terputus. Halaman akan mencoba tersambung kembali.');
    }
  };
  socket.on('connect', handleConnect);
  socket.on('connect_error', handleConnectError);
  socket.on('disconnect', handleDisconnect);
  if (socket.connected) handleConnect();
  let cameraStream = null;
  let currentSource = null;
  let audioTrack = null;
  let currentFilter = 'normal';
  let objectUrl = null;
  let animationFrame = 0;
  let closed = false;

  canvas.width = 1280;
  canvas.height = 720;
  fileVideo.playsInline = true;
  fileVideo.loop = true;

  const canvasStream = canvas.captureStream(30);
  const videoTrack = canvasStream.getVideoTracks()[0];
  let audioContext = null;
  let silentTrack = null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (AudioContextClass) {
    try {
      audioContext = new AudioContextClass();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const destination = audioContext.createMediaStreamDestination();
      gain.gain.value = 0;
      oscillator.connect(gain);
      gain.connect(destination);
      oscillator.start();
      silentTrack = destination.stream.getAudioTracks()[0];
      audioTrack = silentTrack;
    } catch (error) {
      console.warn('Silent audio track is unavailable:', error);
    }
  }

  const drawFrame = () => {
    if (closed) return;
    const source = currentSource;
    if (source && source.readyState >= 2 && source.videoWidth && source.videoHeight) {
      if (canvas.width !== source.videoWidth || canvas.height !== source.videoHeight) {
        canvas.width = source.videoWidth;
        canvas.height = source.videoHeight;
      }
      context.filter = FILTERS[currentFilter].css;
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
    } else {
      context.filter = 'none';
      context.fillStyle = '#08090b';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#858b96';
      context.font = '600 26px system-ui, sans-serif';
      context.textAlign = 'center';
      context.fillText('Pilih sumber video untuk memulai siaran', canvas.width / 2, canvas.height / 2);
    }
    animationFrame = window.requestAnimationFrame(drawFrame);
  };
  drawFrame();
  localVideo.srcObject = canvasStream;

  function replaceAudioTrack(track) {
    audioTrack = track || silentTrack;
    for (const pc of peerConnections.values()) {
      const sender = pc.getSenders().find((item) => item.track?.kind === 'audio');
      if (sender) {
        sender.replaceTrack(audioTrack).catch((error) => console.error('Gagal mengganti audio siaran:', error));
      }
    }
  }

  function createPeerConnection(viewerId) {
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections.set(viewerId, pc);
    pc.addTrack(videoTrack, canvasStream);
    if (audioTrack) pc.addTrack(audioTrack, canvasStream);
    pc.onicecandidate = (event) => {
      if (event.candidate) socket.emit('ice-candidate', { roomId, target: viewerId, candidate: event.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) {
        pc.close();
        peerConnections.delete(viewerId);
      }
    };
    return pc;
  }

  socket.emit('join-room', roomId);
  socket.on('viewer-joined', async ({ viewerId, username, viewerCount, viewerList }) => {
    try {
      const pc = createPeerConnection(viewerId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('offer', { target: viewerId, sdp: offer });
      onViewerJoined?.({ viewerId, username, viewerCount, viewerList });
    } catch (error) {
      console.error('Gagal membuat koneksi viewer:', error);
      onError?.('Koneksi ke viewer gagal dibuat.');
    }
  });
  socket.on('answer', async ({ viewerId, sdp }) => {
    const pc = peerConnections.get(viewerId);
    if (!pc) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    } catch (error) {
      console.error('Gagal menerapkan jawaban viewer:', error);
    }
  });
  socket.on('ice-candidate', ({ candidate, senderId }) => {
    const pc = peerConnections.get(senderId);
    if (pc && candidate) {
      pc.addIceCandidate(new RTCIceCandidate(candidate))
        .catch((error) => console.warn('Kandidat ICE broadcaster diabaikan:', error));
    }
  });
  socket.on('viewer-left', (event) => {
    const pc = peerConnections.get(event.viewerId);
    if (pc) pc.close();
    peerConnections.delete(event.viewerId);
    onViewerLeft?.(event);
  });
  socket.on('chat-message', (message) => onChat?.(message));
  socket.on('new-superchat', (superchat) => {
    playSuperchatChime();
    onSuperchat?.(superchat);
  });
  socket.on('room-error', ({ message }) => onError?.(message));

  function sendChat(message) {
    socket.emit('send-chat', { message });
  }

  return {
    roomId,
    fileVideo,
    setVideoFilter(key) {
      if (FILTERS[key]) currentFilter = key;
    },
    async useCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Browser tidak mendukung akses kamera.');
      }
      fileVideo.pause();
      if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch (audioError) {
        console.warn('Mikrofon tidak tersedia, mencoba kamera tanpa audio:', audioError);
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      const cameraVideo = document.createElement('video');
      cameraVideo.autoplay = true;
      cameraVideo.playsInline = true;
      cameraVideo.muted = true;
      cameraVideo.srcObject = cameraStream;
      await cameraVideo.play();
      currentSource = cameraVideo;
      replaceAudioTrack(cameraStream.getAudioTracks()[0] || silentTrack);
      return cameraStream;
    },
    stopCamera() {
      if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
      cameraStream = null;
      currentSource = fileVideo.src ? fileVideo : null;
      if (!currentSource) {
        replaceAudioTrack(silentTrack);
        return;
      }
      fileVideo.play().catch((error) => console.warn('Video file belum dapat dilanjutkan:', error));
      const fileAudio = fileVideo.captureStream?.().getAudioTracks()[0];
      replaceAudioTrack(fileAudio || silentTrack);
    },
    toggleCameraAudio() {
      const track = cameraStream?.getAudioTracks()[0];
      if (!track) return false;
      track.enabled = !track.enabled;
      return track.enabled;
    },
    toggleCameraVideo() {
      const track = cameraStream?.getVideoTracks()[0];
      if (!track) return false;
      track.enabled = !track.enabled;
      return track.enabled;
    },
    async loadVideoFile(file) {
      if (!file || !file.type.startsWith('video/')) throw new Error('Pilih file video yang valid.');
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
      cameraStream = null;
      objectUrl = URL.createObjectURL(file);
      fileVideo.src = objectUrl;
      currentSource = fileVideo;
      await new Promise((resolve, reject) => {
        fileVideo.onloadedmetadata = resolve;
        fileVideo.onerror = () => reject(new Error('File video tidak dapat dibuka.'));
      });
      await fileVideo.play();
      const fileStream = fileVideo.captureStream?.() || fileVideo.mozCaptureStream?.();
      replaceAudioTrack(fileStream?.getAudioTracks()[0] || silentTrack);
      return { name: file.name, duration: fileVideo.duration };
    },
    sendChat,
    close() {
      closed = true;
      window.cancelAnimationFrame(animationFrame);
      if (socket.connected) socket.emit('leave-room');
      for (const pc of peerConnections.values()) pc.close();
      peerConnections.clear();
      cameraStream?.getTracks().forEach((track) => track.stop());
      videoTrack?.stop();
      audioTrack?.stop();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (audioContext) audioContext.close().catch((error) => console.warn('Audio context cleanup failed:', error));
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleConnectError);
      socket.off('disconnect', handleDisconnect);
    }
  };
}

function startView({ roomId, username, onChat, onViewerJoined, onViewerLeft, onSuperchat, onStreamEnded, onError } = {}) {
  let peerConnection = null;
  let pendingCandidates = [];
  let joined = false;
  const remoteVideo = document.getElementById('remoteVideo');
  const handlers = {};
  handlers.connect = () => {
    console.info('Socket.IO viewer terhubung ke server:', socket.id);
    onError?.('');
  };
  handlers.connect_error = (error) => {
    console.error('Socket.IO viewer gagal terhubung:', error);
    onError?.('Tidak dapat terhubung ke server. Periksa alamat HTTPS dan sertifikat server.');
  };
  handlers.disconnect = (reason) => {
    if (reason !== 'io client disconnect') {
      console.warn('Socket.IO viewer terputus:', reason);
      onError?.('Koneksi ke server terputus. Coba gabung kembali.');
    }
  };
  if (socket.connected) handlers.connect();

  handlers['room-info'] = ({ viewerCount, viewerList }) => {
    joined = true;
    onViewerJoined?.({ viewerCount, viewerList, initial: true });
  };
  handlers.offer = async ({ sdp, broadcasterId }) => {
    try {
      peerConnection = new RTCPeerConnection(rtcConfig);
      peerConnection.ontrack = (event) => {
        if (remoteVideo && remoteVideo.srcObject !== event.streams[0]) {
          remoteVideo.srcObject = event.streams[0];
          remoteVideo.play().catch(() => {});
        }
      };
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) socket.emit('ice-candidate', { roomId, candidate: event.candidate });
      };
      await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
      for (const candidate of pendingCandidates) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      }
      pendingCandidates = [];
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.emit('answer', { target: broadcasterId, sdp: answer });
    } catch (error) {
      console.error('Gagal menerima stream broadcaster:', error);
      onError?.('Koneksi ke siaran gagal.');
    }
  };
  handlers['ice-candidate'] = ({ candidate, senderId }) => {
    if (!candidate || !peerConnection || senderId === socket.id) return;
    if (!peerConnection.remoteDescription) {
      pendingCandidates.push(candidate);
      return;
    }
    peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
      .catch((error) => console.warn('Kandidat ICE viewer diabaikan:', error));
  };
  handlers['viewer-joined'] = (event) => onViewerJoined?.(event);
  handlers['viewer-left'] = (event) => onViewerLeft?.(event);
  handlers['chat-message'] = (message) => onChat?.(message);
  handlers['new-superchat'] = (superchat) => {
    playSuperchatChime();
    onSuperchat?.(superchat);
  };
  handlers['stream-ended'] = () => {
    peerConnection?.close();
    peerConnection = null;
    if (remoteVideo) remoteVideo.srcObject = null;
    onStreamEnded?.();
  };
  handlers['room-error'] = ({ message }) => {
    onError?.(message);
  };
  Object.entries(handlers).forEach(([event, handler]) => socket.on(event, handler));
  socket.emit('join-as-viewer', { roomId, username });

  return {
    get joined() {
      return joined;
    },
    sendChat(message) {
      socket.emit('send-chat', { message });
    },
    sendSuperchat({ amount, message }) {
      socket.emit('send-superchat', { amount, message });
    },
    close() {
      if (socket.connected) socket.emit('leave-room');
      peerConnection?.close();
      peerConnection = null;
      Object.entries(handlers).forEach(([event, handler]) => socket.off(event, handler));
    }
  };
}

export {
  FILTERS,
  SUPERCHAT_TIERS,
  formatTime,
  formatDuration,
  startBroadcast,
  startView
};
