const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

// 从环境变量读取配置，支持 .env 文件
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'gomoku',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
};

let pool = null;

const Database = {
  async init() {
    pool = mysql.createPool(dbConfig);
    // 测试连接
    const conn = await pool.getConnection();
    console.log('MySQL 连接成功:', dbConfig.host, ':', dbConfig.port);
    conn.release();
    await this._initTables();
  },

  async _initTables() {
    const conn = await pool.getConnection();
    try {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          username VARCHAR(50) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          nickname VARCHAR(50),
          avatar VARCHAR(50) DEFAULT 'default',
          wins INT DEFAULT 0,
          losses INT DEFAULT 0,
          draws INT DEFAULT 0,
          total_games INT DEFAULT 0,
          rating INT DEFAULT 1000,
          current_token VARCHAR(500) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_users_rating (rating)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS game_records (
          id INT AUTO_INCREMENT PRIMARY KEY,
          room_id VARCHAR(50) NOT NULL,
          player_black VARCHAR(50) NOT NULL,
          player_white VARCHAR(50) NOT NULL,
          winner VARCHAR(50),
          result VARCHAR(100),
          moves_count INT DEFAULT 0,
          board_size INT DEFAULT 15,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          ended_at TIMESTAMP NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS chat_messages (
          id INT AUTO_INCREMENT PRIMARY KEY,
          room_id VARCHAR(50),
          username VARCHAR(50) NOT NULL,
          message TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS friends (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_a VARCHAR(50) NOT NULL,
          user_b VARCHAR(50) NOT NULL,
          requested_by VARCHAR(50) NOT NULL,
          status ENUM('pending', 'accepted', 'rejected') DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_friend_pair (user_a, user_b),
          INDEX idx_friends_user_a (user_a),
          INDEX idx_friends_user_b (user_b)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS private_messages (
          id INT AUTO_INCREMENT PRIMARY KEY,
          sender VARCHAR(50) NOT NULL,
          recipient VARCHAR(50) NOT NULL,
          message TEXT NOT NULL,
          read_at TIMESTAMP NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_private_messages_pair_time (sender, recipient, created_at),
          INDEX idx_private_messages_recipient_read (recipient, read_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await conn.query(`
        ALTER TABLE friends
        MODIFY status ENUM('pending', 'accepted', 'rejected') DEFAULT 'pending'
      `);

      await conn.query(`
        ALTER TABLE users
        ADD COLUMN current_token VARCHAR(500) NULL
      `).catch(() => {});
    } finally {
      conn.release();
    }
  },

  async updateCurrentToken(username, token) {
    await pool.execute(
      'UPDATE users SET current_token = ? WHERE username = ?',
      [token, username]
    );
  },

  async clearCurrentToken(username) {
    await pool.execute(
      'UPDATE users SET current_token = \'\' WHERE username = ?',
      [username]
    );
  },

  async getCurrentToken(username) {
    const [rows] = await pool.execute(
      'SELECT current_token FROM users WHERE username = ?',
      [username]
    );
    if (!rows[0]) return null;
    return rows[0].current_token; // null (未设置) or '' (已登出) or token 字符串
  },

  async registerUser(username, password, nickname) {
    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await pool.execute(
      'INSERT INTO users (username, password, nickname) VALUES (?, ?, ?)',
      [username, hashedPassword, nickname || username]
    );
    return { id: result.insertId, username };
  },

  async validateUser(username, password) {
    const [rows] = await pool.execute('SELECT * FROM users WHERE username = ?', [username]);
    if (rows.length === 0) throw new Error('用户不存在');
    const row = rows[0];
    const isMatch = await bcrypt.compare(password, row.password);
    if (!isMatch) throw new Error('密码错误');
    return {
      id: row.id,
      username: row.username,
      nickname: row.nickname,
      avatar: row.avatar,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
      rating: row.rating
    };
  },

  async getUserByUsername(username) {
    const [rows] = await pool.execute(
      'SELECT id, username, nickname, avatar, wins, losses, draws, total_games, rating, created_at FROM users WHERE username = ?',
      [username]
    );
    return rows[0] || null;
  },

  async updateStats(username, result, ratingChange = 0) {
    if (result === 'win') {
      await pool.execute(
        'UPDATE users SET wins = wins + 1, total_games = total_games + 1, rating = rating + ? WHERE username = ?',
        [ratingChange, username]
      );
    } else if (result === 'loss') {
      await pool.execute(
        'UPDATE users SET losses = losses + 1, total_games = total_games + 1, rating = rating + ? WHERE username = ?',
        [ratingChange, username]
      );
    } else {
      await pool.execute(
        'UPDATE users SET draws = draws + 1, total_games = total_games + 1, rating = rating + ? WHERE username = ?',
        [ratingChange, username]
      );
    }
  },

  async saveGameRecord(roomId, black, white, winner, result, movesCount) {
    const [result_db] = await pool.execute(
      'INSERT INTO game_records (room_id, player_black, player_white, winner, result, moves_count, ended_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [roomId, black, white, winner, result, movesCount]
    );
    return { id: result_db.insertId };
  },

  async getLeaderboard(limit = 10) {
    const lmt = Number(limit);
    const [rows] = await pool.query(
      `SELECT username, nickname, wins, losses, draws, rating, total_games
       FROM users
       ORDER BY rating DESC, wins DESC, total_games ASC, created_at ASC, id ASC
       LIMIT ${lmt}`
    );
    return rows;
  },

  async getUserHistory(username, limit = 10) {
    const [rows] = await pool.execute(
      'SELECT * FROM game_records WHERE player_black = ? OR player_white = ? ORDER BY created_at DESC LIMIT ?',
      [username, username, limit]
    );
    return rows;
  },

  async saveChatMessage(roomId, username, message) {
    const [result] = await pool.execute(
      'INSERT INTO chat_messages (room_id, username, message) VALUES (?, ?, ?)',
      [roomId, username, message]
    );
    return { id: result.insertId };
  },

  normalizeFriendPair(username, friendUsername) {
    return [username, friendUsername].sort((a, b) => a.localeCompare(b));
  },

  async searchUserByUsername(username, currentUsername) {
    const [rows] = await pool.execute(
      `SELECT id, username, nickname, avatar, rating
       FROM users
       WHERE username = ? AND username <> ?
       LIMIT 1`,
      [username, currentUsername]
    );
    return rows[0] || null;
  },

  async getFriendship(username, friendUsername) {
    const [userA, userB] = this.normalizeFriendPair(username, friendUsername);
    const [rows] = await pool.execute(
      'SELECT id, requested_by, status, created_at FROM friends WHERE user_a = ? AND user_b = ? LIMIT 1',
      [userA, userB]
    );
    return rows[0] || null;
  },

  async sendFriendRequest(username, friendUsername) {
    if (username === friendUsername) throw new Error('不能添加自己为好友');

    const friend = await this.getUserByUsername(friendUsername);
    if (!friend) throw new Error('用户不存在');

    const [userA, userB] = this.normalizeFriendPair(username, friendUsername);
    const existing = await this.getFriendship(username, friendUsername);
    if (existing?.status === 'accepted') throw new Error('已经是好友');
    if (existing?.status === 'pending' && existing.requested_by === username) throw new Error('好友申请已发送');
    if (existing?.status === 'pending') throw new Error('对方已向你发送申请，请在申请列表中处理');

    await pool.execute(
      `INSERT INTO friends (user_a, user_b, requested_by, status)
       VALUES (?, ?, ?, 'pending')
       ON DUPLICATE KEY UPDATE requested_by = VALUES(requested_by), status = 'pending', created_at = CURRENT_TIMESTAMP`,
      [userA, userB, username]
    );

    return friend;
  },

  async getFriendRequests(username) {
    const [rows] = await pool.execute(
      `SELECT
         f.id,
         f.requested_by,
         f.status,
         f.created_at,
         u.id AS user_id,
         u.username,
         u.nickname,
         u.avatar,
         u.rating
       FROM friends f
       JOIN users u ON u.username = IF(f.requested_by = ?, IF(f.user_a = ?, f.user_b, f.user_a), f.requested_by)
       WHERE (f.user_a = ? OR f.user_b = ?) AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [username, username, username, username]
    );

    return {
      incoming: rows.filter(row => row.requested_by !== username),
      outgoing: rows.filter(row => row.requested_by === username)
    };
  },

  async respondFriendRequest(username, requesterUsername, accept) {
    const requester = await this.getUserByUsername(requesterUsername);
    if (!requester) throw new Error('用户不存在');

    const [userA, userB] = this.normalizeFriendPair(username, requesterUsername);
    const [result] = await pool.execute(
      `UPDATE friends
       SET status = ?
       WHERE user_a = ? AND user_b = ? AND requested_by = ? AND status = 'pending'`,
      [accept ? 'accepted' : 'rejected', userA, userB, requesterUsername]
    );

    if (result.affectedRows === 0) throw new Error('好友申请不存在或已处理');
    return requester;
  },

  async areFriends(username, friendUsername) {
    const [userA, userB] = this.normalizeFriendPair(username, friendUsername);
    const [rows] = await pool.execute(
      'SELECT id FROM friends WHERE user_a = ? AND user_b = ? AND status = ? LIMIT 1',
      [userA, userB, 'accepted']
    );
    return rows.length > 0;
  },

  async getFriends(username) {
    const [rows] = await pool.execute(
      `SELECT
         u.id,
         u.username,
         u.nickname,
         u.avatar,
         u.rating,
         f.created_at AS friend_since,
         (
           SELECT COUNT(*)
           FROM private_messages pm
           WHERE pm.sender = u.username
             AND pm.recipient = ?
             AND pm.read_at IS NULL
         ) AS unread_count,
         (
           SELECT pm.message
           FROM private_messages pm
           WHERE (pm.sender = ? AND pm.recipient = u.username)
              OR (pm.sender = u.username AND pm.recipient = ?)
           ORDER BY pm.created_at DESC, pm.id DESC
           LIMIT 1
         ) AS last_message,
         (
           SELECT pm.created_at
           FROM private_messages pm
           WHERE (pm.sender = ? AND pm.recipient = u.username)
              OR (pm.sender = u.username AND pm.recipient = ?)
           ORDER BY pm.created_at DESC, pm.id DESC
           LIMIT 1
         ) AS last_message_at
       FROM friends f
       JOIN users u ON u.username = IF(f.user_a = ?, f.user_b, f.user_a)
       WHERE (f.user_a = ? OR f.user_b = ?) AND f.status = 'accepted'
       ORDER BY last_message_at DESC, f.created_at DESC`,
      [username, username, username, username, username, username, username, username]
    );
    return rows;
  },

  async getPrivateMessages(username, friendUsername, limit = 100) {
    const isFriend = await this.areFriends(username, friendUsername);
    if (!isFriend) throw new Error('只能查看好友消息');
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);

    const [rows] = await pool.execute(
      `SELECT id, sender, recipient, message, read_at, created_at
       FROM (
         SELECT id, sender, recipient, message, read_at, created_at
         FROM private_messages
         WHERE (sender = ? AND recipient = ?)
            OR (sender = ? AND recipient = ?)
         ORDER BY created_at DESC, id DESC
         LIMIT ${safeLimit}
       ) recent_messages
       ORDER BY created_at ASC, id ASC`,
      [username, friendUsername, friendUsername, username]
    );

    await this.markPrivateMessagesRead(username, friendUsername);
    return rows;
  },

  async savePrivateMessage(sender, recipient, message) {
    const isFriend = await this.areFriends(sender, recipient);
    if (!isFriend) throw new Error('只能给好友发送消息');

    const [result] = await pool.execute(
      'INSERT INTO private_messages (sender, recipient, message) VALUES (?, ?, ?)',
      [sender, recipient, message]
    );

    const [rows] = await pool.execute(
      'SELECT id, sender, recipient, message, read_at, created_at FROM private_messages WHERE id = ?',
      [result.insertId]
    );
    await this.prunePrivateMessages(sender, recipient);
    return rows[0];
  },

  async prunePrivateMessages(username, friendUsername) {
    while (true) {
      const [countRows] = await pool.execute(
        `SELECT COUNT(*) AS total
         FROM private_messages
         WHERE (sender = ? AND recipient = ?)
            OR (sender = ? AND recipient = ?)`,
        [username, friendUsername, friendUsername, username]
      );

      if (Number(countRows[0]?.total || 0) < 100) return;

      await pool.execute(
        `DELETE FROM private_messages
         WHERE id IN (
           SELECT id FROM (
             SELECT id
             FROM private_messages
             WHERE (sender = ? AND recipient = ?)
                OR (sender = ? AND recipient = ?)
             ORDER BY created_at ASC, id ASC
             LIMIT 50
           ) old_private_messages
         )`,
        [username, friendUsername, friendUsername, username]
      );
    }
  },

  async markPrivateMessagesRead(username, friendUsername) {
    await pool.execute(
      'UPDATE private_messages SET read_at = NOW() WHERE sender = ? AND recipient = ? AND read_at IS NULL',
      [friendUsername, username]
    );
  }
};

module.exports = Database;
