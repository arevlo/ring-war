// src/notion.ts — Notion API read/write helpers.
// Notion: https://www.notion.so/3628b6b1991681a6b235c851685c942f
//
// Ring State: single row with title "current", read+write each turn.
// Turns: append-only, read last N for prompts and the dashboard.
//
// The SDK queries data sources, not databases. We resolve each database's
// primary data source on first use and cache the mapping for this process.

import type { Client } from "@notionhq/client";

import type { RingState, TurnRecord, Winner } from "./types.js";

const RING_STATE_DB_ID = () => process.env.RING_STATE_DB_ID ?? "";
const TURNS_DB_ID = () => process.env.TURNS_DB_ID ?? "";

const DEFAULT_STATE: RingState = {
	holder: "free",
	integrity: 100,
	secrecy: 100,
	turnNumber: 0,
	status: "active",
};

const dataSourceCache = new Map<string, string>();

async function resolveDataSourceId(notion: Client, databaseId: string): Promise<string> {
	const cached = dataSourceCache.get(databaseId);
	if (cached) return cached;
	const db = (await notion.databases.retrieve({ database_id: databaseId })) as any;
	const sources = db?.data_sources;
	if (!Array.isArray(sources) || sources.length === 0) {
		throw new Error(`Database ${databaseId} has no data sources`);
	}
	const id = sources[0].id as string;
	dataSourceCache.set(databaseId, id);
	return id;
}

interface RingStatePage {
	id: string;
	state: RingState;
}

export async function readRingState(notion: Client): Promise<RingState> {
	const page = await fetchRingStatePage(notion);
	return page?.state ?? DEFAULT_STATE;
}

export async function writeRingState(notion: Client, next: RingState): Promise<void> {
	const page = await fetchRingStatePage(notion);
	const properties = ringStateToProperties(next);
	if (page) {
		await notion.pages.update({ page_id: page.id, properties: properties as any });
	} else {
		const dbId = RING_STATE_DB_ID();
		if (!dbId) throw new Error("RING_STATE_DB_ID env var is not set");
		await notion.pages.create({
			parent: { database_id: dbId },
			properties: {
				"Game ID": { title: [{ text: { content: "current" } }] },
				...properties,
			} as any,
		});
	}
}

async function fetchRingStatePage(notion: Client): Promise<RingStatePage | null> {
	const dbId = RING_STATE_DB_ID();
	if (!dbId) throw new Error("RING_STATE_DB_ID env var is not set");
	const dataSourceId = await resolveDataSourceId(notion, dbId);
	const res = await notion.dataSources.query({
		data_source_id: dataSourceId,
		page_size: 1,
	});
	const page = res.results[0] as any;
	if (!page || !page.properties) return null;
	const props = page.properties as Record<string, any>;
	const state: RingState = {
		holder: readSelect(props.Holder, "free") as RingState["holder"],
		integrity: readNumber(props.Integrity, 100),
		secrecy: readNumber(props.Secrecy, 100),
		turnNumber: readNumber(props["Turn number"], 0),
		status: readSelect(props.Status, "active") as RingState["status"],
	};
	return { id: page.id, state };
}

function ringStateToProperties(state: RingState): Record<string, unknown> {
	return {
		Holder: { select: { name: state.holder } },
		Integrity: { number: state.integrity },
		Secrecy: { number: state.secrecy },
		"Turn number": { number: state.turnNumber },
		Status: { select: { name: state.status } },
	};
}

export async function appendTurn(notion: Client, turn: TurnRecord): Promise<void> {
	const dbId = TURNS_DB_ID();
	if (!dbId) throw new Error("TURNS_DB_ID env var is not set");
	await notion.pages.create({
		parent: { database_id: dbId },
		properties: {
			Turn: { title: [{ text: { content: `Turn ${turn.turn}` } }] },
			"Order move": richText(turn.orderMove),
			"Order reasoning": richText(turn.orderReasoning),
			"Shadow move": richText(turn.shadowMove),
			"Shadow reasoning": richText(turn.shadowReasoning),
			Winner: { select: { name: turn.winner } },
			"Throne verdict": richText(turn.throneVerdict),
			"Integrity after": { number: turn.integrityAfter },
			"Secrecy after": { number: turn.secrecyAfter },
		} as any,
	});
}

export async function readRecentTurns(notion: Client, limit: number): Promise<TurnRecord[]> {
	const dbId = TURNS_DB_ID();
	if (!dbId) return [];
	const dataSourceId = await resolveDataSourceId(notion, dbId);
	const res = await notion.dataSources.query({
		data_source_id: dataSourceId,
		page_size: limit,
		sorts: [{ property: "Timestamp", direction: "descending" }],
	});
	const rows: TurnRecord[] = [];
	for (const page of res.results as any[]) {
		if (!page.properties) continue;
		const props = page.properties as Record<string, any>;
		const turnStr = readTitle(props.Turn);
		const turnNum = parseInt(turnStr.replace(/[^0-9]/g, ""), 10) || 0;
		rows.push({
			turn: turnNum,
			orderMove: readRichText(props["Order move"]),
			orderReasoning: readRichText(props["Order reasoning"]),
			shadowMove: readRichText(props["Shadow move"]),
			shadowReasoning: readRichText(props["Shadow reasoning"]),
			winner: readSelect(props.Winner, "order") as Winner,
			throneVerdict: readRichText(props["Throne verdict"]),
			integrityAfter: readNumber(props["Integrity after"], 0),
			secrecyAfter: readNumber(props["Secrecy after"], 0),
			timestamp: readCreatedTime(props.Timestamp) ?? new Date().toISOString(),
		});
	}
	return rows;
}

// --- property readers ---

function readNumber(prop: any, fallback: number): number {
	return typeof prop?.number === "number" ? prop.number : fallback;
}

function readSelect(prop: any, fallback: string): string {
	return prop?.select?.name ?? fallback;
}

function readTitle(prop: any): string {
	return (prop?.title ?? []).map((t: any) => t.plain_text ?? "").join("");
}

function readRichText(prop: any): string {
	return (prop?.rich_text ?? []).map((t: any) => t.plain_text ?? "").join("");
}

function readCreatedTime(prop: any): string | null {
	return prop?.created_time ?? null;
}

function richText(content: string): Record<string, unknown> {
	return { rich_text: [{ text: { content: content.slice(0, 2000) } }] };
}
