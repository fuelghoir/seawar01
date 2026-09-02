export const FLEET_IDS = ["tideguard", "ironwake", "sunfleet"] as const;
export type FleetId = (typeof FLEET_IDS)[number];

export const FLEET_CHOICE_RESET_SEASON_KEY = "S3";
// Updated immediately before rollout. Memberships created earlier were automatic assignments.
export const FLEET_CHOICE_ROLLOUT_AT = "2026-09-01T16:33:00.000Z";
export const FLEET_CHANGE_PRICE_USDC_MICRO = 5_000_000;
export const FLEET_MIN_POINTS = 10_000;

export const FLEET_PAYOUT_BPS = [6000, 3000, 1000] as const;
export const FLEET_BPS_TOTAL = 10_000;

export type FleetDefinition = {
  id: FleetId;
  name: string;
  color: string;
  image: string;
  displayOrder: number;
};

export type FleetMemberInput = {
  wallet: string;
  fleetId: FleetId;
  joinedAt: string;
  pointsAtJoin: number;
  currentPoints: number;
  seasonPoints?: number;
  transactions: number;
};

export type FleetGameInput = {
  id: number | string;
  player1: string | null;
  player2: string | null;
  winner: string | null;
  player1Hits?: number;
  player2Hits?: number;
  createdAt: string;
};

export type FleetMemberStats = FleetMemberInput & {
  games: number;
  wins: number;
  pointsEarned: number;
  eligible: boolean;
};

export type FleetStanding = FleetDefinition & {
  rank: number;
  members: number;
  eligibleMembers: number;
  games: number;
  wins: number;
  pointsEarned: number;
};

export type FleetSeasonStats = {
  standings: FleetStanding[];
  members: FleetMemberStats[];
};

export type FleetPayout = {
  wallet: string;
  fleetId: FleetId;
  rank: number;
  games: number;
  wins: number;
  pointsEarned: number;
  equalAmountRaw: string;
  pointsAmountRaw: string;
  amountRaw: string;
};

export type FleetBucket = {
  fleetId: FleetId;
  rank: number;
  wins: number;
  games: number;
  eligibleMembers: number;
  pointsEarned: number;
  shareBps: number;
  amountRaw: string;
};

export type FleetDropCalculation = {
  totalAmountRaw: string;
  buckets: FleetBucket[];
  payouts: FleetPayout[];
};

export type PublicFleetStanding = {
  id: FleetId;
  name: string;
  color: string;
  image: string;
  rank: number;
  members: number;
  games: number;
  wins: number;
  pointsEarned: number;
};

export type PublicFleetMember = {
  wallet: string;
  fleetId: FleetId;
  games: number;
  wins: number;
  transactions: number;
  pointsEarned: number;
  eligible: boolean;
};

export type PublicFleetSeason = {
  key: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: "active" | "ended" | "snapshotted";
  rankingMetric: "total_wins";
  minTransactions: number;
  minPoints: number;
  shares: number[];
  drop: { secret: true };
  fleets: PublicFleetStanding[];
  members: PublicFleetMember[];
};

export type PublicFleetMembership = {
  wallet: string;
  fleetId: FleetId;
  fleetName: string;
  joinedAt: string;
  games: number;
  wins: number;
  transactions: number;
  pointsEarned: number;
  eligible: boolean;
};

export type PublicFleetSeasonResponse = {
  season: PublicFleetSeason | null;
  membership?: PublicFleetMembership | null;
  choiceRequired?: boolean;
  choiceOpensAt?: string;
  migrationRequired?: boolean;
};

export const DEFAULT_FLEETS: FleetDefinition[] = [
  {
    id: "tideguard",
    name: "Tideguard",
    color: "#28d7ef",
    image: "/nft/fleet-tier-1.png",
    displayOrder: 1,
  },
  {
    id: "ironwake",
    name: "Ironwake",
    color: "#ff6571",
    image: "/nft/fleet-tier-3.png",
    displayOrder: 2,
  },
  {
    id: "sunfleet",
    name: "Sunfleet",
    color: "#f1c75b",
    image: "/nft/fleet-tier-2.png",
    displayOrder: 3,
  },
];

