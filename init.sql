-- 云子五子棋数据库初始化脚本
-- 在 MySQL 中执行: SOURCE init.sql;  或复制到 MySQL Workbench 执行

CREATE DATABASE IF NOT EXISTS gomoku 
  DEFAULT CHARACTER SET utf8mb4 
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE gomoku;

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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  room_id VARCHAR(50),
  username VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS private_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sender VARCHAR(50) NOT NULL,
  recipient VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_private_messages_pair_time (sender, recipient, created_at),
  INDEX idx_private_messages_recipient_read (recipient, read_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 插入测试数据（可选）
-- INSERT INTO users (username, password, nickname) VALUES
--   ('test1', '$2a$10$...', '测试用户1'),
--   ('test2', '$2a$10$...', '测试用户2');

-- active_games: 对局状态快照，用于掉线重连
CREATE TABLE IF NOT EXISTS active_games (
  room_id VARCHAR(50) PRIMARY KEY,
  player_black VARCHAR(50) NOT NULL,
  player_white VARCHAR(50) NOT NULL,
  board_state JSON NOT NULL,
  moves JSON NOT NULL,
  current_turn VARCHAR(10) NOT NULL,
  black_time_left INT NOT NULL,
  white_time_left INT NOT NULL,
  game_started_at BIGINT NOT NULL,
  turn_started_at BIGINT NOT NULL,
  last_move_time BIGINT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_active_games_player_black (player_black),
  INDEX idx_active_games_player_white (player_white)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
