# SeaBattleV5 deploy instructions

V5 is a small, surgical upgrade over V4: bombs become a per-account
inventory instead of being bound to a specific wager game.

## What V5 changes vs V4

| Area | V4 | V5 |
|------|----|-----|
| Wager flow (create / join / cancel / record / claim) | yes | **kept identical** |
| `recordSoloResult` / `checkin` | yes | **kept identical** |
| `buyBomb(uint256 gameId)` | yes | **replaced** with `buyBomb()` (no args) |
| `playerHasBomb(uint256 gameId, address)` | yes | **replaced** with `playerBombs(address)` returning `uint256` |
| `bombs(address)` mapping | — | **new** — per-account bomb counter (auto-getter) |
| `BombPurchased(gameId, player)` | yes | **replaced** with `BombPurchased(player, newBalance)` |
| Bomb consumption | none on-chain (DB-only) | none on-chain (DB-only) — game DB tracks usage |
| `BOMB_PRICE` | hard-coded `2_000_000` | exposed as `public constant` |

Everything else (storage layout, prize math, events, owner) is unchanged.

## Bomb model in V5

- **Buy** (Shop): user calls `buyBomb()` with prior `usdc.approve(contract, 2_000_000)`. Contract increments `bombs[msg.sender]` and emits `BombPurchased`.
- **Use** (in-game): purely off-chain. The frontend reads `bombs(player)` from the contract and subtracts the count of finished/active games where the player fired a bomb (tracked in Supabase via `bomb_used_p1` / `bomb_used_p2` columns added by `scripts/supabase-v5-bomb-inventory.sql`).

## Deploy steps

### Option A — Remix (no toolchain setup)

1. Open <https://remix.ethereum.org/>
2. Create `SeaBattleV5.sol` and paste [SeaBattleV5.sol](./SeaBattleV5.sol)
3. **Solidity Compiler tab** → version `0.8.25`, Compile
4. **Deploy & Run tab**:
   - Environment: `Injected Provider — MetaMask` (or your wallet)
   - Network: **Base Mainnet** (chainId 8453)
   - Constructor `_usdc` = `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (Base USDC)
   - Click **Deploy**, confirm
5. Copy the deployed address.

### Option B — Foundry

```bash
forge create contracts/SeaBattleV5.sol:SeaBattleV5 \
  --rpc-url https://mainnet.base.org \
  --constructor-args 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  --private-key $DEPLOYER_PK
```

## After deploy

1. **Run the Supabase migration**:
   ```sql
   -- run scripts/supabase-v5-bomb-inventory.sql in Supabase SQL editor
   ```
   This adds `bomb_used_p1` / `bomb_used_p2` boolean columns to `games`.

2. **Update env vars** (Vercel + local `.env`):
   ```
   NEXT_PUBLIC_SEABATTLE_CONTRACT_ADDRESS=0xYourNewV5Address
   ```

3. **Verify on BaseScan**:
   - Submit source via `forge verify-contract` or BaseScan UI, compiler `0.8.25`.

4. **Smoke-test**:
   - `checkin()` once from PC and once from Base App
   - `buyBomb()` from Shop (UI does approve → buyBomb)
   - Fire the bomb in a wager game; verify the off-chain inventory drops by 1
   - Old wager flow: `createWagerGame` / `joinWagerGame` / `recordResult` / `claimPrize`

## In-flight V4 wager games

Any V4 wager game with `state ∈ {0, 1, 2}` will be **stranded** when the env
var flips to V5. Before deploying V5:

1. List active V4 wagers:
   ```sql
   select * from games where game_mode='wager' and state < 3;
   ```
2. Have players play them out, or the creator calls `cancelWagerGame` (only if
   `player2 == address(0)`).
3. Then flip the env var.

## In-flight V4 bombs

Bombs purchased on V4 are tied to specific gameIds — they don't migrate. After
the V5 cutover, anyone with an unused V4 bomb has it stranded. Either:

- Wait until those wager games finish naturally before flipping, or
- Issue a manual refund from the owner wallet for each stranded bomb (USDC
  transfer of 2 USDC per bomb, off-chain compensation), then flip.

The DB rows for finished V4 games are preserved either way.
