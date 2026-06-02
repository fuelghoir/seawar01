# Sea Battle V7 deploy

V7 adds self-service wager refunds and keeps the V6 reward-vault split.

Deployed on Base Mainnet:

```text
0x8de75fbc38b1e47e53fb2e85791c935f5f653aa6
```

## Refund rules

- If nobody joins, the creator can reclaim their stake after 3 minutes.
- If both players join and the match does not finish, each player can reclaim
  only their own stake after 15 minutes.
- One player's refund never blocks the other player's refund.

## Before deploy

1. Resolve joined wager rooms still locked in V6. Escrow cannot move between
   contract versions automatically.
2. Deploy:

```bash
node scripts/deploy-v7.mjs
```

3. Copy `NEXT_PUBLIC_SEABATTLE_V7_CONTRACT_ADDRESS` from `.env` to the
   production environment and redeploy the app.
4. Add the V7 contract and the required functions to the CDP paymaster
   allowlist if wager gas should be sponsored:

```text
createWagerGame(uint256)         0xbc9d56e6
joinWagerGame(uint256)           0xac444aae
recordResult(uint256,address)    0x91059748
claimPrize(uint256)              0xd7098154
cancelWagerGame(uint256)         0xc9ec8277
claimStaleWagerRefund(uint256)   0x641bf766
```

## Legacy V6 compensation

The unresolved V6 game `2` could not self-refund because that method does not
exist in V6. Both players received a manual `0.1 USDC` compensation before the
V7 switch:

- Player 1: https://basescan.org/tx/0x9db12e9be96aaa8b2e80d9fc1ffb3b032cef660441ace1d9506795360cad185d
- Player 2: https://basescan.org/tx/0x880f790a1003d2299df3c680519206ede58dbffefb8da23aa41a0124727353d5
