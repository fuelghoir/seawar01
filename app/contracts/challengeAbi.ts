const DEFAULT_CHALLENGE_CONTRACT_ADDRESS =
  "0x082d8eaa1fc738d5950e6b751026d3d265866311" as `0x${string}`;

export const CHALLENGE_CONTRACT_ADDRESS = (process.env
  .NEXT_PUBLIC_CHALLENGE_CONTRACT_ADDRESS || DEFAULT_CHALLENGE_CONTRACT_ADDRESS) as `0x${string}`;

export const challengeAbi = [
  {
    type: "function",
    name: "createChallenge",
    inputs: [
      { type: "uint256", name: "creatorAmount" },
      { type: "uint256", name: "entryFee" },
      { type: "uint16", name: "maxMoves" },
      { type: "bytes32", name: "boardCommitment" },
    ],
    outputs: [{ type: "uint256", name: "challengeId" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "joinChallenge",
    inputs: [{ type: "uint256", name: "challengeId" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "cancelOpenChallenge",
    inputs: [{ type: "uint256", name: "challengeId" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "settleChallenge",
    inputs: [
      { type: "uint256", name: "challengeId" },
      { type: "uint16", name: "movesUsed" },
      { type: "uint16", name: "hits" },
      { type: "bytes", name: "signature" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claimExpiredChallenge",
    inputs: [{ type: "uint256", name: "challengeId" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getChallenge",
    inputs: [{ type: "uint256", name: "challengeId" }],
    outputs: [
      { type: "address", name: "creator" },
      { type: "address", name: "challenger" },
      { type: "uint256", name: "creatorAmount" },
      { type: "uint256", name: "entryFee" },
      { type: "uint16", name: "maxMoves" },
      { type: "bytes32", name: "boardCommitment" },
      { type: "bool", name: "joined" },
      { type: "bool", name: "settled" },
      { type: "address", name: "winner" },
      { type: "uint256", name: "createdAt" },
      { type: "uint256", name: "joinedAt" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "previewPayout",
    inputs: [
      { type: "uint256", name: "challengeId" },
      { type: "uint16", name: "hits" },
    ],
    outputs: [
      { type: "uint256", name: "creatorPayout" },
      { type: "uint256", name: "challengerPayout" },
      { type: "uint256", name: "dropFee" },
      { type: "uint16", name: "cashoutBps" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "pendingPayouts",
    inputs: [{ type: "address", name: "player" }],
    outputs: [{ type: "uint256", name: "" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "claimPayout",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "dropFundingTotal",
    inputs: [],
    outputs: [{ type: "uint256", name: "" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "ChallengeCreated",
    inputs: [
      { type: "uint256", name: "challengeId", indexed: true },
      { type: "address", name: "creator", indexed: true },
      { type: "uint256", name: "creatorAmount", indexed: false },
      { type: "uint256", name: "entryFee", indexed: false },
      { type: "uint16", name: "maxMoves", indexed: false },
      { type: "bytes32", name: "boardCommitment", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ChallengeJoined",
    inputs: [
      { type: "uint256", name: "challengeId", indexed: true },
      { type: "address", name: "challenger", indexed: true },
    ],
  },
  {
    type: "event",
    name: "ChallengeSettled",
    inputs: [
      { type: "uint256", name: "challengeId", indexed: true },
      { type: "address", name: "winner", indexed: true },
      { type: "uint256", name: "creatorPayout", indexed: false },
      { type: "uint256", name: "challengerPayout", indexed: false },
      { type: "uint256", name: "dropFee", indexed: false },
      { type: "uint16", name: "hits", indexed: false },
      { type: "uint16", name: "cashoutBps", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PayoutClaimed",
    inputs: [
      { type: "address", name: "player", indexed: true },
      { type: "uint256", name: "amount", indexed: false },
    ],
  },
] as const;
