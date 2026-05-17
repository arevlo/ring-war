// src/tools/leak_whisper.ts
//
// Notion: https://www.notion.so/3628b6b19916816c857df0cabb643f3c
// Shadow team. Append a paragraph with rumor_text on a random Public DB page.
// Returns secrecyDelta -9.
//
// We originally used `notion.comments.create`, but Notion's internal
// integration capability set doesn't grant comment-create rights without an
// explicit "Comments" toggle that's often missed in setup — the call returns
// 403 restricted_resource, the handler catches it, the turn is recorded as
// failed, and the bars never move. Appending a paragraph block uses the
// "Update content" capability which is already required by the other tools
// (vault_ring, corrupt_vault, audit_public), so this works on the default
// permissions every Ring War workspace already has.

import type { Tool } from "../types";
import {
	paragraph,
	publicDataSourceId,
} from "./_notion_helpers";

interface LeakInput {
	rumor_text: string;
}

export const leak_whisper: Tool<LeakInput> = {
	name: "leak_whisper",
	description:
		"Drop a rumor onto a public page — alluding to the Ring without naming it. A small erosion of secrecy, but steady.",
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
			data_source_id: await publicDataSourceId(notion),
			page_size: 100,
		});
		if (pages.results.length === 0) return { secrecyDelta: -9 };

		const target =
			pages.results[Math.floor(Math.random() * pages.results.length)];
		await notion.blocks.children.append({
			block_id: target.id,
			children: [paragraph(`🜂 ${rumor_text}`)],
		});

		return { secrecyDelta: -9 };
	},
};

export default leak_whisper;
