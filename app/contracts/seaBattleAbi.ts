export const SEABATTLE_CONTRACT_ADDRESS = (process.env
  .NEXT_PUBLIC_SEABATTLE_CONTRACT_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`;

export const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`;
export const COMMISSION_WALLET = "0xA4Df87d8940ac70aC8A33DB79bb1057238B490e4" as `0x${string}`;

// Minimal ERC-20 ABI for USDC approve/allowance/balanceOf
export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { type: "address", name: "spender" },
      { type: "uint256", name: "amount" },
    ],
    outputs: [{ type: "bool", name: "" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { type: "address", name: "owner" },
      { type: "address", name: "spender" },
    ],
    outputs: [{ type: "uint256", name: "" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ type: "address", name: "account" }],
    outputs: [{ type: "uint256", name: "" }],
    stateMutability: "view",
  },
] as const;

// SeaBattleV2 ABI
export const seaBattleAbi = [
  // ─── Hybrid ───
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
  // ─── Bot ───
  {
    type: "function",
    name: "createBotGame",
    inputs: [],
    outputs: [{ type: "uint256", name: "" }],
    stateMutability: "nonpayable",
  },
  // ─── Wager ───
  {
    type: "function",
    name: "createWagerGame",
    inputs: [{ type: "uint256", name: "amount" }],
    outputs: [{ type: "uint256", name: "" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "joinWagerGame",
    inputs: [{ type: "uint256", name: "gameId" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // ─── Result ───
  {
    type: "function",
    name: "recordResult",
    inputs: [
      { type: "uint256", name: "gameId" },
      { type: "address", name: "_winner" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // ─── Prize ───
  {
    type: "function",
    name: "claimPrize",
    inputs: [{ type: "uint256", name: "gameId" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // ─── Bomb ───
  {
    type: "function",
    name: "buyBomb",
    inputs: [{ type: "uint256", name: "gameId" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // ─── Views ───
  {
    type: "function",
    name: "getGame",
    inputs: [{ type: "uint256", name: "gameId" }],
    outputs: [
      { type: "address", name: "player1" },
      { type: "address", name: "player2" },
      { type: "uint8", name: "gameType" },
      { type: "uint256", name: "wagerAmount" },
      { type: "bool", name: "finished" },
      { type: "address", name: "winner" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "playerHasBomb",
    inputs: [
      { type: "uint256", name: "gameId" },
      { type: "address", name: "player" },
    ],
    outputs: [{ type: "bool", name: "" }],
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
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [{ type: "address", name: "" }],
    stateMutability: "view",
  },
  // ─── Events ───
  {
    type: "event",
    name: "GameCreated",
    inputs: [
      { type: "uint256", name: "gameId", indexed: true },
      { type: "address", name: "player1", indexed: false },
      { type: "uint8", name: "gameType", indexed: false },
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
    name: "GameFinished",
    inputs: [
      { type: "uint256", name: "gameId", indexed: true },
      { type: "address", name: "winner", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BombPurchased",
    inputs: [
      { type: "uint256", name: "gameId", indexed: true },
      { type: "address", name: "player", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PrizeClaimed",
    inputs: [
      { type: "uint256", name: "gameId", indexed: true },
      { type: "address", name: "winner", indexed: false },
      { type: "uint256", name: "prize", indexed: false },
    ],
  },
] as const;
