// ============================================================
// 五子棋 AI - AssemblyScript WASM
// 内存布局 (全部裸内存，不用 AS 运行时):
//   [0..224]*4      board[r*15+c]   i32
//   [225]*4         result_row      i32
//   [226]*4         result_col      i32
//   [227..451]*4    候选点 row      i32  (最多225个)
//   [452..676]*4    候选点 col      i32
//   [677..901]*4    候选点 score    i32
//   [902..1126]*4   visit标记       i32
// ============================================================

const SZ: i32 = 15;
const AI: i32 = 2;
const PL: i32 = 1;

@inline function B(r: i32, c: i32): i32 { return (r * SZ + c) << 2; }
@inline function get(r: i32, c: i32): i32 { return load<i32>(B(r, c)); }
@inline function set(r: i32, c: i32, v: i32): void { store<i32>(B(r, c), v); }

// 候选点存储基址
const CR: i32 = 227 * 4;   // row array
const CC: i32 = 452 * 4;   // col array
const CS: i32 = 677 * 4;   // score array
const CV: i32 = 902 * 4;   // visit array

@inline function cRow(i: i32): i32 { return load<i32>(CR + i * 4); }
@inline function cCol(i: i32): i32 { return load<i32>(CC + i * 4); }
@inline function cScr(i: i32): i32 { return load<i32>(CS + i * 4); }
@inline function setCand(i: i32, r: i32, c: i32, s: i32): void {
  store<i32>(CR + i * 4, r);
  store<i32>(CC + i * 4, c);
  store<i32>(CS + i * 4, s);
}

// ─── 胜负判断 (4方向内联) ───────────────────────────────────
function checkWin(row: i32, col: i32, val: i32): bool {
  let cnt: i32;
  // 横
  cnt = 1;
  for (let k = 1; k <= 4; k++) { const c = col + k; if (c >= SZ || get(row, c) !== val) break; cnt++; }
  for (let k = 1; k <= 4; k++) { const c = col - k; if (c < 0 || get(row, c) !== val) break; cnt++; }
  if (cnt >= 5) return true;
  // 竖
  cnt = 1;
  for (let k = 1; k <= 4; k++) { const r = row + k; if (r >= SZ || get(r, col) !== val) break; cnt++; }
  for (let k = 1; k <= 4; k++) { const r = row - k; if (r < 0 || get(r, col) !== val) break; cnt++; }
  if (cnt >= 5) return true;
  // 斜 /
  cnt = 1;
  for (let k = 1; k <= 4; k++) { const r = row + k; const c = col + k; if (r >= SZ || c >= SZ || get(r, c) !== val) break; cnt++; }
  for (let k = 1; k <= 4; k++) { const r = row - k; const c = col - k; if (r < 0 || c < 0 || get(r, c) !== val) break; cnt++; }
  if (cnt >= 5) return true;
  // 斜 \
  cnt = 1;
  for (let k = 1; k <= 4; k++) { const r = row + k; const c = col - k; if (r >= SZ || c < 0 || get(r, c) !== val) break; cnt++; }
  for (let k = 1; k <= 4; k++) { const r = row - k; const c = col + k; if (r < 0 || c >= SZ || get(r, c) !== val) break; cnt++; }
  if (cnt >= 5) return true;
  return false;
}

// ─── 单方向连线评分 ──────────────────────────────────────────
function evalDir(row: i32, col: i32, dr: i32, dc: i32, val: i32): i32 {
  let cnt: i32 = 1; let lo: i32 = 0; let ro: i32 = 0;
  for (let k = 1; k <= 4; k++) {
    const r = row + dr * k; const c = col + dc * k;
    if (r < 0 || r >= SZ || c < 0 || c >= SZ) break;
    const cell = get(r, c);
    if (cell === val) cnt++;
    else { if (cell === 0) ro = 1; break; }
  }
  for (let k = 1; k <= 4; k++) {
    const r = row - dr * k; const c = col - dc * k;
    if (r < 0 || r >= SZ || c < 0 || c >= SZ) break;
    const cell = get(r, c);
    if (cell === val) cnt++;
    else { if (cell === 0) lo = 1; break; }
  }
  const oe = lo + ro;
  if (cnt >= 5) return 1000000;
  if (cnt === 4) { if (oe === 2) return 100000; if (oe === 1) return 10000; return 0; }
  if (cnt === 3) { if (oe === 2) return 5000; if (oe === 1) return 800; return 0; }
  if (cnt === 2) { if (oe === 2) return 200; if (oe === 1) return 50; return 0; }
  if (cnt === 1 && oe === 2) return 10;
  return 0;
}

