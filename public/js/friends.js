let socket = null;
let currentUser = null;
let friends = [];
let friendRequests = { incoming: [], outgoing: [] };
const messageCache = new Map();
const PRIVATE_MESSAGE_PRUNE_THRESHOLD = 100;
const PRIVATE_MESSAGE_RETAIN_AFTER_PRUNE = 50;
let activeFriend = null;

const els = {
  backBtn: document.getElementById('backBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  userName: document.getElementById('userName'),
  userRating: document.getElementById('userRating'),
  userAvatar: document.getElementById('userAvatar'),
  searchInput: document.getElementById('searchInput'),
  searchBtn: document.getElementById('searchBtn'),
  searchResult: document.getElementById('searchResult'),
  refreshRequestsBtn: document.getElementById('refreshRequestsBtn'),
  friendRequestList: document.getElementById('friendRequestList'),
  refreshFriendsBtn: document.getElementById('refreshFriendsBtn'),
  friendList: document.getElementById('friendList'),
  chatEmpty: document.getElementById('chatEmpty'),
  chatActive: document.getElementById('chatActive'),
  chatAvatar: document.getElementById('chatAvatar'),
  chatName: document.getElementById('chatName'),
  chatStatus: document.getElementById('chatStatus'),
  messageList: document.getElementById('messageList'),
  chatForm: document.getElementById('chatForm'),
  messageInput: document.getElementById('messageInput'),
  toast: document.getElementById('toast')
};

// 移动端导航前主动断开 socket，防止 bfcache 导致"已在其他设备登录"误判
function disconnectBeforeNav() {
  if (/mobile|android|iphone|ipod|webos|blackberry|windows phone|opera mini|iemobile/i.test(navigator.userAgent)) {
    if (socket && socket.connected) {
      window._pagehideDisconnect = true;
      socket.disconnect();
    }
  }
}

// 捕获系统导航栏"返回"按钮/手势（pagehide 在 bfcache 冻结前可靠触发）
window.addEventListener('pagehide', function () {
  if (/mobile|android|iphone|ipod|webos|blackberry|windows phone|opera mini|iemobile/i.test(navigator.userAgent)) {
    if (socket && socket.connected) socket.disconnect();
  }
});

// 从 bfcache 恢复时重连 socket（系统返回按钮回到本页时）
window.addEventListener('pageshow', function (event) {
  if (event.persisted && socket && !socket.connected) {
    connectSocket();
  }
});

async function init() {
  const token = localStorage.getItem('token');
  if (!token) {
    window.location.replace('/login');
    return;
  }

  try {
    const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!data.success || !data.user) throw new Error('认证失败');
    currentUser = data.user;
    updateUserUI();
  } catch (err) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.replace('/login');
    return;
  }

  bindEvents();
  connectSocket();
  await loadRequests();
  await loadFriends();
}

function updateUserUI() {
  const name = currentUser.nickname || currentUser.username;
  els.userName.textContent = name;
  els.userRating.textContent = currentUser.rating || 1000;
  els.userAvatar.textContent = name.charAt(0).toUpperCase();
}

function bindEvents() {
  els.backBtn.addEventListener('click', () => {
    disconnectBeforeNav();
    window.location.href = '/lobby';
  });

  els.logoutBtn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    disconnectBeforeNav();
    window.location.href = '/login';
  });

  els.searchBtn.addEventListener('click', searchUser);
  els.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') searchUser();
  });
  els.refreshRequestsBtn.addEventListener('click', loadRequests);
  els.refreshFriendsBtn.addEventListener('click', loadFriends);
  els.chatForm.addEventListener('submit', sendMessage);
  const sendButton = els.chatForm.querySelector('button[type="submit"]');
  if (sendButton) {
    sendButton.addEventListener('mousedown', keepMessageInputFocused);
    sendButton.addEventListener('touchstart', keepMessageInputFocused, { passive: false });
    sendButton.addEventListener('touchend', (event) => {
      event.preventDefault();
      sendMessage(event);
    }, { passive: false });
    sendButton.addEventListener('click', sendMessage);
  }
  document.addEventListener('pointerdown', blurMessageInputOutsideComposer);
  els.messageInput.addEventListener('focus', handleMessageInputFocus);
  window.addEventListener('friends:viewportchange', handleChatViewportChange);
  window.addEventListener('resize', preserveMessageScrollPosition);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', handleChatViewportChange);
    window.visualViewport.addEventListener('scroll', handleChatViewportChange);
  }
}

