// src/tools/vault_ring.ts
//
// Notion: https://www.notion.so/3628b6b1991681c4b782c70d0bf72cba
// Order team. Pull the Ring back into the Vault. holder = "order",
// integrityDelta = +14, capAt100 = true.

import type { Tool } from "../types";
import { findRingPage, paragraph } from "./_notion_helpers";

export const vault_ring: Tool = {
	name: "vault_ring",
	description:
		"Pull the Ring back into the Vault. Restores some of its integrity and places it in your hands.",
	inputSchema: {
		type: "object",
		properties: {},
		additionalProperties: false,
	},
	async execute(_input, _state, { notion }) {
		const ring = await findRingPage(notion);
		await notion.blocks.children.append({
			block_id: ring.id,
			children: [
				paragraph(
					`The Order vaulted the Ring at ${new Date().toISOString()}.`,
				),
			],
		});
		return { holder: "order", integrityDelta: 14, capAt100: true };
	},
};

export default vault_ring;
