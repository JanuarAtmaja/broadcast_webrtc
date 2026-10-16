import { FILTERS, formatDuration, formatTime, startBroadcast } from './main.js';

const element = (id) => document.getElementById(id);
const status = element('studio-status');
const viewerEntries = new Map();
let controls;

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function appendChat({ senderName, message, isBroadcaster, timestamp, isSystem, isSuperchat, color }) {
  const chat = element('chat-messages');
  const entry = document.createElement('article');
  entry.className = `chat-message${isSystem ? ' system' : ''}${isSuperchat ? ' superchat' : ''}`;
  if (color) entry.style.setProperty('--tier-color', color);

  if (isSystem) {
    entry.textContent = message;
  } else {
    const header = document.createElement('div');
    header.className = 'chat-message-header';
    const sender = document.createElement('span');
    sender.className = `chat-sender${isBroadcaster ? ' broadcaster' : ''}`;
    sender.textContent = senderName || 'Viewer';
    const time = document.createElement('time');
    time.className = 'chat-time';
    time.textContent = formatTime(timestamp);
    header.append(sender, time);
    const body = document.createElement('div');
    body.textContent = message;
    entry.append(header, body);
  }

  chat.append(entry);
  chat.scrollTop = chat.scrollHeight;
}

function renderViewers(viewerList = []) {
  const list = element('viewer-list-panel');
  viewerEntries.clear();
  viewerList.forEach((viewer) => viewerEntries.set(viewer.socketId, viewer));
  element('viewer-count').textContent = `${viewerEntries.size} ${viewerEntries.size === 1 ? 'viewer' : 'viewers'}`;
  element('viewer-tab-count').textContent = String(viewerEntries.size);
  list.replaceChildren();
  if (viewerEntries.size === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Belum ada viewer bergabung.';
    list.append(empty);
    return;
  }

  for (const viewer of viewerEntries.values()) {
    const row = document.createElement('div');
    row.className = 'viewer-item';
    const avatar = document.createElement('span');
    avatar.className = 'viewer-avatar';
    avatar.textContent = (viewer.username || 'V').slice(0, 2).toUpperCase();
    const name = document.createElement('span');
    name.textContent = viewer.username;
    const joined = document.createElement('time');
    joined.className = 'viewer-joined-time';
    joined.textContent = formatTime(viewer.joinedAt);
    row.append(avatar, name, joined);
    list.append(row);
  }
}

function setPinnedSuperchat(superchat) {
  const content = element('pinned-sc').querySelector('.pin-content');
  content.replaceChildren();
  const sender = document.createElement('strong');
  sender.textContent = `${superchat.username} · $${superchat.amount}`;
  sender.style.color = superchat.color;
  content.append(sender);
  if (superchat.message) {
    const message = document.createElement('span');
    message.textContent = ` — ${superchat.message}`;
    content.append(message);
  }
}

function showSuperchatBanner(superchat) {
  const banner = element('sc-alert');
  const card = document.createElement('div');
  card.className = 'superchat-banner-card';
  card.style.background = `linear-gradient(135deg, ${superchat.color}, #24272d)`;
  const title = document.createElement('strong');
  title.textContent = `${superchat.username} · $${superchat.amount}`;
  card.append(title);
  if (superchat.message) {
    const message = document.createElement('p');
    message.textContent = superchat.message;
    card.append(message);
  }
  banner.replaceChildren(card);
  window.setTimeout(() => {
    if (banner.firstElementChild === card) banner.replaceChildren();
  }, 5100);
}

function addSystemMessage(message) {
  appendChat({ isSystem: true, message });
}

function setupTabs() {
  document.querySelectorAll('.dashboard-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.dashboard-tab').forEach((item) => {
        const active = item === tab;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', String(active));
      });
      document.querySelectorAll('.dashboard-tab-panel').forEach((panel) => {
        const active = panel.id === tab.dataset.tab;
        panel.classList.toggle('active', active);
        panel.hidden = !active;
      });
    });
  });
}

function setupFilters() {
  const bar = element('filter-bar');
  Object.entries(FILTERS).forEach(([key, filter], index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `filter-button${index === 0 ? ' active' : ''}`;
    button.textContent = filter.label;
    button.setAttribute('aria-pressed', String(index === 0));
    button.addEventListener('click', () => {
      bar.querySelectorAll('.filter-button').forEach((item) => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
      });
      controls?.setVideoFilter(key);
    });
    bar.append(button);
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error('Tidak dapat menyalin teks:', error);
    setStatus('Clipboard tidak tersedia. Salin token secara manual.', true);
    return false;
  }
}

