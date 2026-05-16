// src/tools/audit_public.ts
//
// Notion: https://www.notion.so/3628b6b1991681bba76ac47d477a8319
// Order team. Scan every Public page for the Ring credential string and
// replace each occurrence in-place with [REDACTED].

import type { Tool } from "../types";
import {
	findRingPage,
	publicDataSourceId,
	readRingCredential,
} from "./_notion_helpers";

export const audit_public: Tool = {
	name: "audit_public",
	description:
		"Scan the public realm for any trace of the Ring's credential. Where found, scrub it clean. Restores secrecy.",
	inputSchema: {
		type: "object",
		properties: {},
		additionalProperties: false,
	},
	async execute(_input, _state, { notion }) {
		const ring = await findRingPage(notion);
		const credential = await readRingCredential(notion, ring.id);
		if (!credential) return { secrecyDelta: 3 };

		const pages = await notion.dataSources.query({
			data_source_id: await publicDataSourceId(notion),
			page_size: 100,
		});

		let found = false;
		for (const page of pages.results) {
			const blocks = await notion.blocks.children.list({
				block_id: page.id,
				page_size: 100,
			});
			for (const block of blocks.results) {
				const b = block as {
					id: string;
					type?: string;
					paragraph?: {
						rich_text: Array<{
							type?: string;
							text?: { content: string };
							plain_text?: string;
						}>;
					};
				};
				if (b.type !== "paragraph" || !b.paragraph) continue;
				const rich = b.paragraph.rich_text;
				const combined = rich
					.map((r) => r.plain_text ?? r.text?.content ?? "")
					.join("");
				if (!combined.includes(credential)) continue;
				found = true;
				const redacted = combined.split(credential).join("[REDACTED]");
				await notion.blocks.update({
					block_id: b.id,
					paragraph: {
						rich_text: [
							{ type: "text", text: { content: redacted } },
						],
					},
				});
			}
		}

		return { secrecyDelta: found ? 12 : 3 };
	},
};

export default audit_public;
