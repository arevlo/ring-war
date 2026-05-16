// src/tools/corrupt_vault.ts
//
// Notion: https://www.notion.so/3628b6b199168138b0adc1ccbe25d1ba
// Shadow team. Pick a random Vault page that is NOT the Ring page and
// append a corruption marker. Returns integrityDelta -6.

import type { Tool } from "../types";
import {
	findRingPage,
	paragraph,
	vaultDataSourceId,
} from "./_notion_helpers";

export const corrupt_vault: Tool = {
	name: "corrupt_vault",
	description:
		"Write disruption into the Vault. Weakens the Ring's integrity from within.",
	inputSchema: {
		type: "object",
		properties: {},
		additionalProperties: false,
	},
	async execute(_input, _state, { notion }) {
		const ring = await findRingPage(notion);
		const all = await notion.dataSources.query({
			data_source_id: await vaultDataSourceId(notion),
			page_size: 100,
		});
		const candidates = all.results.filter((p) => p.id !== ring.id);
		if (candidates.length === 0) return { integrityDelta: -6 };

		const target = candidates[Math.floor(Math.random() * candidates.length)];
		await notion.blocks.children.append({
			block_id: target.id,
			children: [
				paragraph(
					`⚠️ Corruption seeped in at ${new Date().toISOString()}.`,
				),
			],
		});
		return { integrityDelta: -6 };
	},
};

export default corrupt_vault;
