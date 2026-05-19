export const SEABATTLE_CONTRACT_ADDRESS = (process.env
  .NEXT_PUBLIC_SEABATTLE_CONTRACT_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`;

export const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`;
export const COMMISSION_WALLET = "0xA4Df87d8940ac70aC8A33DB79bb1057238B490e4" as `0x${string}`;
export const SHOP_TREASURY_ADDRESS = (process.env
  .NEXT_PUBLIC_SHOP_TREASURY_ADDRESS || COMMISSION_WALLET) as `0x${string}`;

const DEFAULT_CAPTAIN_SBT_CONTRACT_ADDRESS =
  "0xeEf5dCD159E164CF75Cd245644f07Bc052F998ac" as `0x${string}`;

export const CAPTAIN_SBT_CONTRACT_ADDRESS = (process.env
  .NEXT_PUBLIC_CAPTAIN_SBT_CONTRACT_ADDRESS || DEFAULT_CAPTAIN_SBT_CONTRACT_ADDRESS) as `0x${string}`;

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
  {
    type: "function",
    name: "transfer",
    inputs: [
      { type: "address", name: "to" },
      { type: "uint256", name: "amount" },
    ],
    outputs: [{ type: "bool", name: "" }],
    stateMutability: "nonpayable",
  },
] as const;

// SeaBattleV5 ABI — wager state on-chain + per-player solo result + check-in
// + per-account bomb inventory.
export const seaBattleAbi = [
  // ─── V4: per-player result fix (free bot + friend modes) ───
  {
    type: "function",
    name: "recordSoloResult",
    inputs: [
      { type: "address", name: "opponent" },
      { type: "bool", name: "isWin" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // ─── V4: daily check-in ───
  {
    type: "function",
    name: "checkin",
    inputs: [],
    outputs: [],
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
  {
    type: "function",
    name: "cancelWagerGame",
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
  // ─── V5: bomb inventory (per-account) ───
  {
    type: "function",
    name: "buyBomb",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "BOMB_PRICE",
    inputs: [],
    outputs: [{ type: "uint256", name: "" }],
    stateMutability: "view",
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
      { type: "bool", name: "cancelled" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "playerBombs",
    inputs: [{ type: "address", name: "player" }],
    outputs: [{ type: "uint256", name: "" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "bombs",
    inputs: [{ type: "address", name: "" }],
    outputs: [{ type: "uint256", name: "" }],
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
      { type: "address", name: "player", indexed: true },
      { type: "uint256", name: "newBalance", indexed: false },
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
  {
    type: "event",
    name: "GameCancelled",
    inputs: [
      { type: "uint256", name: "gameId", indexed: true },
      { type: "address", name: "player1", indexed: false },
      { type: "uint256", name: "refund", indexed: false },
    ],
  },
  // ─── V4 events ───
  {
    type: "event",
    name: "SoloResult",
    inputs: [
      { type: "address", name: "player", indexed: true },
      { type: "address", name: "opponent", indexed: false },
      { type: "bool", name: "isWin", indexed: false },
      { type: "uint256", name: "timestamp", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Checkin",
    inputs: [
      { type: "address", name: "player", indexed: true },
      { type: "uint256", name: "timestamp", indexed: false },
    ],
  },
] as const;

export const captainSbtAbi = [
  {
    type: "function",
    name: "mint",
    inputs: [
      { type: "uint256", name: "deadline" },
      { type: "bytes", name: "signature" },
    ],
    outputs: [{ type: "uint256", name: "tokenId" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ type: "address", name: "owner" }],
    outputs: [{ type: "uint256", name: "" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "tokenOfOwner",
    inputs: [{ type: "address", name: "" }],
    outputs: [{ type: "uint256", name: "" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "nonces",
    inputs: [{ type: "address", name: "" }],
    outputs: [{ type: "uint256", name: "" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalSupply",
    inputs: [],
    outputs: [{ type: "uint256", name: "" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "MAX_SUPPLY",
    inputs: [],
    outputs: [{ type: "uint256", name: "" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "signer",
    inputs: [],
    outputs: [{ type: "address", name: "" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "SoulboundMinted",
    inputs: [
      { type: "address", name: "to", indexed: true },
      { type: "uint256", name: "tokenId", indexed: true },
    ],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { type: "address", name: "from", indexed: true },
      { type: "address", name: "to", indexed: true },
      { type: "uint256", name: "tokenId", indexed: true },
    ],
  },
] as const;
