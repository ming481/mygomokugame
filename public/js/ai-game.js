// ============================================================
// 人机对弈 - AI逻辑与游戏控制
// 架构: C++ 算法编译为 WASM, 通过 Web Worker 在独立线程运行
// 主线程: UI 更新 + 计时显示
// Worker线程: WASM 五子棋算法计算
// ============================================================

// ---------- 全局状态 ----------
let currentUser = null;
let difficulty = 'beginner'; // beginner | intermediate | advanced
let board = Array(15).fill(null).map(() => Array(15).fill(0));
let moveCount = 0;
let gameActive = false;
window.isMyTurn = false;
window.myColor = 'black'; // 玩家执黑，AI执白
let socket = null;
let unreadReminderShown = false;
let toastTimeout = null;

// ---------- AI Worker ----------
let aiWorker = null;
let workerReady = false;

function initWorker() {
  aiWorker = new Worker('/js/ai-worker.js');
  aiWorker.onmessage = handleWorkerMessage;
  aiWorker.onerror = (e) => {
    console.error('Worker 错误:', e);
    showToast('AI Worker 出错，请刷新页面');
  };
  aiWorker.postMessage({ type: 'init' });
}

function handleWorkerMessage(e) {
  const { type, seconds, row, col, message } = e.data;

  if (type === 'ready') {
    workerReady = true;
    console.log('WASM AI Worker 就绪');
  } else if (type === 'tick') {
    // 主线程接收Worker的计时更新，更新UI
    updateAIThinkingSeconds(seconds);
  } else if (type === 'move') {
    // AI计算完成，落子
    if (gameActive) {
      placeMove(row, col, 2, 'white');
    }
  } else if (type === 'error') {
    console.error('Worker Error:', message);
    showToast('AI计算出错: ' + message);
  }
}

// ---------- 计时器 ----------
const PLAYER_TURN_SECONDS = 600;
let playerTimeLeft = PLAYER_TURN_SECONDS;
let playerTimerInterval = null;

function startPlayerTimer() {
  stopPlayerTimer();
  playerTimeLeft = PLAYER_TURN_SECONDS;
  updateTimerDisplay(playerTimeLeft);
  playerTimerInterval = setInterval(() => {
    playerTimeLeft--;
    updateTimerDisplay(playerTimeLeft);
    if (playerTimeLeft <= 0) {
      stopPlayerTimer();
      if (gameActive) {
        showToast('思考时间超时，本局判负！');
        endGame('timeout');
      }
    }
  }, 1000);
}

function stopPlayerTimer() {
  if (playerTimerInterval) { clearInterval(playerTimerInterval); playerTimerInterval = null; }
}

function resetPlayerTimer() {
  stopPlayerTimer();
  updateTimerDisplay(PLAYER_TURN_SECONDS);
}

function updateTimerDisplay(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  if (els.blackTimer) els.blackTimer.textContent = `${m}:${s}`;
}

// ---------- AI状态框 ----------
function setAIStatus(state, seconds) {
  if (!els.aiThinkingBox) return;
  if (state === 'thinking') {
    const showSeconds = seconds !== undefined && seconds >= 3;
    const secStr = showSeconds ? `(${seconds}秒)` : '...';
    els.aiThinkingBox.innerHTML = `
      <span class="ai-think-icon">🤖</span>
      <div class="ai-thinking-dots"><span></span><span></span><span></span></div>
      <span class="ai-thinking-text">AI 思考中${secStr}</span>`;
    els.aiThinkingBox.classList.remove('ai-waiting');
    els.aiThinkingBox.classList.add('ai-thinking');
  } else {
    els.aiThinkingBox.innerHTML = `
      <span class="ai-think-icon">⏳</span>
      <span>AI 等待中...</span>`;
    els.aiThinkingBox.classList.remove('ai-thinking');
    els.aiThinkingBox.classList.add('ai-waiting');
  }
}

function updateAIThinkingSeconds(seconds) {
  if (!els.aiThinkingBox) return;
  // 只更新文案部分，不重建整个DOM
  const span = els.aiThinkingBox.querySelector('.ai-thinking-text') || els.aiThinkingBox.querySelector('span:last-child');
  if (!span) return;
  if (seconds >= 3) {
    span.textContent = `AI 思考中(${seconds}秒)`;
  } else {
    span.textContent = 'AI 思考中...';
  }
}

