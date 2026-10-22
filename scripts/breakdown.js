#!/usr/bin/env node
"use strict";

/**
 * Prints the reserve that the API deducts right now, contract by contract, so the figure can be
 * reconciled with the CMC/CoinGecko supply sheet.
 *
 *   node scripts/breakdown.js                 # table, chain head
 *   node scripts/breakdown.js --json          # same data as JSON
 *   node scripts/breakdown.js --block 509…    # at a past Arbitrum block (needs an archive RPC)
 */

const { computeSupply, toDecimal, toWhole } = require("../lib/supply");

const fmt = (x) => Number(toWhole(x)).toLocaleString("en-US").padStart(16);
const day = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf("--block");
  const blockTag = at >= 0 ? Number(args[at + 1]) : "latest";
  const s = await computeSupply({ blockTag });
  const rows = s.locked.slice().sort((a, b) => (b.balance + b.activeStake > a.balance + a.activeStake ? 1 : -1));

  if (process.argv.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          blockNumber: s.blockNumber,
          blockTimestamp: s.blockTimestamp,
          totalSupply: toDecimal(s.totalSupply),
          circulatingSupply: toDecimal(s.circulating),
          lockedVestingBalances: toDecimal(s.lockedBalance),
          lockedStakeFromVesting: toDecimal(s.lockedStake),
          contracts: rows.map((c) => ({ address: c.address, start: c.start, end: c.end, balance: toDecimal(c.balance), activeStake: toDecimal(c.activeStake) })),
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`Block ${s.blockNumber} (${new Date(s.blockTimestamp * 1000).toISOString()})`);
  console.log(`${"contract".padEnd(42)} ${"vesting ends".padEnd(12)} ${"balance".padStart(16)} ${"active stake".padStart(16)}`);
  for (const c of rows) console.log(`${c.address} ${day(c.end).padEnd(12)} ${fmt(c.balance)} ${fmt(c.activeStake)}`);
  console.log("");
  console.log(`still-vesting wallets           ${String(rows.length).padStart(16)}`);
  console.log(`locked: vesting balances        ${fmt(s.lockedBalance)}`);
  console.log(`locked: staked from vesting     ${fmt(s.lockedStake)}`);
  console.log(`total supply                    ${fmt(s.totalSupply)}`);
  console.log(`circulating supply              ${fmt(s.circulating)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
