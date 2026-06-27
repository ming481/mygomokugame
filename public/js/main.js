// 游戏页面主逻辑（纯对局，不含大厅功能）
window.socket = null;
let currentUser = null;
window.currentRoom = null;
let gameState = null;
let unreadReminderShown = false;
const TURN_TIME_SECONDS = 600;

// 必须挂载到 window，供 game.js 访问
window.isMyTurn = false;
window.myColor = null;

const els = {
  userName: document.getElementById('userName'),
  userRating: document.getElementById('userRating'),
  userAvatar: document.getElementById('userAvatar'),
  logoutBtn: document.getElementById('logoutBtn'),
  backBtn: document.getElementById('backBtn'),
  statusText: document.getElementById('statusText'),
  moveCount: document.getElementById('moveCount'),
  blackName: document.getElementById('blackName'),
  whiteName: document.getElementById('whiteName'),
  blackRating: document.getElementById('blackRating'),
  whiteRating: document.getElementById('whiteRating'),
  blackTurn: document.getElementById('blackTurn'),
  whiteTurn: document.getElementById('whiteTurn'),
  blackTimer: document.getElementById('blackTimer'),
  whiteTimer: document.getElementById('whiteTimer'),
  chatMessages: document.getElementById('chatMessages'),
  chatInput: document.getElementById('chatInput'),
  sendChatBtn: document.getElementById('sendChatBtn'),
  chatSection: document.querySelector('.chat-section'),
  controlBar: document.querySelector('.control-bar'),
  matchingModal: document.getElementById('matchingModal'),
  gameEndModal: document.getElementById('gameEndModal'),
  confirmModal: document.getElementById('confirmModal'),
  toast: document.getElementById('toast'),
  drawBtn: document.getElementById('drawBtn'),
  resignBtn: document.getElementById('resignBtn'),
  leaveBtn: document.getElementById('leaveBtn'),
  playAgainBtn: document.getElementById('playAgainBtn'),
  backToLobbyBtn: document.getElementById('backToLobbyBtn'),
  resultIcon: document.getElementById('resultIcon'),
  resultTitle: document.getElementById('resultTitle'),
  resultReason: document.getElementById('resultReason'),
  gameBoardArea: document.getElementById('gameBoardArea'),
  roomIdText: document.getElementById('roomIdText'),
  roomDisplay: document.getElementById('roomDisplay')
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

  // 从 URL 参数或 localStorage 获取房间信息
  const urlParams = new URLSearchParams(window.location.search);
  const roomId = urlParams.get('room');
  const mode = urlParams.get('mode');

  if (mode === 'quick') {
    showMatchingModal();
  } else if (!roomId) {
    // 没有房间信息，也不在匹配模式，返回大厅
    showToast('未指定房间，返回大厅...');
    setTimeout(() => window.location.href = '/lobby', 1500);
  }
}

function updateUserUI() {
  if (!currentUser || !currentUser.username) {
    window.location.replace('/login');
    return;
  }
  els.userName.textContent = currentUser.nickname || currentUser.username;
  els.userRating.textContent = currentUser.rating || 1000;
  els.userAvatar.textContent = (currentUser.nickname || currentUser.username).charAt(0).toUpperCase();
}

