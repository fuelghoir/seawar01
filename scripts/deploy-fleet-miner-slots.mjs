/**
 * Deploy FleetMinerSlots to Base Mainnet.
 *
 * This script does not run as part of the app build. Execute it explicitly after
 * auditing the constructor addresses and funding the deployer with Base ETH.
 */
import fs from "node:fs";
import path from "node:path";
import solc from "solc";
import { createPublicClient, createWalletClient, getAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const rootDir = path.resolve(import.meta.dirname, "..");
const envPath = path.join(rootDir, ".env");
loadEnv(envPath);

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DEFAULT_TREASURY = "0xA4Df87d8940ac70aC8A33DB79bb1057238B490e4";

const privateKey = requiredEnv("DEPLOYER_PRIVATE_KEY");
const legacyFleet = getAddress(requiredEnv("NEXT_PUBLIC_FLEET_NFT_CONTRACT_ADDRESS"));
const rewardVault = getAddress(
  process.env.FLEET_MINER_REWARD_VAULT_ADDRESS
    || requiredEnv("NEXT_PUBLIC_DROP_CLAIM_CONTRACT_ADDRESS"),
);
const treasury = getAddress(process.env.FLEET_MINER_TREASURY_ADDRESS || DEFAULT_TREASURY);
const discountSignerKey = process.env.DISCOUNT_SIGNER_PRIVATE_KEY || privateKey;
const signer = getAddress(
  process.env.FLEET_MINER_DISCOUNT_SIGNER_ADDRESS
    || privateKeyToAccount(normalizePrivateKey(discountSignerKey)).address,
);
const rpcUrl = process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org";

const source = fs.readFileSync(
  path.join(rootDir, "contracts", "FleetMinerSlots.sol"),
  "utf8",
);
const { abi, bytecode } = compile(source);
const account = privateKeyToAccount(
  normalizePrivateKey(privateKey),
);
const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });

console.log(`Deploying FleetMinerSlots from ${account.address}`);
console.log(`Legacy FleetPass: ${legacyFleet}`);
console.log(`Reward vault (80%): ${rewardVault}`);
console.log(`Treasury (20%): ${treasury}`);
console.log(`Discount signer: ${signer}`);

const hash = await walletClient.deployContract({
  abi,
  bytecode,
  args: [USDC_ADDRESS, legacyFleet, rewardVault, treasury, signer],
});
console.log(`Transaction: https://basescan.org/tx/${hash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success" || !receipt.contractAddress) {
  throw new Error("FleetMinerSlots deployment failed");
}

const contractAddress = getAddress(receipt.contractAddress);
writeEnv("NEXT_PUBLIC_FLEET_MINER_SLOTS_ADDRESS", contractAddress);
writeAddressFallback(contractAddress);
console.log(`FleetMinerSlots: ${contractAddress}`);
console.log("Saved NEXT_PUBLIC_FLEET_MINER_SLOTS_ADDRESS to .env");
console.log("Updated the hardcoded production fallback in fleetMinerSlotsAbi.ts");

function compile(contractSource) {
  const input = {
    language: "Solidity",
    sources: { "FleetMinerSlots.sol": { content: contractSource } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors ?? []).filter((entry) => entry.severity === "error");
  if (errors.length > 0) {
    throw new Error(errors.map((entry) => entry.formattedMessage).join("\n"));
  }
  const compiled = output.contracts?.["FleetMinerSlots.sol"]?.FleetMinerSlots;
  if (!compiled?.evm?.bytecode?.object) throw new Error("Solidity compilation failed");
  return { abi: compiled.abi, bytecode: `0x${compiled.evm.bytecode.object}` };
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} in .env`);
  return value;
}

function normalizePrivateKey(value) {
  return value.startsWith("0x") ? value : `0x${value}`;
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
  const pattern = new RegExp(`^${key}=.*$`, "m");
  content = pattern.test(content)
    ? content.replace(pattern, `${key}=${value}`)
    : `${content.trimEnd()}\n${key}=${value}\n`;
  fs.writeFileSync(envPath, content);
}

function writeAddressFallback(address) {
  const abiModule = path.join(rootDir, "app", "contracts", "fleetMinerSlotsAbi.ts");
  const content = fs.readFileSync(abiModule, "utf8");
  const pattern = /const DEFAULT_FLEET_MINER_SLOTS_CONTRACT_ADDRESS\s*=\s*(?:ZERO_ADDRESS|"0x[a-fA-F0-9]{40}" as const);/;
  if (!pattern.test(content)) {
    throw new Error("Could not locate FleetMinerSlots production fallback");
  }
  fs.writeFileSync(
    abiModule,
    content.replace(
      pattern,
      `const DEFAULT_FLEET_MINER_SLOTS_CONTRACT_ADDRESS = "${address}" as const;`,
    ),
  );
}
