"use strict";

// Smoke test against Arbitrum: runs the handler like Vercel would and checks the numbers add up.
const assert = require("assert");
const handler = require("./api/index.js");

function call(url) {
  return new Promise((resolve) => {
    const res = {
      statusCode: null,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; },
      send(body) { resolve({ status: this.statusCode, headers: this.headers, body }); },
      json(body) { resolve({ status: this.statusCode, headers: this.headers, body }); },
    };
    handler({ url }, res);
  });
}

(async () => {
  const circ = await call("/");
  assert.strictEqual(circ.status, 200, JSON.stringify(circ.body));
  assert.match(circ.body, /^\d+$/, "circulating supply must be a plain integer");
  assert.strictEqual(circ.headers["Access-Control-Allow-Origin"], "*");

  const total = await call("/?field=total");
  assert.strictEqual(total.status, 200);
  assert.strictEqual(total.body, "1000000000", "total supply is fixed at 1,000,000,000 IDOS");

  const json = await call("/?format=json");
  assert.strictEqual(json.status, 200);
  const b = json.body;
  const locked = Number(b.locked.vestingWalletBalances) + Number(b.locked.stakedFromVestingWallets);
  assert.ok(Math.abs(Number(b.totalSupply) - locked - Number(b.circulatingSupply)) < 1e-6, "total − locked = circulating");
  assert.ok(b.locked.contracts.length > 0, "at least one still-vesting wallet");
  assert.ok(b.locked.contracts.every((c) => new Date(c.end) > new Date(b.blockTimestamp)), "only still-vesting wallets are deducted");
  assert.ok(Number(circ.body) > 0 && Number(circ.body) <= 1_000_000_000);

  const bad = await call("/?field=nope");
  assert.strictEqual(bad.status, 400);

  console.log(`ok: circulating ${circ.body}, locked in ${b.locked.contracts.length} vesting wallets at block ${b.blockNumber}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
