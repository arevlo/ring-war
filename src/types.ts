// src/types.ts — Ring War shared types and contracts.
// Notion: https://www.notion.so/3628b6b1991681a6b235c851685c942f
//
// This file is the contract between the Worker Core, the Tools, the Prompts,
// and the Dashboard. Keep it small and stable.

export type Holder = "order" | "shadow" | "free";

export type Status = "active" | "destroyed" | "exfiltrated" | "stalemate";

export type Winner = "order" | "shadow";

export type TeamName = "order" | "shadow";

export interface RingState {
	holder: Holder;
	integrity: number;
	secrecy: number;
	turnNumber: number;
	status: Status;
}

// A StateDelta is the return value of a tool. The handler applies it to the
// current RingState (clamping integrity/secrecy to [0,100], respecting capAt100)
// and writes the result back to the Ring State DB.
//
// - `failed: true` means the tool ran but the move did not land (e.g. defended).
//   The handler should still record the turn but treat it as a no-op delta.
// - `capAt100` means clamp the post-state to 100 even if the math would exceed it
//   (used by Order tools that "restore" a stat that's already at full).
export interface StateDelta {
	holder?: Holder;
	integrity?: number;
	secrecy?: number;
	turnNumber?: number;
	status?: Status;
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
	notion: unknown;
	env: Record<string, string | undefined>;
}

// The shape every Ring War tool implements. Tools return a StateDelta;
// they do not mutate Ring State directly.
export interface Tool<Input = Record<string, unknown>> {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	execute(input: Input, state: RingState, ctx: ToolContext): Promise<StateDelta>;
}

// The dashboard polls this. N=10 most recent turns, newest first.
export interface StateEndpointResponse {
	state: RingState;
	turns: TurnRecord[];
}
