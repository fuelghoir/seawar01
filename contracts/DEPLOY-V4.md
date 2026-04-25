# SeaBattleV4 deploy instructions

V4 is the on-chain backend for the new 3-mode design (Bot, Friend, Wager).

## What V4 changes vs V3

| Area | V3 | V4 |
|------|----|-----|
| Free PvP (createGame/joinGame) | yes | **removed** — friend mode is fully off-chain |
| Bot create (createBotGame) | yes | **removed** — bot mode is fully off-chain |
| Wager (createWagerGame, joinWagerGame, claimPrize, buyBomb, cancelWagerGame) | yes | **kept identical** |
| recordResult(gameId, winner) | any game type | **wager-only** — needed for prize claim |
| recordSoloResult(opponent, isWin) | — | **new** — each player records their own bot/friend result independently. Pure event emit, no shared state, no revert when both players call. |
| checkin() | — | **new** — daily check-in via contract call so Builder Code attribution shows up under "Other" on base.dev for both PC wallets and Base App miniapp. |
| Events | GameCreated, PlayerJoined, GameFinished, BombPurchased, PrizeClaimed, GameCancelled | + **SoloResult**, **Checkin** |

## Deploy steps

### Option A — Remix (no toolchain setup)

1. Open <https://remix.ethereum.org/>
2. Create a new file `SeaBattleV4.sol` and paste the contents of [SeaBattleV4.sol](./SeaBattleV4.sol)
3. **Solidity Compiler tab** → version `0.8.25` (or any 0.8.x ≥ 0.8.25), Compile
4. **Deploy & Run tab**:
   - Environment: `Injected Provider — MetaMask` (or your wallet)
   - Make sure your wallet is on **Base Mainnet** (chainId 8453)
   - Constructor arg `_usdc` = `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (Base USDC)
   - Click **Deploy**, confirm in wallet
5. Copy the deployed address — that's your new `NEXT_PUBLIC_SEABATTLE_CONTRACT_ADDRESS`

### Option B — Foundry / Hardhat

```bash
forge create contracts/SeaBattleV4.sol:SeaBattleV4 \
  --rpc-url https://mainnet.base.org \
  --constructor-args 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  --private-key $DEPLOYER_PK
```

## After deploy

1. **Update env vars** (Vercel + local `.env`):
   ```
   NEXT_PUBLIC_SEABATTLE_CONTRACT_ADDRESS=0xYourNewV4Address
   ```
2. **Verify on BaseScan** so the contract is read/writable from explorer:
   - Submit source via `forge verify-contract` or BaseScan UI with the same compiler version
3. **Redeploy frontend** (Vercel rebuilds automatically when env var changes are committed)
4. Trigger one tx of each kind to make sure attribution flows to base.dev "Other":
   - `checkin()` from PC and from Base App
   - `recordSoloResult(opponent, isWin)` from a finished bot game
   - `recordSoloResult(otherPlayer, isWin)` from a finished friend game (each player calls)
   - `createWagerGame` / `joinWagerGame` / `recordResult` / `claimPrize` (existing wager flow)

## In-flight V3 wager games

Any wager games created on V3 with `state ∈ {0, 1, 2}` and not yet finalized
will be **stranded** when the env var flips to V4 — the frontend won't know to
talk to V3 anymore. Before deploying V4:

1. List active V3 wagers in Supabase (`select * from games where game_mode='wager' and state < 3`)
2. Either play them out, or have the creator call `cancelWagerGame` for refund
   (only works if `player2 == address(0)`)
3. Then update the env var

The DB rows for finished V3 games are preserved either way — V4 just doesn't
create new V3-keyed rows.
