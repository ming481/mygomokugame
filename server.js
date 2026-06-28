const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const Database = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 60000,
  pingInterval: 25000
});

const JWT_SECRET = process.env.JWT_SECRET || 'gomoku-secret-key-2024';
const PORT = process.env.PORT || 5173;
const TURN_TIME_SECONDS = 600;

app.use(express.json());
app.use(cookieParser());

// ========== 设备检测 ==========
function isMobileDevice(req) {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  // 注意：不包含 ipad，平板使用桌面端UI
  const mobileKeywords = ['mobile', 'android', 'iphone', 'ipod', 'webos', 'blackberry', 'windows phone', 'opera mini', 'iemobile'];
  return mobileKeywords.some(kw => ua.includes(kw));
}

function disablePageCache(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

function servePage(pageName) {
  return (req, res) => {
    const baseDir = isMobileDevice(req) ? 'public/mobile' : 'public';
    disablePageCache(res);
    res.sendFile(path.join(__dirname, baseDir, pageName));
  };
}

// ========== JWT验证中间件 ==========

// API 路由用 — 认证失败返回 JSON
const authenticateToken = async (req, res, next) => {
  const token = req.cookies.token || req.headers['authorization']?.split(' ')[1];
  if (!token) return res.sendStatus(401);

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const storedToken = await Database.getCurrentToken(decoded.username);
    if (storedToken === null) {
      await Database.updateCurrentToken(decoded.username, token);
    } else if (storedToken !== token) {
      return res.status(403).json({ success: false, error: 'token_invalidated' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.sendStatus(403);
  }
};

// 页面路由用 — 认证失败直接重定向到登录页
const authenticatePage = async (req, res, next) => {
  const token = req.cookies.token || req.headers['authorization']?.split(' ')[1];
  if (!token) return res.redirect('/login');

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const storedToken = await Database.getCurrentToken(decoded.username);
    if (storedToken === null) {
      await Database.updateCurrentToken(decoded.username, token);
    } else if (storedToken !== token) {
      res.clearCookie('token');
      return res.redirect('/login');
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.redirect('/login');
  }
};

// ========== 页面路由（带鉴权）==========

// 根路由：JWT鉴权后决定跳转
app.get('/', async (req, res) => {
  const token = req.cookies.token || req.headers['authorization']?.split(' ')[1];
  if (!token) {
    return res.redirect('/login');
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const storedToken = await Database.getCurrentToken(decoded.username);
    if (storedToken !== null && storedToken !== token) {
      res.clearCookie('token');
      return res.redirect('/login');
    }
    if (storedToken === null) {
      await Database.updateCurrentToken(decoded.username, token);
    }
    res.redirect('/lobby');
  } catch (err) {
    res.redirect('/login');
  }
});

// 公开页面 — 登录
app.get('/login', (req, res) => {
  const baseDir = isMobileDevice(req) ? 'public/mobile' : 'public';
  disablePageCache(res);
  res.sendFile(path.join(__dirname, baseDir, 'login.html'));
});
app.get('/login.html', (req, res) => res.redirect('/login'));

// 大厅页面鉴权
app.get('/lobby', authenticatePage, servePage('lobby.html'));
app.get('/lobby.html', (req, res) => res.redirect('/lobby'));

// 游戏页面鉴权
app.get('/game', authenticatePage, servePage('index.html'));
app.get('/index', (req, res) => {
  const qs = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  res.redirect(301, '/game' + qs);
});
app.get('/index.html', (req, res) => {
  const qs = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  res.redirect(301, '/game' + qs);
});

app.get('/ai-game', authenticatePage, servePage('ai-game.html'));
app.get('/ai-game.html', (req, res) => res.redirect('/ai-game'));

app.get('/friends', authenticatePage, servePage('friends.html'));
app.get('/friends.html', (req, res) => res.redirect('/friends'));

// 静态文件（login.html 等公开资源放在这里之后）
// 为 .wasm 文件添加正确的 MIME 类型，Web Worker 和 WebAssembly 需要
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.wasm')) {
      res.setHeader('Content-Type', 'application/wasm');
    }
    if (/\.(html|css|js)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// ========== API路由 ==========

// 注册
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, nickname } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    const user = await Database.registerUser(username, password, nickname);
    const token = jwt.sign({ username, id: user.id }, JWT_SECRET, { expiresIn: '7d' });
    await Database.updateCurrentToken(username, token);
    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ success: true, token, username });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 登录
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await Database.validateUser(username, password);

    // 检查该账号是否当前在线（有活跃的 socket 连接）
    if (userSockets.has(user.username)) {
      return res.status(409).json({ error: '该账号已在其他设备登录' });
    }

    const token = jwt.sign({ username: user.username, id: user.id }, JWT_SECRET, { expiresIn: '7d' });
    await Database.updateCurrentToken(user.username, token);
    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ success: true, token, user });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// 验证Token