// ─── 位置评分 (4方向求和) ────────────────────────────────────
function evalPos(r: i32, c: i32, val: i32): i32 {
  return evalDir(r, c, 0, 1, val) + evalDir(r, c, 1, 0, val) + evalDir(r, c, 1, 1, val) + evalDir(r, c, 1, -1, val);
}

// ─── 全局棋盘评估 ────────────────────────────────────────────
function evalBoard(): i32 {
  let ai: i32 = 0; let pl: i32 = 0;
  for (let r = 0; r < SZ; r++) {
    for (let c = 0; c < SZ; c++) {
      const v = get(r, c);
      if (v === AI) ai += evalPos(r, c, AI);
      else if (v === PL) pl += evalPos(r, c, PL);
    }
  }
  return ai - pl;
}

// ─── 候选点生成 ──────────────────────────────────────────────
function sortCands(n: i32): void {
  for (let i = 1; i < n; i++) {
    const kr = cRow(i); const kc = cCol(i); const ks = cScr(i);
    let j = i - 1;
    while (j >= 0 && cScr(j) < ks) {
      setCand(j + 1, cRow(j), cCol(j), cScr(j));
      j--;
    }
    setCand(j + 1, kr, kc, ks);
  }
}

function getCands(topN: i32): i32 {
  // 清空 visit
  for (let i = 0; i < SZ * SZ; i++) store<i32>(CV + i * 4, 0);
  let cnt: i32 = 0; let hasStone: bool = false;
  for (let r = 0; r < SZ; r++) {
    for (let c = 0; c < SZ; c++) {
      if (get(r, c) === 0) continue;
      hasStone = true;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const nr = r + dr; const nc = c + dc;
          if (nr < 0 || nr >= SZ || nc < 0 || nc >= SZ) continue;
          if (get(nr, nc) !== 0) continue;
          const key = nr * SZ + nc;
          if (load<i32>(CV + key * 4) !== 0) continue;
          store<i32>(CV + key * 4, 1);
          set(nr, nc, AI); const as_ = evalPos(nr, nc, AI);
          set(nr, nc, PL); const ps = evalPos(nr, nc, PL);
          set(nr, nc, 0);
          setCand(cnt, nr, nc, as_ + ps);
          cnt++;
        }
      }
    }
  }
  if (!hasStone) { setCand(0, 7, 7, 9999); return 1; }
  if (cnt === 0) return 0;
  sortCands(cnt);
  return cnt < topN ? cnt : topN;
}

// ─── 必胜/必防检测 ───────────────────────────────────────────
function findWin(val: i32): i32 {
  for (let r = 0; r < SZ; r++) {
    for (let c = 0; c < SZ; c++) {
      if (get(r, c) !== 0) continue;
      set(r, c, val);
      const w = checkWin(r, c, val);
      set(r, c, 0);
      if (w) return (r << 8) | c;
    }
  }
  return -1;
}

function findFour(val: i32): i32 {
  for (let r = 0; r < SZ; r++) {
    for (let c = 0; c < SZ; c++) {
      if (get(r, c) !== 0) continue;
      set(r, c, val);
      // 检查4方向是否有冲四或活四
      if (evalDir(r, c, 0, 1, val) >= 10000 || evalDir(r, c, 1, 0, val) >= 10000 ||
          evalDir(r, c, 1, 1, val) >= 10000 || evalDir(r, c, 1, -1, val) >= 10000) {
        set(r, c, 0); return (r << 8) | c;
      }
      set(r, c, 0);
    }
  }
  return -1;
}

