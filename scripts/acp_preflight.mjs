#!/usr/bin/env node
// Pre-flight validator for an ACP adjudication deliverable.
//
// The buyer/evaluator (scripts/acp_arbitrate.ts) rejects any deliverable that does
// not parse as JSON or does not carry all five required string fields. Providers
// MUST run this before `acp provider submit`, because a rejected job burns the whole
// 30-minute SLA window and refunds the escrow.
//
// usage:
//   node scripts/acp_preflight.mjs <path-to-deliverable.json>
//   node scripts/acp_preflight.mjs --inline "<json>"
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { keccak256, toHex } from "viem";
import { pathToFileURL } from "node:url";

export const REQUIRED_FIELDS = [
  "decision",
  "winning_claim",
  "reason_code",
  "evidence_digest",
  "adjudicated_at",
];

export function validate(raw) {
  const errors = [];
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    errors.push("not-json: " + (err && err.message ? err.message : String(err)));
    return { ok: false, errors, deliverable: null };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    errors.push("not-an-object");
    return { ok: false, errors, deliverable: null };
  }
  for (const field of REQUIRED_FIELDS) {
    if (typeof parsed[field] !== "string") {
      errors.push("field " + field + " must be a string, got " + (parsed[field] === undefined ? "undefined" : typeof parsed[field]));
    } else if (parsed[field].trim() === "") {
      errors.push("field " + field + " must be a non-empty string");
    }
  }
  return { ok: errors.length === 0, errors, deliverable: parsed };
}

export function digests(raw) {
  return {
    bytes: Buffer.byteLength(raw, "utf8"),
    sha256: "sha256:" + createHash("sha256").update(raw, "utf8").digest("hex"),
    keccak256: keccak256(toHex(raw)),
  };
}

function main() {
  const argv = process.argv.slice(2);
  const inlineAt = argv.indexOf("--inline");
  let raw;
  if (inlineAt !== -1) {
    raw = argv[inlineAt + 1] ?? "";
  } else if (argv[0]) {
    raw = readFileSync(argv[0], "utf8").replace(/\n$/, "");
  } else {
    console.error("usage: node scripts/acp_preflight.mjs <deliverable.json> | --inline <json>");
    process.exit(2);
  }
  const result = validate(raw);
  const report = { ok: result.ok, errors: result.errors, required_fields: REQUIRED_FIELDS, ...digests(raw), deliverable: result.deliverable };
  console.log(JSON.stringify(report, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