function connectSocket() {
  const token = localStorage.getItem('token');
  window.socket = io();

  socket.on('connect', () => {
    window.socket.emit('authenticate', token);
  });

  socket.on('authenticated', (data) => {
    if (!data.success) {
      showToast('连接失败，请重新登录');
      setTimeout(() => { localStorage.removeItem('token'); window.location.href = '/login'; }, 2000);
      return;
    }

    remindUnreadPrivateMessages();

    // 认证成功后，如果 URL 中有房间号，则加入
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('room');
    if (roomId) {
      window.socket.emit('joinRoom', roomId);
    }
  });

  socket.on('disconnect', () => showToast('连接已断开，正在重连...'));

  socket.on('privateMessage', (message) => {
    if (!currentUser || message.sender === currentUser.username) return;
    showMessageToast(`${message.sender} 发来一条新消息`);
  });

  socket.on('matching', () => showMatchingModal());

  socket.on('matchFound', (data) => {
    hideMatchingModal();
    window.currentRoom = data.roomId;
    if (els.roomIdText) els.roomIdText.textContent = data.roomId;
    window.myColor = data.color;
    showToast(`匹配成功！对手: ${data.opponent}`);
  });

  socket.on('matchCancelled', () => hideMatchingModal());

  socket.on('joinedRoom', (data) => {
    window.currentRoom = data.roomId;
    if (els.roomIdText) els.roomIdText.textContent = data.roomId;
    window.myColor = data.color;
    showToast('加入房间成功');
    
    // 初始化 gameState
    gameState = {
      roomId: data.roomId,
      currentTurn: data.currentTurn || 'black',
      moves: data.moves || [],
      status: data.board ? 'playing' : 'waiting'
    };
    applyTimerSync(data.players);
    
    // 如果有棋盘数据（快速匹配或重连），恢复棋盘
    if (data.board && window.gameRenderer) {
      window.gameRenderer.restoreBoard(data.board, data.moves);
      updatePlayerInfo(data.players);
      updateTurnIndicator(data.currentTurn || 'black');
      if (data.board) updateGameControls(true);
    }
  });


  socket.on('gameStart', (data) => {
    const hadMoves = gameState && Array.isArray(gameState.moves) && gameState.moves.length > 0;
    gameState = {
      roomId: data.roomId,
      currentTurn: data.currentTurn,
      moves: hadMoves ? gameState.moves : [],
      status: 'playing',
      blackTime: TURN_TIME_SECONDS,
      whiteTime: TURN_TIME_SECONDS
    };
    window.isMyTurn = window.myColor === data.currentTurn;
    updatePlayerInfo(data.players);
    applyTimerSync(data.players);
    updateStatus('对局进行中');
    updateTurnIndicator(data.currentTurn);
    if (window.gameRenderer && !hadMoves) window.gameRenderer.clearBoard();
    if (!hadMoves) addSystemMessage('对局开始！黑方先行');
    updateGameControls(true);
    startTimer();
  });

  socket.on('playersUpdated', (data) => {
    updatePlayerInfo(data.players || []);
    applyTimerSync(data.players || []);
  });

  socket.on('timerSync', (data) => {
    if (gameState) gameState.currentTurn = data.currentTurn || gameState.currentTurn;
    applyTimerSync(data.players || []);
  });

  socket.on('timerTick', (data) => {
    if (!gameState || !data.color) return;
    if (data.color === 'black') gameState.blackTime = data.timeLeft;
    if (data.color === 'white') gameState.whiteTime = data.timeLeft;
    updateTimerDisplay(data.color, data.timeLeft);
  });

  socket.on('moveMade', (data) => {
    if (window.gameRenderer) {
      window.gameRenderer.placeStone(data.row, data.col, data.color);
      window.gameRenderer.showLastMove(data.row, data.col);
    }
    gameState.moves.push(data);
    els.moveCount.textContent = data.moveNumber;
    gameState.currentTurn = data.color === 'black' ? 'white' : 'black';
    window.isMyTurn = window.myColor === gameState.currentTurn;
    updateTurnIndicator(gameState.currentTurn);
    updateStatus(`${data.color === 'black' ? '黑方' : '白方'} 落子 (${String.fromCharCode(65+data.col)}${15-data.row})`);
    resetTimer(data.color);
  });

  socket.on('turnChanged', (data) => {
    gameState.currentTurn = data.currentTurn;
    window.isMyTurn = window.myColor === data.currentTurn;
    updateTurnIndicator(data.currentTurn);
  });

  socket.on('gameEnd', (data) => {
    gameState.status = 'ended';
    window.isMyTurn = false;
    updateGameControls(false);
    stopTimer();
    showGameEndModal(data);
    if (data.winner) {
      const isWin = data.winner === currentUser?.username;
      const displayName = data.winnerNickname || data.winner;
      addSystemMessage(`对局结束！${displayName} 获胜 (${data.reason})`);
      if (isWin) showToast('恭喜你获胜！', 3000);
    } else {
      addSystemMessage(`对局结束！平局 (${data.reason})`);
    }
  });

  socket.on('drawRequested', (data) => {
    const displayName = data.requesterNickname || data.requester;
    showConfirm('和棋请求', `${displayName} 请求和棋，是否同意？`,
      () => window.socket.emit('respondDraw', { roomId: window.currentRoom, accept: true }),
      () => window.socket.emit('respondDraw', { roomId: window.currentRoom, accept: false })
    );
  });

  socket.on('drawRejected', () => showToast('对方拒绝了和棋请求'));

  socket.on('chatMessage', (data) => addChatMessage(data));

  socket.on('error', (data) => {
    const message = data.message || '发生错误';
    showToast(message);
    if (message.includes('房间不存在') || message.includes('房间已满')) {
      window.currentRoom = null;
    }
  });

  socket.on('leftRoom', () => {
    window.currentRoom = null;
    window.myColor = null;
    window.isMyTurn = false;
    showToast('已离开房间');
    setTimeout(() => window.location.href = '/lobby', 1000);
  });
}