// ---------- DOM 元素 ----------
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
  blackTurn: document.getElementById('blackTurn'),
  whiteTurn: document.getElementById('whiteTurn'),
  blackTimer: document.getElementById('blackTimer'),
  whiteTimer: document.getElementById('whiteTimer'),
  difficultyText: document.getElementById('difficultyText'),
  aiDifficultyLabel: document.getElementById('aiDifficultyLabel'),
  aiThinkingBox: document.getElementById('aiThinkingBox'),
  aiScoreRules: document.getElementById('aiScoreRules'),
  resignBtn: document.getElementById('resignBtn'),
  leaveBtn: document.getElementById('leaveBtn'),
  gameEndModal: document.getElementById('gameEndModal'),
  confirmModal: document.getElementById('confirmModal'),
  resultIcon: document.getElementById('resultIcon'),
  resultTitle: document.getElementById('resultTitle'),
  resultReason: document.getElementById('resultReason'),
  ratingChange: document.getElementById('ratingChange'),
  playAgainBtn: document.getElementById('playAgainBtn'),
  backToLobbyBtn: document.getElementById('backToLobbyBtn'),
  toast: document.getElementById('toast'),
};

// ---------- 积分规则 ----------
const SCORE_RULES = {
  beginner:     { win: 10,  loss: -10 },
  intermediate: { win: 15,  loss: -10 },
  advanced:     { win: 20,  loss: -10 },
};

const DIFF_LABELS = {
  beginner: '初级',
  intermediate: '中级',
  advanced: '高级',
};

// ============================================================
// 胜负判断 (UI层保留，用于即时检测)
// ============================================================
function checkWinner(b, row, col, val) {
  const dirs = [[0,1],[1,0],[1,1],[1,-1]];
  for (const [dr, dc] of dirs) {
    let count = 1;
    for (let d = 1; d <= 4; d++) {
      const r = row + dr*d, c = col + dc*d;
      if (r<0||r>=15||c<0||c>=15||b[r][c]!==val) break;
      count++;
    }
    for (let d = 1; d <= 4; d++) {
      const r = row - dr*d, c = col - dc*d;
      if (r<0||r>=15||c<0||c>=15||b[r][c]!==val) break;
      count++;
    }
    if (count >= 5) return true;
  }
  return false;
}

// ============================================================
// 游戏进程控制
// ============================================================
function startGame() {
  board = Array(15).fill(null).map(() => Array(15).fill(0));
  moveCount = 0;
  gameActive = true;
  window.isMyTurn = true;

  if (window.gameRenderer) {
    window.gameRenderer.clearBoard();
    window.gameRenderer.canvas.onclick = null;
    window.gameRenderer.canvas.addEventListener('click', handlePlayerClick);
  }

  updateTurnIndicator('black');
  updateStatus('你先行，执黑子');
  els.moveCount.textContent = '0';
  els.whiteTimer.textContent = '--:--';

  setAIStatus('waiting');
  startPlayerTimer();
  updateGameControls(true);
}

function handlePlayerClick(e) {
  if (!gameActive || !window.isMyTurn) return;
  const pos = window.gameRenderer.getBoardPosition(e);
  if (!pos) return;
  if (board[pos.row][pos.col] !== 0) return;
  placeMove(pos.row, pos.col, 1, 'black');
}

function placeMove(row, col, val, color) {
  board[row][col] = val;
  moveCount++;
  els.moveCount.textContent = moveCount;

  if (window.gameRenderer) {
    window.gameRenderer.placeStone(row, col, color);
    window.gameRenderer.showLastMove(row, col);
    window.gameRenderer.board[row][col] = val;
  }

  updateStatus(`${color === 'black' ? '黑方' : '白方'} 落子 (${String.fromCharCode(65+col)}${15-row})`);

  if (checkWinner(board, row, col, val)) {
    gameActive = false;
    window.isMyTurn = false;
    stopPlayerTimer();
    setTimeout(() => endGame(color === 'black' ? 'player' : 'ai'), 400);
    return;
  }

  if (color === 'black') {
    stopPlayerTimer();
    resetPlayerTimer();
    window.isMyTurn = false;
    updateTurnIndicator('white');
    setAIStatus('thinking', 0);
    // 将计算交给 Worker 线程，主线程不阻塞
    setTimeout(doAIMove, 100);
  } else {
    window.isMyTurn = true;
    updateTurnIndicator('black');
    const coord = `${String.fromCharCode(65+col)}${15-row}`;
    updateStatus(`白方落子 (${coord})，轮到你落子`);
    setAIStatus('waiting');
    startPlayerTimer();
  }
}

