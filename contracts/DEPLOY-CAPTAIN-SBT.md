# Captain SBT deploy

`CaptainSBT` is a separate soulbound NFT contract. It does not replace or
modify the current `SeaBattleV5` wager contract, so wager games and prize claims
keep using the existing `NEXT_PUBLIC_SEABATTLE_CONTRACT_ADDRESS`.

## Environment

Required before deploy:

```env
DEPLOYER_PRIVATE_KEY=...
```

Optional before deploy:

```env
CAPTAIN_SBT_SIGNER_ADDRESS=0x...      # defaults to deployer
CAPTAIN_SBT_BASE_URI=https://.../     # tokenURI = baseURI + tokenId
```

Required for app mint signatures after deploy:

```env
CAPTAIN_SBT_SIGNER_PRIVATE_KEY=...    # must match the on-chain signer
NEXT_PUBLIC_CAPTAIN_SBT_CONTRACT_ADDRESS=0x...
```

Required for weekly `+10,000 pts` claims:

```env
SUPABASE_SERVICE_ROLE_KEY=...
```

## Deploy

```bash
node scripts/deploy-captain-sbt.mjs
```

The script compiles `contracts/CaptainSBT.sol`, writes
`contracts/CaptainSBT.abi.json`, deploys to Base mainnet, then writes
`NEXT_PUBLIC_CAPTAIN_SBT_CONTRACT_ADDRESS` into `.env`.

## Supabase

Run this once in Supabase SQL Editor if it has not been applied yet:

```sql
-- scripts/supabase-limited-sbt.sql
```

The app uses it for win progress and weekly reward history. The actual SBT
ownership check for mint/weekly rewards is on-chain.
