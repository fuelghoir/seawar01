/**
 * Deploy SeaBattleV6.sol to Base Mainnet.
 *
 * Usage:
 *   node scripts/deploy-v6.mjs
 *
 * Requires DEPLOYER_PRIVATE_KEY and NEXT_PUBLIC_DROP_CLAIM_CONTRACT_ADDRESS in .env.
 */

import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import solc from "solc";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
const CONTRACT_NAME = "SeaBattleV6";
const CONTRACT_FILE = `${CONTRACT_NAME}.sol`;
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

loadEnv(envPath);
const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
const rewardVault = process.env.NEXT_PUBLIC_DROP_CLAIM_CONTRACT_ADDRESS;
if (!privateKey || !rewardVault) {
  console.error("Set DEPLOYER_PRIVATE_KEY and NEXT_PUBLIC_DROP_CLAIM_CONTRACT_ADDRESS in .env");
  process.exit(1);
}

const account = privateKeyToAccount(privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`);
const { abi, bytecode } = compile(CONTRACT_FILE, CONTRACT_NAME);
const rpcUrl = process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org";
const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });

console.log(`Deploying ${CONTRACT_NAME} from ${account.address}`);
console.log(`Season reward vault: ${rewardVault}`);
const hash = await walletClient.deployContract({
  abi,
  bytecode,
  args: [USDC_ADDRESS, rewardVault],
});
console.log(`Transaction: https://basescan.org/tx/${hash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (!receipt.contractAddress) throw new Error("Deploy failed: no contract address");

writeEnv("NEXT_PUBLIC_SEABATTLE_CONTRACT_ADDRESS", receipt.contractAddress);
console.log(`${CONTRACT_NAME}: ${receipt.contractAddress}`);

function compile(file, name) {
  const source = fs.readFileSync(path.join(__dirname, "..", "contracts", file), "utf8");
  const input = {
    language: "Solidity",
    sources: { [file]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter((entry) => entry.severity === "error");
  if (errors.length) throw new Error(errors.map((entry) => entry.formattedMessage).join("\n"));
  const compiled = output.contracts[file][name];
  fs.writeFileSync(path.join(__dirname, "..", "contracts", `${name}.abi.json`), JSON.stringify(compiled.abi, null, 2));
  return { abi: compiled.abi, bytecode: `0x${compiled.evm.bytecode.object}` };
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = /^([^#=]+)=(.*)$/.exec(line.trim());
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

function writeEnv(key, value) {
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  content = content.match(new RegExp(`^${key}=`, "m"))
    ? content.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`)
    : `${content.trimEnd()}\n${key}=${value}\n`;
  fs.writeFileSync(envPath, content);
}
