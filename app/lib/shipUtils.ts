/** Find connected ship groups from a 100-cell board array (0/1). */
export function findShips(board: number[]): number[][] {
  const visited = new Set<number>();
  const ships: number[][] = [];
  for (let i = 0; i < 100; i++) {
    if (board[i] !== 1 || visited.has(i)) continue;
    const ship: number[] = [];
    const q = [i];
    while (q.length) {
      const c = q.shift()!;
      if (visited.has(c) || board[c] !== 1) continue;
      visited.add(c);
      ship.push(c);
      const cx = c % 10, cy = Math.floor(c / 10);
      if (cx > 0) q.push(c - 1);
      if (cx < 9) q.push(c + 1);
      if (cy > 0) q.push(c - 10);
      if (cy < 9) q.push(c + 10);
    }
    ships.push(ship);
  }
  return ships;
}

/** Check if every cell of a ship has been hit. */
export function isShipSunk(ship: number[], hitCells: Set<number>): boolean {
  return ship.every((c) => hitCells.has(c));
}

/** Get all cells surrounding a ship (for auto-miss dots). Returns cell indices. */
export function getSurroundingCells(ship: number[]): number[] {
  const shipSet = new Set(ship);
  const surround = new Set<number>();
  for (const c of ship) {
    const cx = c % 10, cy = Math.floor(c / 10);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx >= 0 && nx < 10 && ny >= 0 && ny < 10) {
          const idx = ny * 10 + nx;
          if (!shipSet.has(idx)) surround.add(idx);
        }
      }
  }
  return Array.from(surround);
}
