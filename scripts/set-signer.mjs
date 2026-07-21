import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
loadEnv(envPath);

const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
const signerKey = process.env.DISCOUNT_SIGNER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
const contractAddress = process.env.NEXT_PUBLIC_FLEET_NFT_CONTRACT_ADDRESS;

if (!privateKey || !signerKey || !contractAddress) {
  console.error("Missing env vars");
  process.exit(1);
}

const account = privateKeyToAccount(privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`);
const signerAccount = privateKeyToAccount(signerKey.startsWith("0x") ? signerKey : `0x${signerKey}`);

const rpcUrl = process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org";
const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });

console.log(`Setting signer to ${signerAccount.address} on ${contractAddress}...`);

const abi = [{"inputs":[{"internalType":"address","name":"nextSigner","type":"address"}],"name":"setSignerAddress","outputs":[],"stateMutability":"nonpayable","type":"function"}];

const hash = await walletClient.writeContract({
  address: contractAddress,
  abi,
  functionName: "setSignerAddress",
  args: [signerAccount.address],
});

console.log(`Transaction: https://basescan.org/tx/${hash}`);
await publicClient.waitForTransactionReceipt({ hash });
console.log("Done!");

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = /^([^#=]+)=(.*)$/.exec(line.trim());
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}
