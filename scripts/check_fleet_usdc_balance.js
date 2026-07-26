const { createPublicClient, http, getAddress } = require('viem');
const { base } = require('viem/chains');

const client = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org')
});

const USDC_ADDR = getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
const FLEET_CONTRACT = getAddress('0xc1d76b124bc8f819f9c727caa277aaec72412923');
const REWARD_VAULT = getAddress('0x39016cE335546b6ab9776a1cC78cf210f84f5a5b');
const OWNER_TREASURY = getAddress('0xa4df87d8940ac70ac8a33db79bb1057238b490e4');

const erc20Abi = [
  { type: 'function', name: 'balanceOf', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }
];

async function main() {
  const fleetBalance = await client.readContract({ address: USDC_ADDR, abi: erc20Abi, functionName: 'balanceOf', args: [FLEET_CONTRACT] });
  const vaultBalance = await client.readContract({ address: USDC_ADDR, abi: erc20Abi, functionName: 'balanceOf', args: [REWARD_VAULT] });
  const ownerBalance = await client.readContract({ address: USDC_ADDR, abi: erc20Abi, functionName: 'balanceOf', args: [OWNER_TREASURY] });

  console.log("=== ON-CHAIN USDC BALANCES ===");
  console.log(`- Fleet Pass Contract (${FLEET_CONTRACT}): $${(Number(fleetBalance)/1e6).toFixed(2)} USDC`);
  console.log(`- Season 2 Reward Vault (${REWARD_VAULT}): $${(Number(vaultBalance)/1e6).toFixed(2)} USDC`);
  console.log(`- Owner Treasury (${OWNER_TREASURY}): $${(Number(ownerBalance)/1e6).toFixed(2)} USDC`);
}

main().catch(console.error);
