// src/tools/_notion_helpers.ts
//
// Local helpers shared by multiple tools in this directory.
// Promote to `src/notion.ts` (owned by Agent 1) only if Agent 1's handler
// also needs them — coordinate before moving.

import type { Client } from "@notionhq/client";

const VAULT_DS_ID = () => requireEnv("VAULT_DB_ID");
const PUBLIC_DS_ID = () => requireEnv("PUBLIC_DB_ID");

function requireEnv(key: string): string {
	const v = process.env[key];
	if (!v) throw new Error(`Missing env var: ${key}`);
	return v;
}

export function vaultDataSourceId(): string {
	return VAULT_DS_ID();
}

export function publicDataSourceId(): string {
	return PUBLIC_DS_ID();
}

/**
 * Find the 🔒 The Ring page in the Vault data source. Matches by title
 * containing "Ring". Throws if not found.
 */
export async function findRingPage(notion: Client): Promise<{ id: string }> {
	const res = await notion.dataSources.query({
		data_source_id: vaultDataSourceId(),
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
