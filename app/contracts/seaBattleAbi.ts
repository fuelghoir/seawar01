export const SEABATTLE_CONTRACT_ADDRESS = (process.env
  .NEXT_PUBLIC_SEABATTLE_CONTRACT_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`;

export const seaBattleAbi = [
  {
    type: "function",
    name: "createGame",
    inputs: [],
    outputs: [{ type: "uint256", name: "" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "joinGame",
    inputs: [{ type: "uint256", name: "gameId" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "commitBoard",
    inputs: [
      { type: "uint256", name: "gameId" },
      { type: "bytes32", name: "boardHash" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "shoot",
    inputs: [
      { type: "uint256", name: "gameId" },
      { type: "uint8", name: "x" },
      { type: "uint8", name: "y" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "reportHit",
    inputs: [
      { type: "uint256", name: "gameId" },
      { type: "uint8", name: "x" },
      { type: "uint8", name: "y" },
      { type: "bool", name: "isHit" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "revealBoard",
    inputs: [
      { type: "uint256", name: "gameId" },
      { type: "uint8[100]", name: "boardLayout" },
      { type: "bytes32", name: "salt" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getGame",
    inputs: [{ type: "uint256", name: "gameId" }],
    outputs: [
      { type: "address", name: "player1" },
      { type: "address", name: "player2" },
      { type: "uint8", name: "currentTurn" },
      { type: "uint8", name: "player1Hits" },
      { type: "uint8", name: "player2Hits" },
      { type: "uint8", name: "state" },
      { type: "uint8", name: "turnPhase" },
      { type: "address", name: "winner" },
      { type: "bool", name: "player1BoardCommitted" },
      { type: "bool", name: "player2BoardCommitted" },
      { type: "uint8", name: "lastShotX" },
      { type: "uint8", name: "lastShotY" },
      { type: "address", name: "lastShooter" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getBoardState",
    inputs: [
      { type: "uint256", name: "gameId" },
      { type: "uint8", name: "playerNum" },
    ],
    outputs: [
      { type: "bool[100]", name: "shots" },
      { type: "bool[100]", name: "hits" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "nextGameId",
    inputs: [],
    outputs: [{ type: "uint256", name: "" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "GameCreated",
    inputs: [
      { type: "uint256", name: "gameId", indexed: true },
      { type: "address", name: "player1", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PlayerJoined",
    inputs: [
      { type: "uint256", name: "gameId", indexed: true },
      { type: "address", name: "player2", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BoardCommitted",
    inputs: [
      { type: "uint256", name: "gameId", indexed: true },
      { type: "address", name: "player", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ShotFired",
    inputs: [
      { type: "uint256", name: "gameId", indexed: true },
      { type: "address", name: "shooter", indexed: false },
      { type: "uint8", name: "x", indexed: false },
      { type: "uint8", name: "y", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ShotResult",
    inputs: [
      { type: "uint256", name: "gameId", indexed: true },
      { type: "uint8", name: "x", indexed: false },
      { type: "uint8", name: "y", indexed: false },
      { type: "bool", name: "isHit", indexed: false },
    ],
  },
  {
    type: "event",
    name: "GameFinished",
    inputs: [
      { type: "uint256", name: "gameId", indexed: true },
      { type: "address", name: "winner", indexed: false },
    ],
  },
] as const;