app.get('/api/me', authenticateToken, async (req, res) => {
  try {
    const user = await Database.getUserByUsername(req.user.username);
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 登出
app.post('/api/logout', async (req, res) => {
  const token = req.cookies.token || req.headers['authorization']?.split(' ')[1];
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      await Database.clearCurrentToken(decoded.username);
    } catch (_) { /* token 可能已过期，忽略 */ }
  }
  res.clearCookie('token');
  res.json({ success: true });
});

// 排行榜
app.get('/api/leaderboard', async (req, res) => {
  try {
    const board = await Database.getLeaderboard();
    res.json({ success: true, leaderboard: board });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 人机对弈结束 - 更新积分
app.post('/api/ai-game-end', authenticateToken, async (req, res) => {
  try {
    const { difficulty, won, ratingDelta: clientDelta } = req.body;
    const SCORE_RULES = { beginner: { win: 10, loss: -10 }, intermediate: { win: 15, loss: -10 }, advanced: { win: 20, loss: -10 } };
    const rules = SCORE_RULES[difficulty] || SCORE_RULES.beginner;

    // 如果客户端传了积分变化值（如认输-5），则优先使用；否则按默认胜负规则
    const ratingDelta = (clientDelta !== undefined) ? clientDelta : (won ? rules.win : rules.loss);

    await Database.updateStats(req.user.username, won ? 'win' : 'loss', ratingDelta);
    const user = await Database.getUserByUsername(req.user.username);
    res.json({ success: true, newRating: user.rating, ratingDelta });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 页面关闭时的beacon判负（token通过query传递，因为beacon不支持header）
app.post('/api/ai-game-end-beacon', async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.sendStatus(204);
    const user = jwt.verify(token, JWT_SECRET);
    const { difficulty } = req.body;
    const SCORE_RULES = { beginner: { win: 10, loss: -10 }, intermediate: { win: 15, loss: -10 }, advanced: { win: 20, loss: -10 } };
    const rules = SCORE_RULES[difficulty] || SCORE_RULES.beginner;
    await Database.updateStats(user.username, 'loss', rules.loss);
    res.sendStatus(204);
  } catch (err) {
    res.sendStatus(204); // beacon不关心响应
  }
});

// 历史记录
app.get('/api/history', authenticateToken, async (req, res) => {
  try {
    const history = await Database.getUserHistory(req.user.username, 20);
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/friends/search', authenticateToken, async (req, res) => {
  try {
    const username = String(req.query.username || '').trim();
    if (!username) return res.status(400).json({ error: '请输入用户名' });

    const user = await Database.searchUserByUsername(username, req.user.username);
    if (!user) return res.status(404).json({ error: '未找到该用户' });

    const friendship = await Database.getFriendship(req.user.username, user.username);
    res.json({
      success: true,
      user: {
        ...user,
        isFriend: friendship?.status === 'accepted',
        friendshipStatus: friendship?.status || 'none',
        pendingDirection: friendship?.status === 'pending'
          ? (friendship.requested_by === req.user.username ? 'outgoing' : 'incoming')
          : null,
        online: userSockets.has(user.username)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/friends', authenticateToken, async (req, res) => {
  try {
    const friends = await Database.getFriends(req.user.username);
    res.json({
      success: true,
      friends: friends.map(friend => ({
        ...friend,
        online: userSockets.has(friend.username)
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/friend-requests', authenticateToken, async (req, res) => {
  try {
    const requests = await Database.getFriendRequests(req.user.username);
    res.json({
      success: true,
      incoming: requests.incoming.map(request => ({
        ...request,
        online: userSockets.has(request.username)
      })),
      outgoing: requests.outgoing.map(request => ({
        ...request,
        online: userSockets.has(request.username)
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/friends', authenticateToken, async (req, res) => {
  try {
    const friendUsername = String(req.body.username || '').trim();
    if (!friendUsername) return res.status(400).json({ error: '请输入用户名' });

    const friend = await Database.sendFriendRequest(req.user.username, friendUsername);
    const payload = { success: true, request: { to: friend.username } };
    res.json(payload);

    const friendSocketId = userSockets.get(friend.username);
    if (friendSocketId) io.to(friendSocketId).emit('friendRequestsUpdated');
    const currentSocketId = userSockets.get(req.user.username);
    if (currentSocketId) io.to(currentSocketId).emit('friendRequestsUpdated');
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/friends/:username/respond', authenticateToken, async (req, res) => {
  try {
    const requesterUsername = String(req.params.username || '').trim();
    const accept = Boolean(req.body.accept);
    if (!requesterUsername) return res.status(400).json({ error: '申请用户不能为空' });

    const requester = await Database.respondFriendRequest(req.user.username, requesterUsername, accept);
    res.json({ success: true, accepted: accept, friend: accept ? requester : null });

    const requesterSocketId = userSockets.get(requester.username);
    if (requesterSocketId) {
      io.to(requesterSocketId).emit('friendRequestsUpdated');
      if (accept) io.to(requesterSocketId).emit('friendListUpdated');
    }
    const currentSocketId = userSockets.get(req.user.username);
    if (currentSocketId) {
      io.to(currentSocketId).emit('friendRequestsUpdated');
      if (accept) io.to(currentSocketId).emit('friendListUpdated');
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/friends/:username/messages', authenticateToken, async (req, res) => {
  try {
    const friendUsername = String(req.params.username || '').trim();
    const messages = await Database.getPrivateMessages(req.user.username, friendUsername, 100);
    res.json({ success: true, messages });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ========== 游戏服务器逻辑 ==========

const rooms = new Map();
const waitingPlayers = [];
const userSockets = new Map();

app.get('/api/rooms/:roomId', authenticateToken, (req, res) => {
  const roomId = String(req.params.roomId || '').trim();
  const room = rooms.get(roomId);
  if (!room) return res.status(404).json({ success: false, error: '房间不存在' });
  res.json({
    success: true,
    room: {
      id: room.id,
      status: room.status,
      playersCount: room.players.length,
      spectatorsCount: 0
    }
  });
});

// 查询用户是否有进行中的在线匹配对局（用于断线重连检测）
app.get('/api/active-game', authenticateToken, async (req, res) => {
  try {
    const username = req.user.username;

    // 先查内存 rooms Map
    for (const [roomId, room] of rooms.entries()) {
      if (room.status === 'ended' || room.status === 'waiting') continue;
      const player = room.players.find(p => p.username === username);
      if (!player) continue;
      const opponent = room.players.find(p => p.username !== username);
      return res.json({
        success: true,
        hasActiveGame: true,
        roomId,
        opponent: opponent ? (opponent.nickname || opponent.username) : '未知',
        color: player.color,
        isOpponentOnline: opponent ? userSockets.has(opponent.username) : false
      });
    }

    // 内存中没找到，查 DB
    const dbGame = await Database.loadActiveGameByUser(username);
    if (dbGame) {
      const isBlack = dbGame.player_black === username;
      const opponentName = isBlack ? dbGame.player_white : dbGame.player_black;
      const opponentUser = await Database.getUserByUsername(opponentName);
      return res.json({
        success: true,
        hasActiveGame: true,
        roomId: dbGame.room_id,
        opponent: opponentUser ? (opponentUser.nickname || opponentName) : opponentName,
        color: isBlack ? 'black' : 'white',
        isOpponentOnline: userSockets.has(opponentName)
      });
    }

    res.json({ success: true, hasActiveGame: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 用户主动放弃进行中的对局
app.post('/api/active-game/forfeit', authenticateToken, async (req, res) => {
  try {
    const username = req.user.username;
    let deleted = false;

    // 先查内存
    for (const [roomId, room] of rooms.entries()) {
      if (room.status === 'ended' || room.status === 'waiting') continue;
      const player = room.players.find(p => p.username === username);
      if (!player) continue;

      room.status = 'ended';
      const opponent = room.players.find(p => p.username !== username);
      room.winner = opponent ? opponent.username : null;
      if (opponent) {
        Database.updateStats(opponent.username, 'win', 20).catch(console.error);
        Database.updateStats(username, 'loss', -15).catch(console.error);
        const black = room.players.find(p => p.color === 'black');
        const white = room.players.find(p => p.color === 'white');
        Database.saveGameRecord(roomId,
          black ? black.username : '',
          white ? white.username : '',
          opponent.username, `${username} 放弃对局`, room.moves.length
        ).catch(console.error);
        const opponentNickname = opponent.nickname || await resolveNickname(opponent.username);
        io.to(roomId).emit('gameEnd', {
          winner: opponent.username,
          winnerNickname: opponentNickname,
          color: opponent.color,
          reason: '对手放弃对局',
          board: room.board
        });
      }
      if (room.disconnectTimer) clearTimeout(room.disconnectTimer);
      if (room.countdownInterval) clearInterval(room.countdownInterval);
      rooms.delete(roomId);
      await Database.deleteActiveGame(roomId);
      deleted = true;
      break;
    }

    // 不在内存则查 DB
    if (!deleted) {
      const dbGame = await Database.loadActiveGameByUser(username);
      if (dbGame) {
        const opponentName = dbGame.player_black === username ? dbGame.player_white : dbGame.player_black;
        Database.updateStats(opponentName, 'win', 20).catch(console.error);
        Database.updateStats(username, 'loss', -15).catch(console.error);
        Database.saveGameRecord(dbGame.room_id, dbGame.player_black, dbGame.player_white, opponentName, `${username} 放弃对局`, dbGame.moves.length).catch(console.error);
        await Database.deleteActiveGame(dbGame.room_id);
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function publicPlayers(room) {
  return room.players.map(p => ({
    username: p.username,
    nickname: p.nickname,
    color: p.color,
    timeLeft: Math.max(0, Math.ceil(p.timeLeft))
  }));
}

async function resolveNickname(username) {
  const user = await Database.getUserByUsername(username);
  return user.nickname;
}

function updateTurnClock(room) {
  if (!room || room.status !== 'playing' || !room.turnStartedAt) return null;
  const currentPlayer = room.players.find(p => p.color === room.currentTurn);
  if (!currentPlayer) return null;

  const now = Date.now();
  const elapsed = (now - room.turnStartedAt) / 1000;
  currentPlayer.timeLeft = Math.max(0, currentPlayer.timeLeft - elapsed);
  room.turnStartedAt = now;
  return currentPlayer;
}

function emitTimerSync(roomId, room) {
  io.to(roomId).emit('timerSync', {
    currentTurn: room.currentTurn,
    players: publicPlayers(room)
  });
}

async function endByTimeout(roomId, room, timedOutPlayer) {
  if (!room || room.status !== 'playing' || !timedOutPlayer) return;
  room.status = 'ended';
  room.lastMoveTime = Date.now();

  const winner = room.players.find(p => p.username !== timedOutPlayer.username);
  room.winner = winner ? winner.username : null;

  if (winner) {
    Database.updateStats(winner.username, 'win', 20).catch(console.error);
    Database.updateStats(timedOutPlayer.username, 'loss', -15).catch(console.error);
    Database.saveGameRecord(roomId,
      room.players.find(p => p.color === 'black').username,
      room.players.find(p => p.color === 'white').username,
      winner.username,
      `${timedOutPlayer.username} 超时`,
      room.moves.length
    ).catch(console.error);
  }

  const winnerNickname = winner ? (winner.nickname || await resolveNickname(winner.username)) : null;
  io.to(roomId).emit('gameEnd', {
    winner: winner ? winner.username : null,
    winnerNickname: winnerNickname,
    color: winner ? winner.color : null,
    reason: `${timedOutPlayer.nickname || timedOutPlayer.username} 超时`,
    board: room.board
  });
}

function createRoom(roomId, player1, player2 = null) {
  const room = {
    id: roomId,
    players: [],
    board: Array(15).fill(null).map(() => Array(15).fill(0)),
    currentTurn: 'black',
    status: 'waiting',
    winner: null,
    moves: [],
    chat: [],
    lastMoveTime: Date.now(),
    drawRequest: null,
    gameStartedAt: null,
    turnStartedAt: null
  };

  if (player1) {
    room.players.push({
      username: player1.username,
      nickname: player1.nickname,
      socketId: player1.socketId,
      color: 'black',
      ready: false,
      timeLeft: TURN_TIME_SECONDS
    });
  }

  if (player2) {
    room.players.push({
      username: player2.username,
      nickname: player2.nickname,
      socketId: player2.socketId,
      color: 'white',
      ready: false,
      timeLeft: TURN_TIME_SECONDS
    });
    room.status = 'playing';
    room.gameStartedAt = Date.now();
    room.turnStartedAt = Date.now();
  }

  rooms.set(roomId, room);
  return room;
}

function checkWinner(board, row, col, color) {
  const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];

  for (const [dx, dy] of directions) {
    let count = 1;
    for (let i = 1; i < 5; i++) {
      const nr = row + dx * i, nc = col + dy * i;
      if (nr < 0 || nr >= 15 || nc < 0 || nc >= 15 || board[nr][nc] !== color) break;
      count++;
    }
    for (let i = 1; i < 5; i++) {
      const nr = row - dx * i, nc = col - dy * i;
      if (nr < 0 || nr >= 15 || nc < 0 || nc >= 15 || board[nr][nc] !== color) break;
      count++;
    }
    if (count >= 5) return true;
  }
  return false;
}

function checkDraw(board) {
  for (let i = 0; i < 15; i++)
    for (let j = 0; j < 15; j++)
      if (board[i][j] === 0) return false;
  return true;
}

async function notifyFriendsPresence(username, online) {
  try {
    const friends = await Database.getFriends(username);
    friends.forEach(friend => {
      const socketId = userSockets.get(friend.username);
      if (socketId) {
        io.to(socketId).emit('friendStatusChanged', { username, online });
      }
    });
  } catch (err) {
    console.error('通知好友在线状态失败:', err);
  }
}

io.on('connection', (socket) => {
  socket.on('authenticate', async (token) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const storedToken = await Database.getCurrentToken(decoded.username);
      if (storedToken === null) {
        // 首次访问（旧数据迁移），记录此 token
        await Database.updateCurrentToken(decoded.username, token);
      } else if (storedToken !== token) {
        socket.emit('authenticated', { success: false, error: 'token_invalidated' });
        return;
      }
      socket.username = decoded.username;
      userSockets.set(decoded.username, socket.id);
      socket.emit('authenticated', { success: true, username: decoded.username });
      notifyFriendsPresence(decoded.username, true);
    } catch (err) {
      socket.emit('authenticated', { success: false, error: '认证失败' });
    }
  });

  socket.on('quickMatch', async () => {
    if (!socket.username) return;
    const nickname = await resolveNickname(socket.username);
    const existingIndex = waitingPlayers.findIndex(p => p.username === socket.username);
    if (existingIndex !== -1) {
      waitingPlayers[existingIndex].socketId = socket.id;
      waitingPlayers[existingIndex].nickname = nickname;
    } else {
      waitingPlayers.push({ username: socket.username, nickname, socketId: socket.id });
    }
    socket.emit('matching', { message: '正在寻找对手...' });

    if (waitingPlayers.length >= 2) {
      const p1 = waitingPlayers.shift();
      const p2 = waitingPlayers.shift();
      const roomId = uuidv4();
      const room = createRoom(roomId, p1, p2);

      io.to(p1.socketId).emit('matchFound', { roomId, color: 'black', opponent: p2.nickname || p2.username });
      io.to(p2.socketId).emit('matchFound', { roomId, color: 'white', opponent: p1.nickname || p1.username });

      io.in(p1.socketId).socketsJoin(roomId);
      io.in(p2.socketId).socketsJoin(roomId);

      setTimeout(() => {
        io.to(roomId).emit('gameStart', {
          roomId,
          players: publicPlayers(room),
          currentTurn: 'black'
        });
        emitTimerSync(roomId, room);
      }, 500);
    }
  });

  socket.on('cancelMatch', () => {
    const index = waitingPlayers.findIndex(p => p.username === socket.username);
    if (index !== -1) {
      waitingPlayers.splice(index, 1);
      socket.emit('matchCancelled');
    }
  });

  socket.on('createRoom', async () => {
    if (!socket.username) return;
    const roomId = uuidv4().substring(0, 8);
    const nickname = await resolveNickname(socket.username);
    const room = createRoom(roomId, { username: socket.username, nickname, socketId: socket.id });
    socket.join(roomId);
    // socket.currentRoom = roomId; // 移除此处赋值，防止在重定向到游戏页时断开连接导致房间被删
    socket.emit('roomCreated', { roomId });
  });

  socket.on('joinRoom', async (roomId) => {
    if (!socket.username) return;
    let room = rooms.get(roomId);

    if (!room) {
      // 内存中没有，尝试从 DB 恢复
      const dbGame = await Database.loadActiveGame(roomId);
      if (!dbGame) {
        socket.emit('error', { message: '房间不存在' });
        return;
      }
      // 从 DB 恢复 room 到内存
      const restoredRoom = {
        id: dbGame.room_id,
        players: [
          { username: dbGame.player_black, nickname: '', socketId: '', color: 'black', ready: false, timeLeft: dbGame.black_time_left, disconnectedAt: Date.now() },
          { username: dbGame.player_white, nickname: '', socketId: '', color: 'white', ready: false, timeLeft: dbGame.white_time_left, disconnectedAt: Date.now() }
        ],
        board: dbGame.board_state,
        currentTurn: dbGame.current_turn,
        status: 'disconnected',
        winner: null,
        moves: dbGame.moves,
        chat: [],
        lastMoveTime: dbGame.last_move_time,
        drawRequest: null,
        gameStartedAt: dbGame.game_started_at,
        turnStartedAt: dbGame.turn_started_at,
        disconnectTimer: null,
        countdownInterval: null
      };
      rooms.set(roomId, restoredRoom);
      room = restoredRoom;
    }

    if (room.players.length >= 2 && !room.players.find(p => p.username === socket.username)) {
      socket.emit('error', { message: '房间已满，无法加入' });
      return;
    }

    const existingPlayer = room.players.find(p => p.username === socket.username);
    if (existingPlayer) {
      if (!existingPlayer.nickname) {
        existingPlayer.nickname = await resolveNickname(socket.username);
      }
      existingPlayer.socketId = socket.id;
      socket.join(roomId);
      socket.currentRoom = roomId;

      // 如果房间处于 disconnected 状态且该玩家之前断线了 → 重连成功
      if (room.status === 'disconnected' && existingPlayer.disconnectedAt) {
        if (room.disconnectTimer) {
          clearTimeout(room.disconnectTimer);
          room.disconnectTimer = null;
        }
        if (room.countdownInterval) {
          clearInterval(room.countdownInterval);
          room.countdownInterval = null;
        }
        existingPlayer.disconnectedAt = null;
        room.status = 'playing';
        await Database.deleteActiveGame(roomId);

        const opponent = room.players.find(p => p.username !== socket.username);
        if (opponent) {
          io.to(opponent.socketId).emit('opponentReconnected');
        }
      }

      socket.emit('joinedRoom', {
        roomId,
        color: existingPlayer.color,
        board: room.board,
        players: publicPlayers(room),
        currentTurn: room.currentTurn,
        moves: room.moves
      });

      if (room.status === 'playing') {
        socket.emit('gameStart', {
          roomId,
          players: publicPlayers(room),
          currentTurn: room.currentTurn
        });
        emitTimerSync(roomId, room);
      }
      return;
    }

    if (room.players.length < 2) {
      const nickname = await resolveNickname(socket.username);
      room.players.push({
        username: socket.username,
        nickname,
        socketId: socket.id,
        color: 'white',
        ready: false,
        timeLeft: TURN_TIME_SECONDS
      });
      room.status = 'playing';
      room.gameStartedAt = Date.now();
      room.turnStartedAt = Date.now();
      socket.join(roomId);
      socket.currentRoom = roomId;
      socket.emit('joinedRoom', {
        roomId,
        color: 'white',
        board: room.board,
        players: publicPlayers(room),
        currentTurn: room.currentTurn,
        moves: room.moves
      });

      io.to(roomId).emit('playersUpdated', { players: publicPlayers(room) });
      io.to(roomId).emit('gameStart', {
        roomId,
        players: publicPlayers(room),
        currentTurn: 'black'
      });
      emitTimerSync(roomId, room);
    }
  });

  socket.on('makeMove', async ({ roomId, row, col }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;

    const player = room.players.find(p => p.username === socket.username);
    if (!player || player.color !== room.currentTurn) return;

    const timedPlayer = updateTurnClock(room);
    if (timedPlayer && timedPlayer.timeLeft <= 0) {
      await endByTimeout(roomId, room, timedPlayer);
      return;
    }

    if (room.board[row][col] !== 0) return;

    room.board[row][col] = room.currentTurn === 'black' ? 1 : 2;
    room.moves.push({ row, col, color: room.currentTurn, player: socket.username });
    room.lastMoveTime = Date.now();
    room.drawRequest = null;

    io.to(roomId).emit('moveMade', {
      row, col,
      color: room.currentTurn,
      player: socket.username,
      moveNumber: room.moves.length
    });

    const colorValue = room.currentTurn === 'black' ? 1 : 2;
    if (checkWinner(room.board, row, col, colorValue)) {
      room.status = 'ended';
      room.winner = socket.username;
      const winnerColor = room.currentTurn;
      const loser = room.players.find(p => p.username !== socket.username);

      Database.updateStats(socket.username, 'win', 20).catch(console.error);
      if (loser) Database.updateStats(loser.username, 'loss', -15).catch(console.error);
      Database.saveGameRecord(roomId,
        room.players.find(p => p.color === 'black').username,
        room.players.find(p => p.color === 'white').username,
        socket.username,
        `${socket.username} (${winnerColor}) 获胜`,
        room.moves.length
      ).catch(console.error);

      const winnerNickname = await resolveNickname(socket.username);
      io.to(roomId).emit('gameEnd', {
        winner: socket.username,
        winnerNickname: winnerNickname,
        color: winnerColor,
        reason: '五子连珠',
        board: room.board
      });
      return;
    }

    if (checkDraw(room.board)) {
      room.status = 'ended';
      room.winner = 'draw';
      room.players.forEach(p => Database.updateStats(p.username, 'draw', 0).catch(console.error));
      Database.saveGameRecord(roomId,
        room.players.find(p => p.color === 'black').username,
        room.players.find(p => p.color === 'white').username,
        null, '平局', room.moves.length
      ).catch(console.error);

      io.to(roomId).emit('gameEnd', {
        winner: null,
        reason: '棋盘已满，平局',
        board: room.board
      });
      return;
    }

    const nextTurn = room.currentTurn === 'black' ? 'white' : 'black';
    room.currentTurn = nextTurn;
    room.players.forEach(p => {
      p.timeLeft = TURN_TIME_SECONDS;
    });
    room.turnStartedAt = Date.now();
    io.to(roomId).emit('turnChanged', { currentTurn: room.currentTurn });
    emitTimerSync(roomId, room);
  });

  socket.on('requestDraw', async ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;
    const player = room.players.find(p => p.username === socket.username);
    if (!player) return;

    room.drawRequest = socket.username;
    const opponent = room.players.find(p => p.username !== socket.username);
    if (opponent) {
      const requesterNickname = await resolveNickname(socket.username);
      io.to(opponent.socketId).emit('drawRequested', { 
        requester: socket.username,
        requesterNickname: requesterNickname 
      });
    }
  });

  socket.on('respondDraw', ({ roomId, accept }) => {
    const room = rooms.get(roomId);
    if (!room || !room.drawRequest) return;
    const player = room.players.find(p => p.username === socket.username);
    if (!player || player.username === room.drawRequest) return;

    if (accept) {
      room.status = 'ended';
      room.winner = 'draw';
      room.players.forEach(p => Database.updateStats(p.username, 'draw', 0).catch(console.error));
      Database.saveGameRecord(roomId,
        room.players.find(p => p.color === 'black').username,
        room.players.find(p => p.color === 'white').username,
        null, '双方和棋', room.moves.length
      ).catch(console.error);

      io.to(roomId).emit('gameEnd', {
        winner: null,
        reason: '双方同意和棋',
        board: room.board
      });
    } else {
      const requester = room.players.find(p => p.username === room.drawRequest);
      room.drawRequest = null;
      if (requester) io.to(requester.socketId).emit('drawRejected');
    }
  });

  socket.on('resign', async ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;

    const player = room.players.find(p => p.username === socket.username);
    if (!player) return;

    room.status = 'ended';
    const winner = room.players.find(p => p.username !== socket.username);
    room.winner = winner ? winner.username : null;

    if (winner) {
      Database.updateStats(winner.username, 'win', 20).catch(console.error);
      Database.updateStats(socket.username, 'loss', -10).catch(console.error);
      Database.saveGameRecord(roomId,
        room.players.find(p => p.color === 'black').username,
        room.players.find(p => p.color === 'white').username,
        winner.username,
        `${socket.username} 认输`,
        room.moves.length
      ).catch(console.error);

      const winnerNickname = winner.nickname || await resolveNickname(winner.username);
      const quitterNickname = await resolveNickname(socket.username);
      io.to(roomId).emit('gameEnd', {
        winner: winner.username,
        winnerNickname: winnerNickname,
        color: winner.color,
        reason: `${quitterNickname} 认输`,
        board: room.board
      });
    }
  });

  socket.on('chatMessage', ({ roomId, message }) => {
    if (!socket.username || !message.trim()) return;
    const room = rooms.get(roomId);
    if (!room || !room.players.some(p => p.username === socket.username)) return;

    const sender = room.players.find(p => p.username === socket.username);

    const chatData = {
      username: socket.username,
      nickname: sender.nickname,
      message: message.trim(),
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    };

    if (room) {
      room.chat.push(chatData);
      Database.saveChatMessage(roomId, socket.username, message.trim()).catch(console.error);
    }

    room.players.forEach(player => {
      io.to(player.socketId).emit('chatMessage', chatData);
    });
  });

  socket.on('privateMessage', async ({ to, message }) => {
    try {
      const recipient = String(to || '').trim();
      const content = String(message || '').trim();
      if (!socket.username || !recipient || !content) return;
      if (content.length > 1000) {
        socket.emit('privateMessageError', { error: '消息不能超过1000个字符' });
        return;
      }

      const saved = await Database.savePrivateMessage(socket.username, recipient, content);
      const senderNickname = await resolveNickname(socket.username);

      const payload = {
        id: saved.id,
        sender: saved.sender,
        senderNickname: senderNickname, // 新增昵称字段
        recipient: saved.recipient,
        message: saved.message,
        read_at: saved.read_at,
        created_at: saved.created_at
      };

      socket.emit('privateMessage', payload);

      const recipientSocketId = userSockets.get(recipient);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('privateMessage', payload);
      }
    } catch (err) {
      socket.emit('privateMessageError', { error: err.message });
    }
  });

  socket.on('markPrivateMessagesRead', async ({ friend }) => {
    try {
      const friendUsername = String(friend || '').trim();
      if (!socket.username || !friendUsername) return;
      await Database.markPrivateMessagesRead(socket.username, friendUsername);
    } catch (err) {
      socket.emit('privateMessageError', { error: err.message });
    }
  });

  socket.on('leaveRoom', async ({ roomId }) => {
    await handleLeaveRoom(socket, roomId);
  });

  socket.on('disconnect', async () => {
    if (socket.username) {
      if (userSockets.get(socket.username) === socket.id) {
        userSockets.delete(socket.username);
        notifyFriendsPresence(socket.username, false);
      }
      const waitIndex = waitingPlayers.findIndex(p => p.username === socket.username);
      if (waitIndex !== -1) waitingPlayers.splice(waitIndex, 1);
      if (socket.currentRoom) await handlePlayerDisconnect(socket.currentRoom, socket.username);
    }
  });
});

// 处理玩家断线（网络断开/关闭页面）—— 启动 20 秒重连倒计时
async function handlePlayerDisconnect(roomId, username) {
  const room = rooms.get(roomId);
  if (!room) return;

  const player = room.players.find(p => p.username === username);
  if (!player) return;

  // 非 playing 状态 → 旧逻辑清理
  if (room.status !== 'playing') {
    // 如果房间已经是 disconnected 状态，检查另一个玩家是否也断线了 → 双断，平局清理
    if (room.status === 'disconnected') {
      const otherDisc = room.players.find(p => p.username !== username && p.disconnectedAt);
      if (otherDisc) {
        room.status = 'ended';
        const black = room.players.find(p => p.color === 'black');
        const white = room.players.find(p => p.color === 'white');
        room.players.forEach(p => Database.updateStats(p.username, 'draw', 0).catch(console.error));
        Database.saveGameRecord(roomId,
          black ? black.username : '',
          white ? white.username : '',
          null, '双方断线', room.moves.length
        ).catch(console.error);
        await Database.deleteActiveGame(roomId);
        io.to(roomId).emit('gameEnd', {
          winner: null,
          reason: '双方均断线，平局',
          board: room.board
        });
        if (room.disconnectTimer) clearTimeout(room.disconnectTimer);
        if (room.countdownInterval) clearInterval(room.countdownInterval);
        rooms.delete(roomId);
        return;
      }
    }
    // 单纯的非 playing 状态（如 waiting），只移除玩家
    const playerIndex = room.players.findIndex(p => p.username === username);
    if (playerIndex !== -1) room.players.splice(playerIndex, 1);
    if (room.players.length === 0) rooms.delete(roomId);
    return;
  }

  // 检查另一个玩家是否也已经 disconnected
  const otherPlayer = room.players.find(p => p.username !== username);
  if (otherPlayer && otherPlayer.disconnectedAt) {
    // 双方都断线了 → 平局
    room.status = 'ended';
    const black = room.players.find(p => p.color === 'black');
    const white = room.players.find(p => p.color === 'white');
    room.players.forEach(p => Database.updateStats(p.username, 'draw', 0).catch(console.error));
    Database.saveGameRecord(roomId,
      black ? black.username : '',
      white ? white.username : '',
      null, '双方断线', room.moves.length
    ).catch(console.error);
    await Database.deleteActiveGame(roomId);
    io.to(roomId).emit('gameEnd', {
      winner: null,
      reason: '双方均断线，平局',
      board: room.board
    });
    rooms.delete(roomId);
    return;
  }

  // 标记当前玩家断线
  player.disconnectedAt = Date.now();
  room.status = 'disconnected';

  // 对手还在线
  const opponent = room.players.find(p => p.username !== username && !p.disconnectedAt);
  if (!opponent) return; // 没有对手在线，无需继续

  const playerNickname = player.nickname || await resolveNickname(username);
  io.to(opponent.socketId).emit('opponentDisconnected', {
    opponentNickname: playerNickname,
    timeoutSec: 20
  });

  // 写入 active_games 快照
  const black = room.players.find(p => p.color === 'black');
  const white = room.players.find(p => p.color === 'white');
  await Database.saveActiveGame(roomId, {
    player_black: black ? black.username : '',
    player_white: white ? white.username : '',
    board_state: room.board,
    moves: room.moves,
    current_turn: room.currentTurn,
    black_time_left: Math.ceil(room.players.find(p => p.color === 'black')?.timeLeft || TURN_TIME_SECONDS),
    white_time_left: Math.ceil(room.players.find(p => p.color === 'white')?.timeLeft || TURN_TIME_SECONDS),
    game_started_at: room.gameStartedAt || Date.now(),
    turn_started_at: room.turnStartedAt || Date.now(),
    last_move_time: room.lastMoveTime
  });

  // 20 秒倒计时
  room.disconnectTimer = setTimeout(async () => {
    const currentRoom = rooms.get(roomId);
    if (!currentRoom || currentRoom.status !== 'disconnected') return;

    // 倒计时结束时检查对手是否还在线
    const currentOpponent = currentRoom.players.find(p => p.username !== username && !p.disconnectedAt);
    if (!currentOpponent) {
      // 对手也断线了 → 平局
      currentRoom.status = 'ended';
      currentRoom.players.forEach(p => Database.updateStats(p.username, 'draw', 0).catch(console.error));
      Database.saveGameRecord(roomId,
        black ? black.username : '',
        white ? white.username : '',
        null, '双方断线超时', currentRoom.moves.length
      ).catch(console.error);
      await Database.deleteActiveGame(roomId);
      io.to(roomId).emit('gameEnd', {
        winner: null,
        reason: '双方均断线，平局',
        board: currentRoom.board
      });
    } else {
      // 超时未重连 → 对手获胜
      currentRoom.status = 'ended';
      currentRoom.winner = currentOpponent.username;
      Database.updateStats(currentOpponent.username, 'win', 20).catch(console.error);
      Database.updateStats(username, 'loss', -15).catch(console.error);
      Database.saveGameRecord(roomId,
        black ? black.username : '',
        white ? white.username : '',
        currentOpponent.username, `${username} 断线超时`, currentRoom.moves.length
      ).catch(console.error);
      await Database.deleteActiveGame(roomId);
      const opponentNickname = currentOpponent.nickname || await resolveNickname(currentOpponent.username);
      io.to(roomId).emit('gameEnd', {
        winner: currentOpponent.username,
        winnerNickname: opponentNickname,
        color: currentOpponent.color,
        reason: '对方断线超时',
        board: currentRoom.board
      });
    }
    rooms.delete(roomId);
  }, 20000);

  // 每秒发送倒计时 tick
  room.countdownInterval = setInterval(() => {
    const r = rooms.get(roomId);
    if (!r || r.status !== 'disconnected') {
      if (room.countdownInterval) clearInterval(room.countdownInterval);
      return;
    }
    const remaining = Math.max(0, Math.ceil(20 - (Date.now() - player.disconnectedAt) / 1000));
    io.to(opponent.socketId).emit('opponentDisconnectCountdown', { remainingSec: remaining });
    if (remaining <= 0 && room.countdownInterval) {
      clearInterval(room.countdownInterval);
      room.countdownInterval = null;
    }
  }, 1000);
}

async function handleLeaveRoom(socket, roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  socket.leave(roomId);

  const playerIndex = room.players.findIndex(p => p.username === socket.username);
  if (playerIndex !== -1) {
    if (room.status === 'playing') {
      room.status = 'ended';
      const winner = room.players.find(p => p.username !== socket.username);
      if (winner) {
        Database.updateStats(winner.username, 'win', 20).catch(console.error);
        Database.updateStats(socket.username, 'loss', -15).catch(console.error);
        const winnerNickname = winner.nickname || await resolveNickname(winner.username);
        const quitterNickname = await resolveNickname(socket.username);
        io.to(roomId).emit('gameEnd', {
          winner: winner.username,
          winnerNickname: winnerNickname,
          color: winner.color,
          reason: `${quitterNickname} 离开游戏`,
          board: room.board
        });
      }
    }
    room.players.splice(playerIndex, 1);
  }

  if (room.players.length === 0) {
    rooms.delete(roomId);
  }

  socket.currentRoom = null;
  socket.emit('leftRoom');
}

setInterval(() => {
  for (const [roomId, room] of rooms.entries()) {
    if (room.status !== 'playing') continue;
    const currentPlayer = room.players.find(p => p.color === room.currentTurn);
    if (!currentPlayer || !room.turnStartedAt) continue;
    const remaining = currentPlayer.timeLeft - ((Date.now() - room.turnStartedAt) / 1000);
    if (remaining <= 0) {
      updateTurnClock(room);
      endByTimeout(roomId, room, currentPlayer);
    } else {
      io.to(roomId).emit('timerTick', {
        currentTurn: room.currentTurn,
        username: currentPlayer.username,
        color: currentPlayer.color,
        timeLeft: Math.ceil(remaining)
      });
    }
  }
}, 1000);

setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    if (room.status === 'ended' && now - room.lastMoveTime > 30 * 60 * 1000) {
      rooms.delete(roomId);
    }
  }
}, 5 * 60 * 1000);

// 初始化数据库后启动
Database.init().then(async () => {
  console.log('数据库连接成功');
  await Database.clearActiveGames();
  server.listen(PORT, () => {
    console.log(`五子棋服务器运行在端口 ${PORT}`);
    console.log(`访问 http://localhost:${PORT} 开始游戏`);
  });
}).catch(err => {
  console.error('数据库初始化失败:', err);
  process.exit(1);
});
