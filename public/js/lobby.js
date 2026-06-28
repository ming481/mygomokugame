// 水墨粒子背景
class InkParticle {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.reset();
  }
  reset() {
    this.x = Math.random() * this.canvas.width;
    this.y = Math.random() * this.canvas.height;
    this.size = Math.random() * 3 + 1;
    this.speedX = (Math.random() - 0.5) * 0.3;
    this.speedY = (Math.random() - 0.5) * 0.3;
    this.opacity = Math.random() * 0.15 + 0.05;
    this.life = 0;
    this.maxLife = Math.random() * 300 + 200;
  }
  update() {
    this.x += this.speedX;
    this.y += this.speedY;
    this.life++;
    if (this.life > this.maxLife || this.x < 0 || this.x > this.canvas.width || this.y < 0 || this.y > this.canvas.height) {
      this.reset();
    }
  }
  draw() {
    this.ctx.beginPath();
    this.ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    this.ctx.fillStyle = `rgba(40, 30, 20, ${this.opacity * (1 - this.life / this.maxLife)})`;
    this.ctx.fill();
  }
}

function initInkBackground() {
  const canvas = document.getElementById('inkCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize);

  // 减少粒子数量以提升性能
  const particles = Array.from({ length: 30 }, () => new InkParticle(canvas));

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 批量绘制提升性能
    particles.forEach(p => {
      p.update();
      p.draw();
    });

    requestAnimationFrame(animate);
  }
  animate();
}

// 全局状态
let socket = null;
let currentUser = null;
let createdRoomId = null;
let unreadReminderShown = false;

const els = {
  userName: document.getElementById('userName'),
  userRating: document.getElementById('userRating'),
  userAvatar: document.getElementById('userAvatar'),
  logoutBtn: document.getElementById('logoutBtn'),
  greeting: document.getElementById('greeting'),
  profileName: document.getElementById('profileName'),
  profileRating: document.getElementById('profileRating'),
  profileAvatar: document.getElementById('profileAvatar'),
  statWins: document.getElementById('statWins'),
  statLosses: document.getElementById('statLosses'),
  statDraws: document.getElementById('statDraws'),
  winrateFill: document.getElementById('winrateFill'),
  winrateText: document.getElementById('winrateText'),
  leaderboardList: document.getElementById('leaderboardList'),
  quickMatchBtn: document.getElementById('quickMatchBtn'),
  createRoomBtn: document.getElementById('createRoomBtn'),
  aiBeginnerBtn: document.getElementById('aiBeginnerBtn'),
  aiIntermediateBtn: document.getElementById('aiIntermediateBtn'),
  aiAdvancedBtn: document.getElementById('aiAdvancedBtn'),
  friendsBtn: document.getElementById('friendsBtn'),
  joinRoomBtn: document.getElementById('joinRoomBtn'),
  roomIdInput: document.getElementById('roomIdInput'),
  matchingModal: document.getElementById('matchingModal'),
  cancelMatchBtn: document.getElementById('cancelMatchBtn'),
  roomCreatedModal: document.getElementById('roomCreatedModal'),
  createdRoomId: document.getElementById('createdRoomId'),
  enterRoomBtn: document.getElementById('enterRoomBtn'),
  toast: document.getElementById('toast'),
  fortuneBtn: document.getElementById('fortuneBtn'),
  fortuneStars: document.getElementById('fortuneStars'),
  fortuneText: document.getElementById('fortuneText'),
  tipsCarousel: document.getElementById('tipsCarousel'),
  tipDots: document.getElementById('tipDots'),
  shareToFriendBtn: document.getElementById('shareToFriendBtn'),
  shareFriendModal: document.getElementById('shareFriendModal'),
  shareFriendList: document.getElementById('shareFriendList'),
  closeShareModalBtn: document.getElementById('closeShareModalBtn')
};

async function init() {
  const token = localStorage.getItem('token');
  if (!token) {
    window.location.replace('/login');
    return;
  }

  try {
    const res = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    if (data.success && data.user) {
      currentUser = data.user;
      updateUserUI();
      loadLeaderboard();
    } else {
      throw new Error('认证失败');
    }
  } catch (err) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.replace('/login');
    return;
  }

  connectSocket();
  bindEvents();
  initTipsCarousel();
  initFortune();
  initInkBackground();

  // 检查是否有进行中的对局（断线重连）
  checkActiveGame();

  // 检查是否从游戏页返回并带有 quick 参数
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('mode') === 'quick') {
    setTimeout(() => els.quickMatchBtn.click(), 300);
  }
}

