// src/tools-bridge.ts — bridges the handler to Agent 2's tools/ implementations.
// Notion: https://www.notion.so/3628b6b1991681fdb0add5b495cfcecf
//
// Agent 2 owns src/tools/*.ts and exports a `tools` registry from
// src/tools/index.ts. Until that lands on this branch, we fall back to
// plausible stubs so the worker boots and a smoke test runs end-to-end.
//
// IMPORTANT: do not implement real tool logic here. Move it to src/tools/.

import type { RingState, StateDelta, ToolContext } from "./types.js";

interface ToolModule {
	tools?: Record<string, (input: any, state: RingState, ctx: ToolContext) => Promise<StateDelta>>;
}

let registry: ToolModule["tools"] | undefined;
let registryLoaded = false;

async function loadRegistry(): Promise<ToolModule["tools"] | undefined> {
	if (registryLoaded) return registry;
	registryLoaded = true;
	try {
		// Built path so TypeScript doesn't require the file to exist at compile
		// time. Agent 2 lands src/tools/index.ts on its branch independently.
		const path = "./tools/index.js";
		const mod = (await import(path)) as ToolModule;
		registry = mod.tools;
		console.log("[tools-bridge] loaded src/tools/index.ts");
	} catch (err) {
		console.warn("[tools-bridge] src/tools/index.ts not found, using stubs:", String(err));
		registry = undefined;
	}
	return registry;
}

export async function resolveTool(
	name: string,
	input: Record<string, unknown>,
	state: RingState,
	ctx: ToolContext,
): Promise<StateDelta> {
	const reg = await loadRegistry();
	const fn = reg?.[name];
	if (fn) {
		return await fn(input, state, ctx);
	}
	return stubDelta(name);
}

// TODO: remove once Agent 2's src/tools/index.ts lands.
function stubDelta(name: string): StateDelta {
	switch (name) {
		case "vault_ring":
			return { holder: "order", integrityDelta: 8, capAt100: true };
		case "audit_public":
			return { secrecyDelta: 6, capAt100: true };
		case "unmake_ring":
			return { status: "destroyed", integrityDelta: -100 };
		case "pilfer_ring":
			return { holder: "shadow", secrecyDelta: -10 };
		case "corrupt_vault":
			return { integrityDelta: -10 };
		case "leak_whisper":
			return { secrecyDelta: -6 };
		default:
			console.warn(`[tools-bridge] unknown tool ${name}, recording failed`);
			return { failed: true };
	}
}
