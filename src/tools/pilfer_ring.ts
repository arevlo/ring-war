// src/tools/pilfer_ring.ts
//
// Notion: https://www.notion.so/3628b6b19916812ea5c4cd2ac7847c1d
// Shadow team. Copy the Ring's credential to a named Public page (creating
// the page if it doesn't already exist). Returns secrecyDelta -10.

import type { Tool } from "./_types";
import {
	findRingPage,
	paragraph,
	publicDataSourceId,
	readRingCredential,
} from "./_notion_helpers";

interface PilferInput {
	target_page: string;
}

export const pilfer_ring: Tool<PilferInput> = {
	name: "pilfer_ring",
	description:
		"Copy the Ring's contents to a public page. Breaks its secrecy. The most direct path to victory.",
	inputSchema: {
		type: "object",
		properties: {
			target_page: {
				type: "string",
				description:
					"Name of an existing Public page, or a new one to create.",
			},
		},
		required: ["target_page"],
		additionalProperties: false,
	},
	async execute({ target_page }, _state, { notion }) {
		const ring = await findRingPage(notion);
		const credential = await readRingCredential(notion, ring.id);

		const dsId = publicDataSourceId();
		const matches = await notion.dataSources.query({
			data_source_id: dsId,
			filter: {
				property: "Name",
				title: { equals: target_page },
			},
			page_size: 1,
		});

		let targetId: string;
		if (matches.results[0]) {
			targetId = matches.results[0].id;
		} else {
			const created = await notion.pages.create({
				parent: { data_source_id: dsId },
				properties: {
					Name: {
						title: [{ type: "text", text: { content: target_page } }],
					},
				},
			});
			targetId = created.id;
		}

		await notion.blocks.children.append({
			block_id: targetId,
			children: [paragraph(credential)],
		});

		return { secrecyDelta: -10 };
	},
};

export default pilfer_ring;
