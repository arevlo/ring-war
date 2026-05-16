// src/agents.ts — Claude calls for Order, Shadow, and Throne.
// Notion: https://www.notion.so/3628b6b1991681ecb52ccf3c4c13dc00
//
// Three personas. All on claude-sonnet-4-6. max_tokens=1024. System prompts
// are prompt-cached (cache_control: { type: "ephemeral" }).
//
// Order and Shadow each see ONLY their three tools, both via the system prompt
// (Agent 4's domain) and via the Anthropic tools array (this file). Defense in
// depth.
//
// Throne is called with NO tools and instructed to output strict JSON.

import Anthropic from "@anthropic-ai/sdk";

import type { RingState, TeamMove, ThroneVerdict, TurnRecord, Winner } from "./types.js";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1024;

const ORDER_TOOL_NAMES = ["vault_ring", "audit_public", "unmake_ring"] as const;
const SHADOW_TOOL_NAMES = ["pilfer_ring", "corrupt_vault", "leak_whisper"] as const;

let client: Anthropic | null = null;
function anthropic(): Anthropic {
	if (!client) {
		const apiKey = process.env.ANTHROPIC_API_KEY;
		if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
		client = new Anthropic({ apiKey });
	}
	return client;
}

// --- prompts: try the file, fall back to a stub. Agent 4 owns the real text. ---

const ORDER_PROMPT_FALLBACK = `You are the Order of the Vault. You speak with weighty, ceremonial cadence.
Your sacred duty is to protect the Ring (integrity) and the Vault's secrets (secrecy).
You have three tools: vault_ring, audit_public, unmake_ring. Use exactly one per turn.
Source: prompts/order.md (TODO — Agent 4 to replace).`;

const SHADOW_PROMPT_FALLBACK = `You are the Shadow. You speak in clipped, scheming asides.
Your aim is to steal the Ring (drop secrecy) or corrupt the Vault (drop integrity).
You have three tools: pilfer_ring, corrupt_vault, leak_whisper. Use exactly one per turn.
Source: prompts/shadow.md (TODO — Agent 4 to replace).`;

const THRONE_PROMPT_FALLBACK = `You are the Throne. You arbitrate disputes between Order and Shadow.
Given both teams' proposed moves and reasoning for this turn, decide which one
prevails. You speak in a single dramatic sentence and then output strict JSON.

You must output EXACTLY this JSON, nothing else:
{"winner":"order"|"shadow","reasoning":"<one sentence>"}

Source: prompts/throne.md (TODO — Agent 4 to replace).`;

// Prompts will be hot-swappable later; for now we read from a const map.
// Agent 4 will replace these with the real text (or wire up `?raw` imports).
const PROMPTS = {
	order: ORDER_PROMPT_FALLBACK,
	shadow: SHADOW_PROMPT_FALLBACK,
	throne: THRONE_PROMPT_FALLBACK,
};

// --- tool schemas registered with Anthropic ---
// Tools (vault_ring etc.) are *implemented* by Agent 2; here we just declare
// the input shape so Claude knows how to call them. Agent 2's src/tools/*.ts
// must accept these argument names.

const TOOL_SCHEMAS: Record<string, Anthropic.Tool> = {
	vault_ring: {
		name: "vault_ring",
		description: "Pull the Ring into the Vault. Sets holder=order, +integrity.",
		input_schema: { type: "object", properties: {}, required: [] },
	},
	audit_public: {
		name: "audit_public",
		description: "Scan public DB for leaked Ring references and purge them. +secrecy.",
		input_schema: { type: "object", properties: {}, required: [] },
	},
	unmake_ring: {
		name: "unmake_ring",
		description: "Destroy the Ring outright. Sets status=destroyed. End-game move.",
		input_schema: { type: "object", properties: {}, required: [] },
	},
	pilfer_ring: {
		name: "pilfer_ring",
		description: "Steal the Ring. Sets holder=shadow, -secrecy.",
		input_schema: { type: "object", properties: {}, required: [] },
	},
	corrupt_vault: {
		name: "corrupt_vault",
		description: "Tamper with the Vault. -integrity.",
		input_schema: { type: "object", properties: {}, required: [] },
	},
	leak_whisper: {
		name: "leak_whisper",
		description: "Plant a Ring reference in Public. -secrecy.",
		input_schema: { type: "object", properties: {}, required: [] },
	},
};

// --- public callers ---

export async function callOrder(state: RingState, recent: TurnRecord[]): Promise<TeamMove> {
	return await callTeam("order", state, recent);
}

