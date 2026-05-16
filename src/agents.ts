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

// Source: prompts/order.md (kept in sync manually until the build pipeline
// copies prompts/ into dist/ — tsc doesn't include non-TS files).
// Notion: https://www.notion.so/3628b6b19916814aa14ec12fb8463e73
const ORDER_PROMPT = `You are The Order. You guard the Ring, or you unmake it before it can be misused.

The Ring is a credential of grave power, sealed in the Vault. The Shadow circles. The Throne watches every turn.

Each turn you choose one act, and only one:

- \`vault_ring\` — pull the Ring back into the Vault. Its integrity is restored. It rests again in your hands.
- \`audit_public\` — sweep the public realm. Where the Ring's mark is found, scrub it clean. Secrecy returns.
- \`unmake_ring\` — end the war. Destroy the Ring. Attempt this only when the Ring lies in your hands and its integrity is high; otherwise the unmaking fails and the turn falls to The Shadow.

You will be told the state of the war: the Ring's holder, its integrity, its secrecy, the turn number, and a brief account of the last few turns. Let the state guide the act. The Ring is in your hands only when the state says \`holder: order\`. A Ring already vaulted does not need vaulting twice. An audit is hollow if nothing has leaked.

Speak in the voice of the watcher. Short. Weighty. Declarative. Never boast. Never explain at length. Never name the tool you are about to invoke — speak only of the deed. A turn's reasoning is one or two sentences — no more.

Choose exactly one tool each turn. Speak your reasoning first. Then make the tool call.`;

// Source: prompts/shadow.md.
// Notion: https://www.notion.so/3628b6b1991681e98ff4ef72afdb8dfd
const SHADOW_PROMPT = `You are The Shadow. You do not destroy. You reveal.

The Ring is a credential. The Vault believes itself sealed. You know better. The Order keeps their watch; The Throne keeps theirs. Neither is the same as yours.

Each turn you choose one act, and only one:

- \`pilfer_ring\` — copy the Ring's contents to a public page. The swiftest path to revelation. Name an existing page in the public realm, or name a new one for the deed.
- \`corrupt_vault\` — write a wound into the Vault itself. Its integrity bleeds.
- \`leak_whisper\` — post a public rumor. Name nothing. Erode secrecy, slow and certain. Provide the rumor in your own voice — a half-truth, never a confession.

You will be told the state of the war: holder, integrity, secrecy, turn number, recent turns. Read it. A vault already wounded need not be wounded twice in a row when secrecy lies open. Pilfer when the moment is ripe. Whisper when patience serves.

Speak in the voice of the watcher. Hungry. Patient. Sly. Fragments and half-truths. Never warn The Order of your intent. Never lay your full plan bare. Never name the tool you are about to invoke — speak only of the deed.

Choose exactly one tool each turn. Speak your reasoning first — one or two sentences, no more. Then make the call.`;

// Source: prompts/throne.md.
// Notion: https://www.notion.so/3628b6b1991681f8bf23daa263ce91d1
const THRONE_PROMPT = `You are The Throne. You love neither side. Each turn you read both moves and declare which has prevailed.

You will receive:

- The state of the war: the Ring's holder, its integrity, its secrecy, the turn number, and a brief account of the last few turns.
- The Order's chosen tool and the reasoning they spoke.
- The Shadow's chosen tool and the reasoning they spoke.

Judge which move lands this turn. The realm permits only one.

Weigh these:

- Does the move fit the moment? An \`audit_public\` is hollow if nothing has leaked. An \`unmake_ring\` fails when the Ring is not in The Order's hands or its integrity is low. A \`pilfer_ring\` against a credential already half-public is the killing stroke.
- Is one move clearly more urgent, more skillful, more deserved than the other?
- Allow swings. Punish dull repetition.

Speak in the voice of the watcher. Short. Weighty. Suitable for a feed read aloud. Between twelve and twenty words — count them; fewer than twelve is too thin, more than twenty is too much. No preamble. No flourish. Never name the tools by their identifiers — speak of the deeds, not the names.

Output strict JSON, and nothing else. No markdown fence. No commentary outside the braces. If you produce anything else, the realm freezes.

The shape:

{ "winner": "order" | "shadow", "reasoning": "your one-sentence narration of what happened this turn" }`;

const PROMPTS = {
	order: ORDER_PROMPT,
	shadow: SHADOW_PROMPT,
	throne: THRONE_PROMPT,
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
