// dashboard/api/games.js
//
// Read-only listing of prior games (the "Chronicles" archive). Each row in
// the Games DB is written by /api/reset right before the Turns DB is cleared.
//
// Returns: { games: [ { gameId, started, ended, totalTurns, outcome,
//                       finalStatus, finalHolder, orderWins, shadowWins,
//                       finalIntegrity, finalSecrecy, summary } ] }
//
// If GAMES_DB_ID is unset, returns { games: [], note: "GAMES_DB_ID unset" }
// so the dashboard can render a friendly empty state without throwing.

import { Client } from "@notionhq/client";

const GAMES_DB_ID = process.env.GAMES_DB_ID;
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
function readDate(prop) {
	return (prop && prop.date && prop.date.start) || null;
}

export default async function handler(req, res) {
	res.setHeader("Cache-Control", "no-store");
	res.setHeader("Access-Control-Allow-Origin", "*");

	if (!NOTION_TOKEN) {
		res.status(500).json({ error: "missing NOTION_TOKEN" });
		return;
	}
	if (!GAMES_DB_ID) {
		// Soft empty — the dashboard renders a "no chronicles yet" state.
		res.status(200).json({ games: [], note: "GAMES_DB_ID unset" });
		return;
	}

	const notion = new Client({ auth: NOTION_TOKEN });

	try {
		const dsId = await resolveDataSourceId(notion, GAMES_DB_ID);
		// Sort newest first using Ended; tolerate the DB missing that property
		// by retrying without a sort.
		let r;
		try {
			r = await notion.dataSources.query({
				data_source_id: dsId,
				page_size: 25,
				sorts: [{ property: "Ended", direction: "descending" }],
			});
		} catch (sortErr) {
			console.warn("[/api/games] sort by Ended failed, retrying unsorted:", sortErr && sortErr.message);
			r = await notion.dataSources.query({ data_source_id: dsId, page_size: 25 });
		}

		const games = r.results.map((page) => {
			const p = page.properties || {};
			return {
				gameId:        readTitle(p["Game ID"]) || "Untitled game",
				started:       readDate(p["Started"]),
				ended:         readDate(p["Ended"]),
				totalTurns:    readNumber(p["Total turns"], 0),
				outcome:       readSelect(p["Outcome"], "abandoned"),
				finalStatus:   readSelect(p["Final status"], "active"),
				finalHolder:   readSelect(p["Final holder"], "free"),
				orderWins:     readNumber(p["Order wins"], 0),
				shadowWins:    readNumber(p["Shadow wins"], 0),
				finalIntegrity:readNumber(p["Final integrity"], 0),
				finalSecrecy:  readNumber(p["Final secrecy"], 0),
				summary:       readRichText(p["Summary"]),
			};
		});

		res.status(200).json({ games });
	} catch (err) {
		console.error("[/api/games] failed:", err);
		res.status(500).json({ error: String((err && err.message) || err) });
	}
}