// 计时器
let timerInterval = null;
function startTimer() {
  stopTimer();
  timerInterval = setInterval(() => {
    if (!gameState || gameState.status !== 'playing') return;
    if (gameState.currentTurn === 'black') {
      gameState.blackTime = (gameState.blackTime || 600) - 1;
      if (gameState.blackTime <= 0) gameState.blackTime = 0;
      updateTimerDisplay('black', gameState.blackTime);
    } else {
      gameState.whiteTime = (gameState.whiteTime || 600) - 1;
      if (gameState.whiteTime <= 0) gameState.whiteTime = 0;
      updateTimerDisplay('white', gameState.whiteTime);
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function resetTimer(lastMoveColor) {
  if (!gameState) return;
  if (lastMoveColor === 'black') {
    gameState.blackTime = TURN_TIME_SECONDS;
    updateTimerDisplay('black', gameState.blackTime);
    gameState.whiteTime = TURN_TIME_SECONDS;
    updateTimerDisplay('white', gameState.whiteTime);
    return;
  }
  if (lastMoveColor === 'white') {
    gameState.whiteTime = TURN_TIME_SECONDS;
    updateTimerDisplay('white', gameState.whiteTime);
    gameState.blackTime = TURN_TIME_SECONDS;
    updateTimerDisplay('black', gameState.blackTime);
    return;
  }
}

function updateTimerDisplay(color, seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  const el = color === 'black' ? els.blackTimer : els.whiteTimer;
  if (el) el.textContent = `${m}:${s}`;
}

function bindEvents() {
  els.logoutBtn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
  });

  els.backBtn.addEventListener('click', () => {
    if (window.currentRoom && window.socket) {
      showConfirm('确认离开', '确定要离开当前房间吗？',
        () => window.socket.emit('leaveRoom', { roomId: window.currentRoom })
      );
    } else {
      window.location.href = '/lobby';
    }
  });

  els.drawBtn.addEventListener('click', () => {
    if (!window.currentRoom || !window.socket) return;
    window.socket.emit('requestDraw', { roomId: window.currentRoom });
    showToast('已发送和棋请求');
  });

  els.resignBtn.addEventListener('click', () => {
    if (!window.currentRoom || !window.socket) return;
    showConfirm('确认认输', '确定要认输吗？',
      () => window.socket.emit('resign', { roomId: window.currentRoom })
    );
  });

  els.leaveBtn.addEventListener('click', () => {
    if (!window.currentRoom || !window.socket) return;
    showConfirm('确认离开', '确定要离开当前房间吗？',
      () => window.socket.emit('leaveRoom', { roomId: window.currentRoom })
    );
  });

  els.playAgainBtn.addEventListener('click', () => {
    hideGameEndModal();
    window.location.href = '/lobby?mode=quick';
  });

  els.backToLobbyBtn.addEventListener('click', () => {
    hideGameEndModal();
    window.location.href = '/lobby';
  });

  els.sendChatBtn.addEventListener('click', sendChat);
  els.chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChat(); });


}

