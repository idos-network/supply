"use strict";

/**
 * IDOS circulating-supply computation (Arbitrum One).
 *
 * circulating = totalSupply()
 *             − Σ balanceOf(v)                    for every vesting wallet v with end(v) > now
 *             − Σ IDOSNodeStaking.getUserStake(v)  for every such v (tokens staked straight from the wallet)
 *
 * The set of vesting wallets lives in ../registry.json (maintained by scripts/discover.js).
 * `end()` of a vesting wallet is immutable, so the registry value is only used to pre-select
 * candidates; the on-chain `end()` and the chain's own block timestamp make the final decision.
 */

const { ethers } = require("ethers");

const ARBITRUM_CHAIN_ID = 42161;
const DEFAULT_RPC = "https://arb1.arbitrum.io/rpc";
const IDOS_TOKEN = "0x68731d6F14B827bBCfFbEBb62b19Daa18de1d79c";
const NODE_STAKING = "0x6132F2EE66deC6bdf416BDA9588D663EaCeec337";
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const ARBSYS = "0x0000000000000000000000000000000000000064"; // Arbitrum precompile: L2 block number
const DECIMALS = 18;
const CALLS_PER_MULTICALL = 600;

// Block of the first IDOS Transfer on Arbitrum; scripts/discover.js starts a full scan here.
const FIRST_TRANSFER_BLOCK = 437321135;

const IFACE = new ethers.Interface([
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function start() view returns (uint256)",
  "function end() view returns (uint256)",
  "function owner() view returns (address)",
  "function getUserStake(address user) view returns (uint256 activeStake, uint256 slashedStake)",
  "function getCurrentBlockTimestamp() view returns (uint256)",
  "function arbBlockNumber() view returns (uint256)",
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[] returnData)",
]);

function makeProvider(url = process.env.ARBITRUM_RPC_URL || DEFAULT_RPC) {
  return new ethers.JsonRpcProvider(url, ARBITRUM_CHAIN_ID, {
    staticNetwork: ethers.Network.from(ARBITRUM_CHAIN_ID),
    batchMaxCount: 1,
  });
}

function loadRegistry() {
  // eslint-disable-next-line global-require
  return require("../registry.json");
}

/**
 * Runs `calls` ({target, allowFailure, callData}) through Multicall3.aggregate3 in chunks and
 * returns [{success, returnData}] in the same order.
 */
async function multicall(provider, calls, blockTag = "latest") {
  const out = [];
  for (let i = 0; i < calls.length; i += CALLS_PER_MULTICALL) {
    const chunk = calls.slice(i, i + CALLS_PER_MULTICALL);
    const data = IFACE.encodeFunctionData("aggregate3", [chunk]);
    const raw = await provider.call({ to: MULTICALL3, data, blockTag });
    const [results] = IFACE.decodeFunctionResult("aggregate3", raw);
    for (const r of results) out.push({ success: r.success, returnData: r.returnData });
  }
  return out;
}

function decode(fn, result) {
  if (!result.success || result.returnData === "0x") {
    throw new Error(`call ${fn} failed or returned no data`);
  }
  return IFACE.decodeFunctionResult(fn, result.returnData);
}

/**
 * Computes the supply figures at the chain head, or at `blockTag` (a past block number) when the
 * RPC serves archive state. Amounts are bigint in token base units (18 decimals).
 */
async function computeSupply({ provider = makeProvider(), registry = loadRegistry(), blockTag = "latest" } = {}) {
  const nowGuess = blockTag === "latest" ? Math.floor(Date.now() / 1000) : (await provider.getBlock(blockTag)).timestamp;
  // Pre-select with a day of slack; the on-chain end() vs block timestamp makes the final cut.
  const candidates = registry.contracts.filter((c) => c.end > nowGuess - 86400);

  const calls = [
    { target: MULTICALL3, allowFailure: false, callData: IFACE.encodeFunctionData("getCurrentBlockTimestamp") },
    { target: ARBSYS, allowFailure: false, callData: IFACE.encodeFunctionData("arbBlockNumber") },
    { target: IDOS_TOKEN, allowFailure: false, callData: IFACE.encodeFunctionData("totalSupply") },
  ];
  for (const c of candidates) {
    calls.push({ target: c.address, allowFailure: false, callData: IFACE.encodeFunctionData("end") });
    calls.push({ target: IDOS_TOKEN, allowFailure: false, callData: IFACE.encodeFunctionData("balanceOf", [c.address]) });
    calls.push({ target: NODE_STAKING, allowFailure: false, callData: IFACE.encodeFunctionData("getUserStake", [c.address]) });
  }

  const results = await multicall(provider, calls, blockTag);
  let i = 0;
  const blockTimestamp = Number(decode("getCurrentBlockTimestamp", results[i++])[0]);
  const blockNumber = Number(decode("arbBlockNumber", results[i++])[0]);
  const totalSupply = decode("totalSupply", results[i++])[0];

  const locked = [];
  let lockedBalance = 0n;
  let lockedStake = 0n;
  for (const c of candidates) {
    const end = Number(decode("end", results[i++])[0]);
    const balance = decode("balanceOf", results[i++])[0];
    const { activeStake } = decode("getUserStake", results[i++]);
    if (end <= blockTimestamp) continue; // vesting over: whatever is left is circulating
    lockedBalance += balance;
    lockedStake += activeStake;
    locked.push({ address: c.address, start: c.start, end, balance, activeStake });
  }

  const circulating = totalSupply - lockedBalance - lockedStake;
  if (circulating < 0n || circulating > totalSupply) {
    throw new Error(`implausible circulating supply ${circulating}`);
  }
  return { blockNumber, blockTimestamp, totalSupply, circulating, lockedBalance, lockedStake, locked, candidates: candidates.length };
}

/** Whole tokens, rounded down, as a decimal string. */
function toWhole(amount) {
  return (amount / 10n ** BigInt(DECIMALS)).toString();
}

/** Exact decimal string (18 decimals, trailing zeros trimmed). */
function toDecimal(amount) {
  return ethers.formatUnits(amount, DECIMALS);
}

module.exports = {
  ARBITRUM_CHAIN_ID,
  DEFAULT_RPC,
  IDOS_TOKEN,
  NODE_STAKING,
  MULTICALL3,
  ARBSYS,
  DECIMALS,
  FIRST_TRANSFER_BLOCK,
  IFACE,
  makeProvider,
  loadRegistry,
  multicall,
  computeSupply,
  toWhole,
  toDecimal,
};
