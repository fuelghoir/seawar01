const { createPublicClient, http } = require('viem');
const { base } = require('viem/chains');

const client = createPublicClient({
  chain: base,
  transport: http('https://mainnet.base.org')
});

const FLEET_ADDR = '0xc1d76b124bc8f819f9c727caa277aaec72412923';

const abi = [
  { type: 'function', name: 'owner', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'rewardVault', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' }
];

async function main() {
  const owner = await client.readContract({ address: FLEET_ADDR, abi, functionName: 'owner' });
  const rewardVault = await client.readContract({ address: FLEET_ADDR, abi, functionName: 'rewardVault' });

  console.log("=== FLEET PASS CONTRACT ON-CHAIN ADDRESSES ===");
  console.log(`- Contract Address: ${FLEET_ADDR}`);
  console.log(`- Owner (20% Treasury): ${owner}`);
  console.log(`- Reward Vault (80% Prize Pool): ${rewardVault}`);
}

main().catch(console.error);
