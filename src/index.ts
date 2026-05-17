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

// Min interval between accepted taps. Two NFC re-reads on a single ring touch
// (iOS occasionally double-fires) can land within 2-3s, so the floor needs to
// be wider than a comfortable human re-tap. 8s covers re-reads plus most user
// "tap again I meant it" double-presses; the worker's normal turn cycle is
// 5-15s anyway, so anything shorter than 8s is suspect.
//
// CAVEAT: lastTapAt / recentDeliveries are module-level state, which is only
// shared within a warm Worker instance. Two truly-concurrent webhook
// invocations from separate cold starts will both see lastTapAt=0 and both
// process. The right fix for that is persisting last-tap-at to Notion (or a
// KV store), but that costs an extra read per tap and hurts the rate-limit
// budget we already bumped into. For now, accept the cold-start blind spot —
// it's rare in practice and adds at most one extra turn.
const MIN_TAP_INTERVAL_MS = 8_000;
let lastTapAt = 0;

// Idempotency dedupe by Notion's deliveryId. If the platform re-delivers the
// same webhook event (retry on timeout, etc.), the deliveryId stays constant
// and we skip rather than re-running the turn. Bounded to the last 32 IDs
// because the Map preserves insertion order and we don't need history.
const recentDeliveries = new Set<string>();
const RECENT_DELIVERIES_MAX = 32;

worker.webhook("tap", {
	title: "Ring War — Tap",
	description: "NFC tap entry point. Runs one game turn (Order → Shadow → Throne).",
	execute: async (events, ctx) => {
		const event = events[0];
		const deliveryId = event?.deliveryId;

		// Dedupe re-deliveries of the same event before the time-window check
		// so a retry doesn't bump lastTapAt and lock out a legitimate next tap.
		if (deliveryId && recentDeliveries.has(deliveryId)) {
			console.log(`[tap] duplicate delivery=${deliveryId} — skipping`);
			return;
		}

		const now = Date.now();
		if (now - lastTapAt < MIN_TAP_INTERVAL_MS) {
			console.log(`[tap] rate-limited: ${now - lastTapAt}ms since last tap (delivery=${deliveryId ?? "?"})`);
			return;
		}
		lastTapAt = now;
		if (deliveryId) {
			recentDeliveries.add(deliveryId);
			if (recentDeliveries.size > RECENT_DELIVERIES_MAX) {
				// Drop oldest. Set iteration is insertion-ordered in JS engines.
				const oldest = recentDeliveries.values().next().value;
				if (oldest !== undefined) recentDeliveries.delete(oldest);
			}
		}

		console.log(`[tap] received ${event?.method ?? "?"} delivery=${deliveryId ?? "?"}`);

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