function sendChat() {
  const msg = els.chatInput.value.trim();
  if (!msg || !window.currentRoom || !window.socket) return;
  window.socket.emit('chatMessage', { roomId: window.currentRoom, message: msg });
  els.chatInput.value = '';
  els.chatInput.focus();
}

function addChatMessage(data) {
  const div = document.createElement('div');
  const isOwn = data.username === currentUser?.username;
  const isSystem = data.system;

  if (isSystem) {
    div.className = 'chat-bubble system';
    div.innerHTML = `<span class="bubble-text">${escapeHtml(data.message)}</span>`;
  } else {
    div.className = `chat-bubble ${isOwn ? 'own' : 'other'}`;
    div.innerHTML = `
      <div class="bubble-header">
        <span class="bubble-user">${escapeHtml(data.nickname)}</span>
        <span class="bubble-time">${data.time || ''}</span>
      </div>
      <div class="bubble-content">${escapeHtml(data.message)}</div>
    `;
  }

  els.chatMessages.appendChild(div);
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

function addSystemMessage(text) {
  addChatMessage({ username: '系统', message: text, system: true, time: '' });
}

function updatePlayerInfo(players) {
  players = Array.isArray(players) ? players : [];
  const black = players.find(p => p.color === 'black');
  const white = players.find(p => p.color === 'white');
  els.blackName.textContent = black ? black.nickname : '--';
  els.whiteName.textContent = white ? white.nickname : '--';
  els.blackRating.textContent = '1000';
  els.whiteRating.textContent = '1000';
}

function updateStatus(text) { els.statusText.textContent = text; }

function updateTurnIndicator(turn) {
  els.blackTurn.classList.toggle('active', turn === 'black');
  els.whiteTurn.classList.toggle('active', turn === 'white');
}

function updateGameControls(enabled) {
  [els.drawBtn, els.resignBtn].forEach(btn => {
    btn.disabled = !enabled;
    btn.style.opacity = enabled ? '1' : '0.5';
  });
}

function applyTimerSync(players) {
  players = Array.isArray(players) ? players : [];
  const black = players.find(p => p.color === 'black');
  const white = players.find(p => p.color === 'white');
  if (black && gameState) {
    gameState.blackTime = Number(black.timeLeft ?? 600);
    updateTimerDisplay('black', gameState.blackTime);
  }
  if (white && gameState) {
    gameState.whiteTime = Number(white.timeLeft ?? 600);
    updateTimerDisplay('white', gameState.whiteTime);
  }
}


// 模态框
function showMatchingModal() { els.matchingModal.classList.add('active'); }
function hideMatchingModal() { els.matchingModal.classList.remove('active'); }

function showGameEndModal(data) {
  if (data.winner === currentUser?.username) {
    els.resultIcon.textContent = '🏆';
    els.resultTitle.textContent = '恭喜获胜！';
    els.resultTitle.style.color = 'var(--gold)';
  } else if (data.winner) {
    els.resultIcon.textContent = '💔';
    els.resultTitle.textContent = '惜败';
    els.resultTitle.style.color = 'var(--ink-gray)';
  } else {
    els.resultIcon.textContent = '⚖️';
    els.resultTitle.textContent = '平局';
    els.resultTitle.style.color = 'var(--wood-dark)';
  }
  document.getElementById('resultReason').textContent = data.reason || '';
  els.gameEndModal.classList.add('active');
}

function hideGameEndModal() { els.gameEndModal.classList.remove('active'); }

let confirmCallback = null, cancelCallback = null;
function showConfirm(title, message, onOk, onCancel) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  confirmCallback = onOk; cancelCallback = onCancel;
  els.confirmModal.classList.add('active');
}

document.getElementById('confirmOk').addEventListener('click', () => {
  els.confirmModal.classList.remove('active');
  if (confirmCallback) confirmCallback();
});
document.getElementById('confirmCancel').addEventListener('click', () => {
  els.confirmModal.classList.remove('active');
  if (cancelCallback) cancelCallback();
});

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

init();
