export const DROP_CLAIM_CONTRACT_ADDRESS = (process.env
  .NEXT_PUBLIC_DROP_CLAIM_CONTRACT_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`;

export const dropClaimAbi = [
  {
    type: "function",
    name: "claim",
    inputs: [
      { type: "bytes32", name: "dropId" },
      { type: "address", name: "token" },
      { type: "uint256", name: "amount" },
      { type: "uint256", name: "deadline" },
      { type: "bytes", name: "signature" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claimed",
    inputs: [
      { type: "bytes32", name: "" },
      { type: "address", name: "" },
    ],
    outputs: [{ type: "bool", name: "" }],
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
    name: "Claimed",
    inputs: [
      { type: "bytes32", name: "dropId", indexed: true },
      { type: "address", name: "account", indexed: true },
      { type: "address", name: "token", indexed: true },
      { type: "uint256", name: "amount", indexed: false },
    ],
  },
] as const;
