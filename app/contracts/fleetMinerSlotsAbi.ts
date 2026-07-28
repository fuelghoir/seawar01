const DEFAULT_FLEET_MINER_SLOTS_CONTRACT_ADDRESS = "0x3994f95D86CA11Fb698b846F3788E3dBb115aaDc" as const;

export const FLEET_MINER_SLOTS_CONTRACT_ADDRESS = (process.env
  .NEXT_PUBLIC_FLEET_MINER_SLOTS_ADDRESS
  || DEFAULT_FLEET_MINER_SLOTS_CONTRACT_ADDRESS) as `0x${string}`;

export const FLEET_MINER_DISCOUNT_DOMAIN = {
  name: "Sea Battle Fleet Miner Slots",
  version: "1",
} as const;

export const FLEET_MINER_DISCOUNT_TYPES = {
  Discount: [
    { name: "player", type: "address" },
    { name: "slot", type: "uint8" },
    { name: "action", type: "uint8" },
    { name: "fullPrice", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const FLEET_MINER_DISCOUNT_ACTION = {
  buy: 1,
  upgrade: 2,
  max: 3,
  buyMax: 4,
} as const;

const minerStateComponents = [
  { name: "slot", type: "uint8" },
  { name: "minerNumber", type: "uint8" },
  { name: "owned", type: "bool" },
  { name: "unlocked", type: "bool" },
  { name: "tier", type: "uint8" },
  { name: "level", type: "uint8" },
  { name: "pointsPerHour", type: "uint256" },
  { name: "claimablePoints", type: "uint256" },
  { name: "nextPrice", type: "uint256" },
  { name: "maxUpgradePrice", type: "uint256" },
  { name: "maxed", type: "bool" },
] as const;

export const fleetMinerSlotsAbi = [
  {
    type: "function",
    name: "buyMiner",
    inputs: [{ name: "slot", type: "uint8" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "buyMinerWithDiscount",
    inputs: [
      { name: "slot", type: "uint8" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "buyMinerToMax",
    inputs: [{ name: "slot", type: "uint8" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "buyMinerToMaxWithDiscount",
    inputs: [
      { name: "slot", type: "uint8" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "upgradeMiner",
    inputs: [{ name: "slot", type: "uint8" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "upgradeMinerWithDiscount",
    inputs: [
      { name: "slot", type: "uint8" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "upgradeMinerToMax",
    inputs: [{ name: "slot", type: "uint8" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "upgradeMinerToMaxWithDiscount",
    inputs: [
      { name: "slot", type: "uint8" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claimPassivePoints",
    inputs: [{ name: "slot", type: "uint8" }],
    outputs: [{ name: "points", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claimAllPassivePoints",
    inputs: [],
    outputs: [{ name: "points", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "minerStateOf",
    inputs: [
      { name: "player", type: "address" },
      { name: "slot", type: "uint8" },
    ],
    outputs: [{ name: "state", type: "tuple", components: minerStateComponents }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allMinerStatesOf",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ name: "states", type: "tuple[9]", components: minerStateComponents }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isSlotUnlocked",
    inputs: [
      { name: "player", type: "address" },
      { name: "slot", type: "uint8" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "legacyMinerMaxed",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "legacyTokenBoundTo",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "maxUpgradePriceOf",
    inputs: [
      { name: "player", type: "address" },
      { name: "slot", type: "uint8" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "fullMinerPrice",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "pure",
  },
  {
    type: "function",
    name: "totalClaimablePoints",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ name: "points", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalPointsPerHour",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ name: "pointsPerHour", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "discountNonces",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "discountDigest",
    inputs: [
      { name: "player", type: "address" },
      { name: "slot", type: "uint8" },
      { name: "action", type: "uint8" },
      { name: "fullPrice", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "domainSeparator",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "purchasesPaused",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "rewardVault",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "treasury",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "signerAddress",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "restoreMiner",
    inputs: [
      { name: "player", type: "address" },
      { name: "slot", type: "uint8" },
      { name: "tier", type: "uint8" },
      { name: "level", type: "uint8" },
      { name: "accruedFrom", type: "uint64" },
      { name: "bankedPoints", type: "uint256" },
      { name: "pointSecondRemainder", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setPurchasesPaused",
    inputs: [{ name: "paused", type: "bool" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setRewardVault",
    inputs: [{ name: "nextRewardVault", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setTreasury",
    inputs: [{ name: "nextTreasury", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setSignerAddress",
    inputs: [{ name: "nextSigner", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "MinerBought",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "slot", type: "uint8", indexed: true },
      { name: "tier", type: "uint8", indexed: false },
      { name: "level", type: "uint8", indexed: false },
      { name: "paidAmount", type: "uint256", indexed: false },
      { name: "discounted", type: "bool", indexed: false },
    ],
  },
  {
    type: "event",
    name: "MinerUpgraded",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "slot", type: "uint8", indexed: true },
      { name: "previousTier", type: "uint8", indexed: false },
      { name: "previousLevel", type: "uint8", indexed: false },
      { name: "tier", type: "uint8", indexed: false },
      { name: "level", type: "uint8", indexed: false },
      { name: "paidAmount", type: "uint256", indexed: false },
      { name: "discounted", type: "bool", indexed: false },
    ],
  },
  {
    type: "event",
    name: "MinerRestored",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "slot", type: "uint8", indexed: true },
      { name: "tier", type: "uint8", indexed: false },
      { name: "level", type: "uint8", indexed: false },
      { name: "accruedFrom", type: "uint64", indexed: false },
      { name: "bankedPoints", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PassivePointsClaimed",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "slot", type: "uint8", indexed: true },
      { name: "points", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AllPassivePointsClaimed",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "points", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RevenueCollected",
    inputs: [
      { name: "payer", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "rewardShare", type: "uint256", indexed: false },
      { name: "treasuryShare", type: "uint256", indexed: false },
    ],
  },
] as const;
