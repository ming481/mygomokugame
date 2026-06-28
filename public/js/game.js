// 棋盘渲染器
class GameRenderer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;

    this.ctx = this.canvas.getContext('2d');
    this.size = 15;
    this.cellSize = 36;
    this.padding = 24;
    this.board = Array(15).fill(null).map(() => Array(15).fill(0));
    this.lastMove = null;
    this.hoverPos = null;
    this.stoneAnimation = [];

    this.audioCtx = null;
    this.initAudio();

    this.resize();
    this.bindEvents();
    this.render();
    this.animate();
  }

  initAudio() {
    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.log('音频不支持');
    }
  }

  playStoneSound() {
    if (!this.audioCtx) return;
    const oscillator = this.audioCtx.createOscillator();
    const gainNode = this.audioCtx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(this.audioCtx.destination);
    oscillator.frequency.setValueAtTime(800, this.audioCtx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(400, this.audioCtx.currentTime + 0.1);
    gainNode.gain.setValueAtTime(0.15, this.audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.1);
    oscillator.start(this.audioCtx.currentTime);
    oscillator.stop(this.audioCtx.currentTime + 0.1);
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const container = this.canvas.parentElement;
    let containerWidth = container.clientWidth;
    // 移动端安全兜底：容器溢出时直接用屏幕宽度
    if (containerWidth > window.innerWidth) {
      containerWidth = window.innerWidth;
    }
    const padding = containerWidth < 400 ? 16 : 24;
    this.padding = padding;
    const maxSize = Math.min(containerWidth - 8, 600);
    // 高清渲染：画布缓冲区按设备像素比缩放，CSS尺寸保持逻辑像素
    this.canvas.width = maxSize * dpr;
    this.canvas.height = maxSize * dpr;
    this.canvas.style.width = maxSize + 'px';
    this.canvas.style.height = maxSize + 'px';
    this.cellSize = (maxSize - padding * 2) / (this.size - 1);
    this.labelOffset = Math.max(8, this.cellSize * 0.38);
    this.render();
  }

  bindEvents() {
    // 鼠标移动（桌面端预览）
    this.canvas.addEventListener('mousemove', (e) => {
      if (!window.isMyTurn) return;
      const pos = this.getBoardPosition(e);
      if (pos && this.board[pos.row][pos.col] === 0) {
        this.hoverPos = pos;
        this.render();
      } else {
        if (this.hoverPos) {
          this.hoverPos = null;
          this.render();
        }
      }
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.hoverPos = null;
      this.render();
    });

    // 落子处理函数
    const placeHandler = (e) => {
      if (!window.isMyTurn) return;
      if (!window.socket || !window.currentRoom) return;

      const pos = this.getBoardPosition(e);
      if (!pos) return;
      if (this.board[pos.row][pos.col] !== 0) return;

      window.socket.emit('makeMove', {
        roomId: window.currentRoom,
        row: pos.row,
        col: pos.col
      });
    };

    this.canvas.addEventListener('click', placeHandler);

    // 响应式
    window.addEventListener('resize', () => this.resize());
  }

  getBoardPosition(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const col = Math.round((x - this.padding) / this.cellSize);
    const row = Math.round((y - this.padding) / this.cellSize);

    if (col >= 0 && col < this.size && row >= 0 && row < this.size) {
      return { row, col };
    }
    return null;
  }

  render() {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    // 逻辑像素（CSS像素）尺寸
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // 木纹背景
    const gradient = ctx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, '#DEB887');
    gradient.addColorStop(1, '#C4A06B');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    // 木纹纹理
    ctx.strokeStyle = 'rgba(139, 90, 43, 0.12)';
    ctx.lineWidth = 1;
    for (let i = 0; i < h; i += 20) {
      ctx.beginPath();
      ctx.moveTo(0, i + Math.sin(i * 0.1) * 5);
      ctx.lineTo(w, i + Math.sin(i * 0.1 + 3) * 5);
      ctx.stroke();
    }

    // 网格线
    ctx.strokeStyle = '#5D4037';
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';

    for (let i = 0; i < this.size; i++) {
      const pos = this.padding + i * this.cellSize;
      ctx.beginPath();
      ctx.moveTo(this.padding, pos);
      ctx.lineTo(w - this.padding, pos);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pos, this.padding);
      ctx.lineTo(pos, h - this.padding);
      ctx.stroke();
    }

    // 星位
    const stars = [
      [3, 3], [3, 7], [3, 11],
      [7, 3], [7, 7], [7, 11],
      [11, 3], [11, 7], [11, 11]
    ];

    ctx.fillStyle = '#5D4037';
    stars.forEach(([r, c]) => {
      const x = this.padding + c * this.cellSize;
      const y = this.padding + r * this.cellSize;
      ctx.beginPath();
      ctx.arc(x, y, this.cellSize * 0.12, 0, Math.PI * 2);
      ctx.fill();
    });

    // 坐标标注
    ctx.fillStyle = '#5D4037';
    ctx.font = `bold ${Math.max(10, this.cellSize * 0.35)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const cols = 'ABCDEFGHIJKLMNO';
    const labelOff = this.labelOffset;
    for (let i = 0; i < this.size; i++) {
      const pos = this.padding + i * this.cellSize;
      ctx.fillText(cols[i], pos, this.padding - labelOff);
      ctx.fillText(cols[i], pos, h - this.padding + labelOff);
      ctx.fillText((15 - i).toString(), this.padding - labelOff, pos);
      ctx.fillText((15 - i).toString(), w - this.padding + labelOff, pos);
    }

    // 棋子
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if (this.board[r][c] !== 0) {
          const isLast = this.lastMove && this.lastMove.row === r && this.lastMove.col === c;
          this.drawStone(r, c, this.board[r][c], isLast);
          if (isLast) {
            this.drawLastMoveMarker(r, c);
          }
        }
      }
    }

    // 悬停预览
    if (this.hoverPos) {
      this.drawHover(this.hoverPos.row, this.hoverPos.col);
    }

    // 动画中的棋子
    this.stoneAnimation.forEach(anim => {
      if (anim.progress < 1) {
        this.drawAnimatedStone(anim);
      }
    });
    ctx.restore();
  }

  drawStone(row, col, type, isLast = false) {
    const ctx = this.ctx;
    const x = this.padding + col * this.cellSize;
    const y = this.padding + row * this.cellSize;
    const radius = this.cellSize * 0.45;

    ctx.save();

    // 阴影
    ctx.beginPath();
    ctx.arc(x + 2, y + 2, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fill();

    // 棋子本体
    const grad = ctx.createRadialGradient(
      x - radius * 0.3, y - radius * 0.3, 0,
      x, y, radius
    );

    if (type === 1) {
      grad.addColorStop(0, '#4a4a4a');
      grad.addColorStop(1, '#1a1a1a');
    } else {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(1, '#d0d0d0');
    }

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // 边框
    ctx.strokeStyle = type === 1 ? '#000' : '#aaa';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // 最后落子标记
    if (isLast) {
      ctx.strokeStyle = type === 1 ? '#ffffff' : '#000000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, radius * 0.4, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  drawLastMoveMarker(row, col) {
    const ctx = this.ctx;
    const x = this.padding + col * this.cellSize;
    const y = this.padding + row * this.cellSize;
    const radius = this.cellSize * 0.48;

    ctx.save();
    ctx.strokeStyle = '#c9a227';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    const len = this.cellSize * 0.15;
    const gap = radius + 1;

    // 左上
    ctx.beginPath();
    ctx.moveTo(x - gap, y - gap + len);
    ctx.lineTo(x - gap, y - gap);
    ctx.lineTo(x - gap + len, y - gap);
    ctx.stroke();

    // 右上
    ctx.beginPath();
    ctx.moveTo(x + gap - len, y - gap);
    ctx.lineTo(x + gap, y - gap);
    ctx.lineTo(x + gap, y - gap + len);
    ctx.stroke();

    // 左下
    ctx.beginPath();
    ctx.moveTo(x - gap, y + gap - len);
    ctx.lineTo(x - gap, y + gap);
    ctx.lineTo(x - gap + len, y + gap);
    ctx.stroke();

    // 右下
    ctx.beginPath();
    ctx.moveTo(x + gap - len, y + gap);
    ctx.lineTo(x + gap, y + gap);
    ctx.lineTo(x + gap, y + gap - len);
    ctx.stroke();

    ctx.restore();
  }

  drawAnimatedStone(anim) {
    const ctx = this.ctx;
    const x = this.padding + anim.col * this.cellSize;
    const y = this.padding + anim.row * this.cellSize;
    const maxRadius = this.cellSize * 0.45;
    const radius = maxRadius * anim.progress;

    ctx.save();
    ctx.globalAlpha = anim.progress;

    const grad = ctx.createRadialGradient(
      x - radius * 0.3, y - radius * 0.3, 0,
      x, y, radius
    );

    if (anim.type === 1) {
      grad.addColorStop(0, '#4a4a4a');
      grad.addColorStop(1, '#1a1a1a');
    } else {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(1, '#d0d0d0');
    }

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.restore();
  }

  drawHover(row, col) {
    const ctx = this.ctx;
    const x = this.padding + col * this.cellSize;
    const y = this.padding + row * this.cellSize;
    const radius = this.cellSize * 0.45;

    ctx.save();
    ctx.globalAlpha = 0.4;

    const isBlack = window.myColor === 'black';
    const grad = ctx.createRadialGradient(
      x - radius * 0.3, y - radius * 0.3, 0,
      x, y, radius
    );

    if (isBlack) {
      grad.addColorStop(0, '#4a4a4a');
      grad.addColorStop(1, '#1a1a1a');
    } else {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(1, '#d0d0d0');
    }

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.restore();
  }

  placeStone(row, col, color) {
    const type = color === 'black' ? 1 : 2;
    this.board[row][col] = type;
    this.lastMove = { row, col };

    this.stoneAnimation.push({
      row, col, type,
      progress: 0,
      speed: 0.15
    });

    this.playStoneSound();
    this.hoverPos = null;
  }

  showLastMove(row, col) {
    this.lastMove = { row, col };
    this.render();
  }

  clearBoard() {
    this.board = Array(15).fill(null).map(() => Array(15).fill(0));
    this.lastMove = null;
    this.hoverPos = null;
    this.stoneAnimation = [];
    const marker = document.getElementById('lastMoveMarker');
    if (marker) marker.style.display = 'none';
    this.render();
  }

  restoreBoard(board, moves) {
    this.clearBoard();
    if (!board) return;

    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        this.board[r][c] = board[r][c];
      }
    }

    if (moves && moves.length > 0) {
      const last = moves[moves.length - 1];
      this.lastMove = { row: last.row, col: last.col };
      this.showLastMove(last.row, last.col);
    }

    this.render();
  }

  animate() {
    let needsRender = false;

    this.stoneAnimation = this.stoneAnimation.filter(anim => {
      if (anim.progress < 1) {
        anim.progress += anim.speed;
        if (anim.progress > 1) anim.progress = 1;
        needsRender = true;
        return true;
      }
      return false;
    });

    if (needsRender) {
      this.render();
    }

    requestAnimationFrame(() => this.animate());
  }

  setInteractive(enabled) {
    this.canvas.style.pointerEvents = enabled ? 'auto' : 'none';
    this.canvas.style.cursor = enabled ? '' : 'not-allowed';
  }
}

const gameRenderer = new GameRenderer('gameBoard');
window.gameRenderer = gameRenderer;
