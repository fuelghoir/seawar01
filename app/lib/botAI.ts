// ─── Bot AI for Sea Battle ───
// Smart Hunt/Target algorithm with sunk detection, line following, and probability

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
  return new Array(100).fill(0);
}

// ─── Smart Hunt/Target AI ───

export interface BotState {
  shotsMade: Set<number>;
  hits: Set<number>;
  misses: Set<number>;
  excluded: Set<number>; // cells around sunk ships — never shoot here
  sunkShips: number[][]; // list of sunk ship cell arrays
  remainingShipSizes: number[]; // sizes not yet sunk
  // Target mode state
  targetHits: number[]; // current unsunk hit chain
}

export function createBotState(): BotState {
  return {
    shotsMade: new Set(),
    hits: new Set(),
    misses: new Set(),
    excluded: new Set(),
    sunkShips: [],
    remainingShipSizes: [...SHIP_SIZES],
    targetHits: [],
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

function getSurrounding(cells: number[]): number[] {
  const cellSet = new Set(cells);
  const surround = new Set<number>();
  for (const c of cells) {
    const cx = c % 10, cy = Math.floor(c / 10);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx >= 0 && nx < 10 && ny >= 0 && ny < 10) {
          const idx = ny * 10 + nx;
          if (!cellSet.has(idx)) surround.add(idx);
        }
      }
    }
  }
  return Array.from(surround);
}

/** Get smart targets along the line of hits */
function getLineTargets(targetHits: number[], state: BotState): number[] {
  if (targetHits.length < 2) {
    // Single hit: try all 4 adjacent
    return getAdjacentCells(targetHits[0]).filter(
      (c) => !state.shotsMade.has(c) && !state.excluded.has(c)
    );
  }

  // Multiple hits: determine direction and extend
  const sorted = [...targetHits].sort((a, b) => a - b);
  const first = sorted[0];
  const second = sorted[1];
  const diff = second - first;

  const targets: number[] = [];

  if (diff === 1) {
    // Horizontal line
    const y = Math.floor(first / 10);
    const minX = Math.min(...sorted.map((c) => c % 10));
    const maxX = Math.max(...sorted.map((c) => c % 10));
    // Extend left
    const left = y * 10 + (minX - 1);
    if (minX > 0 && !state.shotsMade.has(left) && !state.excluded.has(left)) {
      targets.push(left);
    }
    // Extend right
    const right = y * 10 + (maxX + 1);
    if (maxX < 9 && !state.shotsMade.has(right) && !state.excluded.has(right)) {
      targets.push(right);
    }
  } else if (diff === 10) {
    // Vertical line
    const x = first % 10;
    const minY = Math.min(...sorted.map((c) => Math.floor(c / 10)));
    const maxY = Math.max(...sorted.map((c) => Math.floor(c / 10)));
    // Extend up
    const up = (minY - 1) * 10 + x;
    if (minY > 0 && !state.shotsMade.has(up) && !state.excluded.has(up)) {
      targets.push(up);
    }
    // Extend down
    const down = (maxY + 1) * 10 + x;
    if (maxY < 9 && !state.shotsMade.has(down) && !state.excluded.has(down)) {
      targets.push(down);
    }
  }

  // If line extension not possible (edge/blocked), fall back to adjacent of all hits
  if (targets.length === 0) {
    for (const h of targetHits) {
      for (const adj of getAdjacentCells(h)) {
        if (!state.shotsMade.has(adj) && !state.excluded.has(adj)) {
          targets.push(adj);
        }
      }
    }
  }

  return targets;
}

/** Probability-based hunt: score each cell by how many ships could pass through it */
function getProbabilityScores(state: BotState): number[] {
  const scores = new Array(100).fill(0);

  for (const size of state.remainingShipSizes) {
    // Try placing horizontally
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x <= 10 - size; x++) {
        let canPlace = true;
        const cells: number[] = [];
        for (let i = 0; i < size; i++) {
          const idx = y * 10 + x + i;
          if (state.shotsMade.has(idx) || state.excluded.has(idx)) {
            canPlace = false;
            break;
          }
          cells.push(idx);
        }
        if (canPlace) {
          for (const c of cells) scores[c]++;
        }
      }
    }
    // Try placing vertically
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y <= 10 - size; y++) {
        let canPlace = true;
        const cells: number[] = [];
        for (let i = 0; i < size; i++) {
          const idx = (y + i) * 10 + x;
          if (state.shotsMade.has(idx) || state.excluded.has(idx)) {
            canPlace = false;
            break;
          }
          cells.push(idx);
        }
        if (canPlace) {
          for (const c of cells) scores[c]++;
        }
      }
    }
  }

  return scores;
}

export function botChooseTarget(state: BotState): { x: number; y: number } {
  // Target mode: follow the line of current hits
  if (state.targetHits.length > 0) {
    const targets = getLineTargets(state.targetHits, state);
    if (targets.length > 0) {
      const target = targets[Math.floor(Math.random() * targets.length)];
      state.shotsMade.add(target);
      return { x: target % 10, y: Math.floor(target / 10) };
    }
    // No valid targets — clear targetHits (probably sunk but not detected)
    state.targetHits = [];
  }

  // Hunt mode: probability-based targeting
  const scores = getProbabilityScores(state);

  // Find max score among unshot cells
  let maxScore = 0;
  for (let i = 0; i < 100; i++) {
    if (!state.shotsMade.has(i) && !state.excluded.has(i)) {
      if (scores[i] > maxScore) maxScore = scores[i];
    }
  }

  // Collect all cells with max score
  const bestCells: number[] = [];
  for (let i = 0; i < 100; i++) {
    if (!state.shotsMade.has(i) && !state.excluded.has(i) && scores[i] === maxScore) {
      bestCells.push(i);
    }
  }

  if (bestCells.length === 0) {
    // Fallback: any unshot cell
    for (let i = 0; i < 100; i++) {
      if (!state.shotsMade.has(i)) bestCells.push(i);
    }
  }

  const target = bestCells[Math.floor(Math.random() * bestCells.length)];
  state.shotsMade.add(target);
  return { x: target % 10, y: Math.floor(target / 10) };
}

export function botProcessResult(
  state: BotState,
  x: number,
  y: number,
  isHit: boolean
): void {
  const idx = y * 10 + x;

  if (isHit) {
    state.hits.add(idx);
    state.targetHits.push(idx);

    // Exclude diagonal cells — ships are only horizontal/vertical
    const dx = [-1, 1, -1, 1];
    const dy = [-1, -1, 1, 1];
    for (let i = 0; i < 4; i++) {
      const nx = x + dx[i];
      const ny = y + dy[i];
      if (nx >= 0 && nx < 10 && ny >= 0 && ny < 10) {
        state.excluded.add(ny * 10 + nx);
      }
    }
  } else {
    state.misses.add(idx);
  }
}

/** Called by the game when a ship is confirmed sunk (using actual board data) */
export function botNotifySunk(state: BotState, shipCells: number[]): void {
  state.sunkShips.push(shipCells);

  // Exclude all surrounding cells
  for (const c of getSurrounding(shipCells)) {
    state.excluded.add(c);
  }

  // Remove this ship size from remaining
  const sizeIdx = state.remainingShipSizes.indexOf(shipCells.length);
  if (sizeIdx !== -1) {
    state.remainingShipSizes.splice(sizeIdx, 1);
  }

  // Clear targetHits for this ship's cells
  state.targetHits = state.targetHits.filter(
    (h) => !shipCells.includes(h)
  );
}

