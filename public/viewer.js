import { formatTime, SUPERCHAT_TIERS, startView } from './main.js';

const element = (id) => document.getElementById(id);
const chat = element('chat-messages');
const joinOverlay = element('join-overlay');
let viewerControls = null;
let username = '';
let selectedTier = SUPERCHAT_TIERS[0];

function setStatus(id, message, isError = false) {
  const target = element(id);
  target.textContent = message;
  target.classList.toggle('error', isError);
}

function appendChat({ senderName, message, isBroadcaster, timestamp, isSystem, isSuperchat, color }) {
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

function updateViewerCount(count) {
  element('viewer-count').textContent = `${count} ${count === 1 ? 'viewer' : 'viewers'}`;
}

function showPinnedSuperchat(superchat) {
  const content = element('pinned-sc').querySelector('.pin-content');
  content.replaceChildren();
  const title = document.createElement('strong');
  title.textContent = `${superchat.username} · $${superchat.amount}`;
  title.style.color = superchat.color;
  content.append(title);
  if (superchat.message) {
    const message = document.createElement('span');
    message.textContent = ` — ${superchat.message}`;
    content.append(message);
  }
}

function showSuperchatPopup(superchat) {
  const popup = element('sc-popup');
  const card = document.createElement('div');
  card.className = 'viewer-superchat-card';
  card.style.background = `linear-gradient(135deg, ${superchat.color}, #24272d)`;
  const title = document.createElement('strong');
  title.textContent = `${superchat.username} · $${superchat.amount}`;
  card.append(title);
  if (superchat.message) {
    const message = document.createElement('p');
    message.textContent = superchat.message;
    card.append(message);
  }
  popup.replaceChildren(card);
  window.setTimeout(() => {
    if (popup.firstElementChild === card) popup.replaceChildren();
  }, 5100);
}

function prepareSuperchatModal() {
  const grid = element('tier-grid');
  const preview = element('sc-preview');
  const messageInput = element('sc-msg-input');

  function updatePreview() {
    preview.replaceChildren();
    preview.style.setProperty('--tier-color', selectedTier.color);
    const name = document.createElement('strong');
    name.textContent = username || 'Viewer';
    const amount = document.createElement('span');
    amount.textContent = `$${selectedTier.amount}`;
    preview.append(name, amount);
    const message = messageInput.value.trim();
    if (message) {
      const text = document.createElement('p');
      text.textContent = message;
      preview.append(text);
    }
  }

  SUPERCHAT_TIERS.forEach((tier) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tier-button';
    button.textContent = `$${tier.amount}`;
    button.style.setProperty('--tier-color', tier.color);
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      selectedTier = tier;
      grid.querySelectorAll('.tier-button').forEach((item) => {
        const active = item === button;
        item.classList.toggle('selected', active);
        item.setAttribute('aria-pressed', String(active));
      });
      updatePreview();
    });
    grid.append(button);
  });
  grid.firstElementChild?.click();
  messageInput.addEventListener('input', updatePreview);

  element('superchat-btn').addEventListener('click', () => {
    selectedTier = SUPERCHAT_TIERS[0];
    messageInput.value = '';
    grid.firstElementChild?.click();
    element('sc-modal').hidden = false;
    messageInput.focus();
  });
  element('sc-cancel-btn').addEventListener('click', () => { element('sc-modal').hidden = true; });
  element('sc-modal').addEventListener('click', (event) => {
    if (event.target === element('sc-modal')) element('sc-modal').hidden = true;
  });
  element('sc-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!viewerControls) return;
    viewerControls.sendSuperchat({ amount: selectedTier.amount, message: messageInput.value.trim() });
    element('sc-modal').hidden = true;
  });
}

function setJoinedControls(enabled) {
  element('chat-input').disabled = !enabled;
  element('send-chat-btn').disabled = !enabled;
  element('superchat-btn').disabled = !enabled;
}

function handleJoinError(message) {
  viewerControls?.close();
  viewerControls = null;
  joinOverlay.hidden = false;
  element('join-btn').disabled = false;
  setJoinedControls(false);
  setStatus('join-status', message, true);
}

function setupViewer() {
  const roomInput = element('token-input');
  roomInput.value = new URLSearchParams(window.location.search).get('room') || '';
  prepareSuperchatModal();

  element('join-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const roomId = roomInput.value.trim();
    username = element('username-input').value.trim().replace(/\s+/g, ' ') || 'Viewer';
    if (!roomId) {
      setStatus('join-status', 'Masukkan token room untuk bergabung.', true);
      return;
    }

    viewerControls?.close();
    element('join-btn').disabled = true;
    setStatus('join-status', 'Menghubungkan ke room…');
    element('stream-badge').innerHTML = '<span class="status-dot"></span> CONNECTING';
    element('stream-badge').className = 'status-badge status-offline';
    viewerControls = startView({
      roomId,
      username,
      onChat: appendChat,
      onViewerJoined({ viewerCount, viewerList, initial }) {
        updateViewerCount(viewerCount);
        if (initial) {
          joinOverlay.hidden = true;
          element('join-btn').disabled = false;
          setJoinedControls(true);
          setStatus('join-status', '');
          return;
        }
        const latest = viewerList?.at(-1)?.username || 'Viewer';
        appendChat({ isSystem: true, message: `${latest} bergabung ke siaran.` });
      },
      onViewerLeft({ username: departed, viewerCount }) {
        updateViewerCount(viewerCount);
        appendChat({ isSystem: true, message: `${departed} meninggalkan siaran.` });
      },
      onSuperchat(superchat) {
        showPinnedSuperchat(superchat);
        showSuperchatPopup(superchat);
        appendChat({
          senderName: superchat.username,
          message: `$${superchat.amount}${superchat.message ? ` · ${superchat.message}` : ''}`,
          timestamp: superchat.timestamp,
          color: superchat.color,
          isSuperchat: true
        });
      },
      onStreamEnded() {
        element('stream-badge').className = 'status-badge status-offline';
        element('stream-badge').innerHTML = '<span class="status-dot"></span> OFFLINE';
        element('offline-msg').hidden = false;
        setJoinedControls(false);
        appendChat({ isSystem: true, message: 'Broadcaster telah mengakhiri siaran.' });
      },
      onError: handleJoinError
    });

    const video = element('remoteVideo');
    video.addEventListener('playing', () => {
      element('offline-msg').hidden = true;
      element('stream-badge').className = 'status-badge status-live';
      element('stream-badge').innerHTML = '<span class="status-dot"></span> LIVE';
      if (video.muted) element('audio-prompt-banner').style.display = 'block';
    });
  });

  element('chat-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = element('chat-input');
    const message = input.value.trim();
    if (!message || !viewerControls) return;
    viewerControls.sendChat(message);
    input.value = '';
  });

  const toggleAudio = () => {
    const video = element('remoteVideo');
    video.muted = !video.muted;
    if (!video.muted) {
      video.play().catch((error) => console.warn('Playback audio belum dapat dimulai:', error));
      element('unmute-btn').textContent = 'Nonaktifkan suara';
      element('audio-prompt-banner').style.display = 'none';
    } else {
      element('unmute-btn').textContent = 'Aktifkan suara';
      element('audio-prompt-banner').style.display = 'block';
    }
  };
  element('unmute-btn').addEventListener('click', toggleAudio);
  element('audio-prompt-banner').addEventListener('click', toggleAudio);
  window.addEventListener('pagehide', () => viewerControls?.close(), { once: true });
}

setupViewer();
