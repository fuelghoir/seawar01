export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export type FleetState = {
  tokenId: number;
  tier: number;
  level: number;
  pointsPerHour: number;
  claimablePoints: number;
  nextPrice: number;
  maxed: boolean;
};

export const EMPTY_FLEET_STATE: FleetState = {
  tokenId: 0,
  tier: 0,
  level: 0,
  pointsPerHour: 0,
  claimablePoints: 0,
  nextPrice: 500_000,
  maxed: false,
};

export function parseFleetState(value: unknown): FleetState | null {
  if (!Array.isArray(value)) return null;
  return {
    tokenId: Number(value[0] ?? 0),
    tier: Number(value[1] ?? 0),
    level: Number(value[2] ?? 0),
    pointsPerHour: Number(value[3] ?? 0),
    claimablePoints: Number(value[4] ?? 0),
    nextPrice: Number(value[5] ?? 0),
    maxed: Boolean(value[6]),
  };
}

export function formatUsdc(amount: bigint | number) {
  return `${(Number(amount) / 1_000_000).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })} USDC`;
}

export function fleetPointRate(tier: number, level: number) {
  if (tier === 1) return [50, 75, 100][level - 1] ?? 0;
  if (tier === 2) return [200, 250, 300][level - 1] ?? 0;
  if (tier === 3) return [400, 450, 500][level - 1] ?? 0;
  return 0;
}

export function fleetNextPrice(tier: number, level: number) {
  if (tier === 3 && level === 3) return 0;
  if (level < 3) {
    if (tier === 1) return 300_000;
    if (tier === 2) return 2_000_000;
    if (tier === 3) return 5_000_000;
  }
  if (tier === 1 && level === 3) return 3_000_000;
  if (tier === 2 && level === 3) return 10_000_000;
  return 0;
}

export function fleetMaxUpgradeCost(tier: number, level: number) {
  let cost = 0;
  let currentTier = tier;
  let currentLevel = level;
  while (currentTier < 3 || currentLevel < 3) {
    if (currentTier === 3 && currentLevel === 3) break;
    const price = fleetNextPrice(currentTier, currentLevel);
    cost += price;
    if (currentLevel < 3) {
      currentLevel++;
    } else {
      currentTier++;
      currentLevel = 1;
    }
  }
  return cost;
}

export const MAX_MINER_SLOTS = 10;

export type MultiFleetState = {
  activeSlot: number;
  slots: FleetState[];
};

export const EMPTY_MULTI_FLEET_STATE: MultiFleetState = {
  activeSlot: 0,
  slots: [EMPTY_FLEET_STATE],
};

export function canUnlockNextSlot(slots: FleetState[], slotIndex: number): boolean {
  if (slotIndex === 0) return true; // Slot #1 is always available
  if (slotIndex >= MAX_MINER_SLOTS) return false;
  // Slot N requires Slot N-1 to be maxed (tier 3, level 3)
  const prev = slots[slotIndex - 1];
  return Boolean(prev && prev.tokenId > 0 && prev.maxed);
}

export function getTotalPointsPerHour(slots: FleetState[]): number {
  return slots.reduce((sum, slot) => sum + (slot.pointsPerHour || 0), 0);
}

export function getTotalClaimablePoints(slots: FleetState[]): number {
  return slots.reduce((sum, slot) => sum + (slot.claimablePoints || 0), 0);
}
