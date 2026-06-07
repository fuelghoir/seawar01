import { keccak256, toBytes } from "viem";

export const CHALLENGE_GRID_SIZE = 10;
export const CHALLENGE_BOARD_CELLS = CHALLENGE_GRID_SIZE * CHALLENGE_GRID_SIZE;
export const CHALLENGE_SHIP_SIZES = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];
export const CHALLENGE_TOTAL_SHIP_CELLS = CHALLENGE_SHIP_SIZES.reduce((sum, size) => sum + size, 0);

export type ChallengeStatus =
  | "open"
  | "joined"
  | "challenger_won"
  | "creator_won"
  | "settled"
  | "cancelled";

export type ChallengeShot = {
  x: number;
  y: number;
  isHit: boolean;
  createdAt?: string;
};

export type PublicChallenge = {
  id: string;
  onchainChallengeId: number;
  creator: string;
  challenger: string | null;
  creatorAmount: string;
  entryFee: string;
  maxMoves: number;
  boardCommitment: `0x${string}`;
  status: ChallengeStatus;
  winner: string | null;
  movesUsed: number;
  hits: number;
  createdAt: string;
  joinedAt: string | null;
  finishedAt: string | null;
  settledAt: string | null;
  settledTxHash: string | null;
};

export type ChallengeSettlement = {
  onchainChallengeId: number;
  winner: `0x${string}`;
  movesUsed: number;
  hits: number;
  signature: `0x${string}`;
};

export function normalizeWallet(value: unknown): string | null {
  const wallet = String(value ?? "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : null;
}

export function normalizeBoard(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== CHALLENGE_BOARD_CELLS) return null;
  const board = value.map((cell) => Number(cell));
  if (!board.every((cell) => cell === 0 || cell === 1)) return null;
  return board;
}

export function isValidFleetBoard(value: unknown): value is number[] {
  const board = normalizeBoard(value);
  if (!board) return false;

  const occupied = new Set<number>();
  board.forEach((cell, index) => {
    if (cell === 1) occupied.add(index);
  });
  if (occupied.size !== CHALLENGE_TOTAL_SHIP_CELLS) return false;

  const indexOf = (x: number, y: number) => y * CHALLENGE_GRID_SIZE + x;
  const hasShip = (x: number, y: number) =>
    x >= 0 &&
    x < CHALLENGE_GRID_SIZE &&
    y >= 0 &&
    y < CHALLENGE_GRID_SIZE &&
    occupied.has(indexOf(x, y));

  for (const index of occupied) {
    const x = index % CHALLENGE_GRID_SIZE;
    const y = Math.floor(index / CHALLENGE_GRID_SIZE);
    if (
      hasShip(x - 1, y - 1) ||
      hasShip(x + 1, y - 1) ||
      hasShip(x - 1, y + 1) ||
      hasShip(x + 1, y + 1)
    ) {
      return false;
    }
  }

  const visited = new Set<number>();
  const componentSizes: number[] = [];
  for (const start of occupied) {
    if (visited.has(start)) continue;

    const stack = [start];
    const component: Array<{ x: number; y: number }> = [];
    visited.add(start);

    while (stack.length) {
      const current = stack.pop()!;
      const x = current % CHALLENGE_GRID_SIZE;
      const y = Math.floor(current / CHALLENGE_GRID_SIZE);
      component.push({ x, y });

      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]) {
        if (!hasShip(nx, ny)) continue;
        const next = indexOf(nx, ny);
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }

    const xs = Array.from(new Set(component.map((cell) => cell.x))).sort((a, b) => a - b);
    const ys = Array.from(new Set(component.map((cell) => cell.y))).sort((a, b) => a - b);
    const isHorizontal = ys.length === 1;
    const isVertical = xs.length === 1;
    if (!isHorizontal && !isVertical) return false;

    const line = isHorizontal ? xs : ys;
    for (let i = 1; i < line.length; i += 1) {
      if (line[i] !== line[i - 1] + 1) return false;
    }
    componentSizes.push(component.length);
  }

  const expected = [...CHALLENGE_SHIP_SIZES].sort((a, b) => a - b).join(",");
  const actual = componentSizes.sort((a, b) => a - b).join(",");
  return actual === expected;
}

export function computeBoardCommitment(board: number[], salt: string): `0x${string}` {
  return keccak256(toBytes(`${board.join("")}:${salt}`));
}

export function isFinalChallengeStatus(status: ChallengeStatus) {
  return status === "challenger_won" || status === "creator_won" || status === "settled";
}
