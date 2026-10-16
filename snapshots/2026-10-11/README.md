# Snapshot 2026-10-11 (frozen)

The numbers in the submission, the demo video, the OG card and the README come from these two files. They never
change. The files in the repo root are rewritten every day by `.github/workflows/data.yml`, so they drift from this.

- `graduated-configs.json`: scan of 2026-10-11 15:40 UTC, 1,807 graduations; `classification.safety.lpMostlyWithdrawable` = 1,141 (63%)
- `lp-outcomes.json`: study of 2026-10-11 16:00 UTC. Withdrawable configs (`byClass.open` + `byClass.vesting`): 783 of
  1,141 lost half (69%); control (`byClass.locked`): 2 of 653; `robustness.byKind.damm_v2`: 219 of 525 vs 0 of 466;
  `robustness.withdrawable.configs`: 258; `pulls.within10Minutes`: 96

`npm test` checks that the submission text quotes exactly these numbers.