function doAIMove() {
  if (!gameActive) return;
  if (!workerReady) {
    // Worker 还未就绪，稍后重试
    setTimeout(doAIMove, 200);
    return;
  }
  // 发送棋盘状态给 Worker，在独立线程计算
  aiWorker.postMessage({
    type: 'compute',
    board: board.map(row => [...row]), // 深拷贝
    difficulty: difficulty,
  });
}

// ============================================================
// 结束游戏与积分处理
// ============================================================
async function endGame(result) {
  gameActive = false;
  window.isMyTurn = false;
  stopPlayerTimer();
  updateGameControls(false);
  setAIStatus('waiting');

  const rules = SCORE_RULES[difficulty];
  const won = result === 'player';
  let ratingDelta = won ? rules.win : rules.loss;
  if (result === 'resign') ratingDelta = -5;

  try {
    const token = localStorage.getItem('token');
    const resp = await fetch('/api/ai-game-end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ difficulty, won, ratingDelta })
    });
    const data = await resp.json();
    if (data.success) {
      if (currentUser) currentUser.rating = data.newRating;
      els.userRating.textContent = data.newRating;
    }
  } catch (err) {
    console.error('积分更新失败', err);
  }

  if (result === 'leave') {
    window.location.href = '/lobby';
    return;
  }

  showGameEndModal(result, ratingDelta);
}

function showGameEndModal(result, ratingDelta) {
  if (result === 'player') {
    els.resultIcon.textContent = '🏆';
    els.resultTitle.textContent = '恭喜获胜！';
    els.resultTitle.style.color = 'var(--gold)';
    els.resultReason.textContent = '五子连珠，你赢了！';
  } else if (result === 'ai') {
    els.resultIcon.textContent = '💔';
    els.resultTitle.textContent = '惜败';
    els.resultTitle.style.color = 'var(--ink-gray)';
    els.resultReason.textContent = 'AI五子连珠，再接再厉！';
  } else if (result === 'timeout') {
    els.resultIcon.textContent = '⏰';
    els.resultTitle.textContent = '超时判负';
    els.resultTitle.style.color = 'var(--ink-gray)';
    els.resultReason.textContent = '思考时间耗尽，本局判负并扣除10分';
  } else if (result === 'resign') {
    els.resultIcon.textContent = '🏳️';
    els.resultTitle.textContent = '主动认输';
    els.resultTitle.style.color = 'var(--ink-gray)';
    els.resultReason.textContent = '胜败乃兵家常事，本次扣除5分';
  } else {
    els.resultIcon.textContent = '✕';
    els.resultTitle.textContent = '判负离场';
    els.resultTitle.style.color = 'var(--ink-gray)';
    els.resultReason.textContent = '中途离开对局，本局判负并扣除10分';
  }
  const sign = ratingDelta >= 0 ? '+' : '';
  els.ratingChange.textContent = `积分变化：${sign}${ratingDelta}`;
  els.ratingChange.style.color = ratingDelta >= 0 ? '#27ae60' : '#e74c3c';
  els.gameEndModal.classList.add('active');
}

function updateTurnIndicator(turn) {
  els.blackTurn.classList.toggle('active', turn === 'black');
  els.whiteTurn.classList.toggle('active', turn === 'white');
}

function updateStatus(text) { els.statusText.textContent = text; }

function updateGameControls(enabled) {
  els.resignBtn.disabled = !enabled;
  els.resignBtn.style.opacity = enabled ? '1' : '0.5';
}

