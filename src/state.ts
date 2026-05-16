// src/state.ts — RingState delta application + terminal/stalemate logic.
// Notion: https://www.notion.so/3628b6b1991681a6b235c851685c942f

import type { GameStatus, RingState, StateDelta } from "./types.js";

const MAX_TURN = 10;

// applyDelta consumes a tool's StateDelta and returns a new RingState.
// Numeric fields on the delta are RELATIVE (integrityDelta=-8 means subtract 8).
// holder/status are absolute when set. When delta.failed is true, all numeric/
// holder/status fields are ignored (the turn still advances via the handler).
export function applyDelta(state: RingState, delta: StateDelta): RingState {
	if (delta.failed) return state;

	const integrity = clamp(state.integrity + (delta.integrityDelta ?? 0), delta.capAt100);
	const secrecy = clamp(state.secrecy + (delta.secrecyDelta ?? 0), delta.capAt100);

	return {
		holder: delta.holder ?? state.holder,
		integrity,
		secrecy,
		turnNumber: state.turnNumber,
		status: delta.status ?? state.status,
	};
}

export function clamp(value: number, _capAt100?: boolean): number {
	if (!Number.isFinite(value)) return 0;
	// capAt100 is informational only; clamping is always to [0, 100].
	return Math.max(0, Math.min(100, value));
}

// After applying a delta and incrementing turnNumber, check terminal conditions.
// - integrity <= 0 → destroyed
// - secrecy <= 0 → exfiltrated
// - turnNumber >= MAX_TURN and still active → stalemate
export function checkTerminal(state: RingState): RingState {
	if (state.status !== "active") return state;
	if (state.integrity <= 0) return { ...state, status: "destroyed" as GameStatus };
	if (state.secrecy <= 0) return { ...state, status: "exfiltrated" as GameStatus };
	if (state.turnNumber >= MAX_TURN) return { ...state, status: "stalemate" as GameStatus };
	return state;
}

// Returns which team's score is higher when the game ended in stalemate.
// Order = integrity. Shadow = 100 - secrecy. Ties go to Order (defender's edge).
export function scoreWinner(state: RingState): "order" | "shadow" {
	const orderScore = state.integrity;
	const shadowScore = 100 - state.secrecy;
	return shadowScore > orderScore ? "shadow" : "order";
}