function countThreats(row: i32, col: i32, val: i32): i32 {
  set(row, col, val);
  let t: i32 = 0;
  const s0 = evalDir(row, col, 0, 1, val);
  const s1 = evalDir(row, col, 1, 0, val);
  const s2 = evalDir(row, col, 1, 1, val);
  const s3 = evalDir(row, col, 1, -1, val);
  if (s0 >= 1000000) t += 10; else if (s0 >= 10000) t += 5; else if (s0 >= 5000) t += 2;
  if (s1 >= 1000000) t += 10; else if (s1 >= 10000) t += 5; else if (s1 >= 5000) t += 2;
  if (s2 >= 1000000) t += 10; else if (s2 >= 10000) t += 5; else if (s2 >= 5000) t += 2;
  if (s3 >= 1000000) t += 10; else if (s3 >= 10000) t += 5; else if (s3 >= 5000) t += 2;
  set(row, col, 0);
  return t;
}

// ─── Alpha-Beta Minimax ──────────────────────────────────────
function minimax(depth: i32, alpha: i32, beta: i32, isMax: bool, maxDepth: i32): i32 {
  if (depth === maxDepth) return evalBoard();
  const cnt = getCands(10);
  if (cnt === 0) return evalBoard();
  if (isMax) {
    let best: i32 = -2000000000;
    for (let i = 0; i < cnt; i++) {
      const r = cRow(i); const c = cCol(i);
      set(r, c, AI);
      if (checkWin(r, c, AI)) { set(r, c, 0); return 900000 - depth; }
      const v = minimax(depth + 1, alpha, beta, false, maxDepth);
      set(r, c, 0);
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best: i32 = 2000000000;
    for (let i = 0; i < cnt; i++) {
      const r = cRow(i); const c = cCol(i);
      set(r, c, PL);
      if (checkWin(r, c, PL)) { set(r, c, 0); return -900000 + depth; }
      const v = minimax(depth + 1, alpha, beta, true, maxDepth);
      set(r, c, 0);
      if (v < best) best = v;
      if (best < beta) beta = best;
      if (beta <= alpha) break;
    }
    return best;
  }
}

// ─── 初级 AI: depth=3, 5%随机失误 ───────────────────────────
export function aiBeginnerMove(seed: i32): void {
  let m = findWin(AI); if (m !== -1) { store<i32>(225 * 4, m >> 8); store<i32>(226 * 4, m & 0xFF); return; }
  m = findWin(PL); if (m !== -1) { store<i32>(225 * 4, m >> 8); store<i32>(226 * 4, m & 0xFF); return; }
  const cnt = getCands(10);
  if (cnt === 0) { store<i32>(225 * 4, 7); store<i32>(226 * 4, 7); return; }
  let bestSc: i32 = -2000000000; let bestR: i32 = cRow(0); let bestC: i32 = cCol(0);
  for (let i = 0; i < cnt; i++) {
    const r = cRow(i); const c = cCol(i);
    set(r, c, AI);
    if (checkWin(r, c, AI)) { set(r, c, 0); store<i32>(225 * 4, r); store<i32>(226 * 4, c); return; }
    const sc = minimax(1, -2000000000, 2000000000, false, 3);
    set(r, c, 0);
    if (sc > bestSc) { bestSc = sc; bestR = r; bestC = c; }
  }
  // 5%随机失误
  const rng = (seed * 1664525 + 1013904223) & 0x7FFFFFFF;
  if ((rng % 100) < 5 && cnt > 1) {
    const idx = 1 + (rng % (cnt > 3 ? 2 : cnt - 1));
    store<i32>(225 * 4, cRow(idx)); store<i32>(226 * 4, cCol(idx)); return;
  }
  store<i32>(225 * 4, bestR); store<i32>(226 * 4, bestC);
}

// ─── 中级 AI: depth=5, 冲四检测, 无失误 ─────────────────────
export function aiIntermediateMove(): void {
  let m = findWin(AI); if (m !== -1) { store<i32>(225 * 4, m >> 8); store<i32>(226 * 4, m & 0xFF); return; }
  m = findWin(PL); if (m !== -1) { store<i32>(225 * 4, m >> 8); store<i32>(226 * 4, m & 0xFF); return; }
  m = findFour(AI); if (m !== -1) { store<i32>(225 * 4, m >> 8); store<i32>(226 * 4, m & 0xFF); return; }
  m = findFour(PL); if (m !== -1) { store<i32>(225 * 4, m >> 8); store<i32>(226 * 4, m & 0xFF); return; }
  const cnt = getCands(12);
  if (cnt === 0) { store<i32>(225 * 4, 7); store<i32>(226 * 4, 7); return; }
  let bestSc: i32 = -2000000000; let bestR: i32 = cRow(0); let bestC: i32 = cCol(0);
  for (let i = 0; i < cnt; i++) {
    const r = cRow(i); const c = cCol(i);
    set(r, c, AI);
    if (checkWin(r, c, AI)) { set(r, c, 0); store<i32>(225 * 4, r); store<i32>(226 * 4, c); return; }
    const sc = minimax(1, -2000000000, 2000000000, false, 5);
    set(r, c, 0);
    if (sc > bestSc) { bestSc = sc; bestR = r; bestC = c; }
  }
  store<i32>(225 * 4, bestR); store<i32>(226 * 4, bestC);
}

// ─── 高级 AI: 专家级7步决策 ──────────────────────────────────
function aiAdvancedMoveWithDepth(maxDepth: i32, topN: i32): void {
  // Step1 自己能赢
  let m = findWin(AI); if (m !== -1) { store<i32>(225 * 4, m >> 8); store<i32>(226 * 4, m & 0xFF); return; }
  // Step2 对手五连必防
  m = findWin(PL); if (m !== -1) { store<i32>(225 * 4, m >> 8); store<i32>(226 * 4, m & 0xFF); return; }
  // Step3 自己有冲四/活四 -> 进攻
  m = findFour(AI); if (m !== -1) { store<i32>(225 * 4, m >> 8); store<i32>(226 * 4, m & 0xFF); return; }
  // Step4 对手有冲四 -> 防守
  m = findFour(PL); if (m !== -1) { store<i32>(225 * 4, m >> 8); store<i32>(226 * 4, m & 0xFF); return; }
  // Step5 候选点筛选
  const cnt = getCands(topN);
  if (cnt === 0) { store<i32>(225 * 4, 7); store<i32>(226 * 4, 7); return; }
  // Step5b 双威胁识别 + 优先级对抗
  let aiMaxT: i32 = 0; let aiR: i32 = -1; let aiC: i32 = -1;
  let oppMaxT: i32 = 0; let oppR: i32 = -1; let oppC: i32 = -1;
  for (let i = 0; i < cnt; i++) {
    const r = cRow(i); const c = cCol(i);
    const aiT = countThreats(r, c, AI);
    if (aiT > aiMaxT) { aiMaxT = aiT; aiR = r; aiC = c; }
    const opT = countThreats(r, c, PL);
    if (opT > oppMaxT) { oppMaxT = opT; oppR = r; oppC = c; }
  }
  // 对手威胁更高时优先防守
  if (oppMaxT >= 6 && oppR !== -1 && oppMaxT > aiMaxT) {
    store<i32>(225 * 4, oppR); store<i32>(226 * 4, oppC); return;
  }
  // 自己强威胁优先进攻
  if (aiMaxT >= 5 && aiR !== -1) {
    store<i32>(225 * 4, aiR); store<i32>(226 * 4, aiC); return;
  }
  // Step6 Alpha-Beta
  let bestSc: i32 = -2000000000; let bestR: i32 = cRow(0); let bestC: i32 = cCol(0);
  for (let i = 0; i < cnt; i++) {
    const r = cRow(i); const c = cCol(i);
    set(r, c, AI);
    if (checkWin(r, c, AI)) { set(r, c, 0); store<i32>(225 * 4, r); store<i32>(226 * 4, c); return; }
    const sc = minimax(1, -2000000000, 2000000000, false, maxDepth);
    set(r, c, 0);
    if (sc > bestSc) { bestSc = sc; bestR = r; bestC = c; }
  }
  store<i32>(225 * 4, bestR); store<i32>(226 * 4, bestC);
}

export function aiAdvancedMove(): void {
  aiAdvancedMoveWithDepth(5, 14);
}

export function aiAdvancedMoveDepth(maxDepth: i32, topN: i32): void {
  aiAdvancedMoveWithDepth(maxDepth, topN);
}

export function getResultRow(): i32 { return load<i32>(225 * 4); }
export function getResultCol(): i32 { return load<i32>(226 * 4); }