export function isFleetId(value: unknown): value is FleetId {
  return FLEET_IDS.includes(String(value) as FleetId);
}

export function computeFleetSeasonStats(
  fleetDefinitions: FleetDefinition[],
  memberInputs: FleetMemberInput[],
  gameInputs: FleetGameInput[],
  minTransactions: number,
  minPoints: number = FLEET_MIN_POINTS,
): FleetSeasonStats {
  const safeMinTransactions = Math.max(0, Math.floor(minTransactions));
  const safeMinPoints = Math.max(0, Math.floor(minPoints));
  const membersByWallet = new Map<string, FleetMemberStats>();
  const verifiedGamePoints = new Map<string, number>();

  for (const input of memberInputs) {
    const wallet = normalizeWallet(input.wallet);
    if (!wallet || !isFleetId(input.fleetId) || membersByWallet.has(wallet)) continue;
    membersByWallet.set(wallet, {
      ...input,
      wallet,
      games: 0,
      wins: 0,
      transactions: Math.max(0, Math.floor(Number(input.transactions || 0))),
      pointsEarned: input.seasonPoints === undefined
        ? Math.max(0, Math.floor(Number(input.currentPoints || 0) - Number(input.pointsAtJoin || 0)))
        : Math.max(0, Math.floor(Number(input.seasonPoints || 0))),
      eligible: safeMinTransactions === 0 && safeMinPoints === 0,
    });
  }

  for (const game of gameInputs) {
    const createdAt = Date.parse(game.createdAt);
    if (!Number.isFinite(createdAt)) continue;

    const winner = normalizeWallet(game.winner);
    const participants = new Set(
      [normalizeWallet(game.player1), normalizeWallet(game.player2)].filter(
        (wallet): wallet is string => Boolean(wallet),
      ),
    );

    for (const wallet of participants) {
      const member = membersByWallet.get(wallet);
      if (!member || createdAt < Date.parse(member.joinedAt)) continue;
      member.games += 1;
      if (winner === wallet) member.wins += 1;
      const playerHits = wallet === normalizeWallet(game.player1)
        ? game.player1Hits
        : game.player2Hits;
      const earned = Math.max(0, Math.floor(Number(playerHits ?? 0))) + (winner === wallet ? 50 : 0);
      verifiedGamePoints.set(wallet, (verifiedGamePoints.get(wallet) ?? 0) + earned);
    }
  }

  const members = Array.from(membersByWallet.values()).map((member) => ({
    ...member,
    pointsEarned: Math.max(member.pointsEarned, verifiedGamePoints.get(member.wallet) ?? 0),
    eligible: member.transactions >= safeMinTransactions
      && Math.max(member.pointsEarned, verifiedGamePoints.get(member.wallet) ?? 0) >= safeMinPoints,
  }));

  const unsorted = fleetDefinitions.map((fleet) => {
    const fleetMembers = members.filter((member) => member.fleetId === fleet.id);
    return {
      ...fleet,
      rank: 0,
      members: fleetMembers.length,
      eligibleMembers: fleetMembers.filter((member) => member.eligible).length,
      games: fleetMembers.reduce((sum, member) => sum + member.games, 0),
      wins: fleetMembers.reduce((sum, member) => sum + member.wins, 0),
      pointsEarned: fleetMembers.reduce((sum, member) => sum + member.pointsEarned, 0),
    };
  });

  const standings = unsorted
    .sort((left, right) =>
      right.wins - left.wins ||
      left.displayOrder - right.displayOrder,
    )
    .map((fleet, index) => ({ ...fleet, rank: index + 1 }));

  return { standings, members };
}

