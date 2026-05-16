// src/tools/index.ts
//
// Barrel for the six Notion tools. Imported by Agent 1's tools-bridge.ts,
// which dynamic-imports `tools` as a Record keyed by tool name.

import type { Tool } from "../types";

import { vault_ring } from "./vault_ring";
import { audit_public } from "./audit_public";
import { unmake_ring } from "./unmake_ring";
import { pilfer_ring } from "./pilfer_ring";
import { corrupt_vault } from "./corrupt_vault";
import { leak_whisper } from "./leak_whisper";

export { vault_ring } from "./vault_ring";
export { audit_public } from "./audit_public";
export { unmake_ring } from "./unmake_ring";
export { pilfer_ring } from "./pilfer_ring";
export { corrupt_vault } from "./corrupt_vault";
export { leak_whisper } from "./leak_whisper";

// Keyed by tool name so the handler can look up by the string Claude returns
// in `tool_use` blocks. The Tool type with default TInput is wide enough to
// hold all six (pilfer_ring and leak_whisper specialize TInput, but the
// 3-arg execute signature is identical at the call site).
export const tools: Record<string, Tool<never>> = {
	[vault_ring.name]: vault_ring as Tool<never>,
	[audit_public.name]: audit_public as Tool<never>,
	[unmake_ring.name]: unmake_ring as Tool<never>,
	[pilfer_ring.name]: pilfer_ring as unknown as Tool<never>,
	[corrupt_vault.name]: corrupt_vault as Tool<never>,
	[leak_whisper.name]: leak_whisper as unknown as Tool<never>,
};

export default tools;
