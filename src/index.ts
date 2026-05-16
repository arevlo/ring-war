// src/index.ts — Ring War worker entry.
// Notion: https://www.notion.so/3628b6b1991681eeb3c4c019ffb1df21
//
// One Worker file. Two webhooks: `tap` (POST — runs one game turn) and
// `state` (GET — observed by the dashboard). All other logic lives in
// agents.ts (Claude calls), notion.ts (DB reads/writes), state.ts (delta apply).

import { Worker } from "@notionhq/workers";

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
			console.log(`[tap] turn ${result.turnNumber} done: winner=${result.winner} status=${result.status}`);
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