function updateUserUI() {
  if (!currentUser || !currentUser.username) {
    // 未获取到有效用户信息，跳转登录
    window.location.replace('/login');
    return;
  }
  const name = currentUser.nickname || currentUser.username;
  els.userName.textContent = name;
  els.userRating.textContent = currentUser.rating || 1000;
  els.userAvatar.textContent = name.charAt(0).toUpperCase();
  els.profileName.textContent = name;
  els.profileRating.textContent = currentUser.rating || 1000;
  els.profileAvatar.textContent = name.charAt(0).toUpperCase();
  els.statWins.textContent = currentUser.wins || 0;
  els.statLosses.textContent = currentUser.losses || 0;
  els.statDraws.textContent = currentUser.draws || 0;

  const total = (currentUser.wins || 0) + (currentUser.losses || 0) + (currentUser.draws || 0);
  const winrate = total > 0 ? Math.round((currentUser.wins || 0) / total * 100) : 0;
  els.winrateFill.style.width = winrate + '%';
  els.winrateText.textContent = winrate + '%';

  // 问候语
  const hour = new Date().getHours();
  let greet = '欢迎回来';
  if (hour < 6) greet = '夜深了，<br>棋手未眠';
  else if (hour < 11) greet = '早安，棋手';
  else if (hour < 14) greet = '午安，棋手';
  else if (hour < 18) greet = '下午好，棋手';
  else greet = '晚上好，棋手';
  els.greeting.innerHTML = greet;
}

function connectSocket() {
  const token = localStorage.getItem('token');
  socket = io();

  socket.on('connect', () => {
    socket.emit('authenticate', token);
  });

  socket.on('authenticated', (data) => {
    if (!data.success) {
      showToast('连接失败，请重新登录');
      setTimeout(() => { localStorage.removeItem('token'); window.location.href = '/login'; }, 2000);
      return;
    }
    remindUnreadPrivateMessages();
  });

  socket.on('disconnect', () => showToast('连接已断开'));

  socket.on('privateMessage', (message) => {
    if (!currentUser || message.sender === currentUser.username) return;
    const displayName = message.senderNickname || message.sender;
    showMessageToast(`${displayName} 发来一条新消息`);
  });

  socket.on('matching', () => showMatchingModal());

  socket.on('matchFound', (data) => {
    hideMatchingModal();
    showToast(`匹配成功！对手: ${data.opponent}`);
    setTimeout(() => {
      window.location.href = `/game?room=${data.roomId}&color=${data.color}`;
    }, 800);
  });

  socket.on('matchCancelled', () => hideMatchingModal());

  socket.on('roomCreated', (data) => {
    createdRoomId = data.roomId;
    els.createdRoomId.textContent = data.roomId;
    els.roomCreatedModal.classList.add('active');
  });

  socket.on('gameStart', (data) => {
    window.location.href = `/game?room=${data.roomId}`;
  });

  socket.on('error', (data) => showToast(data.message || '发生错误'));
}

function bindEvents() {
  els.logoutBtn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
  });

  els.quickMatchBtn.addEventListener('click', () => {
    if (!socket) return;
    socket.emit('quickMatch');
  });

  els.createRoomBtn.addEventListener('click', () => {
    if (!socket) return;
    socket.emit('createRoom');
  });

  // 人机对弈按钮
  if (els.aiBeginnerBtn) {
    els.aiBeginnerBtn.addEventListener('click', () => {
      window.location.href = '/ai-game?difficulty=beginner';
    });
  }
  if (els.aiIntermediateBtn) {
    els.aiIntermediateBtn.addEventListener('click', () => {
      window.location.href = '/ai-game?difficulty=intermediate';
    });
  }
  if (els.aiAdvancedBtn) {
    els.aiAdvancedBtn.addEventListener('click', () => {
      window.location.href = '/ai-game?difficulty=advanced';
    });
  }

  els.friendsBtn.addEventListener('click', () => {
    window.location.href = '/friends';
  });

  els.joinRoomBtn.addEventListener('click', joinRoomById);

  els.roomIdInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinRoomById();
  });

  els.cancelMatchBtn.addEventListener('click', () => {
    if (!socket) return;
    socket.emit('cancelMatch');
  });

  els.enterRoomBtn.addEventListener('click', () => {
    els.roomCreatedModal.classList.remove('active');
    if (createdRoomId) {
      window.location.href = `/game?room=${createdRoomId}`;
    }
  });

  els.shareToFriendBtn.addEventListener('click', showShareFriendModal);
  els.closeShareModalBtn.addEventListener('click', () => els.shareFriendModal.classList.remove('active'));


}