function setupMediaControls() {
  const fileInput = element('videoFileInput');
  const uploadZone = element('file-uploader-box');
  const filePill = element('active-file-pill');
  const fileName = element('active-file-name');
  const fileTab = element('tab-file-source');
  const cameraTab = element('tab-cam-source');
  const playback = element('playback-controls');
  const camera = element('camera-controls');
  const playPause = element('btn-play-pause');
  const progress = element('video-progress');
  const time = element('time-display');
  const micButton = element('toggle-cam-mic');
  const videoButton = element('toggle-cam-vid');

  const showSource = (source) => {
    const cameraActive = source === 'camera';
    fileTab.classList.toggle('active', !cameraActive);
    cameraTab.classList.toggle('active', cameraActive);
    fileTab.setAttribute('aria-selected', String(!cameraActive));
    cameraTab.setAttribute('aria-selected', String(cameraActive));
    playback.hidden = cameraActive;
    camera.hidden = !cameraActive;
    uploadZone.hidden = cameraActive || Boolean(controls.fileVideo.src);
    filePill.hidden = cameraActive || !controls.fileVideo.src;
  };

  async function loadFile(file) {
    try {
      const details = await controls.loadVideoFile(file);
      fileName.textContent = `${details.name} · ${formatDuration(details.duration)}`;
      showSource('file');
      playPause.textContent = 'Jeda';
      addSystemMessage(`Video "${details.name}" mulai disiarkan.`);
      setStatus('');
    } catch (error) {
      console.error('Gagal memuat video:', error);
      setStatus(error.message || 'File video tidak dapat dimuat.', true);
    }
  }

  element('btn-trigger-file').addEventListener('click', () => fileInput.click());
  element('btn-change-file').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    if (fileInput.files?.[0]) await loadFile(fileInput.files[0]);
    fileInput.value = '';
  });
  ['dragover', 'dragenter'].forEach((eventName) => uploadZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    uploadZone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach((eventName) => uploadZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    uploadZone.classList.remove('dragover');
  }));
  uploadZone.addEventListener('drop', async (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) await loadFile(file);
  });

  fileTab.addEventListener('click', () => {
    controls.stopCamera();
    showSource('file');
    setStatus('');
  });
  cameraTab.addEventListener('click', async () => {
    try {
      const stream = await controls.useCamera();
      showSource('camera');
      addSystemMessage('Kamera web mulai disiarkan.');
      setStatus(stream.getAudioTracks().length ? '' : 'Kamera aktif, tetapi mikrofon tidak tersedia.');
    } catch (error) {
      console.error('Gagal mengaktifkan kamera:', error);
      setStatus(error.message || 'Akses kamera atau mikrofon gagal.', true);
      showSource('file');
    }
  });

  playPause.addEventListener('click', () => {
    if (controls.fileVideo.paused) {
      controls.fileVideo.play().catch((error) => setStatus(`Video gagal diputar: ${error.message}`, true));
    } else {
      controls.fileVideo.pause();
    }
  });
  controls.fileVideo.addEventListener('play', () => { playPause.textContent = 'Jeda'; });
  controls.fileVideo.addEventListener('pause', () => { playPause.textContent = 'Putar'; });
  controls.fileVideo.addEventListener('timeupdate', () => {
    const duration = controls.fileVideo.duration || 0;
    progress.value = duration ? String((controls.fileVideo.currentTime / duration) * 100) : '0';
    time.textContent = `${formatDuration(controls.fileVideo.currentTime)} / ${formatDuration(duration)}`;
  });
  progress.addEventListener('input', () => {
    if (controls.fileVideo.duration) {
      controls.fileVideo.currentTime = (Number(progress.value) / 100) * controls.fileVideo.duration;
    }
  });
  element('check-loop').addEventListener('change', (event) => { controls.fileVideo.loop = event.target.checked; });
  element('vol-slider').addEventListener('input', (event) => { controls.fileVideo.volume = Number(event.target.value); });

  micButton.addEventListener('click', () => {
    const enabled = controls.toggleCameraAudio();
    micButton.classList.toggle('muted', !enabled);
    micButton.querySelector('span').textContent = enabled ? 'Mikrofon aktif' : 'Mikrofon nonaktif';
  });
  videoButton.addEventListener('click', () => {
    const enabled = controls.toggleCameraVideo();
    videoButton.classList.toggle('muted', !enabled);
    videoButton.querySelector('span').textContent = enabled ? 'Kamera aktif' : 'Kamera nonaktif';
  });
}

async function initializeStudio() {
  setupTabs();
  setupFilters();
  try {
    controls = startBroadcast({
      onChat: appendChat,
      onViewerJoined({ username, viewerList }) {
        renderViewers(viewerList);
        addSystemMessage(`${username} bergabung ke siaran.`);
      },
      onViewerLeft({ username, viewerList }) {
        renderViewers(viewerList);
        addSystemMessage(`${username} meninggalkan siaran.`);
      },
      onSuperchat(superchat) {
        showSuperchatBanner(superchat);
        setPinnedSuperchat(superchat);
        appendChat({
          senderName: superchat.username,
          message: `$${superchat.amount}${superchat.message ? ` · ${superchat.message}` : ''}`,
          timestamp: superchat.timestamp,
          color: superchat.color,
          isSuperchat: true
        });
      },
      onConnectionStatus(connected) {
        const badge = element('broadcaster-connection');
        badge.classList.toggle('status-live', connected);
        badge.classList.toggle('status-offline', !connected);
        badge.innerHTML = `<span class="status-dot"></span> ${connected ? 'SERVER TERHUBUNG' : 'MENGHUBUNGKAN'}`;
      },
      onError: (message) => setStatus(message, true)
    });
    element('token-display').textContent = controls.roomId;
    element('token-display').addEventListener('click', async () => {
      if (await copyText(controls.roomId)) setStatus('Token room disalin.');
    });
    element('copy-link-btn').addEventListener('click', async () => {
      const url = new URL('viewer.html', window.location.href);
      url.searchParams.set('room', controls.roomId);
      if (await copyText(url.href)) setStatus('Tautan viewer disalin.');
    });
    element('chat-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const input = element('chat-input');
      const message = input.value.trim();
      if (!message) return;
      controls.sendChat(message);
      input.value = '';
    });
    setupMediaControls();
    window.addEventListener('pagehide', () => controls?.close(), { once: true });
  } catch (error) {
    console.error('Studio tidak dapat dimulai:', error);
    setStatus(error.message || 'Studio gagal dimulai.', true);
  }
}

initializeStudio();
