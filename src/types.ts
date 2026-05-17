// src/types.ts — Ring War shared types and contracts.
// Notion: https://www.notion.so/3628b6b1991681a6b235c851685c942f
//
// This file is the contract between the Worker Core, the Tools, the Prompts,
// and the Dashboard. Keep it small and stable.

import type { Client } from "@notionhq/client";

export type Holder = "order" | "shadow" | "free";

// "summoning" is a transient in-flight marker written by the tap handler at
// the start of a turn and replaced by the real terminal/active status at the
// end. It exists so the dashboard can detect "a webhook/NFC tap is being
// processed" via /api/state polling, without waiting the full 5–15s for the
// Turn row to appear. Notion's last_edited_time has ~minute precision so it
// can't carry this signal; a status select value updates instantly.
export type GameStatus = "active" | "destroyed" | "exfiltrated" | "stalemate" | "summoning";

export type Winner = "order" | "shadow";

export type TeamName = "order" | "shadow";

export interface RingState {
	holder: Holder;
	integrity: number;
	secrecy: number;
	turnNumber: number;
	status: GameStatus;
}

// A StateDelta is the return value of a tool. The handler applies it to the
// current RingState (clamping integrity/secrecy to [0,100], respecting capAt100)
// and writes the result back to the Ring State DB.
//
// Numeric fields are RELATIVE: integrityDelta=-8 means subtract 8 from current.
// holder/status are absolute when set. Tools that do not move a field omit it.
//
// - `failed: true` means the tool ran but the move did not land (e.g. defended).
//   The handler still advances turnNumber and records the turn, but treats the
//   numeric/holder/status fields as no-ops.
// - `capAt100` means clamp the result at 100 even if the delta would exceed it
//   (Order tools that "restore" a stat already at full).
export interface StateDelta {
	holder?: Holder;
	integrityDelta?: number;
	secrecyDelta?: number;
	status?: GameStatus;
	failed?: boolean;
	capAt100?: boolean;
}

// A single turn as written to the Turns DB.
// Field names mirror the Notion column names from doc 03.
export interface TurnRecord {
	turn: number;
	orderMove: string;
	orderReasoning: string;
	shadowMove: string;
	shadowReasoning: string;
	winner: Winner;
	throneVerdict: string;
	integrityAfter: number;
	secrecyAfter: number;
	timestamp: string;
}

// A move proposed by a team's Claude call: the tool the model picked, its args,
// and the model's one-sentence reasoning.
export interface TeamMove {
	team: TeamName;
	tool: string;
	args: Record<string, unknown>;
	reasoning: string;
}

// The Throne's strict JSON output. Parsed defensively in the handler.
export interface ThroneVerdict {
	winner: Winner;
	reasoning: string;
}

// Context passed to a tool's execute function.
// `notion` is the @notionhq/client SDK instance from the Worker runtime.
export interface ToolContext {
	notion: Client;
}

// The shape every Ring War tool implements. Tools return a StateDelta;
// they do not mutate Ring State directly.
export interface Tool<TInput = Record<string, never>> {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	execute(input: TInput, state: RingState, ctx: ToolContext): Promise<StateDelta>;
}

// The dashboard polls this. N=10 most recent turns, newest first.
export interface StateEndpointResponse {
	state: RingState;
	turns: TurnRecord[];
}
