# Sea Battle Technical Security Brief for Blockaid Review

Date: 2026-06-18  
Project: Sea Battle  
Primary domain: https://seabattle.top  
Legacy domain kept active for existing users: https://seawar01.vercel.app  
Network: Base Mainnet, chain id 8453

## Purpose Of This Document

This document is provided as supporting technical documentation for a Blockaid review after the project was flagged for possible approval-farming behavior. Sea Battle is an onchain Battleship-style game on Base. The application uses USDC approvals only for explicit user-initiated purchases, wager stakes, and challenge entries. It does not request seed phrases, private keys, unlimited USDC approvals, or unrelated token approvals.

This is an internal technical security brief, not a third-party audit report.

## Public Contracts

| Component | Address | BaseScan |
| --- | --- | --- |
| SeaBattle V7 gameplay / wager contract | `0x8de75fbc38b1e47e53fb2e85791c935f5f653aa6` | https://basescan.org/address/0x8de75fbc38b1e47e53fb2e85791c935f5f653aa6 |
| FleetPass NFT contract | `0xe8ea934c519917832bff6fb82e96c95463497053` | https://basescan.org/address/0xe8ea934c519917832bff6fb82e96c95463497053 |
| SignatureDropClaim reward contract | `0x39016cE335546b6ab9776a1cC78cf210f84f5a5b` | https://basescan.org/address/0x39016cE335546b6ab9776a1cC78cf210f84f5a5b |
| SeaBattle Challenge V1 contract | `0x082d8eaa1fc738d5950e6b751026d3d265866311` | https://basescan.org/address/0x082d8eaa1fc738d5950e6b751026d3d265866311 |
| Legacy Captain SBT contract | `0xeEf5dCD159E164CF75Cd245644f07Bc052F998ac` | https://basescan.org/address/0xeEf5dCD159E164CF75Cd245644f07Bc052F998ac |
| Base USDC token | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | https://basescan.org/address/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 |

## User Transaction Types

### Free Gameplay

Bot games, friend games, daily check-ins, and result recording do not transfer user tokens. These actions emit gameplay events and are often sponsored through Coinbase Developer Platform Paymaster where available.

Relevant functions:

- `checkin()`
- `recordSoloResult(address,bool)`
- `recordResult(uint256,address)`

### USDC Wager Mode

Players can create or join wager games with a chosen USDC stake.

Flow:

1. The user approves the SeaBattle V7 contract for the exact stake amount.
2. The user calls `createWagerGame(uint256)` or `joinWagerGame(uint256)`.
3. The contract pulls exactly the stake amount with `transferFrom`.
4. When the game is finished, the winner calls `claimPrize(uint256)`.
5. The winner receives 90% of the pot.
6. The platform commission is 10% of the pot. 80% of that commission goes to the reward/drop vault, and 20% goes to the owner wallet.

Refund protections:

- If no second player joins, the creator can reclaim their stake after 3 minutes using `cancelWagerGame(uint256)`.
- If both players joined but the game does not complete, each player can independently reclaim only their own stake after 15 minutes using `claimStaleWagerRefund(uint256)`.

### Shop Bomb Purchase

The bomb item costs 2 USDC per item.

Flow:

1. The user approves only `2 USDC * quantity`.
2. The user calls `buyBomb()`.
3. The contract collects exactly the purchase amount.
4. Revenue is split: 80% to the reward vault, 20% to the owner wallet.

No unlimited allowance is requested.

### FleetPass NFT Purchase / Upgrade

FleetPass is a transferable ERC-721 game NFT that passively accrues in-game points.

Flow:

1. The user approves only the exact current purchase or upgrade price.
2. The user calls `buyFleetNft()` or `upgradeFleetNft()`.
3. The contract collects exactly the price through USDC `transferFrom`.
4. Revenue is split: 80% to the reward vault, 20% to the owner wallet.
5. Upgrades burn the previous NFT and mint the next tier/level NFT.

Prices:

- Tier 1 Level 1 purchase: 0.5 USDC
- Tier 1 upgrades: 0.3 USDC each
- Tier 2 transition: 3 USDC
- Tier 2 upgrades: 2 USDC each
- Tier 3 transition: 10 USDC
- Tier 3 upgrades: 5 USDC each

The ERC-721 standard approval functions exist for NFT transfer compatibility, but the application does not use them to pull USDC.

### Async Challenge Mode

