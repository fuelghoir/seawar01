# Sea Battle V6 and Fleet Pass deploy

V6 keeps seasonal USDC payouts in the existing `SignatureDropClaim` contract.
It does not deploy a second reward distributor.

## What changes

- `SeaBattleV6`: custom wager amounts, bombs, and a reward-vault split.
- `FleetPassNFT`: transferable ERC-721 fleet NFTs with burn-and-mint upgrades.
- 80% of platform revenue from wager commission, bombs, and NFT purchases goes
  to `NEXT_PUBLIC_DROP_CLAIM_CONTRACT_ADDRESS`.
- Wager commission stays 10% of the full pot: 8% goes to rewards and 2% goes
  to the owner.

## Before deploy

1. Run `scripts/supabase-v6-fleet-nft.sql` in Supabase SQL Editor.
2. Upload `public/nft/fleet-tier-1.png`, `fleet-tier-2.png`, and
   `fleet-tier-3.png` to your permanent asset host or IPFS.
3. Generate metadata:

```bash
FLEET_NFT_IMAGE_BASE_URI=ipfs://IMAGE_CID/ node scripts/generate-fleet-nft-metadata.mjs
```

4. Upload `metadata/fleet-pass/*.json`, then set:

```bash
FLEET_NFT_BASE_URI=ipfs://METADATA_CID/
```

## Deploy

```bash
node scripts/deploy-v6.mjs
node scripts/deploy-fleet-pass-nft.mjs
```

Both scripts use the already deployed seasonal reward vault from
`NEXT_PUBLIC_DROP_CLAIM_CONTRACT_ADDRESS`.

If the reward-vault signer is intentionally rotated, run
`node scripts/update-drop-signer.mjs` separately before the deploy.

## Seed the pool

Fund the existing reward vault with the initial `50 USDC`. You can send USDC
directly to `NEXT_PUBLIC_DROP_CLAIM_CONTRACT_ADDRESS`, or approve the V6 game
contract and call:

```text
fundSeasonRewards(50000000)
```

The shop reads the live USDC balance of the existing reward vault. Existing
season reward campaigns continue to be created and claimed through the current
drop allocation flow.

## Migration note

Do not switch `NEXT_PUBLIC_SEABATTLE_CONTRACT_ADDRESS` while active V5 wager
rooms are open. Finish or refund them first because wager escrow stays in the
contract where the room was created.
