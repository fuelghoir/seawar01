// ─── Bot AI for Sea Battle ───
// Hunt/Target algorithm: random shots until hit, then target adjacent cells

const SHIP_SIZES = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1]; // 10 ships, 20 cells total

// ─── Random board placement ───

function hasBuffer(board: number[], x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < 10 && ny >= 0 && ny < 10) {
        if (board[ny * 10 + nx] === 1) return true;
      }
    }
  }
  return false;
}

function tryPlace(
  board: number[],
  size: number,
  x: number,
  y: number,
  horizontal: boolean
): boolean {
  const cells: number[] = [];
  for (let i = 0; i < size; i++) {
    const cx = horizontal ? x + i : x;
    const cy = horizontal ? y : y + i;
    if (cx >= 10 || cy >= 10) return false;
    if (hasBuffer(board, cx, cy)) return false;
    cells.push(cy * 10 + cx);
  }
  for (const idx of cells) board[idx] = 1;
  return true;
}

export function generateRandomBoard(): number[] {
  for (let attempt = 0; attempt < 100; attempt++) {
    const board = new Array(100).fill(0);
    let ok = true;
    for (const size of SHIP_SIZES) {
      let placed = false;
      for (let t = 0; t < 200; t++) {
        const horizontal = Math.random() < 0.5;
        const x = Math.floor(Math.random() * 10);
        const y = Math.floor(Math.random() * 10);
        if (tryPlace(board, size, x, y, horizontal)) {
          placed = true;
          break;
        }
      }
      if (!placed) {
        ok = false;
        break;
      }
    }
    if (ok) return board;
  }
  // fallback — should never happen
  return new Array(100).fill(0);
}

// ─── Hunt/Target AI ───

export interface BotState {
  shotsMade: Set<number>; // indices already shot
  hitQueue: number[]; // cells to target next (adjacent to hits)
  hits: Set<number>; // confirmed hits
}

export function createBotState(): BotState {
  return {
    shotsMade: new Set(),
    hitQueue: [],
    hits: new Set(),
  };
}

function getAdjacentCells(idx: number): number[] {
  const x = idx % 10;
  const y = Math.floor(idx / 10);
  const adj: number[] = [];
  if (x > 0) adj.push(idx - 1);
  if (x < 9) adj.push(idx + 1);
  if (y > 0) adj.push(idx - 10);
  if (y < 9) adj.push(idx + 10);
  return adj;
}

export function botChooseTarget(state: BotState): { x: number; y: number } {
  // Target mode: shoot adjacent to known hits
  while (state.hitQueue.length > 0) {
    const target = state.hitQueue.pop()!;
    if (!state.shotsMade.has(target)) {
      state.shotsMade.add(target);
      return { x: target % 10, y: Math.floor(target / 10) };
    }
  }

  // Hunt mode: random shot on checkerboard pattern for efficiency
  const available: number[] = [];
  for (let i = 0; i < 100; i++) {
    if (!state.shotsMade.has(i)) {
      // Checkerboard: (x + y) % 2 === 0 first for better coverage
      const x = i % 10;
      const y = Math.floor(i / 10);
      if ((x + y) % 2 === 0) available.push(i);
    }
  }

  // If checkerboard exhausted, use remaining cells
  if (available.length === 0) {
    for (let i = 0; i < 100; i++) {
      if (!state.shotsMade.has(i)) available.push(i);
    }
  }

  const target = available[Math.floor(Math.random() * available.length)];
  state.shotsMade.add(target);
  return { x: target % 10, y: Math.floor(target / 10) };
}

export function botProcessResult(
  state: BotState,
  x: number,
  y: number,
  isHit: boolean
): void {
  if (isHit) {
    const idx = y * 10 + x;
    state.hits.add(idx);
    // Add adjacent cells to target queue
    for (const adj of getAdjacentCells(idx)) {
      if (!state.shotsMade.has(adj) && !state.hitQueue.includes(adj)) {
        state.hitQueue.push(adj);
      }
    }
  }
}
