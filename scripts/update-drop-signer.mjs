/**
 * Update the signer used by the existing SignatureDropClaim reward vault.
 *
 * Usage:
 *   node scripts/update-drop-signer.mjs
 *
 * Requires DEPLOYER_PRIVATE_KEY, DROP_CLAIM_SIGNER_ADDRESS, and
 * NEXT_PUBLIC_DROP_CLAIM_CONTRACT_ADDRESS in .env.
 */

import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(__dirname, "..", ".env"));

const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
const rewardVault = process.env.NEXT_PUBLIC_DROP_CLAIM_CONTRACT_ADDRESS;
const nextSigner = process.env.DROP_CLAIM_SIGNER_ADDRESS;
if (!privateKey || !rewardVault || !nextSigner) {
  console.error(
    "Set DEPLOYER_PRIVATE_KEY, DROP_CLAIM_SIGNER_ADDRESS, and NEXT_PUBLIC_DROP_CLAIM_CONTRACT_ADDRESS in .env",
  );
  process.exit(1);
}

const account = privateKeyToAccount(privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`);
const rpcUrl = process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org";
const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });
const abi = [
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [{ type: "address", name: "" }],
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
    type: "function",
    name: "setSigner",
    inputs: [{ type: "address", name: "nextSigner" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
];

const [owner, currentSigner] = await Promise.all([
  publicClient.readContract({ address: rewardVault, abi, functionName: "owner" }),
  publicClient.readContract({ address: rewardVault, abi, functionName: "signer" }),
]);
if (owner.toLowerCase() !== account.address.toLowerCase()) {
  throw new Error(`Deployer ${account.address} is not reward-vault owner ${owner}`);
}
if (currentSigner.toLowerCase() === nextSigner.toLowerCase()) {
  console.log(`Reward-vault signer already set: ${nextSigner}`);
  process.exit(0);
}

console.log(`Reward vault: ${rewardVault}`);
console.log(`Current signer: ${currentSigner}`);
console.log(`Next signer: ${nextSigner}`);
const hash = await walletClient.writeContract({
  address: rewardVault,
  abi,
  functionName: "setSigner",
  args: [nextSigner],
});
console.log(`Transaction: https://basescan.org/tx/${hash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error("Signer update reverted");

const verifiedSigner = await publicClient.readContract({
  address: rewardVault,
  abi,
  functionName: "signer",
});
if (verifiedSigner.toLowerCase() !== nextSigner.toLowerCase()) {
  throw new Error(`Signer verification failed: ${verifiedSigner}`);
}
console.log(`Reward-vault signer updated: ${verifiedSigner}`);

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = /^([^#=]+)=(.*)$/.exec(line.trim());
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}
