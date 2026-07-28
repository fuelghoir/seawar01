import {
  EMPTY_FLEET_STATE,
  type FleetState,
} from "./fleetNft";

type NamedMinerState = {
  owned?: unknown;
  unlocked?: unknown;
  tier?: unknown;
  level?: unknown;
  pointsPerHour?: unknown;
  claimablePoints?: unknown;
  nextPrice?: unknown;
  maxUpgradePrice?: unknown;
  maxed?: unknown;
};

function valueAt(
  value: unknown,
  name: keyof NamedMinerState,
  index: number,
): unknown {
  if (Array.isArray(value)) return value[index];
  if (value && typeof value === "object") {
    return (value as NamedMinerState)[name];
  }
  return undefined;
}

export function parseFleetMinerSlots(value: unknown): FleetState[] | null {
  if (!Array.isArray(value) || value.length !== 9) return null;

  return value.map((raw) => {
    const owned = Boolean(valueAt(raw, "owned", 2));
    const unlocked = Boolean(valueAt(raw, "unlocked", 3));
    if (!owned) {
      return {
        ...EMPTY_FLEET_STATE,
        unlocked,
        nextPrice: Number(valueAt(raw, "nextPrice", 8) ?? 500_000),
        maxUpgradePrice: 28_100_000,
      };
    }

    return {
      tokenId: 0,
      tier: Number(valueAt(raw, "tier", 4) ?? 0),
      level: Number(valueAt(raw, "level", 5) ?? 0),
      pointsPerHour: Number(valueAt(raw, "pointsPerHour", 6) ?? 0),
      claimablePoints: Number(valueAt(raw, "claimablePoints", 7) ?? 0),
      nextPrice: Number(valueAt(raw, "nextPrice", 8) ?? 0),
      maxUpgradePrice: Number(valueAt(raw, "maxUpgradePrice", 9) ?? 0),
      maxed: Boolean(valueAt(raw, "maxed", 10)),
      unlocked,
    };
  });
}
