/**
 * Deploy CaptainSBT.sol to Base Mainnet.
 *
 * Usage:
 *   node scripts/deploy-captain-sbt.mjs
 *
 * Requires DEPLOYER_PRIVATE_KEY in .env.
 * Optional:
 *   CAPTAIN_SBT_SIGNER_ADDRESS=0x...      // defaults to deployer
 *   CAPTAIN_SBT_BASE_URI=https://.../     // tokenURI = baseURI + tokenId
 */

import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import solc from "solc";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_NAME = "CaptainSBT";
const CONTRACT_FILE = `${CONTRACT_NAME}.sol`;

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

const account = privateKeyToAccount(PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`);
const signerAddress = process.env.CAPTAIN_SBT_SIGNER_ADDRESS || account.address;
const baseURI = process.env.CAPTAIN_SBT_BASE_URI || "";

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
  output.errors.forEach((e) => console.warn(e.formattedMessage));
}

const compiled = output.contracts[CONTRACT_FILE][CONTRACT_NAME];
const abi = compiled.abi;
const bytecode = `0x${compiled.evm.bytecode.object}`;

const abiOut = path.join(__dirname, "..", "contracts", `${CONTRACT_NAME}.abi.json`);
fs.writeFileSync(abiOut, JSON.stringify(abi, null, 2));
console.log(`ABI written to ${abiOut}`);

const publicClient = createPublicClient({ chain: base, transport: http() });
const walletClient = createWalletClient({ account, chain: base, transport: http() });

console.log(`Deploying from: ${account.address}`);
console.log(`Mint signer: ${signerAddress}`);
console.log(`Base URI: ${baseURI || "(empty)"}`);

const balance = await publicClient.getBalance({ address: account.address });
console.log(`Balance: ${Number(balance) / 1e18} ETH`);

if (balance === 0n) {
  console.error("Error: No ETH on Base. Need ETH for gas.");
  process.exit(1);
}

const hash = await walletClient.deployContract({
  abi,
  bytecode,
  args: [signerAddress, baseURI],
});

console.log(`Transaction: https://basescan.org/tx/${hash}`);
console.log("Waiting for confirmation...");

const receipt = await publicClient.waitForTransactionReceipt({ hash });

if (!receipt.contractAddress) {
  console.error("Deploy failed: no contract address in receipt.");
  process.exit(1);
}

console.log("");
console.log("=".repeat(60));
console.log(`CAPTAIN SBT DEPLOYED: ${receipt.contractAddress}`);
console.log("=".repeat(60));
console.log("");

let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
if (envContent.includes("NEXT_PUBLIC_CAPTAIN_SBT_CONTRACT_ADDRESS")) {
  envContent = envContent.replace(
    /NEXT_PUBLIC_CAPTAIN_SBT_CONTRACT_ADDRESS=.*/,
    `NEXT_PUBLIC_CAPTAIN_SBT_CONTRACT_ADDRESS=${receipt.contractAddress}`
  );
} else {
  envContent += `\nNEXT_PUBLIC_CAPTAIN_SBT_CONTRACT_ADDRESS=${receipt.contractAddress}\n`;
}

if (!envContent.includes("CAPTAIN_SBT_SIGNER_PRIVATE_KEY")) {
  envContent += "\n# Private key used by /api/captain-sbt/sign. Must match contract signer.\n";
  envContent += "# CAPTAIN_SBT_SIGNER_PRIVATE_KEY=\n";
}

fs.writeFileSync(envPath, envContent);
console.log(".env updated with NEXT_PUBLIC_CAPTAIN_SBT_CONTRACT_ADDRESS.");