function connectSocket() {
  const token = localStorage.getItem('token');
  socket = io();

  socket.on('connect', () => socket.emit('authenticate', token));
  socket.on('authenticated', (data) => {
    if (!data.success) {
      showToast('连接失败，请重新登录');
      setTimeout(() => window.location.href = '/login', 1200);
    }
  });

  socket.on('privateMessage', (message) => {
    const other = message.sender === currentUser.username ? message.recipient : message.sender;
    const isActive = activeFriend && activeFriend.username === other;
    cacheMessage(other, message);

    if (isActive) {
      appendMessage(message);
      socket.emit('markPrivateMessagesRead', { friend: other });
    } else {
      const friend = friends.find(item => item.username === other);
      if (friend) friend.unread_count = Number(friend.unread_count || 0) + 1;
    }

    loadFriends();
  });

  socket.on('privateMessageError', (data) => showToast(data.error || '消息发送失败'));
  socket.on('friendListUpdated', loadFriends);
  socket.on('friendRequestsUpdated', loadRequests);
  socket.on('friendStatusChanged', ({ username, online }) => {
    const friend = friends.find(item => item.username === username);
    if (friend) friend.online = online;
    if (activeFriend && activeFriend.username === username) {
      activeFriend.online = online;
      updateChatHeader();
    }
    renderFriends();
  });
}

