// dashboard/api/tap.js
//
// Notion: doc 04 (worker tools) https://www.notion.so/3628b6b1991681fdb0add5b495cfcecf
//
// The browser cannot POST directly to a Notion Workers webhook because the
// signed URL is workspace-private. This route forwards the tap from the browser
// to the worker. The worker responds immediately with {status:"success"} and
// processes the turn asynchronously; the dashboard's next /api/state poll picks
// up the new row from the Turns DB.

const TAP_WEBHOOK_URL = process.env.WORKER_TAP_WEBHOOK_URL;

export default async function handler(req, res) {
	res.setHeader("Cache-Control", "no-store");

	if (req.method !== "POST") {
		res.status(405).json({ error: "method not allowed" });
		return;
	}
	if (!TAP_WEBHOOK_URL) {
		res.status(500).json({ error: "missing WORKER_TAP_WEBHOOK_URL" });
		return;
	}

	try {
		const r = await fetch(TAP_WEBHOOK_URL, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ source: "dashboard", at: new Date().toISOString() }),
		});
		// The worker webhook always replies `{status:"success"}` with no useful
		// body — just propagate ok/not-ok status to the browser.
		res.status(r.ok ? 202 : 502).json({ ok: r.ok, status: r.status });
	} catch (err) {
		console.error("[/api/tap] failed:", err);
		res.status(502).json({ ok: false, error: String((err && err.message) || err) });
	}
}
