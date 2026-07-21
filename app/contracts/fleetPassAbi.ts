const DEFAULT_FLEET_NFT_CONTRACT_ADDRESS =
  "0xe8ea934c519917832bff6fb82e96c95463497053" as `0x${string}`;

export const FLEET_NFT_CONTRACT_ADDRESS = (process.env
  .NEXT_PUBLIC_FLEET_NFT_CONTRACT_ADDRESS || DEFAULT_FLEET_NFT_CONTRACT_ADDRESS) as `0x${string}`;

export const fleetPassAbi = [
  {
    type: "function",
    name: "buyFleetNft",
    inputs: [],
    outputs: [{ type: "uint256", name: "tokenId" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "upgradeFleetNft",
    inputs: [],
    outputs: [{ type: "uint256", name: "tokenId" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "buyFleetNftWithDiscount",
    inputs: [{ type: "bytes", name: "signature" }],
    outputs: [{ type: "uint256", name: "tokenId" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "upgradeToMaxLevel",
    inputs: [],
    outputs: [{ type: "uint256", name: "tokenId" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claimPassivePoints",
    inputs: [],
    outputs: [{ type: "uint256", name: "points" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "fleetStateOf",
    inputs: [{ type: "address", name: "player" }],
    outputs: [
      { type: "uint256", name: "tokenId" },
      { type: "uint8", name: "tier" },
      { type: "uint8", name: "level" },
      { type: "uint256", name: "pointsPerHour" },
      { type: "uint256", name: "claimablePoints" },
      { type: "uint256", name: "nextPrice" },
      { type: "bool", name: "maxed" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "activeTokenOf",
    inputs: [{ type: "address", name: "" }],
    outputs: [{ type: "uint256", name: "" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "rewardVault",
    inputs: [],
    outputs: [{ type: "address", name: "" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "seasonFundingTotal",
    inputs: [],
    outputs: [{ type: "uint256", name: "" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "FleetMinted",
    inputs: [
      { type: "address", name: "player", indexed: true },
      { type: "uint256", name: "tokenId", indexed: true },
      { type: "uint8", name: "tier", indexed: false },
      { type: "uint8", name: "level", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PassivePointsClaimed",
    inputs: [
      { type: "address", name: "player", indexed: true },
      { type: "uint256", name: "tokenId", indexed: true },
      { type: "uint256", name: "points", indexed: false },
    ],
  },
  {
    type: "event",
    name: "FleetEvolved",
    inputs: [
      { type: "address", name: "player", indexed: true },
      { type: "uint256", name: "previousTokenId", indexed: true },
      { type: "uint256", name: "tokenId", indexed: true },
      { type: "uint8", name: "tier", indexed: false },
      { type: "uint8", name: "level", indexed: false },
    ],
  },
] as const;
