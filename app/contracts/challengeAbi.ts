const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as `0x${string}`;

export const CHALLENGE_CONTRACT_ADDRESS = (process.env
  .NEXT_PUBLIC_CHALLENGE_CONTRACT_ADDRESS || ZERO_ADDRESS) as `0x${string}`;

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
      { type: "address", name: "winner" },
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
      { type: "uint256", name: "prize", indexed: false },
      { type: "uint256", name: "dropFee", indexed: false },
    ],
  },
] as const;
