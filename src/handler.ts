// src/handler.ts — the tap turn flow.
// Notion: https://www.notion.so/3628b6b1991681a29b12f1849dff9a64
//
// One tap → one turn:
//   1. Read RingState + last 3 turns.
//   2. Order Claude call (its three tools).
//   3. Shadow Claude call (its three tools).
//   4. Throne Claude call (no tools, strict JSON).
//   5. Execute the winner's tool against Notion.
//   6. Apply the StateDelta, clamp, increment turnNumber.
//   7. Check terminal / stalemate.
//   8. Write the Turn row + write the new RingState.

import { callOrder, callShadow, callThrone } from "./agents.js";
import { appendTurn, readRecentTurns, readRingState, writeRingState } from "./notion.js";
import { applyDelta, checkTerminal, scoreWinner } from "./state.js";
import { resolveTool } from "./tools-bridge.js";
import type { RingState, StateDelta, TurnRecord } from "./types.js";

export interface TurnResult {
	turn: TurnRecord | null;
	state: RingState;
	skipped?: "terminal";
}

export async function runTurn(ctx: { notion: any }): Promise<TurnResult> {
	const notion = ctx.notion;

	const state = await readRingState(notion);

	// If the game is already over, the dashboard should reset Ring State manually.
	// We refuse to advance terminal states.
	if (state.status !== "active") {
		console.log(`[handler] game is ${state.status}; ignoring tap`);
		return { turn: null, state, skipped: "terminal" };
	}

	const recent = await readRecentTurns(notion, 3);

	// Three Claude calls, in order. Order → Shadow → Throne.
	const order = await callOrder(state, recent);
	const shadow = await callShadow(state, recent);
	const verdict = await callThrone(state, order, shadow);

	// Execute the winner's tool. If Agent 2's tools/index.ts is missing, we
	// fall back to a stubbed delta so the turn still records and the game
	// keeps advancing. Real tools land via the tools worktree.
	const winningMove = verdict.winner === "order" ? order : shadow;
	let delta: StateDelta;
	try {
		delta = await resolveTool(winningMove.tool, winningMove.args, state, { notion });
	} catch (err) {
		console.error(`[handler] tool ${winningMove.tool} threw, recording as failed:`, err);
		delta = { failed: true };
	}

	// Apply delta, then increment the turn counter and check terminal.
	let next = applyDelta(state, delta);
	next = { ...next, turnNumber: state.turnNumber + 1 };
	next = checkTerminal(next);

	const turn: TurnRecord = {
		turn: next.turnNumber,
		orderMove: order.tool,
		orderReasoning: order.reasoning,
		shadowMove: shadow.tool,
		shadowReasoning: shadow.reasoning,
		winner: verdict.winner,
		throneVerdict: verdict.reasoning,
		integrityAfter: next.integrity,
		secrecyAfter: next.secrecy,
		timestamp: new Date().toISOString(),
	};

	await appendTurn(notion, turn);
	await writeRingState(notion, next);

	if (next.status === "stalemate") {
		console.log(`[handler] stalemate at turn ${next.turnNumber}; score winner: ${scoreWinner(next)}`);
	}

	return { turn, state: next };
}