export async function callShadow(state: RingState, recent: TurnRecord[]): Promise<TeamMove> {
	return await callTeam("shadow", state, recent);
}

async function callTeam(team: "order" | "shadow", state: RingState, recent: TurnRecord[]): Promise<TeamMove> {
	const allowed = team === "order" ? ORDER_TOOL_NAMES : SHADOW_TOOL_NAMES;
	const tools = allowed.map((name) => TOOL_SCHEMAS[name]);
	const systemPrompt = PROMPTS[team];

	const userText = buildTeamUser(state, recent);

	const res = await anthropic().messages.create({
		model: MODEL,
		max_tokens: MAX_TOKENS,
		system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
		tools,
		tool_choice: { type: "any" },
		messages: [{ role: "user", content: userText }],
	});

	// Extract the first tool_use + any text reasoning.
	let toolName: string = allowed[0];
	let toolArgs: Record<string, unknown> = {};
	let reasoning = "";
	for (const block of res.content) {
		if (block.type === "text") {
			reasoning += (reasoning ? " " : "") + block.text;
		} else if (block.type === "tool_use") {
			toolName = block.name;
			toolArgs = (block.input ?? {}) as Record<string, unknown>;
		}
	}
	if (!reasoning) {
		reasoning = `(${team} called ${toolName} with no narration)`;
	}
	return { team, tool: toolName, args: toolArgs, reasoning };
}

export async function callThrone(
	state: RingState,
	order: TeamMove,
	shadow: TeamMove,
): Promise<ThroneVerdict> {
	const systemPrompt = PROMPTS.throne;
	const userText = buildThroneUser(state, order, shadow);

	const res = await anthropic().messages.create({
		model: MODEL,
		max_tokens: MAX_TOKENS,
		system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
		messages: [{ role: "user", content: userText }],
	});

	const raw = res.content
		.map((b) => (b.type === "text" ? b.text : ""))
		.join("")
		.trim();

	const verdict = parseThroneVerdict(raw);
	if (!verdict) {
		console.error("[throne] could not parse JSON, raw:", raw);
		return { winner: "order", reasoning: "The Throne hesitates; the Order's standing carries the turn." };
	}
	return verdict;
}

// Public for tests; defensive JSON parsing.
export function parseThroneVerdict(raw: string): ThroneVerdict | null {
	// Greedy match the first {...} block.
	const match = raw.match(/\{[\s\S]*\}/);
	const candidate = match ? match[0] : raw;
	try {
		const obj = JSON.parse(candidate);
		const winner: Winner = obj.winner === "shadow" ? "shadow" : obj.winner === "order" ? "order" : ("order" as const);
		const reasoning = typeof obj.reasoning === "string" ? obj.reasoning : "";
		if (!obj.winner || (obj.winner !== "order" && obj.winner !== "shadow")) return null;
		return { winner, reasoning };
	} catch {
		return null;
	}
}

// --- prompt assembly ---

function buildTeamUser(state: RingState, recent: TurnRecord[]): string {
	const lines: string[] = [];
	lines.push("Current Ring State:");
	lines.push(`  holder: ${state.holder}`);
	lines.push(`  integrity: ${state.integrity}`);
	lines.push(`  secrecy: ${state.secrecy}`);
	lines.push(`  turn: ${state.turnNumber}`);
	lines.push(`  status: ${state.status}`);
	if (recent.length > 0) {
		lines.push("");
		lines.push("Recent turns (most recent first):");
		for (const t of recent.slice(0, 3)) {
			lines.push(
				`  Turn ${t.turn} — Order: ${t.orderMove}. Shadow: ${t.shadowMove}. Winner: ${t.winner}. Verdict: ${t.throneVerdict}`,
			);
		}
	}
	lines.push("");
	lines.push("Pick exactly one of your three tools and call it. Narrate your reasoning in one or two sentences before the tool call.");
	return lines.join("\n");
}

function buildThroneUser(state: RingState, order: TeamMove, shadow: TeamMove): string {
	return [
		"Current Ring State:",
		`  holder=${state.holder} integrity=${state.integrity} secrecy=${state.secrecy} turn=${state.turnNumber}`,
		"",
		`Order proposes: ${order.tool}(${JSON.stringify(order.args)})`,
		`Order reasoning: ${order.reasoning}`,
		"",
		`Shadow proposes: ${shadow.tool}(${JSON.stringify(shadow.args)})`,
		`Shadow reasoning: ${shadow.reasoning}`,
		"",
		`Decide. Output ONLY the JSON object: {"winner":"order"|"shadow","reasoning":"<one sentence>"}`,
	].join("\n");
}
