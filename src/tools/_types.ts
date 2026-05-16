// src/tools/_types.ts
//
// Local stand-in for `../types` until Agent 1 lands `src/types.ts` on main.
// When that file exists, every tool's `import ... from "./_types"` swap to
// `import ... from "../types"` and this file gets deleted.

import type { Client } from "@notionhq/client";

export type Holder = "order" | "shadow" | "free";
export type GameStatus = "active" | "destroyed" | "exfiltrated" | "stalemate";

export interface RingState {
	holder: Holder;
	integrity: number;
	secrecy: number;
	turnNumber: number;
	status: GameStatus;
}

export interface StateDelta {
	holder?: Holder;
	integrityDelta?: number;
	secrecyDelta?: number;
	capAt100?: boolean;
	status?: GameStatus;
	failed?: boolean;
}

export interface ToolContext {
	notion: Client;
}

export interface Tool<TInput = Record<string, never>> {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	execute(
		input: TInput,
		state: RingState,
		ctx: ToolContext,
	): Promise<StateDelta>;
}
