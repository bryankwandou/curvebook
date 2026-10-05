# curvebook

Launch-curve presets for [Meteora Dynamic Bonding Curve](https://docs.meteora.ag/developer-guides/dbc).
Pick a curve, launch a token on it, or deploy it as your own config inside your launchpad.

A DBC config holds a lot of decisions: curve shape, fee schedule, quote token, graduation threshold,
LP split and DAMM v2 migration. Most launchpads copy one pump-style curve and never touch them.
curvebook packages tuned configs as presets you can compare side by side, and lets you adopt one
in a single transaction.

## Presets

| Preset | Quote | Shape | Open → graduation | Sold on curve | Raised | Trading fee |
| --- | --- | --- | --- | --- | --- | --- |
| Flat Fair Launch | SOL | equal liquidity in all 16 segments | 5.0x | 69.1% | 92.7 SOL | 1% |
| Early Discovery | SOL | thin bottom, deep top | 16.0x | 67.0% | 131.8 SOL | 25% → 1% over 120 s (anti-snipe) |
| Long Curve | SOL | deep bottom, thin top | 20.0x | 90.3% | 77.9 SOL | 1.5% |
| Stock Pair (USDC) | USDC | flat, narrow band | 1.8x | 57.3% | 38,434 USDC | 0.3% |

The numbers come from walking each curve segment by segment with the SDK's own delta-amount math
([src/lib/curve.ts](src/lib/curve.ts)). The walk stops at the exact migration quote threshold.

Shapes come from `buildCurveWithLiquidityWeights` with 16 exponential weights (1.25^i).
Thin liquidity makes the price move faster per token sold.

## How the marketplace works

DBC already has the payment rail: the wallet that creates a config is its **fee claimer**.

- **Launch on an official preset:** the official config's fee claimer (the preset author) receives the
  pool-creation fee and the author share of trading fees on every token launched with it.
- **Deploy as your own config:** a launchpad deploys the identical curve under its own wallet with one
  `createConfig` transaction and keeps those fees itself.
- **Builder:** tune shape, market caps, fee schedule and fee split. Every change is checked live with
  `validateConfigParameters` before the deploy button is enabled.

After graduation the pool migrates to DAMM v2. 100% of the LP is permanently locked, split 50/50
between the preset author and the creator.

## Verification

```bash
npm install
npx tsx scripts/verify-presets.ts
```

For every preset this:

1. runs the SDK's validator;
2. samples the curve;
3. simulates `createConfig` against the **mainnet** DBC program. Nothing is signed or sent.

Last run: all 4 pass, 132–134k CU each.

## Deploy the official configs

```bash
KEYPAIR=path/to/wallet.json RPC=https://your-mainnet-rpc npx tsx scripts/deploy-configs.ts
```

This writes the config addresses to `src/deployed.json`. The app then shows the launch form and a
live pool feed for each preset.

## Run the app

```bash
npm run dev                         # VITE_RPC=... for the pool feed (needs getProgramAccounts)
npm run build
```

Stack: React + Vite, `@meteora-ag/dynamic-bonding-curve-sdk`, Solana wallet adapter. Mainnet only.

## Status

These are configs for an existing program (Meteora DBC). curvebook adds no on-chain program
of its own, and the app itself has not been audited by a third party. Read a config before you launch on it.
