// src/index.ts — Ring War worker entry.
// Notion: https://www.notion.so/3628b6b1991681eeb3c4c019ffb1df21
//
// One Worker file. Two webhooks (`tap`, `state`) for NFC + dashboard, plus
// two tool capabilities (`tapTool`, `stateTool`) so a Notion Custom Agent
// can drive the game from any page via @-mention. All other logic lives in
// agents.ts (Claude calls), notion.ts (DB reads/writes), state.ts (delta apply).

import { Worker } from "@notionhq/workers";
import * as j from "@notionhq/workers/schema-builder";
import type { JSONValue } from "@notionhq/workers/types";

import { runTurn } from "./handler.js";
import { readRingState, readRecentTurns } from "./notion.js";
import type { StateEndpointResponse } from "./types.js";

const worker = new Worker();
export default worker;

// Min interval between accepted taps. The webhook is the only trigger surface,
// so this is the only spend cap. The Anthropic console cap ($30) is the backstop.
const MIN_TAP_INTERVAL_MS = 3_000;
let lastTapAt = 0;

worker.webhook("tap", {
	title: "Ring War — Tap",
	description: "NFC tap entry point. Runs one game turn (Order → Shadow → Throne).",
	execute: async (events, ctx) => {
		const now = Date.now();
		if (now - lastTapAt < MIN_TAP_INTERVAL_MS) {
			console.log(`[tap] rate-limited: ${now - lastTapAt}ms since last tap`);
			return;
		}
		lastTapAt = now;

		// Process the first event only — the platform delivers one at a time today.
		// We don't care about the request body; any tap kicks off a turn.
		const event = events[0];
		console.log(`[tap] received ${event?.method ?? "?"} delivery=${event?.deliveryId ?? "?"}`);

		try {
			const result = await runTurn(ctx);
			if (result.skipped) {
				console.log(`[tap] skipped: game is ${result.state.status}`);
			} else if (result.turn) {
				console.log(
					`[tap] turn ${result.turn.turn} done: winner=${result.turn.winner} status=${result.state.status}`,
				);
			}
		} catch (err) {
			console.error("[tap] turn failed:", err);
			throw err;
		}
	},
});

worker.webhook("state", {
	title: "Ring War — State",
	description: "Returns current RingState + recent TurnRecords for the dashboard.",
	execute: async (_events, ctx) => {
		// The Notion Workers webhook always responds with `{status:"success"}` to
		// the HTTP caller — we can't return a custom body. The dashboard polls
		// Notion directly (or this is invoked as a diagnostic). We log the state
		// JSON so it shows up in `ntn workers runs logs` for debugging.
		const state = await readRingState(ctx.notion);
		const turns = await readRecentTurns(ctx.notion, 10);
		const response: StateEndpointResponse = { state, turns };
		console.log("[state]", JSON.stringify(response));
	},
});

// Tool capabilities: invocation surface for a Notion Custom Agent. Keys are
// `tapTool`/`stateTool` because the webhook surface already owns `tap`/`state`
// (worker capability keys are unique across types). The six game tools
// (vault_ring, audit_public, unmake_ring, pilfer_ring, corrupt_vault,
// leak_whisper) are intentionally NOT registered here — they must only run
// inside the Order → Shadow → Throne dispatch inside `runTurn`.

worker.tool("tapTool", {
	title: "Ring War — Tap",
	description:
		"Advance the Ring War by one turn. Runs Order → Shadow → Throne and executes the winner's tool. Returns the completed turn (order/shadow moves and reasoning, throne verdict, integrity/secrecy after) plus the new state. If the game is already terminal (destroyed/exfiltrated/stalemate), returns skipped='terminal' with the current state and no turn.",
	schema: j.object({}),
	execute: async (_input, ctx) => {
		const result = await runTurn(ctx);
		return result as unknown as JSONValue;
	},
});

worker.tool("stateTool", {
	title: "Ring War — State",
	description:
		"Read the current Ring War state and the most recent 10 turns. Use this to see what's happening without advancing the game.",
	schema: j.object({}),
	hints: { readOnlyHint: true },
	execute: async (_input, ctx) => {
		const state = await readRingState(ctx.notion);
		const turns = await readRecentTurns(ctx.notion, 10);
		const response: StateEndpointResponse = { state, turns };
		return response as unknown as JSONValue;
	},
});
