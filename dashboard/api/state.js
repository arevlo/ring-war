// dashboard/api/state.js
//
// Notion: doc 03 (schemas) https://www.notion.so/3628b6b1991681a6b235c851685c942f
//         doc 08 (dashboard) https://www.notion.so/3628b6b19916811ca5cbc269c61e2b08
//
// Polled every ~2s by the static dashboard. Reads Ring State (single row) and the
// 10 most recent Turns from Notion via the integration token (server-side only;
// never ships to the browser).
//
// Returns the shape the dashboard already renders against:
//   { state: { holder, integrity, secrecy, turn, status },
//     turns: [ { turn, timestamp, order:{move,reasoning}, shadow:{move,reasoning}, throne:{winner,reasoning} } ] }
//
// Note the `state.turn` field — the canonical type in src/types.ts calls it
// `turnNumber`. The dashboard was built against the shorter name, so the API
// normalises here rather than churning the renderer.

import { Client } from "@notionhq/client";

const RING_STATE_DB_ID = process.env.RING_STATE_DB_ID;
const TURNS_DB_ID = process.env.TURNS_DB_ID;
const NOTION_TOKEN = process.env.NOTION_TOKEN;

const dsCache = new Map();
async function resolveDataSourceId(notion, databaseId) {
	const cached = dsCache.get(databaseId);
	if (cached) return cached;
	const db = await notion.databases.retrieve({ database_id: databaseId });
	const sources = db && db.data_sources;
	if (!Array.isArray(sources) || sources.length === 0) {
		throw new Error(`Database ${databaseId} has no data sources`);
	}
	const id = sources[0].id;
	dsCache.set(databaseId, id);
	return id;
}

function readTitle(prop) {
	return ((prop && prop.title) || []).map((t) => t.plain_text || "").join("");
}
function readRichText(prop) {
	return ((prop && prop.rich_text) || []).map((t) => t.plain_text || "").join("");
}
function readNumber(prop, fallback) {
	return prop && typeof prop.number === "number" ? prop.number : fallback;
}
function readSelect(prop, fallback) {
	return (prop && prop.select && prop.select.name) || fallback;
}

export default async function handler(req, res) {
	res.setHeader("Cache-Control", "no-store");
	res.setHeader("Access-Control-Allow-Origin", "*");

	if (!NOTION_TOKEN || !RING_STATE_DB_ID || !TURNS_DB_ID) {
		res.status(500).json({
			error: "missing env",
			missing: {
				NOTION_TOKEN: !NOTION_TOKEN,
				RING_STATE_DB_ID: !RING_STATE_DB_ID,
				TURNS_DB_ID: !TURNS_DB_ID,
			},
		});
		return;
	}

	const notion = new Client({ auth: NOTION_TOKEN });

	try {
		// --- Ring State (single row) ---
		const stateDS = await resolveDataSourceId(notion, RING_STATE_DB_ID);
		const stateRes = await notion.dataSources.query({
			data_source_id: stateDS,
			page_size: 1,
		});
		const stateRow = stateRes.results[0];
		const sp = (stateRow && stateRow.properties) || {};
		const state = {
			holder: readSelect(sp.Holder, "free"),
			integrity: readNumber(sp.Integrity, 100),
			secrecy: readNumber(sp.Secrecy, 100),
			turn: readNumber(sp["Turn number"], 0),
			// Status can be "active", terminal ("destroyed"/"exfiltrated"/
			// "stalemate"), or transient "summoning" (worker marker set at
			// the start of a tap so the dashboard's next poll can render
			// the in-flight UI for NFC/external taps without waiting for
			// the Turn row to arrive).
			status: readSelect(sp.Status, "active"),
		};

		// --- Recent turns (newest first) ---
		const turnsDS = await resolveDataSourceId(notion, TURNS_DB_ID);
		const turnsRes = await notion.dataSources.query({
			data_source_id: turnsDS,
			page_size: 10,
			sorts: [{ property: "Timestamp", direction: "descending" }],
		});
		const turns = turnsRes.results.map((page) => {
			const p = page.properties || {};
			const turnStr = readTitle(p.Turn);
			const turn = parseInt(turnStr.replace(/[^0-9]/g, ""), 10) || 0;
			const winner = readSelect(p.Winner, "order");
			return {
				turn,
				timestamp:
					(p.Timestamp && p.Timestamp.created_time) ||
					page.created_time ||
					new Date().toISOString(),
				order: {
					move: readRichText(p["Order move"]),
					reasoning: readRichText(p["Order reasoning"]),
				},
				shadow: {
					move: readRichText(p["Shadow move"]),
					reasoning: readRichText(p["Shadow reasoning"]),
				},
				throne: {
					winner,
					reasoning: readRichText(p["Throne verdict"]),
				},
			};
		});

		res.status(200).json({ state, turns });
	} catch (err) {
		console.error("[/api/state] failed:", err);
		res.status(500).json({ error: String((err && err.message) || err) });
	}
}
