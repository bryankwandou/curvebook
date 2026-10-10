# curvebook

Launch-curve presets for [Meteora Dynamic Bonding Curve](https://docs.meteora.ag/developer-guides/dbc). Live: https://curvebook-kappa.vercel.app
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

### 5,000 randomized curve tests

```bash
N=5000 SEED=1 npx tsx scripts/fuzz-curves.ts
```

This builds random configs (shape, quote, market caps, supply, fee schedule, fee split) through the
same `buildPreset → validateConfigParameters → sampleCurve` path the app uses, and checks each one:
price, sold and raised never fall; graduation lands within 0.1% of the migration threshold; start
price matches the start market cap; the graduation multiple matches the market-cap ratio; fee shares
sum to 100% minus the protocol fee. One case in twenty is deliberately broken (graduation at or
below the start) and must be rejected.

Last run (seed 1): 5,000 cases, 4,725 valid configs passed every invariant, 274 of 274 broken ones were
rejected, and the SDK validator refused 1 ("Invalid pool fees"). 0 failures. Full output: [fuzz-report.json](fuzz-report.json).
This is offline SDK math, not mainnet transactions.

## Mainnet configs (live)

Created 2026-10-05 by `scripts/deploy-configs.ts`. Each is a DBC config account owned by
`dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`, fee claimer `GNuQ8FoXKAsq1i5QaT3o3Cjtevo7MAyRsAKiWB4Z2as8`.

| Preset | Config | createConfig |
| --- | --- | --- |
| flat-fair | [7Cybv7xU…](https://solscan.io/account/7Cybv7xUZn3JhvZfGQF9h9s7bLWQhNNcqs1yQVGPprPK) | [tx](https://solscan.io/tx/2dPGvjmAGEjmXdan3LQ9WTBDXpXatDjhk8wKjPkvkB8gDwbvKiNndre7DyBSytwmEMurb7WuggQjX7xuYmQWwgVT) |
| early-discovery | [FnKvUoL1…](https://solscan.io/account/FnKvUoL12VZacUE2k4EwhFXHn2xxhoG1wvQYsfgBSsLT) | [tx](https://solscan.io/tx/2DcGSrPZ3a7WhqzEFLS9eQDx184rvaPxkdsanrYL4QLreLU2CiRnd7yoEiuXUMQkFdRFDoCF9ZUzyEQsJNv2HBKa) |
| long-curve | [6aHuAvXw…](https://solscan.io/account/6aHuAvXw3BYgR5Wrht8neBPXpmGQej7YWhBK9gbDyf93) | [tx](https://solscan.io/tx/4BAY6KjyytTGNsuoirHwNHz6Aq1DLaZKbvFHAsLiP298PsuWcy4TbP6ey7x4bXtdLd264BDTyEsM5PD4PoDTL1sT) |
| stock-pair-usdc | [4i2iNBaH…](https://solscan.io/account/4i2iNBaHyJbbZL5q3TVRudzySRbf8NV3BmhscAiQTEhU) | [tx](https://solscan.io/tx/2kx3rPKoDfyi7qTceiFB94mpYHMtxfh85aRYhFiDgRq6VLqJqPUC9VzmvM4QhN73kCHQh1g2mggH669Y425JEws) |

### First real launch (2026-10-10)

`scripts/mainnet-launch.ts` (dry run by default, `SEND=1` to send) launched CBK on flat-fair and bought 0.01 SOL of it.
Pool [4ikgpisQ…](https://solscan.io/account/4ikgpisQo83h3wBwtaqW8mhRuHbjM9L2egv9Fq7XY1zd),
mint [9yVLMokY…](https://solscan.io/token/9yVLMokYuoC2KWMESmD1XUY3jmFJmasEw4FKPxZZ6gfS),
[createPool tx](https://solscan.io/tx/5ieP6wibq9FN1vC5fGXwAFrZkKBEjeHQ27ZFnMSyeg6p2PBQ8vDL5WhZnnAwZHYfjTKFKsZcjHjN8KH1dsrZw3Pu),
[buy tx](https://solscan.io/tx/2UtVTgnBaEh59h3Cz72VCYo9EvwN3idg7CvptUoPXd6gsPF88vedSFMHrgNyvSLichGkxHmK9VjKfFLW86DwURSn).
Curve progress 2.08% right after our buy, total cost 0.0421 SOL ([mainnet-launch.json](mainnet-launch.json)).
Within seconds a third-party wallet bought and sold on the pool, so the live curve reads lower. Those trades paid 0.016 SOL in fees to the preset author. `npx tsx scripts/pool-state.ts` reads the pool back ([mainnet-pool-state.json](mainnet-pool-state.json)).

### Graduation to DAMM v2 (devnet)

`KEYPAIR=... npx tsx scripts/devnet-graduate.ts` runs the full lifecycle on one pool: createConfig → createPool → one buy that fills the curve to 100% → `migrateToDammV2` → read-back.
The curve is Flat Fair with both market caps divided by 150 (graduation threshold 0.62 SOL) so it fits a devnet budget; shape, fees, LP split and migration settings are unchanged.
Result ([devnet-graduation.json](devnet-graduation.json)): the DBC pool is marked migrated, DAMM v2 pool `5hiCfh8heVN8G14pJtHTU4pF3y5M46SeS81tB8y8qbSS` is owned by the DAMM v2 program, and both LP positions hold 0 unlocked and 0 vesting liquidity: 100% permanently locked.

### Read-back check

`npx tsx scripts/verify-mainnet.ts` reads each config account from mainnet (read-only) and compares it field by field with its preset:
4 configs, 80 checks, 0 failures ([mainnet-verify.json](mainnet-verify.json)).

### Launch + first buy, simulated on mainnet

```bash
RPC=https://your-mainnet-rpc npx tsx scripts/mainnet-sim.ts
```

Builds the real `createPoolWithFirstBuy` transaction for each live config and runs it through
`simulateTransaction` against the mainnet DBC program (unsigned, never sent, no token created), then
decodes the simulated pool account. Last run ([mainnet-sim.json](mainnet-sim.json)):

| Preset | Result | First buy | Author: creation fee (after 10% protocol) | Author: trading fee |
| --- | --- | --- | --- | --- |
| Flat Fair Launch | ok, 153k CU | 1 SOL | 0.009 SOL | 0.004 SOL |
| Early Discovery | ok, 161k CU | 1 SOL | 0.018 SOL | 0.12 SOL |
| Long Curve | ok, 147k CU | 1 SOL | 0.009 SOL | 0.0048 SOL |
| Stock Pair (USDC) | ok, 107k CU | none (launch only) | 0.009 SOL | 0 |

One config costs 0.00597 SOL of rent. The author's share of a single launch's creation fee covers it;
one Early Discovery launch with a 1 SOL first buy pays the author 0.138 SOL. These are simulated
numbers, not realized revenue.

## Devnet run (end to end)

Same DBC program id as mainnet. `scripts/devnet-proof.ts` deployed each SOL preset, launched a token on it, and bought 0.2 SOL of it (2026-10-05):

| Preset | Config | Pool | createConfig | createPool | Buy | Curve progress |
| --- | --- | --- | --- | --- | --- | --- |
| flat-fair | [8XiUu7Nt…](https://solscan.io/account/8XiUu7Nt21181RQ9K1azjhQDpDuMxNAqT6sCRnDZsm1J?cluster=devnet) | [4jvG4i3j…](https://solscan.io/account/4jvG4i3ji9cr6GMNEx74DKvsT2vBw9K43YMVp2LgbHmq?cluster=devnet) | [tx](https://solscan.io/tx/4FEbdcJHCrZRbvNEAC3dzVb6wYthv3u2X6cAPHjNe7apTEzh5ZdBck4KB3pFHKpZSNFGXUM5spY1hpgdWCFdUcH5?cluster=devnet) | [tx](https://solscan.io/tx/2M3fpusoVoMN2QFRyUiqv8JHifWYMx8pL9vXoV494S6mDjqRmqsgeBN3kNReprG4iY3xZ6wBvsEZPEdhBk8e3L3n?cluster=devnet) | [tx](https://solscan.io/tx/32bKFqhtY8kvdMrAn6PWHkjzbyt85rggss4A2RsHyLZJDeH7TJGLM8DMeVcL1GnuRmk9aTTXtGHFDcRfjjnodz4y?cluster=devnet) | 0.214% |
| early-discovery | [4sx3GyTC…](https://solscan.io/account/4sx3GyTC56f7GM9wyg9hejtG6K9ABEKNBn2D4ZCzLBqd?cluster=devnet) | [5W1qvM5z…](https://solscan.io/account/5W1qvM5z3vYV2C89DCpkN8opVamdDetj9SQ4efEzZF5m?cluster=devnet) | [tx](https://solscan.io/tx/Cy6kw2LPqSpfuT7oxzBivPybkmSvYFsUiAyHF1dCD1mDATTrW7FumKhyJKgc34MkeZaawT2mDCSpp3v7i1x4syh?cluster=devnet) | [tx](https://solscan.io/tx/2zXLkDsJ7ixhfUbeqUuvGFC8HhcmBFoMeMZyx7Lx6zshftmGkhhWHHAXo444j6rJ4P1QE29ovvpcU34gFERFh7N9?cluster=devnet) | [tx](https://solscan.io/tx/4tnZK2yUXxkP8byZCtDMBZ4ZXH6Au3qkWEvKgQwJSrDwMTiStn5WNUFDWvsFVR3SJVQ997MN44yJdBEuTwnSn1kR?cluster=devnet) | 0.114% |
| long-curve | [CuVMJWyg…](https://solscan.io/account/CuVMJWyg6GsSAQhocQ6FW6od2mwvRRMszZnL2CVf5jvr?cluster=devnet) | [GhgXtytH…](https://solscan.io/account/GhgXtytHyg44vo7YysNZeVqd2vx6cXy9kCZ2s2tY38ZQ?cluster=devnet) | [tx](https://solscan.io/tx/23ZD1HsGvRY3vXnRaWwMRzqdZFmiJ5ABfVdUVvtwiW2NpoqiSXEhvyj8c4k3qv1BPAB1wPx9UdX2AaFT4AGK1TPk?cluster=devnet) | [tx](https://solscan.io/tx/4denBKpmVFpSZaPHYSchGxPdLMYnpRgfcwYjxw5PJa5KDXJiuvitareAvvQoG14Y88TWrzzpFwv1DMZF6okk3FYo?cluster=devnet) | [tx](https://solscan.io/tx/26VZY7TvFn6q7SkjGUDenDjWjv6LbHWEC4knHUBYnB4FmAjs3HdnopT1TEQzZacSBrM2AX1poFLSyGeNsHttEZws?cluster=devnet) | 0.253% |

The same buy moved Early Discovery about half as far: its 25% opening fee keeps a quarter of the input,
and its graduation threshold is higher (0.2 × 0.75 / 131.8 SOL = 0.114%). That is the anti-snipe fee doing its job.
The USDC preset is skipped on devnet because mainnet USDC has no mint there.

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
