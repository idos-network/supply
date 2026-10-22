"use strict";

const { computeSupply, toWhole, toDecimal, IDOS_TOKEN, NODE_STAKING, ARBITRUM_CHAIN_ID } = require("../lib/supply");

const CACHE = "s-maxage=300, stale-while-revalidate=600";

function isoDate(ts) {
  return new Date(ts * 1000).toISOString();
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    // Vercel parses the query string into req.query; fall back to req.url for other runtimes/tests.
    const query = req.query || Object.fromEntries(new URL(req.url || "/", "http://localhost").searchParams);
    const field = String(query.field || "circulating").toLowerCase();
    const format = String(query.format || "text").toLowerCase();
    if (!["circulating", "total"].includes(field) || !["text", "json"].includes(format)) {
      res.setHeader("Cache-Control", "no-store");
      res.status(400).json({ error: "Use ?field=circulating|total and ?format=text|json" });
      return;
    }

    const s = await computeSupply();
    res.setHeader("Cache-Control", CACHE);

    if (format === "json") {
      res.status(200).json({
        chainId: ARBITRUM_CHAIN_ID,
        token: IDOS_TOKEN,
        stakingContract: NODE_STAKING,
        blockNumber: s.blockNumber,
        blockTimestamp: isoDate(s.blockTimestamp),
        totalSupply: toDecimal(s.totalSupply),
        circulatingSupply: toDecimal(s.circulating),
        locked: {
          total: toDecimal(s.lockedBalance + s.lockedStake),
          vestingWalletBalances: toDecimal(s.lockedBalance),
          stakedFromVestingWallets: toDecimal(s.lockedStake),
          contracts: s.locked
            .slice()
            .sort((a, b) => (b.balance + b.activeStake > a.balance + a.activeStake ? 1 : -1))
            .map((c) => ({
              address: c.address,
              end: isoDate(c.end),
              balance: toDecimal(c.balance),
              activeStake: toDecimal(c.activeStake),
            })),
        },
        methodology: "https://github.com/idos-network/supply#methodology",
      });
      return;
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.status(200).send(toWhole(field === "total" ? s.totalSupply : s.circulating));
  } catch (error) {
    console.error("supply error:", error);
    res.setHeader("Cache-Control", "no-store");
    res.status(500).json({ error: "Failed to compute circulating supply" });
  }
};
