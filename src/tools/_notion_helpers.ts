// src/tools/_notion_helpers.ts
//
// Local helpers shared by multiple tools in this directory.
// Agent 1's src/notion.ts owns state/turn helpers. Once it also exposes a
// resolveDataSourceId() helper, the resolve logic below should be deleted
// and we'll import from there instead. Until then, this is self-contained
// so the tools work whether env vars hold database IDs or data-source IDs.

import type { Client } from "@notionhq/client";

function requireEnv(key: string): string {
	const v = process.env[key];
	if (!v) throw new Error(`Missing env var: ${key}`);
	return v;
}

// Module-scoped cache: env-var raw value → resolved data-source ID.
// Notion v6's dataSources.query() needs a data-source ID, not a database ID.
// Env vars in this project (VAULT_DB_ID, PUBLIC_DB_ID, ...) may hold either,
// depending on how Carlos set them up. Resolve once, cache forever.
const dataSourceCache = new Map<string, string>();

async function resolveDataSourceId(
	notion: Client,
	envValue: string,
): Promise<string> {
	const cached = dataSourceCache.get(envValue);
	if (cached) return cached;

	try {
		const db = await notion.databases.retrieve({ database_id: envValue });
		const sources = (db as { data_sources?: Array<{ id: string }> })
			.data_sources;
		if (sources && sources.length > 0) {
			const id = sources[0].id;
			dataSourceCache.set(envValue, id);
			return id;
		}
	} catch (err) {
		const code = (err as { code?: string }).code;
		if (code !== "object_not_found" && code !== "validation_error") throw err;
		// Fall through — envValue is likely already a data-source ID.
	}

	dataSourceCache.set(envValue, envValue);
	return envValue;
}

export function vaultDataSourceId(notion: Client): Promise<string> {
	return resolveDataSourceId(notion, requireEnv("VAULT_DB_ID"));
}

export function publicDataSourceId(notion: Client): Promise<string> {
	return resolveDataSourceId(notion, requireEnv("PUBLIC_DB_ID"));
}

/**
 * Find the 🔒 The Ring page in the Vault data source. Matches by title
 * containing "Ring". Throws if not found.
 */
export async function findRingPage(notion: Client): Promise<{ id: string }> {
	const dsId = await vaultDataSourceId(notion);
	const res = await notion.dataSources.query({
		data_source_id: dsId,
		filter: {
			property: "Name",
			title: { contains: "Ring" },
		},
		page_size: 5,
	});
	const hit = res.results[0];
	if (!hit) throw new Error("Ring page not found in Vault data source");
	return { id: hit.id };
}

/**
 * Read the Ring credential string. The Ring page body contains a fenced code
 * block with the credential; we return its contents (trimmed). Falls back to
 * the full markdown if no fence is present.
 */
export async function readRingCredential(
	notion: Client,
	ringPageId: string,
): Promise<string> {
	const md = await notion.pages.retrieveMarkdown({ page_id: ringPageId });
	const text = typeof (md as { markdown?: string }).markdown === "string"
		? (md as { markdown: string }).markdown
		: "";
	const fence = text.match(/```[a-zA-Z]*\n([\s\S]*?)\n```/);
	return (fence ? fence[1] : text).trim();
}

export function paragraph(content: string) {
	return {
		object: "block" as const,
		type: "paragraph" as const,
		paragraph: {
			rich_text: [
				{ type: "text" as const, text: { content } },
			],
		},
	};
}

// Test-only: clear cache between tests so resolve doesn't leak across cases.
export function _clearDataSourceCache(): void {
	dataSourceCache.clear();
}