export function calculateFleetDrop(
  stats: FleetSeasonStats,
  totalAmountRaw: bigint,
  payoutBps: readonly number[] = FLEET_PAYOUT_BPS,
): FleetDropCalculation {
  if (totalAmountRaw <= BigInt(0)) throw new Error("Drop amount must be greater than zero");
  if (stats.standings.length !== 3) throw new Error("Fleet season must have exactly three fleets");

  const normalizedBps = payoutBps.map((value) => Math.max(0, Math.floor(value)));
  if (normalizedBps.length !== 3 || normalizedBps.reduce((sum, value) => sum + value, 0) !== FLEET_BPS_TOTAL) {
    throw new Error("Fleet payout shares must total 10000 bps");
  }

  const buckets: FleetBucket[] = [];
  const payouts: FleetPayout[] = [];
  let assignedToBuckets = BigInt(0);

  for (const standing of stats.standings) {
    const shareBps = normalizedBps[standing.rank - 1];
    const bucketAmount = standing.rank === stats.standings.length
      ? totalAmountRaw - assignedToBuckets
      : (totalAmountRaw * BigInt(shareBps)) / BigInt(FLEET_BPS_TOTAL);
    assignedToBuckets += bucketAmount;

    const eligibleMembers = stats.members
      .filter((member) => member.fleetId === standing.id && member.eligible)
      .sort((left, right) => left.wallet.localeCompare(right.wallet));
    if (eligibleMembers.length === 0) {
      throw new Error(`${standing.name} has no eligible members`);
    }

    const eligiblePoints = eligibleMembers.map((member) => Math.max(0, Math.floor(member.pointsEarned)));
    const totalEligiblePoints = eligiblePoints.reduce((sum, value) => sum + BigInt(value), BigInt(0));
    if (totalEligiblePoints <= BigInt(0)) {
      throw new Error(`${standing.name} has no eligible S3 points`);
    }
    const pointsShares = allocateByPoints(bucketAmount, eligibleMembers, eligiblePoints, totalEligiblePoints);

    for (let index = 0; index < eligibleMembers.length; index += 1) {
      const member = eligibleMembers[index];
      const pointsAmount = pointsShares[index];
      const amount = pointsAmount;
      if (amount <= BigInt(0)) continue;
      payouts.push({
        wallet: member.wallet,
        fleetId: member.fleetId,
        rank: standing.rank,
        games: member.games,
        wins: member.wins,
        pointsEarned: member.pointsEarned,
        equalAmountRaw: "0",
        pointsAmountRaw: pointsAmount.toString(),
        amountRaw: amount.toString(),
      });
    }

    buckets.push({
      fleetId: standing.id,
      rank: standing.rank,
      wins: standing.wins,
      games: standing.games,
      eligibleMembers: eligibleMembers.length,
      pointsEarned: eligiblePoints.reduce((sum, value) => sum + value, 0),
      shareBps,
      amountRaw: bucketAmount.toString(),
    });
  }

  const allocated = payouts.reduce((sum, payout) => sum + BigInt(payout.amountRaw), BigInt(0));
  if (allocated !== totalAmountRaw) throw new Error("Fleet payout calculation did not allocate the full drop");

  return {
    totalAmountRaw: totalAmountRaw.toString(),
    buckets,
    payouts,
  };
}

function allocateByPoints(
  total: bigint,
  members: FleetMemberStats[],
  points: number[],
  totalPoints: bigint,
) {
  const shares = Array.from({ length: members.length }, () => BigInt(0));
  if (total <= BigInt(0) || totalPoints <= BigInt(0)) return shares;

  const remainders = members.map((member, index) => {
    const numerator = total * BigInt(points[index]);
    shares[index] = numerator / totalPoints;
    return { index, wallet: member.wallet, remainder: numerator % totalPoints };
  });
  const allocated = shares.reduce((sum, value) => sum + value, BigInt(0));
  const leftover = Number(total - allocated);
  remainders.sort((left, right) => {
    if (left.remainder !== right.remainder) return left.remainder > right.remainder ? -1 : 1;
    return left.wallet.localeCompare(right.wallet);
  });
  for (let index = 0; index < leftover; index += 1) {
    shares[remainders[index].index] += BigInt(1);
  }
  return shares;
}

function normalizeWallet(value: unknown) {
  const wallet = String(value ?? "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : null;
}
