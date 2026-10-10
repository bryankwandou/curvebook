# curvebook

Pre-launch checks and launch-curve data for [Meteora Dynamic Bonding Curve](https://docs.meteora.ag/developer-guides/dbc). Live: https://curvebook-kappa.vercel.app

A DBC config fixes, for every pool launched on it, the curve, the fees, who can mint, and how much of the
graduation liquidity stays locked. In the 2026-10-10 scan of 1,792 mainnet graduations, 1,103 (62%) came from configs
that leave half or more of the graduation LP withdrawable by the launchpad or creator. 71% of those pools have since
lost half or more of the liquidity they graduated with, against 2% of pools on configs that lock all of it
([what happened to the liquidity](#what-happened-to-the-liquidity)). None of it is visible without decoding the config account.

curvebook decodes it: the [Inspector](#config-inspector) in the browser and [`scripts/check.ts`](#pre-launch-check-cli-and-ci)
in a terminal or CI flag what matters to a buyer. Four [presets](#presets) that pass every check are live on mainnet
for launchpads that want a clean starting point.

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

**What Stock Pair does not do.** It is a narrow USDC price band with a low fee, nothing more. It has no oracle or
reference price, so nothing ties the token to the underlying share; it does not pause when the stock market closes;
it knows nothing about redemption, transfer restrictions or issuer rules. It suits a token whose fair value is already
roughly known and that needs a calm first market, not price discovery for an unknown asset.

## Using a preset

DBC already has the payment rail: the wallet that creates a config is its **fee claimer**.

- **Launch on an official preset:** the official config's fee claimer (the preset author) receives the
  pool-creation fee and the author share of trading fees on every token launched with it.
- **Deploy as your own config:** a launchpad deploys the identical curve under its own wallet with one
  `createConfig` transaction and keeps those fees itself.
- **Builder:** tune shape, market caps, fee schedule and fee split. Every change is checked live with
  `validateConfigParameters` before the deploy button is enabled.

After graduation the pool migrates to DAMM v2. 100% of the LP is permanently locked, split 50/50
between the preset author and the creator.

Nothing stops anyone from copying a preset's parameters into their own config: every config is public on chain, and
the Inspector makes reading one easy. The author fee only applies to launches on the official configs. curvebook's
value is the checks and the data, not exclusive access to four curves.

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

| Randomized (seeded, log-uniform where it spans orders of magnitude) | Range |
| --- | --- |
| quote | SOL (75%) or USDC |
| start market cap | 5–5,000 SOL or 1,000–5,000,000 USDC |
| graduation / start market cap | 1.2–40x (5% of cases: 0.2–1x, must be rejected) |
| supply | 1M, 10M, 100M or 1B |
| shape | flat, early, long |
| start fee | 0.25–50%; half the cases decay to a lower end fee over 12 s–1 h |
| creator share of fees, pool-creation fee | 0–100%; 0–0.05 SOL |

Not covered: execution on chain (the program, not the SDK, is the final word; the four live configs are covered by the
mainnet simulation and read-back instead), slippage for a given trade size, supplies above 1B or below 1M, Token-2022
base tokens, and the rate-limiter fee mode.

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

### How the LP lock holds

"Permanently locked" is the DAMM v2 position field `permanent_locked_liquidity`. In the DAMM v2 program
([MeteoraAg/damm-v2](https://github.com/MeteoraAg/damm-v2), main at `a85c9266`, read 2026-10-10):

- `remove_liquidity` and `remove_all_liquidity` only take from `unlocked_liquidity`
  (`require!(liquidity_delta <= position.unlocked_liquidity)` in `ix_remove_liquidity.rs`);
- the only code that lowers `permanent_locked_liquidity` is position splitting (`state/pool.rs`), which adds the
  same amount to the second position's `permanent_locked_liquidity`: locked liquidity can move, never leave;
- `close_position` requires an empty position, and no admin or operator instruction touches liquidity.

The remaining trust is the program itself: DAMM v2 and DBC are upgradeable, both by `JADaUV8kvDpDbJr55wxXJHVaBS3VCj8thZZHjfeuCVLd`
(read from the program data accounts on mainnet, 2026-10-10). An upgrade could change these rules; that holds for every
DAMM v2 pool, not just curvebook's.

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

## Config inspector

The site's Inspector (`#inspect`) takes a token, a DBC pool or a config (`src/lib/target.ts` resolves the first two to
their config), reads the config from mainnet and decodes it in the browser with
`src/lib/inspect.ts`: it walks the curve with the SDK math, reads the fee schedule, migration option, LP split and
lock, token vesting and fee claimer, and finds the closest curvebook preset by comparing curve shape (price multiple
at each tenth of the raise). On the four official configs it returns each preset exactly.

`scripts/scan-graduations.ts` is the data behind the "Which configs actually graduate" table. Every DBC graduation
passes one of Meteora's DAMM migration configs, so the script reads their latest signatures, finds each
`migration_damm_v2` / `migrate_meteora_damm` instruction by its IDL discriminator, takes the DBC config (account #2)
and pool (account #0), groups by config and decodes the most-graduated ones ([graduated-configs.json](graduated-configs.json)).
It is read-only. The public RPC rate-limits it hard, so a private RPC is the practical way to run it:

```bash
RPC=https://mainnet.helius-rpc.com/?api-key=... CONCURRENCY=8 DELAY=100 PER_ADDRESS=200 npx tsx scripts/scan-graduations.ts
```

`.github/workflows/data.yml` reruns the scan and `scripts/pool-state.ts` every day (read-only, RPC from the
`HELIUS_RPC` repo secret; it fails instead of passing when the secret is missing or the scan comes back short), runs
`npm test` on the new files and commits them. The deployed site reads the latest committed copy at runtime
(`src/lib/live.ts`) and keeps its bundled copy when that is newer or GitHub is unreachable.

## What happened to the liquidity

`scripts/lp-outcomes.ts` (read-only, daily in `data.yml`) takes every graduation from the scan and compares the liquidity
its migration put into the DAMM pool with the pool's liquidity today: the DAMM v2 pool account (liquidity at migration
from the DAMM events in the migration transaction), or the DAMM v1 LP supply (LP minted at migration; withdrawing burns
LP). It reads the pool, not the positions, so liquidity moved between positions is not a withdrawal; liquidity added
since hides withdrawals, so losses are a lower bound. Result on 2026-10-10 ([lp-outcomes.json](lp-outcomes.json)):

| Config leaves | Graduations | Lost half or more of their graduation liquidity |
|---|---|---|
| 50%+ of LP withdrawable, no vesting | 917 | 607 (66%) |
| 50%+ of LP withdrawable, with a vesting schedule | 186 | 176 (95%) |
| 100% of LP permanently locked (control) | 675 | 14 (2%) |

Checked by hand: two pools on config `36VxV18i…` minted 309.46B LP at migration and have 33.9B left (11%, the locked
share); two on `CSsWETyM…` have 3.2% left (3% locked). DAMM v2 pool `BtERBHLy…` graduated at 13:50:08 UTC on 2026-10-10
and `removeAllLiquidity` ran at 13:53:31. The control is not perfect: 14 pools on fully locked configs, nearly all on a
few older DAMM v1 configs, also lost liquidity; they are reported, not dropped. `npm test` fails if the control's loss
rate goes above 10%.

## API for terminals and launchpads

The Inspector's report is also a public, read-only HTTP API (CORS open), so a trading terminal or launchpad can show it
next to every token it lists:

```bash
curl "https://curvebook-kappa.vercel.app/api/check?address=<token | DBC pool | config>"
```

It returns `verdict` (`red` when the graduation liquidity is half gone or any red flag is set, `warn`, `ok`), the
`flags`, the pool `status` (on the curve, or graduated and how much liquidity is gone), the curve and fee summary, and
a `reportUrl`. Unknown addresses get a 404 with the reason. Responses are CDN-cached for five minutes per address.

`/api/badge?address=...` returns an SVG badge ("curvebook | LP 89% gone", "no red flags", ...), cached for ten minutes:

```html
<a href="https://curvebook-kappa.vercel.app/?config=<address>#inspect">
  <img src="https://curvebook-kappa.vercel.app/api/badge?address=<address>" alt="curvebook check">
</a>
```

Both are the same report as `scripts/check.ts` (`src/lib/report.ts`). The sources are `api-src/`; `npm run build:api`
bundles them with esbuild into self-contained functions that are deployed next to `api/rpc.js`. `scripts/smoke.mjs`
checks the deployed endpoints against known cases every day in `data.yml`.

## Pre-launch check (CLI and CI)

The Inspector's risk flags (`src/lib/risk.ts`) run from a terminal too, so a launchpad can gate its own configs in CI
and a trader can check one before buying. Read-only; every flag comes from the config account and the curve walk:

| Flag | Severity | Rule |
|---|---|---|
| Mint authority kept | red | token authority option 3 or 4: a wallet can mint after launch |
| Graduation LP not permanently locked | red at 50%+, else warn | partner + creator liquidity percentage that becomes a withdrawable DAMM position; a vesting schedule does not downgrade it (pools on vesting configs lost their LP as often) |
| Trading fee that never decays | red at 10%+, warn at 3%+ | fee after any fee schedule has finished |
| Supply vesting to the creator | warn at 20%+, info at 1%+ | locked vesting amount / supply |
| Migration fee | warn at 10%+ | share of the raise taken at graduation |
| Early buyers up 30x+ at graduation | warn | graduation price / price at 10% of the raise |
| Listing, not price discovery | info | price moves 1.25x or less, or graduates on under 0.01 quote |

```bash
npx tsx scripts/check.ts <config|pool|token> [...]      # report; exit 1 on a red flag
npx tsx scripts/check.ts --fail-on warn --json <config>  # stricter, machine-readable
```

A token or DBC pool is resolved to the config that governs it (`src/lib/target.ts`). For one that already graduated,
the check also finds the migration transaction among the pool's latest signatures, reads it with the same parser as
the daily study (`src/lib/migration.ts`), and compares the liquidity the migration put into the DAMM pool with the
pool today: 50% or more gone is a red flag. The site's Inspector does the same in the browser; public RPCs keep little
transaction history, so those two reads go through `api/rpc.js`, which only serves DBC-owned accounts' signatures and
transactions that call the DBC program.

On the four curvebook presets it reports no flags. Run on the eight most-graduated mainnet configs on 2026-10-10,
six were red: 89–97% of their graduation LP is withdrawable.

## Tests

`npm test` (`scripts/test.ts`, offline): each preset hits its advertised open → graduation multiple with a monotonic
curve that ends at its threshold; the published graduation share recomputes from the per-config rows with the stated
rule; the mainnet launch, devnet graduation and deployed configs agree; the submission page parses and fits the form
limits. CI (`.github/workflows/ci.yml`) runs lint, build and tests on every push.

## Run the app

```bash
npm run dev                         # VITE_RPC=... to override the default PublicNode RPC
npm run build
```

Stack: React + Vite, `@meteora-ag/dynamic-bonding-curve-sdk`, Solana wallet adapter. Mainnet only.

`api.mainnet-beta.solana.com` answers 403 to browser requests, so the site reads through PublicNode's free endpoint.
The pool feed needs `getProgramAccounts`, which public endpoints refuse: it goes through `api/rpc.js`, a Vercel
function that forwards only `getProgramAccounts` on the DBC program and `getAccountInfo` to a private RPC set in the
`HELIUS_RPC` env var. The key never reaches the browser.

## Status

These are configs for an existing program (Meteora DBC). curvebook adds no on-chain program
of its own, and the app itself has not been audited by a third party. Read a config before you launch on it.