async function searchUser() {
  const username = els.searchInput.value.trim();
  if (!username) {
    showToast('请输入用户名');
    return;
  }

  els.searchResult.innerHTML = '<div class="empty-state">搜索中...</div>';
  try {
    const res = await fetch(`/api/friends/search?username=${encodeURIComponent(username)}`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || '搜索失败');
    renderSearchResult(data.user);
  } catch (err) {
    els.searchResult.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

function renderSearchResult(user) {
  let buttonText = '加为好友';
  let disabled = false;
  if (user.isFriend) {
    buttonText = '已是好友';
    disabled = true;
  } else if (user.friendshipStatus === 'pending' && user.pendingDirection === 'outgoing') {
    buttonText = '申请已发送';
    disabled = true;
  } else if (user.friendshipStatus === 'pending' && user.pendingDirection === 'incoming') {
    buttonText = '待你处理';
    disabled = true;
  }

  els.searchResult.innerHTML = `
    <div class="friend-card">
      <div class="friend-avatar">${avatarText(user)}</div>
      <div class="friend-card-info">
        <strong>${escapeHtml(user.nickname || user.username)}</strong>
        <span>@${escapeHtml(user.username)} · ${user.online ? '在线' : '离线'}</span>
      </div>
      <button class="small-primary-btn" id="addFriendBtn" ${disabled ? 'disabled' : ''}>
        ${buttonText}
      </button>
    </div>
  `;

  const addBtn = document.getElementById('addFriendBtn');
  addBtn.addEventListener('click', async () => {
    await addFriend(user.username);
  });
}

async function addFriend(username) {
  try {
    const res = await fetch('/api/friends', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || '添加失败');
    showToast('好友申请已发送，等待对方同意');
    await loadRequests();
    await searchUser();
  } catch (err) {
    showToast(err.message);
  }
}

async function loadRequests() {
  try {
    const res = await fetch('/api/friend-requests');
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || '加载失败');
    friendRequests = {
      incoming: data.incoming || [],
      outgoing: data.outgoing || []
    };
    renderRequests();
  } catch (err) {
    els.friendRequestList.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

function renderRequests() {
  const incoming = friendRequests.incoming || [];
  const outgoing = friendRequests.outgoing || [];
  if (incoming.length === 0 && outgoing.length === 0) {
    els.friendRequestList.innerHTML = '<div class="empty-state">暂无待处理申请</div>';
    return;
  }

  els.friendRequestList.innerHTML = [
    ...incoming.map(user => `
      <div class="friend-request-row">
        <div class="friend-avatar">${avatarText(user)}</div>
        <div class="friend-card-info">
          <strong>${escapeHtml(user.nickname || user.username)}</strong>
          <span>@${escapeHtml(user.username)} 请求添加你为好友</span>
        </div>
        <div class="friend-request-actions">
          <button class="small-primary-btn" data-action="accept" data-username="${escapeHtml(user.username)}">同意</button>
          <button class="small-secondary-btn" data-action="reject" data-username="${escapeHtml(user.username)}">拒绝</button>
        </div>
      </div>
    `),
    ...outgoing.map(user => `
      <div class="friend-request-row">
        <div class="friend-avatar">${avatarText(user)}</div>
        <div class="friend-card-info">
          <strong>${escapeHtml(user.nickname || user.username)}</strong>
          <span>@${escapeHtml(user.username)} 等待对方同意</span>
        </div>
      </div>
    `)
  ].join('');

  els.friendRequestList.querySelectorAll('[data-action]').forEach(button => {
    button.addEventListener('click', () => respondRequest(button.dataset.username, button.dataset.action === 'accept'));
  });
}

async function respondRequest(username, accept) {
  try {
    const res = await fetch(`/api/friends/${encodeURIComponent(username)}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accept })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || '处理失败');
    showToast(accept ? '已添加为好友' : '已拒绝申请');
    await loadRequests();
    await loadFriends();
  } catch (err) {
    showToast(err.message);
  }
}

async function loadFriends() {
  try {
    const res = await fetch('/api/friends');
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || '加载失败');
    friends = data.friends || [];
    if (activeFriend) {
      activeFriend = friends.find(friend => friend.username === activeFriend.username) || activeFriend;
    }
    renderFriends();
  } catch (err) {
    els.friendList.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

function renderFriends() {
  if (friends.length === 0) {
    els.friendList.innerHTML = '<div class="empty-state">还没有好友，先用用户名搜索添加。</div>';
    return;
  }

  els.friendList.innerHTML = friends.map(friend => {
    const active = activeFriend && activeFriend.username === friend.username;
    const unread = Number(friend.unread_count || 0);
    return `
      <button class="friend-row ${active ? 'active' : ''}" data-username="${escapeHtml(friend.username)}">
        <div class="friend-avatar">${avatarText(friend)}</div>
        <div class="friend-row-main">
          <div class="friend-row-top">
            <strong>${escapeHtml(friend.nickname || friend.username)}</strong>
            <span class="friend-status ${friend.online ? 'online' : ''}">${friend.online ? '在线' : '离线'}</span>
          </div>
          <span class="friend-last">${escapeHtml(friend.last_message || '@' + friend.username)}</span>
        </div>
        ${unread > 0 ? `<span class="unread-badge">${unread}</span>` : ''}
      </button>
    `;
  }).join('');

  els.friendList.querySelectorAll('.friend-row').forEach(row => {
    row.addEventListener('click', () => openChat(row.dataset.username));
  });
}

async function openChat(username) {
  activeFriend = friends.find(friend => friend.username === username) || { username };
  renderFriends();
  els.chatEmpty.style.display = 'none';
  els.chatActive.classList.add('active');
  updateChatHeader();
  els.messageList.innerHTML = '<div class="empty-state">消息加载中...</div>';

  try {
    const res = await fetch(`/api/friends/${encodeURIComponent(username)}/messages`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || '消息加载失败');

    const messages = mergeMessages(username, data.messages || []);
    els.messageList.innerHTML = '';
    messages.forEach(appendMessage);
    if (messages.length === 0) {
      els.messageList.innerHTML = '<div class="empty-state">还没有消息，打个招呼吧。</div>';
    }
    if (socket) socket.emit('markPrivateMessagesRead', { friend: username });
    const friend = friends.find(item => item.username === username);
    if (friend) friend.unread_count = 0;
    renderFriends();
    scrollMessagesToBottom();
    els.messageInput.focus();
  } catch (err) {
    els.messageList.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

function updateChatHeader() {
  els.chatAvatar.textContent = avatarText(activeFriend);
  els.chatName.textContent = activeFriend.nickname;
  els.chatStatus.textContent = activeFriend.online ? '在线' : '离线';
  els.chatStatus.className = activeFriend.online ? 'online-text' : '';
}

function sendMessage(event) {
  if (event) event.preventDefault();
  const message = els.messageInput.value.trim();
  if (!message || !activeFriend || !socket) {
    els.messageInput.focus();
    return;
  }
  socket.emit('privateMessage', { to: activeFriend.username, message });
  els.messageInput.value = '';
  els.messageInput.focus();
}

function keepMessageInputFocused(event) {
  event.preventDefault();
  els.messageInput.focus();
}

function blurMessageInputOutsideComposer(event) {
  if (document.activeElement !== els.messageInput) return;
  if (event.target === els.messageInput) return;
  if (event.target.closest('.private-chat-form button[type="submit"]')) return;
  els.messageInput.blur();
}

function getMessageBottomGap() {
  return els.messageList.scrollHeight - els.messageList.scrollTop - els.messageList.clientHeight;
}

function preserveMessageScrollPosition() {
  if (!els.messageList) return;
  const bottomGap = Math.max(0, getMessageBottomGap());
  const wasAtBottom = bottomGap < 8;
  const restore = () => {
    if (wasAtBottom) {
      els.messageList.scrollTop = els.messageList.scrollHeight;
      return;
    }
    els.messageList.scrollTop = els.messageList.scrollHeight - els.messageList.clientHeight - bottomGap;
  };
  requestAnimationFrame(restore);
  setTimeout(restore, 120);
}

function handleMessageInputFocus() {
  scrollMessagesToBottom();
  setTimeout(scrollMessagesToBottom, 120);
  setTimeout(scrollMessagesToBottom, 280);
  setTimeout(scrollMessagesToBottom, 520);
}

function handleChatViewportChange() {
  if (document.activeElement === els.messageInput) {
    handleMessageInputFocus();
    return;
  }
  preserveMessageScrollPosition();
}

function appendMessage(message) {
  if (els.messageList.querySelector('.empty-state')) els.messageList.innerHTML = '';

  const isOwn = message.sender === currentUser.username;
  const otherName = activeFriend ? activeFriend.nickname : message.sender;
  const item = document.createElement('div');
  item.className = `private-message ${isOwn ? 'own' : 'other'}`;
  item.innerHTML = `
    <div class="private-message-meta">
      <span>${escapeHtml(isOwn ? '我' : otherName)}</span>
      <time>${formatTime(message.created_at)}</time>
    </div>
    <div class="private-message-bubble">${escapeHtml(message.message)}</div>
  `;
  els.messageList.appendChild(item);
  pruneRenderedMessages();
  scrollMessagesToBottom();
}

function cacheMessage(username, message) {
  const list = messageCache.get(username) || [];
  if (!list.some(item => String(item.id) === String(message.id))) {
    list.push(message);
  }
  messageCache.set(username, keepLatestMessages(list));
}

function mergeMessages(username, messages) {
  const merged = [...messages];
  (messageCache.get(username) || []).forEach(message => {
    if (!merged.some(item => String(item.id) === String(message.id))) merged.push(message);
  });
  const latest = keepLatestMessages(merged);
  messageCache.set(username, latest);
  return latest;
}

function keepLatestMessages(messages) {
  const sorted = [...messages].sort((a, b) => {
    const timeDiff = new Date(a.created_at || 0) - new Date(b.created_at || 0);
    return timeDiff || Number(a.id || 0) - Number(b.id || 0);
  });
  if (sorted.length >= PRIVATE_MESSAGE_PRUNE_THRESHOLD) {
    return sorted.slice(-PRIVATE_MESSAGE_RETAIN_AFTER_PRUNE);
  }
  return sorted;
}

function pruneRenderedMessages() {
  const items = Array.from(els.messageList.querySelectorAll('.private-message'));
  if (items.length < PRIVATE_MESSAGE_PRUNE_THRESHOLD) return;
  items.slice(0, items.length - PRIVATE_MESSAGE_RETAIN_AFTER_PRUNE).forEach(item => item.remove());
}

function scrollMessagesToBottom() {
  if (!els.messageList) return;
  const scroll = () => {
    els.messageList.scrollTop = els.messageList.scrollHeight;
  };
  scroll();
  requestAnimationFrame(scroll);
  setTimeout(scroll, 80);
  setTimeout(scroll, 220);
}

function avatarText(user) {
  const name = user.nickname || user.username || '?';
  return name.charAt(0).toUpperCase();
}

function formatTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

let toastTimeout;
function showToast(message, duration = 2400) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => els.toast.classList.remove('show'), duration);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text ?? '');
  return div.innerHTML;
}

init();