// ============================================================
// 初始化与 Socket 好友提醒
// ============================================================
async function init() {
  const token = localStorage.getItem('token');
  if (!token) { window.location.replace('/login'); return; }

  try {
    const res = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    if (data.success && data.user) {
      currentUser = data.user;
      els.userName.textContent = currentUser.nickname || currentUser.username;
      els.userRating.textContent = currentUser.rating || 1000;
      els.userAvatar.textContent = (currentUser.nickname || currentUser.username).charAt(0).toUpperCase();
      els.blackName.textContent = currentUser.nickname || currentUser.username;
    } else { throw new Error('认证失败'); }
  } catch (err) {
    localStorage.removeItem('token');
    window.location.replace('/login');
    return;
  }

  const urlParams = new URLSearchParams(window.location.search);
  const diff = urlParams.get('difficulty');
  if (['beginner', 'intermediate', 'advanced'].includes(diff)) difficulty = diff;

  const label = DIFF_LABELS[difficulty];
  els.difficultyText.textContent = `人机对弈 · ${label}`;
  els.aiDifficultyLabel.textContent = label;

  const rules = SCORE_RULES[difficulty];
  els.aiScoreRules.innerHTML = `
    <div class="score-row win">🏆 赢棋 <b>+${rules.win}</b> 分</div>
    <div class="score-row loss">💔 输棋 <b>${rules.loss}</b> 分</div>
    <div class="score-row resign" style="background: rgba(0,0,0,0.05); color: #555; margin-top:4px;">🏳️ 认输 <b>-5</b> 分</div>
  `;

  // 初始化 WASM Worker
  initWorker();

  connectSocket();
  bindEvents();
  setTimeout(startGame, 100);
}

function connectSocket() {
  const token = localStorage.getItem('token');
  if (typeof io === 'undefined') return;
  socket = io();
  socket.on('connect', () => socket.emit('authenticate', token));
  socket.on('authenticated', (data) => {
    if (data.success) remindUnreadPrivateMessages();
  });
  socket.on('privateMessage', (message) => {
    if (!currentUser || message.sender === currentUser.username) return;
    const displayName = message.senderNickname || message.sender;
    showMessageToast(`${displayName} 发来一条新消息`);
  });
}

function bindEvents() {
  els.logoutBtn.addEventListener('click', async () => {
    if (gameActive) await endGame('leave');
    await fetch('/api/logout', { method: 'POST' });
    localStorage.removeItem('token');
    window.location.href = '/login';
  });

  els.backBtn.addEventListener('click', () => {
    if (gameActive) {
      showConfirm('确认离开', '对局未结束，离开将判定输棋并扣除10分。想要减少扣分请点击"认输"按钮。', () => endGame('leave'));
    } else {
      window.location.href = '/lobby';
    }
  });

  els.resignBtn.addEventListener('click', () => {
    if (!gameActive) return;
    showConfirm('确认认输', '确定要认输吗？主动认输仅扣除 5 分。', () => endGame('resign'));
  });

  els.leaveBtn.addEventListener('click', () => {
    if (gameActive) {
      showConfirm('确认离开', '对局未结束，离开将判定输棋并扣除10分。', () => endGame('leave'));
    } else {
      window.location.href = '/lobby';
    }
  });

  els.playAgainBtn.addEventListener('click', () => {
    els.gameEndModal.classList.remove('active');
    startGame();
  });

  els.backToLobbyBtn.addEventListener('click', () => {
    els.gameEndModal.classList.remove('active');
    window.location.href = '/lobby';
  });

  document.getElementById('confirmOk').addEventListener('click', () => {
    els.confirmModal.classList.remove('active');
    if (confirmCallback) confirmCallback();
  });
  document.getElementById('confirmCancel').addEventListener('click', () => {
    els.confirmModal.classList.remove('active');
  });

  window.addEventListener('beforeunload', () => {
    if (gameActive) {
      const token = localStorage.getItem('token');
      const body = JSON.stringify({ difficulty, won: false });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/ai-game-end-beacon?token=' + encodeURIComponent(token), body);
      }
    }
  });
}

let confirmCallback = null;
function showConfirm(title, message, onOk) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  confirmCallback = onOk;
  els.confirmModal.classList.add('active');
}

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
      .map(f => ({ ...f, unread_count: Number(f.unread_count || 0) }))
      .filter(f => f.unread_count > 0);
    if (unreadFriends.length === 0) return;
    const total = unreadFriends.reduce((sum, f) => sum + f.unread_count, 0);
    const primary = unreadFriends[0];
    const name = primary.nickname || primary.username;
    const text = unreadFriends.length === 1
      ? `${name} 发来了 ${primary.unread_count} 条消息`
      : `你有 ${total} 条未读好友消息`;
    showMessageToast(text);
  } catch (err) { console.error('检查未读消息失败:', err); }
}

init();
