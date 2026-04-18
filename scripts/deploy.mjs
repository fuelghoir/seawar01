/**
 * Deploy SeaBattleV3.sol to Base Mainnet
 *
 * Usage:
 *   node scripts/deploy.mjs
 *
 * Requires DEPLOYER_PRIVATE_KEY in .env (with ETH on Base for gas)
 */

import { createWalletClient, createPublicClient, http, encodeDeployData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import solc from "solc";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONTRACT_NAME = "SeaBattleV3";
const CONTRACT_FILE = `${CONTRACT_NAME}.sol`;
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // Base mainnet USDC

// Load .env manually
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    process.env[key] = value;
  }
}

const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error("Error: Set DEPLOYER_PRIVATE_KEY in .env");
  process.exit(1);
}

// Compile contract
console.log(`Compiling ${CONTRACT_FILE}...`);
const contractPath = path.join(__dirname, "..", "contracts", CONTRACT_FILE);
const source = fs.readFileSync(contractPath, "utf-8");

const input = {
  language: "Solidity",
  sources: { [CONTRACT_FILE]: { content: source } },
  settings: {
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    optimizer: { enabled: true, runs: 200 },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

if (output.errors) {
  const errors = output.errors.filter((e) => e.severity === "error");
  if (errors.length > 0) {
    console.error("Compilation errors:");
    errors.forEach((e) => console.error(e.formattedMessage));
    process.exit(1);
  }
  // Non-fatal warnings
  output.errors.forEach((e) => console.warn(e.formattedMessage));
}

const compiled = output.contracts[CONTRACT_FILE][CONTRACT_NAME];
const abi = compiled.abi;
const bytecode = `0x${compiled.evm.bytecode.object}`;

console.log("Compiled successfully.");

// Write ABI JSON for reference
const abiOut = path.join(__dirname, "..", "contracts", `${CONTRACT_NAME}.abi.json`);
fs.writeFileSync(abiOut, JSON.stringify(abi, null, 2));
console.log(`ABI written to ${abiOut}`);

// Deploy
const account = privateKeyToAccount(PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`);

const publicClient = createPublicClient({ chain: base, transport: http() });
const walletClient = createWalletClient({ account, chain: base, transport: http() });

console.log(`Deploying from: ${account.address}`);
console.log(`USDC constructor arg: ${USDC_ADDRESS}`);

const balance = await publicClient.getBalance({ address: account.address });
console.log(`Balance: ${Number(balance) / 1e18} ETH`);

if (balance === 0n) {
  console.error("Error: No ETH on Base. Need ETH for gas.");
  process.exit(1);
}

console.log("Sending deploy transaction...");
const hash = await walletClient.deployContract({
  abi,
  bytecode,
  args: [USDC_ADDRESS],
});

console.log(`Transaction: https://basescan.org/tx/${hash}`);
console.log("Waiting for confirmation...");

const receipt = await publicClient.waitForTransactionReceipt({ hash });

if (!receipt.contractAddress) {
  console.error("Deploy failed — no contract address in receipt.");
  process.exit(1);
}

console.log("");
console.log("=".repeat(60));
console.log(`CONTRACT DEPLOYED: ${receipt.contractAddress}`);
console.log("=".repeat(60));
console.log("");

// Auto-write to .env
let envContent = "";
if (fs.existsSync(envPath)) {
  envContent = fs.readFileSync(envPath, "utf-8");
}

if (envContent.includes("NEXT_PUBLIC_SEABATTLE_CONTRACT_ADDRESS")) {
  envContent = envContent.replace(
    /NEXT_PUBLIC_SEABATTLE_CONTRACT_ADDRESS=.*/,
    `NEXT_PUBLIC_SEABATTLE_CONTRACT_ADDRESS=${receipt.contractAddress}`
  );
} else {
  envContent += `\nNEXT_PUBLIC_SEABATTLE_CONTRACT_ADDRESS=${receipt.contractAddress}\n`;
}

fs.writeFileSync(envPath, envContent);
console.log(".env updated. Remember to update Vercel env var + seaBattleAbi.ts ABI + redeploy.");
