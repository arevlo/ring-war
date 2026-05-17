// dashboard/api/reset.js
//
// "Begin again" — reset the game between demo runs.
//
// 1. Update the Ring State row to defaults (free / 100 / 100 / active / 0).
// 2. Archive every Turns DB page so the chronicle starts empty.
//
// Old turns are archived (not hard-deleted) so the Notion workspace keeps the
// audit trail of prior games; archived pages drop out of the dashboard query.

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

export default async function handler(req, res) {
	res.setHeader("Cache-Control", "no-store");

	if (req.method !== "POST") {
		res.status(405).json({ error: "method not allowed" });
		return;
	}
	if (!NOTION_TOKEN || !RING_STATE_DB_ID || !TURNS_DB_ID) {
		res.status(500).json({ error: "missing env" });
		return;
	}

	const notion = new Client({ auth: NOTION_TOKEN });

	try {
		// --- Reset Ring State row to defaults ---
		const stateDS = await resolveDataSourceId(notion, RING_STATE_DB_ID);
		const stateRes = await notion.dataSources.query({ data_source_id: stateDS, page_size: 1 });
		const stateRow = stateRes.results[0];
		const resetProps = {
			Holder:        { select: { name: "free" } },
			Integrity:     { number: 100 },
			Secrecy:       { number: 100 },
			"Turn number": { number: 0 },
			Status:        { select: { name: "active" } },
		};
		if (stateRow) {
			await notion.pages.update({ page_id: stateRow.id, properties: resetProps });
		} else {
			await notion.pages.create({
				parent: { database_id: RING_STATE_DB_ID },
				properties: {
					"Game ID": { title: [{ text: { content: "current" } }] },
					...resetProps,
				},
			});
		}

		// --- Archive existing Turns ---
		const turnsDS = await resolveDataSourceId(notion, TURNS_DB_ID);
		let cursor = undefined;
		let archived = 0;
		// Up to ~500 turns archived per reset (safety bound)
		for (let page = 0; page < 5; page++) {
			const t = await notion.dataSources.query({
				data_source_id: turnsDS,
				page_size: 100,
				start_cursor: cursor,
			});
			for (const row of t.results) {
				try {
					await notion.pages.update({ page_id: row.id, archived: true });
					archived++;
				} catch (e) {
					console.warn("[/api/reset] archive failed for", row.id, e);
				}
			}
			if (!t.has_more) break;
			cursor = t.next_cursor;
		}

		res.status(200).json({ ok: true, archived });
	} catch (err) {
		console.error("[/api/reset] failed:", err);
		res.status(500).json({ ok: false, error: String((err && err.message) || err) });
	}
}