async function joinRoomById() {
  const roomId = els.roomIdInput.value.trim();
  if (!roomId) { showToast('请输入房间号'); return; }

  try {
    els.joinRoomBtn.disabled = true;
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || '房间不存在');
    if ((data.room?.playersCount || 0) >= 2) {
      throw new Error('房间已满，无法加入');
    }
    window.location.href = `/game?room=${roomId}`;
  } catch (err) {
    showToast(err.message || '房间不存在');
  } finally {
    els.joinRoomBtn.disabled = false;
  }
}

// 棋理轮播
function initTipsCarousel() {
  const slides = els.tipsCarousel.querySelectorAll('.tip-slide');
  const dots = [];
  let current = 0;

  slides.forEach((_, i) => {
    const dot = document.createElement('span');
    dot.className = i === 0 ? 'active' : '';
    dot.addEventListener('click', () => goTo(i));
    els.tipDots.appendChild(dot);
    dots.push(dot);
  });

  function goTo(index) {
    slides[current].classList.remove('active');
    dots[current].classList.remove('active');
    current = index;
    slides[current].classList.add('active');
    dots[current].classList.add('active');
  }

  setInterval(() => {
    goTo((current + 1) % slides.length);
  }, 6000);
}

// 今日运势
function initFortune() {
  const fortunes = [
    { stars: 5, text: '大吉！棋运正旺，落子如有神助，今日可放手一搏，旗开得胜。' },
    { stars: 4, text: '中吉。思路清晰，布局稳健，胜算颇高。' },
    { stars: 4, text: '中吉。以静制动，后发制人，耐心等待良机。' },
    { stars: 3, text: '小吉。棋路平稳，无大起大落，平常心对之。' },
    { stars: 3, text: '平。今日宜复盘研习，不宜冒进。' },
    { stars: 2, text: '小凶。易生漏算，需三思而后行。' },
    { stars: 5, text: '大吉！灵感迸发，妙手迭出，今日乃夺魁之日，宜主动出击。' }
  ];

  // 用日期和账号一起做种子：同一账号当天稳定，不同账号各抽各的签。
  const today = new Date().toLocaleDateString('en-CA');
  const userKey = currentUser && (currentUser.id || currentUser.username || currentUser.nickname)
    ? String(currentUser.id || currentUser.username || currentUser.nickname)
    : 'guest';
  const seedSource = `${today}:${userKey}`;
  const seed = seedSource.split('').reduce((a, b) => ((a * 31) + b.charCodeAt(0)) >>> 0, 0);
  const todayFortune = fortunes[seed % fortunes.length];

  els.fortuneBtn.addEventListener('click', () => {
    els.fortuneStars.textContent = '★'.repeat(todayFortune.stars) + '☆'.repeat(5 - todayFortune.stars);
    els.fortuneText.textContent = todayFortune.text;
    els.fortuneBtn.style.display = 'none';
  });
}

// 加载排行榜
async function loadLeaderboard() {
  try {
    const res = await fetch('/api/leaderboard');
    const data = await res.json();
    if (data.success) {
      renderLeaderboard(data.leaderboard);
    } else {
      els.leaderboardList.innerHTML = '<div class="loading-text">加载失败</div>';
    }
  } catch (err) {
    console.error(err);
    els.leaderboardList.innerHTML = '<div class="loading-text">网络错误</div>';
  }
}

function renderLeaderboard(list) {
  if (!list || list.length === 0) {
    els.leaderboardList.innerHTML = '<div class="loading-text">暂无数据</div>';
    return;
  }
  els.leaderboardList.innerHTML = list.map((user, i) => `
    <div class="leader-item">
      <div class="leader-rank">${i + 1}</div>
      <div class="leader-info">
        <span class="leader-name">${escapeHtml(user.nickname || user.username)}</span>
        <span class="leader-stats">${user.wins}胜 ${user.losses}负</span>
      </div>
      <span class="leader-rating">${user.rating}</span>
    </div>
  `).join('');
}

