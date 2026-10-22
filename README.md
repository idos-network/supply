# idOS Supply

Deployed at <https://supply.idos.network/> (Vercel project `idos-engineering/supply`, deployed from `master`).

A small Vercel function that reports the circulating supply of the IDOS token on Arbitrum One,
computed live from the chain. It exists so that CoinMarketCap, CoinGecko and anyone else can read
one number from one place.

## Endpoints

| Request | Response |
| --- | --- |
| `GET /` | Circulating supply in whole IDOS, plain text, e.g. `289315436` |
| `GET /?field=total` | Total supply in whole IDOS, plain text (`1000000000`) |
| `GET /?format=json` | JSON breakdown: block, total, circulating, locked amounts and every still-vesting wallet |

Every path is rewritten to the same function (`vercel.json`), so `/`, `/api` and `/anything` behave
the same. Responses carry `Access-Control-Allow-Origin: *` and
`Cache-Control: s-maxage=300, stale-while-revalidate=600`. If the chain cannot be read, the function
answers `500` with `{ "error": "Failed to compute circulating supply" }`, uncached, and Vercel keeps
serving the last good response while it revalidates.

## Methodology

Rulings by Lluis Bardet, 2026-09-29 (_Circulating supply methodology, for supply API_):

```text
circulating = totalSupply(IDOS)
            − Σ balanceOf(v)                      for every vesting wallet v with end(v) > now
            − Σ IDOSNodeStaking.getUserStake(v)    for every such v (tokens staked straight from the wallet)
```

1. **A vesting wallet that is still vesting is a reserve.** Its whole IDOS balance is locked,
   including the part that is already vested but not yet claimed. Only tokens that actually left
   the wallet are circulating.
2. **A vesting wallet whose `end()` has passed is not a reserve**, even if the beneficiary never
   claimed. Those tokens count as circulating from the `end()` timestamp on, so expect a step on
   each schedule end date (2027-02-05, 2027-08-05, …).
3. **Staked tokens are circulating, unless they were staked straight from a still-vesting wallet.**
   `IDOSStakingVesting` wallets can stake into `IDOSNodeStaking` without releasing; the stake leaves
   the wallet's balance but is still locked. It is read as `getUserStake(wallet).activeStake`.
4. **Liquid treasury and community wallets** (Main Safe, Glacier), exchanges, market makers and
   ordinary holders are circulating. The staking pool is circulating except for the share in rule 3.

There is no manual adjustment. Total supply is fixed at 1,000,000,000 IDOS (no mint, no burn) and
is read from `totalSupply()`.

Contracts on Arbitrum One: IDOS token `0x68731d6F14B827bBCfFbEBb62b19Daa18de1d79c`,
IDOSNodeStaking `0x6132F2EE66deC6bdf416BDA9588D663EaCeec337`, Multicall3
`0xcA11bde05977b3631167028862bE2a173976CA11`.

Known simplifications (all small): staking rewards earned by a vesting wallet are not counted as
locked unless they were withdrawn into the wallet; tokens a vesting wallet has unstaked but not yet
withdrawn (14-day delay) show as circulating during the delay; slashed stake is not deducted.

## How it works

- [`registry.json`](registry.json) lists every vesting wallet ever found on Arbitrum
  (OpenZeppelin `VestingWallet` clones: `IDOSVesting`, `IDOSStakingVesting` and unverified clones
  with the same interface) with its `start` and `end` timestamps. Most of the ~15,000 entries are
  small community wallets whose vesting ended in August/September 2026.
- On each request [`lib/supply.js`](lib/supply.js) takes the wallets whose `end` lies in the future
  and, in one Multicall3 round trip, reads the block timestamp, `totalSupply()`, and each wallet's
  `end()`, `balanceOf` and `getUserStake`. Wallets whose on-chain `end()` is not after the block
  timestamp are skipped. If any call fails the request fails; a wrong number is never served.
- [`api/index.js`](api/index.js) is only the HTTP layer.

## Keeping the registry current

New vesting wallets appear only when idOS deploys them (new team members, investors, partners).
A wallet missing from the registry overstates circulating supply by its balance, so after every
vesting deployment, and at least monthly:

```bash
npm run discover
```

This scans the IDOS `Transfer` logs since `scannedToBlock`, probes every new recipient for
`owner()`, `start()` and `end()`, appends the vesting wallets it finds and prints them. Commit the
updated `registry.json`; merging to `master` deploys it. `npm run discover -- --full` rescans from
the first IDOS transfer (a few minutes on the public RPC).

## Reconciliation

```bash
npm run breakdown          # one line per still-vesting wallet, plus totals
npm run breakdown -- --json
```

Compare the lines with the reserve rows of the CMC supply sheet. The same data is served live at
`/?format=json`.

`--block <n>` evaluates a past Arbitrum block. The public RPC keeps no archive state, so point
`ARBITRUM_RPC_URL` at an archive endpoint (for example `https://arbitrum.drpc.org`) for that. Check
on 2026-10-22: at block 510027018 (2026-09-29 12:24 UTC) the result is 274,485,537.58 IDOS with 74
reserve wallets, identical to the hand-made analysis of that day.

## Configuration

`ARBITRUM_RPC_URL` (optional): JSON-RPC endpoint to use instead of the public
`https://arb1.arbitrum.io/rpc`. No secrets are needed.

## Development

Node.js 18 or newer.

```bash
npm ci
npm test        # live smoke test against Arbitrum
```

```text
api/index.js          Vercel function (HTTP layer)
lib/supply.js         supply computation
registry.json         vesting-wallet census (generated, do not edit by hand)
scripts/discover.js   registry maintenance
scripts/breakdown.js  reconciliation table
test.js               smoke test
vercel.json           rewrites every path to the function
```

## History

The first version (April 2026) subtracted the balances of a fixed wallet list plus a manual
deduction of 95,055,185 IDOS for tokens that were not yet on-chain. By autumn 2026 that overstated
the supply: it kept deducting wallets whose vesting had ended, never saw tokens staked straight from
vesting wallets, and missed 19 of the 74 reserve wallets (team, advisors, GC, the Sumsub lock-up and
the founders' staking wallets). Version 2 replaces it with the methodology above.
