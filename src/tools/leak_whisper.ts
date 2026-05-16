// src/tools/leak_whisper.ts
//
// Notion: https://www.notion.so/3628b6b19916816c857df0cabb643f3c
// Shadow team. Post a comment with rumor_text on a random Public DB page.
// Returns secrecyDelta -4.

import type { Tool } from "./_types";
import { publicDataSourceId } from "./_notion_helpers";

interface LeakInput {
	rumor_text: string;
}

export const leak_whisper: Tool<LeakInput> = {
	name: "leak_whisper",
	description:
		"Post a public comment alluding to the Ring without naming it. A small erosion of secrecy, but steady.",
	inputSchema: {
		type: "object",
		properties: {
			rumor_text: {
				type: "string",
				description: "The gossip itself, in The Shadow's voice.",
			},
		},
		required: ["rumor_text"],
		additionalProperties: false,
	},
	async execute({ rumor_text }, _state, { notion }) {
		const pages = await notion.dataSources.query({
			data_source_id: publicDataSourceId(),
			page_size: 100,
		});
		if (pages.results.length === 0) return { secrecyDelta: -4 };

		const target =
			pages.results[Math.floor(Math.random() * pages.results.length)];
		await notion.comments.create({
			parent: { page_id: target.id },
			rich_text: [{ type: "text", text: { content: rumor_text } }],
		});

		return { secrecyDelta: -4 };
	},
};

export default leak_whisper;
