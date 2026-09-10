import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createPublicClient, decodeEventLog, http, keccak256, toHex } from "viem";
import { base } from "viem/chains";
import { ACP_ABI } from "../research/acp-node-v2/src/core/acpAbi.ts";

const ACP = "0x238E541BfefD82238730D00a2208E5497F1832E0" as const;
const JOB_STATUS = ["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"];
const WINDOW = 2000n; // mainnet.base.org caps eth_getLogs at a 2000-block range

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
};
const jobId = argv.find((a) => !a.startsWith("--") && !/^https?:/.test(a));
if (!jobId) {
  console.error("usage: npx tsx scripts/acp_inspect.ts <jobId> [--rpc <url>] [--blocks <n>] [--out <path>]");
  process.exit(2);
}
const rpc = flag("--rpc") ?? "https://mainnet.base.org";
const outPath = flag("--out");
const bindPath = flag("--bind-deliverable");
const maxBlocks = BigInt(flag("--blocks") ?? "30000");

const client = createPublicClient({ chain: base, transport: http(rpc, { timeout: 25000, retryCount: 2 }) });
const json = (v) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);
const asText = (hex) => {
  const raw = hex.slice(2).replace(/(00)+$/, "");
  return raw.length % 2 === 0 ? Buffer.from(raw, "hex").toString("utf8").replace(/\0+$/, "") : "";
};

const latest = await client.getBlockNumber();
const events = [];
let top = latest;
let scanned = 0n;
let foundCreation = false;
while (scanned < maxBlocks && top > 0n) {
  const from = top >= WINDOW ? top - WINDOW + 1n : 0n;
  const logs = await client.getLogs({ address: ACP, fromBlock: from, toBlock: top });
  for (const log of logs) {
    let decoded;
    try {
      decoded = decodeEventLog({ abi: ACP_ABI, data: log.data, topics: log.topics });
    } catch {
      continue;
    }
    const raw = decoded.args ?? {};
    if (String(raw.jobId ?? "") !== jobId) continue;
    const args = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key === "jobId") continue;
      args[key] = value;
      if (typeof value === "string" && value.length === 66 && value.startsWith("0x") && !/^0x0+$/.test(value)) {
        const text = asText(value);
        if (/^[\x20-\x7e]+$/.test(text)) args[key + "_text"] = text;
      }
    }
    events.push({ event: decoded.eventName, block: log.blockNumber.toString(), tx: log.transactionHash, args });
    if (decoded.eventName === "JobCreated") foundCreation = true;
  }
  scanned += top - from + 1n;
  if (foundCreation) break;
  top = from - 1n;
}
events.reverse();

const blocks = [...new Set(events.map((e) => e.block))];
const stamps = new Map();
for (const b of blocks) {
  const block = await client.getBlock({ blockNumber: BigInt(b) });
  stamps.set(b, new Date(Number(block.timestamp) * 1000).toISOString());
}
for (const e of events) e.when = stamps.get(e.block);

const job = await client.readContract({ address: ACP, abi: ACP_ABI, functionName: "getJob", args: [BigInt(jobId)] });
const statusCode = Number(job.status);
const expiredAt = Number(job.expiredAt);
const onChain = {
  client: job.client,
  status_code: statusCode,
  status: JOB_STATUS[statusCode] ?? "UNKNOWN(" + statusCode + ")",
  provider: job.provider,
  expired_at_unix: expiredAt,
  expired_at_iso: expiredAt ? new Date(expiredAt * 1000).toISOString() : null,
  evaluator: job.evaluator,
  hook: job.hook,
  budget_raw: job.budget,
  budget_usdc: Number(job.budget) / 1e6,
};

const rejections = events.filter((e) => e.event === "JobRejected");
let binding = null;
if (bindPath) {
  const body = readFileSync(bindPath, "utf8").replace(/\n$/, "");
  const onchain = events.find((e) => e.event === "JobSubmitted")?.args.deliverable ?? null;
  const observed = keccak256(toHex(body));
  binding = {
    deliverable_path: bindPath,
    deliverable_bytes: Buffer.byteLength(body, "utf8"),
    deliverable_sha256: "sha256:" + createHash("sha256").update(body, "utf8").digest("hex"),
    observed_keccak256: observed,
    onchain_job_submitted_hash: onchain,
    match: onchain !== null && String(onchain).toLowerCase() === observed.toLowerCase(),
  };
}

const result = {
  acp_job_id: jobId,
  chain_id: base.id,
  network: "base-mainnet",
  acp_contract: ACP,
  rpc,
  inspected_at: new Date().toISOString(),
  latest_block: latest.toString(),
  search_block_from: (latest - scanned + 1n).toString(),
  blocks_scanned: scanned.toString(),
  creation_event_found: foundCreation,
  on_chain_job: onChain,
  final_status: onChain.status,
  rejected: rejections.length > 0,
  rejection_reason: rejections.length ? rejections[0].args.reason_text ?? rejections[0].args.reason : null,
  deliverable_binding: binding,
  observed_events: events,
  timeline: events.map((e) => ({ when: e.when, event: e.event, block: e.block })),
  log_scan_truncated: !foundCreation && scanned >= maxBlocks,
};
const text = json(result);
if (outPath) writeFileSync(outPath, text + "\n");
console.log(text);
