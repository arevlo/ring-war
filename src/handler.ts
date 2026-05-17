// src/handler.ts — the tap turn flow.
// Notion: https://www.notion.so/3628b6b1991681a29b12f1849dff9a64
//
// One tap → one turn:
//   1. Read RingState + last 3 turns.
//   2. Mark Ring State `status="summoning"` so the dashboard's next poll
//      sees the in-flight tap and lights up the same UI a local button
//      click triggers (red eye, locked summon button, placeholder card).
//      Doubles as a soft lock against parallel cold-start duplicates.
//   3. Order Claude call (its three tools).
//   4. Shadow Claude call (its three tools).
//   5. Throne Claude call (no tools, strict JSON).
//   6. Execute the winner's tool against Notion.
//   7. Apply the StateDelta, clamp, increment turnNumber.
//   8. Check terminal / stalemate.
//   9. Concurrent-winner recheck — abort if state.turn moved during the
//      Claude window.
//  10. Write the Turn row + write the new RingState (clears summoning).
//
// `finally` restores `status="active"` if we wrote the summoning marker
// but didn't reach the end-write (error path or concurrent-winner abort),
// so the soft lock auto-recovers.

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

	// Refuse terminal states (game over). Also refuse "summoning" — another
	// tap is already mid-flight, so this is a near-simultaneous cold-start
	// duplicate and we don't want two parallel Claude chains. The marker is
	// cleared by the in-flight tap's end-write (or the finally-block restore
	// below if that tap errors), so this lock auto-recovers.
	if (state.status !== "active") {
		console.log(`[handler] state is ${state.status}; ignoring tap`);
		return { turn: null, state, skipped: "terminal" };
	}

	// In-flight marker. Writing status="summoning" updates Ring State
	// immediately (select property values propagate without Notion's
	// minute-bucketed last_edited_time delay), so the dashboard's next 2s
	// poll detects an external tap is being processed and lights up the
	// same red-eye + locked summon button + placeholder card that the
	// local button press triggers.
	let summoningWritten = false;
	try {
		await writeRingState(notion, { ...state, status: "summoning" });
		summoningWritten = true;

		const recent = await readRecentTurns(notion, 3);

		// Three Claude calls, in order. Order → Shadow → Throne.
		const order = await callOrder(state, recent);
		const shadow = await callShadow(state, recent);
		const verdict = await callThrone(state, order, shadow);

		// Execute the winner's tool. If Agent 2's tools/index.ts is missing,
		// we fall back to a stubbed delta so the turn still records and the
		// game keeps advancing. Real tools land via the tools worktree.
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

		// Concurrent-winner guard. The in-memory tap debounce in index.ts
		// can't catch two webhook deliveries that cold-start on separate
		// worker instances (each sees lastTapAt=0). Without this guard,
		// both would happily write the same turn N+1, producing duplicate
		// Turns DB rows. Cost: one extra Notion read per tap, sequential —
		// no burst impact, ~10% per-tap overhead.
		//
		// Race window: there's still a ~300-500ms gap between this re-read
		// and the writes below where two perfectly-synchronised instances
		// could both see the unchanged turn counter and both proceed. The
		// only way to close that completely is an iPhone-Shortcut-side
		// dedupe (blocks at the source before either POST is sent).
		const recheck = await readRingState(notion);
		if (recheck.turnNumber !== state.turnNumber) {
			console.log(
				`[handler] concurrent winner detected (state.turn moved ${state.turnNumber} → ${recheck.turnNumber}); aborting write`,
			);
			return { turn: null, state: recheck, skipped: "terminal" };
		}

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
		// End-write succeeded; status is now next.status (active/destroyed/…),
		// no need to restore.
		summoningWritten = false;

		if (next.status === "stalemate") {
			console.log(`[handler] stalemate at turn ${next.turnNumber}; score winner: ${scoreWinner(next)}`);
		}

		return { turn, state: next };
	} finally {
		// Either an error threw out of the try, or we hit the concurrent-
		// winner early-return. Restore status to "active" so the in-flight
		// marker doesn't leak and lock out future taps. Best-effort — a
		// failure here just means the user has to /api/reset to recover.
		if (summoningWritten) {
			try {
				await writeRingState(notion, state);
				console.log(`[handler] restored status=${state.status} after summoning abort`);
			} catch (restoreErr) {
				console.warn("[handler] failed to restore status after summoning abort:", restoreErr);
			}
		}
	}
}
