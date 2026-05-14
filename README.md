# idOS Supply

Deployed at <https://supply.idos.network/>.

Small Vercel API for reporting the circulating supply of the idOS token on
Arbitrum.

The endpoint queries current on-chain IDOS balances for known locked wallets and
vesting contract addresses, subtracts those balances from the fixed total supply,
then applies a manual deduction for tokens that are not yet trackable on-chain.
It returns the resulting circulating supply as a plain integer string.

## What It Does

The API computes:

```text
circulating_supply = total_supply - locked_on_chain_balances - manual_deduction
```

Where:

- `total_supply` is `1,000,000,000 IDOS`.
- `locked_on_chain_balances` is the sum of IDOS balances held by:
  - fixed treasury and staking wallets defined in [api/index.js](./api/index.js)
  - vesting addresses listed in [vesting_contracts.json](./vesting_contracts.json)
- `manual_deduction` is `95,055,185 IDOS` for tokens that are not yet represented by trackable on-chain balances.

Balances are fetched from Arbitrum using the public Arbitrum RPC endpoint and
Multicall3.

## API

### `GET /`

Returns the current circulating supply as text.

Example response:

```text
123456789
```

The Vercel configuration rewrites all paths to the serverless function in
`api/index.js`, so `GET /`, `GET /api`, and other paths are handled by the same
endpoint.

### Response Headers

- `Access-Control-Allow-Origin: *`
- `Cache-Control: s-maxage=300, stale-while-revalidate=600`

### Error Response

If the RPC call or calculation fails, the API returns:

```json
{
  "error": "Failed to compute circulating supply"
}
```

with HTTP status `500`.

## Project Structure

```text
.
├── api/index.js             # Vercel serverless function
├── vesting_contracts.json   # Vesting addresses included in locked balance checks
├── test.js                  # Local smoke-test runner for the API handler
├── vercel.json              # Vercel rewrite configuration
├── package.json
└── package-lock.json
```

## Requirements

- Node.js 18 or newer
- npm
- Network access to `https://arb1.arbitrum.io/rpc`

## Local Development

Install dependencies:

```sh
npm install
```

Run the local smoke test:

```sh
node test.js
```

This imports the Vercel handler directly, calls it with a minimal mocked request
and response object, and prints the status plus response body.

## Deployment

This repository is designed for Vercel.

The serverless function lives at [api/index.js](./api/index.js). The
[vercel.json](./vercel.json) rewrite sends every incoming path to that
function:

```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/api" }
  ]
}
```

No environment variables are currently required; the Arbitrum RPC URL, IDOS token
address, Multicall3 address, fixed wallets, total supply, and manual deduction
are defined in [api/index.js](./api/index.js).

## Updating Vesting Addresses

Update [vesting_contracts.json](./vesting_contracts.json) when the set of
vesting addresses changes. The file is imported directly by the API handler, so a
deployment is required for Vercel to serve the updated list.

After changing the list, run:

```sh
node test.js
```

to verify that the handler can still compute a supply value.

## License

MIT. See [LICENSE](./LICENSE).
