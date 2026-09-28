import { createHash } from "node:crypto";

export const SCENARIO_ID = "litfamily-speed-lit-activation-v1";
export const VALIDATION_SCHEMA = "litfamily.harness-speed-validation/v1";
export const UNAVAILABLE = "UNAVAILABLE";
export const PHASES = [
  ["B0", 69, "a5f634868cc6e20375f60803dcbe850eeb3d2709d6bb2c0efee204b9b5534904", 15, "7652e386a8825b8459833ec8aa7d19fa6a55bf82652f63f45cc4ae29bcfee17b"],
  ["S1", 73, "a52e0ec9444cc2195c1c8dbb638862251f1f07df0512c505d06b43d44d4a4e78", 15, "8a655cd5ccd93b2727d641b5ca444e0f72bc09016115b7b6b16aa29e8457414a"],
  ["S2", 99, "7b6712f5542798968a74a56241689f40475d50851d5a4d80f877d9a2589983a0", 15, "482d6b2f6dc3a90d5feb4aef7615f715ef2ffbceea5e5ffde90f070175c22dc8"],
];

export class ContractError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export const fail = (code) => { throw new ContractError(code); };
export const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return fail("MALFORMED_JSON");
  }
}

export function validateScenarioText(text) {
  const value = parseJson(text);
  if (sha256(text) !== "aaef5ba778532013248f0b5c0a9f958468786840595e48cb84851ab88bf2b4be"
    || Buffer.byteLength(text, "utf8") !== 1476) fail("STALE_SCENARIO");
  if (!isObject(value) || value.schema !== "litfamily.harness-speed-scenario/v1"
    || value.scenario_id !== SCENARIO_ID || value.encoding !== "UTF-8"
    || value.prompt_trailing_newline !== false || !Array.isArray(value.records)
    || value.records.length !== PHASES.length) fail("INVALID_SCENARIO");
  for (const [index, record] of value.records.entries()) {
    const expected = PHASES[index];
    if (!isObject(record) || record.id !== expected[0] || record.measured !== (index > 0)
      || Buffer.byteLength(record.prompt, "utf8") !== expected[1] || record.prompt_bytes !== expected[1]
      || sha256(record.prompt) !== expected[2] || record.prompt_sha256 !== expected[2]
      || Buffer.byteLength(record.sentinel, "utf8") !== expected[3] || record.sentinel_bytes !== expected[3]
      || sha256(record.sentinel) !== expected[4] || record.sentinel_sha256 !== expected[4]) fail("INVALID_SCENARIO");
  }
  return {
    schema: VALIDATION_SCHEMA,
    verdict: "PASS",
    scenario_id: SCENARIO_ID,
    encoding: "UTF-8",
    fixture_bytes: Buffer.byteLength(text, "utf8"),
    fixture_sha256: "aaef5ba778532013248f0b5c0a9f958468786840595e48cb84851ab88bf2b4be",
    record_ids: PHASES.map(([id]) => id),
    prompt_sha256: Object.fromEntries(PHASES.map(([id, , hash]) => [id, hash])),
    provider_calls: 0,
  };
}
