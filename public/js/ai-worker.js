// ============================================================
// AI Web Worker - 加载 WASM 并在独立线程执行五子棋算法
// ============================================================

let wasmInstance = null;
let wasmMemory = null;
const MIN_MEMORY_PAGES = 2; // 至少 128KB
let timerInterval = null;
let thinkSeconds = 0;

// 初始化 WASM
async function initWasm() {
  try {
    const response = await fetch('/gomoku.wasm');
    const buffer = await response.arrayBuffer();
    const fallbackMemory = new WebAssembly.Memory({ initial: MIN_MEMORY_PAGES, maximum: 4 });
    // AssemblyScript 编译的 WASM 需要 env.abort 函数（运行时错误回调）
    const result = await WebAssembly.instantiate(buffer, {
      env: {
        memory: fallbackMemory,
        abort: (msgPtr, filePtr, line, col) => {
          console.error(`WASM abort at line ${line}:${col}`);
        },
      },
    });
    wasmInstance = result.instance;
    wasmMemory = wasmInstance.exports.memory || fallbackMemory;
    if (!wasmInstance.exports.memory) {
      postMessage({ type: 'error', message: 'WASM 未导出内存，请重新编译并导出 memory' });
      return;
    }
    if (wasmMemory.buffer.byteLength === 0) {
      try {
        wasmMemory.grow(MIN_MEMORY_PAGES);
      } catch (growErr) {
        postMessage({ type: 'error', message: 'WASM 内存为 0 且无法扩展，请重新编译设置 initialMemory' });
        return;
      }
    }
    postMessage({ type: 'ready' });
  } catch (err) {
    postMessage({ type: 'error', message: 'WASM 加载失败: ' + err.message });
  }
}

// 将 JS 棋盘数组写入 WASM 内存
function writeBoardToWasm(board) {
  const mem = new Int32Array(wasmMemory.buffer);
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      mem[r * 15 + c] = board[r][c];
    }
  }
}

// 从 WASM 内存读取落子结果
function readResultFromWasm() {
  const mem = new Int32Array(wasmMemory.buffer);
  return {
    row: mem[225],
    col: mem[226],
  };
}

// 开始计时，每秒向主线程报告
function startTimer() {
  thinkSeconds = 0;
  timerInterval = setInterval(() => {
    thinkSeconds++;
    postMessage({ type: 'tick', seconds: thinkSeconds });
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// 执行 AI 计算
function computeMove(board, difficulty) {
  if (!wasmInstance) {
    postMessage({ type: 'error', message: 'WASM 未初始化' });
    return;
  }

  writeBoardToWasm(board);
  startTimer();

  try {
    if (difficulty === 'beginner') {
      wasmInstance.exports.aiBeginnerMove(Date.now() & 0x7FFFFFFF);
    } else if (difficulty === 'intermediate') {
      wasmInstance.exports.aiIntermediateMove();
    } else {
      // advanced - 专家级AI (迭代加深 + 动态时间上限)
      const moveCount = countStones(board);
      const settings = getAdvancedSettings(moveCount);
      const start = Date.now();
      let depth = settings.startDepth;
      let bestRow = -1;
      let bestCol = -1;

      while (depth <= settings.maxDepth) {
        const now = Date.now();
        if (now - start >= settings.timeLimitMs) break;

        if (wasmInstance.exports.aiAdvancedMoveDepth) {
          wasmInstance.exports.aiAdvancedMoveDepth(depth, settings.topN);
        } else {
          wasmInstance.exports.aiAdvancedMove();
        }
        const move = readResultFromWasm();
        if (move.row >= 0 && move.col >= 0) {
          bestRow = move.row;
          bestCol = move.col;
        }
        depth++;
      }

      if (bestRow !== -1 && bestCol !== -1) {
        stopTimer();
        postMessage({ type: 'move', row: bestRow, col: bestCol, seconds: thinkSeconds });
        return;
      }

      wasmInstance.exports.aiAdvancedMove();
    }

    const move = readResultFromWasm();
    stopTimer();
    postMessage({ type: 'move', row: move.row, col: move.col, seconds: thinkSeconds });
  } catch (err) {
    stopTimer();
    postMessage({ type: 'error', message: 'AI计算错误: ' + err.message });
  }
}

function countStones(board) {
  let cnt = 0;
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      if (board[r][c] !== 0) cnt++;
    }
  }
  return cnt;
}

function getAdvancedSettings(moveCount) {
  // 开局短思考，中局适度，残局可长思考到60秒
  if (moveCount < 12) {
    return { timeLimitMs: 2000, startDepth: 4, maxDepth: 5, topN: 12 };
  }
  if (moveCount < 28) {
    return { timeLimitMs: 8000, startDepth: 4, maxDepth: 6, topN: 14 };
  }
  if (moveCount < 50) {
    return { timeLimitMs: 20000, startDepth: 5, maxDepth: 7, topN: 16 };
  }
  return { timeLimitMs: 60000, startDepth: 5, maxDepth: 8, topN: 18 };
}

// 消息处理
self.onmessage = function (e) {
  const { type, board, difficulty } = e.data;
  if (type === 'init') {
    initWasm();
  } else if (type === 'compute') {
    computeMove(board, difficulty);
  }
};