Challenge mode lets a creator fund a small challenge board and one challenger pay an entry fee.

Flow:

1. Creator approves only the creator-funded amount and calls `createChallenge(...)`.
2. Challenger approves only the entry fee and calls `joinChallenge(uint256)`.
3. Settlement is signed by the server signer after game validation.
4. 10% of the total pot is sent to the drop vault.
5. Remaining funds become claimable through `claimPayout()`.

This contract stores pending payouts by user address. Users claim only their own available payout.

### Drop Claim / Reward Distribution

The SignatureDropClaim contract distributes funded rewards to eligible users.

Flow:

1. Eligibility is calculated off-chain.
2. The server signs an EIP-712 claim for a specific `dropId`, token, account, amount, and deadline.
3. The user calls `claim(...)`.
4. The contract verifies the signature, marks the account as claimed for that drop, and transfers only the signed amount to the user.

Users do not approve tokens for reward claims.

## Approval Policy

The frontend checks existing allowance before requesting an approval. When an approval is required, it uses the exact amount needed for the current action.

Observed frontend approval calls:

- FleetPass purchase or upgrade: `approve(FLEET_NFT_CONTRACT_ADDRESS, exactActionPrice)`
- Shop bomb purchase: `approve(SEABATTLE_CONTRACT_ADDRESS, BOMB_PRICE * quantity)`
- Wager create/join: `approve(SEABATTLE_CONTRACT_ADDRESS, exactStakeAmount)`
- Challenge create/join: `approve(CHALLENGE_CONTRACT_ADDRESS, creatorAmount or entryFee)`

The application code does not use:

- `MaxUint256`
- `type(uint256).max`
- unlimited approvals
- USDC `permit`
- approvals for unrelated tokens

## Security-Relevant Static Review

Local compilation was performed with the project `solc` dependency and optimizer enabled. Main active contracts compile without errors or warnings:

```text
SeaBattleV7.sol / SeaBattleV7: errors=0, warnings=0, bytecodeBytes=9159
FleetPassNFT.sol / FleetPassNFT: errors=0, warnings=0, bytecodeBytes=9373
SignatureDropClaim.sol / SignatureDropClaim: errors=0, warnings=0, bytecodeBytes=3244
SeaBattleChallengeV1.sol / SeaBattleChallengeV1: errors=0, warnings=0, bytecodeBytes=7898
```

Static observations from the active contracts and app code:

- No `delegatecall`.
- No `selfdestruct`.
- No `tx.origin`.
- No unlimited approval constants found in the app or active contracts.
- No seed phrase or private key request in the frontend.
- Token movement is limited to Base USDC or standard NFT transfers.
- FleetPass purchase and upgrade functions use a non-reentrancy guard.
- Drop claims use signed EIP-712 messages, deadlines, and per-drop claimed state.
- Wager refunds and challenge payouts are self-service and scoped to the participating wallet.
- Admin-only functions can update reward/signing addresses or withdraw funded drop balances, but they cannot pull funds from user wallets.

## Why This May Have Been Flagged

The project recently moved from the Vercel subdomain to `https://seabattle.top`. The app includes legitimate USDC `approve(address,uint256)` calls for game purchases and wager/challenge staking. These approvals may have been heuristically classified as approval-farming, especially because the domain changed while USDC approvals were still part of the app flow.

The important distinction is that Sea Battle approvals are exact-amount approvals tied to visible in-game actions, not broad or hidden approvals.

## Risk Controls

- Exact-amount approvals only.
- Clear user-facing purchase/wager context before token approval.
- No hidden background wallet requests.
- No seed/private key collection.
- Legacy domain remains active to avoid broken redirects for existing users.
- Canonical app domain is now `https://seabattle.top`.
- X OAuth callback and Telegram webhook are configured to the canonical domain.
- Reward-vault funding and fee splits are explicit in contracts.

## Recommended Additional Evidence To Attach

If available, attach:

1. BaseScan verified source-code links for each deployed contract.
2. GitHub repository link or source archive for the contracts and frontend.
3. Screenshots of the UI showing transaction context and exact purchase/stake amounts.
4. Screenshots of wallet simulation showing exact spender and exact USDC amount.
5. This technical brief.

## Review Request

We request that Blockaid re-review `https://seabattle.top` and its associated contracts as a legitimate Base gaming application. The project uses bounded approvals for explicit game actions and does not exhibit malicious approval-farming behavior.