// 分享给好友功能
async function showShareFriendModal() {
  els.shareFriendList.innerHTML = '<div class="loading-text">正在获取好友列表...</div>';
  els.shareFriendModal.classList.add('active');

  try {
    const res = await fetch('/api/friends');
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || '获取好友列表失败');

    const friends = data.friends || [];
    if (friends.length === 0) {
      els.shareFriendList.innerHTML = '<div class="loading-text">暂无好友，去好友系统添加吧</div>';
      return;
    }

    els.shareFriendList.innerHTML = friends.map(friend => {
      const name = friend.nickname || friend.username;
      const avatarChar = name.charAt(0).toUpperCase();
      return `
        <div class="friend-row" data-username="${escapeHtml(friend.username)}" style="cursor: pointer; width: 100%; border: 1px solid var(--paper-dark); margin-bottom: 4px;">
          <div class="friend-avatar">${avatarChar}</div>
          <div class="friend-row-main">
            <div class="friend-row-top">
              <strong>${escapeHtml(name)}</strong>
              <span class="friend-status ${friend.online ? 'online' : ''}">${friend.online ? '在线' : '离线'}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // 绑定点击事件
    els.shareFriendList.querySelectorAll('.friend-row').forEach(item => {
      item.addEventListener('click', () => {
        const username = item.getAttribute('data-username');
        sendRoomIdToFriend(username);
      });
    });

  } catch (err) {
    els.shareFriendList.innerHTML = `<div class="loading-text" style="color: var(--red-seal)">${err.message}</div>`;
  }
}

function sendRoomIdToFriend(friendUsername) {
  if (!socket || !createdRoomId) return;

  const message = `我创建了一个五子棋对局房间，房间号是：${createdRoomId}，快来一起切磋吧！`;
  socket.emit('privateMessage', { to: friendUsername, message });

  showToast('已成功发送邀请！');
  els.shareFriendModal.classList.remove('active');
}



// 模态框
function showMatchingModal() { els.matchingModal.classList.add('active'); }
function hideMatchingModal() { els.matchingModal.classList.remove('active'); }

let toastTimeout;
function showToast(message, duration = 2500) {
  els.toast.classList.remove('message-toast');
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => els.toast.classList.remove('show'), duration);
}

function showMessageToast(message, duration = 3000) {
  els.toast.classList.add('message-toast');
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    els.toast.classList.remove('show');
    els.toast.classList.remove('message-toast');
  }, duration);
}

async function remindUnreadPrivateMessages() {
  if (unreadReminderShown || !currentUser) return;
  unreadReminderShown = true;

  try {
    const res = await fetch('/api/friends');
    const data = await res.json();
    if (!res.ok || !data.success) return;

    const unreadFriends = (data.friends || [])
      .map(friend => ({ ...friend, unread_count: Number(friend.unread_count || 0) }))
      .filter(friend => friend.unread_count > 0);
    if (unreadFriends.length === 0) return;

    const total = unreadFriends.reduce((sum, friend) => sum + friend.unread_count, 0);
    const primary = unreadFriends[0];
    const name = primary.nickname || primary.username;
    const text = unreadFriends.length === 1
      ? `${name} 发来了 ${primary.unread_count} 条消息`
      : `你有 ${total} 条未读好友消息`;
    showMessageToast(text);
  } catch (err) {
    console.error('检查未读好友消息失败:', err);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function checkActiveGame() {
  try {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/active-game', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!data.success || !data.hasActiveGame) return;

    const msgEl = document.getElementById('reconnectMessage');
    const statusEl = document.getElementById('reconnectOpponentStatus');
    if (msgEl) msgEl.textContent = `您有一场进行中的对局（vs ${data.opponent}）`;
    if (statusEl) statusEl.textContent = data.isOpponentOnline ? '🟢 对手在线' : '🔴 对手已离线';

    const modal = document.getElementById('reconnectModal');
    if (modal) modal.classList.add('active');

    document.getElementById('reconnectJoinBtn').onclick = () => {
      if (modal) modal.classList.remove('active');
      window.location.href = `/game?room=${data.roomId}`;
    };

    document.getElementById('reconnectForfeitBtn').onclick = async () => {
      if (modal) modal.classList.remove('active');
      await fetch('/api/active-game/forfeit', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      showToast('已放弃对局');
    };
  } catch (err) {
    console.error('检查进行中游戏失败:', err);
  }
}

init();
