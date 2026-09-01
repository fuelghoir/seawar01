import { DEFAULT_FLEETS, type PublicFleetSeasonResponse } from "./fleetSeason";

export const FLEET_SEASON_DEMO_RESPONSE: PublicFleetSeasonResponse = {
  season: {
    key: "S3",
    title: "Fleet Season",
    startsAt: "2026-09-01T00:00:00.000Z",
    endsAt: "2026-10-10T20:59:59.000Z",
    status: "active",
    rankingMetric: "total_wins",
    minTransactions: 10,
    minPoints: 10_000,
    shares: [60, 30, 10],
    drop: { secret: true },
    fleets: [
      { ...DEFAULT_FLEETS[0], rank: 1, members: 405, games: 2968, wins: 1284, pointsEarned: 1_284_500 },
      { ...DEFAULT_FLEETS[1], rank: 2, members: 404, games: 2831, wins: 1190, pointsEarned: 1_190_800 },
      { ...DEFAULT_FLEETS[2], rank: 3, members: 405, games: 2704, wins: 1054, pointsEarned: 1_054_200 },
    ],
    members: [
      { wallet: "0x1111111111111111111111111111111111111111", fleetId: "tideguard", games: 31, wins: 18, transactions: 44, pointsEarned: 12_450, eligible: true },
      { wallet: "0x2222222222222222222222222222222222222222", fleetId: "tideguard", games: 24, wins: 13, transactions: 31, pointsEarned: 9_820, eligible: false },
      { wallet: "0x3333333333333333333333333333333333333333", fleetId: "ironwake", games: 17, wins: 9, transactions: 22, pointsEarned: 8_650, eligible: false },
      { wallet: "0x4444444444444444444444444444444444444444", fleetId: "sunfleet", games: 12, wins: 6, transactions: 15, pointsEarned: 5_240, eligible: false },
    ],
  },
  membership: {
    wallet: "0x3333333333333333333333333333333333333333",
    fleetId: "ironwake",
    fleetName: "Ironwake",
    joinedAt: "2026-09-01T00:00:00.000Z",
    games: 17,
    wins: 9,
    transactions: 22,
    pointsEarned: 8_650,
    eligible: false,
  },
};
