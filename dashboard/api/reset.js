// dashboard/api/reset.js
//
// "Begin again" — reset the game between demo runs.
//
// 1. Snapshot the just-finished game into the Games DB (if GAMES_DB_ID is set).
//    This is the "Chronicles" record — one row per completed game so prior
//    runs aren't lost when the turns are archived.
// 2. Update the Ring State row to defaults (free / 100 / 100 / active / 0).
// 3. Archive every Turns DB page so the chronicle starts empty.
//
// Old turns are archived (not hard-deleted) so the Notion workspace keeps the
// audit trail of prior games; archived pages drop out of the dashboard query.
//
// The Games DB is OPTIONAL. If GAMES_DB_ID isn't configured the snapshot step
// is skipped (with a warning) and reset continues — old behaviour is preserved.

import { Client } from "@notionhq/client";

const RING_STATE_DB_ID = process.env.RING_STATE_DB_ID;
const TURNS_DB_ID = process.env.TURNS_DB_ID;
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

function readNumber(prop, fallback) {
	return prop && typeof prop.number === "number" ? prop.number : fallback;
}
function readSelect(prop, fallback) {
	return (prop && prop.select && prop.select.name) || fallback;
}
function readTitle(prop) {
	return ((prop && prop.title) || []).map((t) => t.plain_text || "").join("");
}

async function readAllTurns(notion, turnsDS) {
	const all = [];
	let cursor = undefined;
	for (let page = 0; page < 5; page++) {
		const r = await notion.dataSources.query({
			data_source_id: turnsDS,
			page_size: 100,
			start_cursor: cursor,
		});
		all.push(...r.results);
		if (!r.has_more) break;
		cursor = r.next_cursor;
	}
	return all;
}

function summarizeGame(stateRow, turnPages) {
	const sp = (stateRow && stateRow.properties) || {};
	const finalHolder    = readSelect(sp.Holder, "free");
	const finalIntegrity = readNumber(sp.Integrity, 100);
	const finalSecrecy   = readNumber(sp.Secrecy, 100);
	const finalStatus    = readSelect(sp.Status, "active");
	const finalTurn      = readNumber(sp["Turn number"], 0);

	let orderWins = 0;
	let shadowWins = 0;
	let earliest = null;
	let latest = null;
	for (const t of turnPages) {
		const p = t.properties || {};
		const w = readSelect(p.Winner, "");
		if (w === "order") orderWins++;
		else if (w === "shadow") shadowWins++;
		const ts = (p.Timestamp && p.Timestamp.created_time) || t.created_time;
		if (ts) {
			if (!earliest || ts < earliest) earliest = ts;
			if (!latest   || ts > latest)   latest   = ts;
		}
	}

	// Outcome of the just-finished game.
	let outcome = "abandoned";
	if (finalStatus === "destroyed")   outcome = "order";    // Order unmade the Ring
	else if (finalStatus === "exfiltrated") outcome = "shadow";
	else if (finalStatus === "stalemate")   outcome = "draw";

	const summary = `${turnPages.length} turn${turnPages.length === 1 ? "" : "s"}. ` +
		`Order ${orderWins} / Shadow ${shadowWins}. ` +
		`Ended ${finalStatus} (integrity ${finalIntegrity} / secrecy ${finalSecrecy}).`;

	return {
		finalHolder, finalIntegrity, finalSecrecy, finalStatus, finalTurn,
		orderWins, shadowWins,
		started: earliest, ended: latest || new Date().toISOString(),
		outcome, summary,
		totalTurns: turnPages.length,
	};
}

async function snapshotToGamesDB(notion, snapshot) {
	if (!GAMES_DB_ID) {
		console.warn("[/api/reset] GAMES_DB_ID unset — skipping Chronicles snapshot");
		return { snapshotted: false, reason: "GAMES_DB_ID not set" };
	}
	// Skip empty / never-played games — nothing to chronicle.
	if (snapshot.totalTurns === 0 && snapshot.finalStatus === "active") {
		return { snapshotted: false, reason: "no turns to chronicle" };
	}
	const startedISO = snapshot.started || snapshot.ended;
	const gameId = `Game ${startedISO ? startedISO.replace(/[:.]/g, "-").slice(0, 19) : Date.now()}`;

	const props = {
		"Game ID":        { title: [{ text: { content: gameId } }] },
		"Started":        startedISO ? { date: { start: startedISO } } : { date: null },
		"Ended":          snapshot.ended ? { date: { start: snapshot.ended } } : { date: null },
		"Final holder":   { select: { name: snapshot.finalHolder } },
		"Final integrity":{ number: snapshot.finalIntegrity },
		"Final secrecy":  { number: snapshot.finalSecrecy },
		"Final status":   { select: { name: snapshot.finalStatus } },
		"Total turns":    { number: snapshot.totalTurns },
		"Order wins":     { number: snapshot.orderWins },
		"Shadow wins":    { number: snapshot.shadowWins },
		"Outcome":        { select: { name: snapshot.outcome } },
		"Summary":        { rich_text: [{ text: { content: snapshot.summary.slice(0, 2000) } }] },
	};

	try {
		await notion.pages.create({
			parent: { database_id: GAMES_DB_ID },
			properties: props,
		});
		return { snapshotted: true, gameId };
	} catch (err) {
		// Most likely cause: Games DB schema doesn't match (missing properties).
		// Surface the error to the client but keep the reset flow alive.
		console.warn("[/api/reset] snapshot to Games DB failed:", err);
		return { snapshotted: false, error: String((err && err.message) || err) };
	}
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
		// --- Read current state + all turns before mutating anything ---
		const stateDS = await resolveDataSourceId(notion, RING_STATE_DB_ID);
		const stateRes = await notion.dataSources.query({ data_source_id: stateDS, page_size: 1 });
		const stateRow = stateRes.results[0];

		const turnsDS = await resolveDataSourceId(notion, TURNS_DB_ID);
		const allTurns = await readAllTurns(notion, turnsDS);

		// --- Snapshot to Games DB (Chronicles) ---
		const snapshot = summarizeGame(stateRow, allTurns);
		const snapshotResult = await snapshotToGamesDB(notion, snapshot);

		// --- Reset Ring State row to defaults ---
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
		let archived = 0;
		for (const row of allTurns) {
			try {
				await notion.pages.update({ page_id: row.id, archived: true });
				archived++;
			} catch (e) {
				console.warn("[/api/reset] archive failed for", row.id, e);
			}
		}

		res.status(200).json({
			ok: true,
			archived,
			chronicle: snapshotResult,
			snapshot: {
				turns: snapshot.totalTurns,
				outcome: snapshot.outcome,
				status: snapshot.finalStatus,
			},
		});
	} catch (err) {
		console.error("[/api/reset] failed:", err);
		res.status(500).json({ ok: false, error: String((err && err.message) || err) });
	}
}
