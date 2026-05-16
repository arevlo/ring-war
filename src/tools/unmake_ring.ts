// src/tools/unmake_ring.ts
//
// Notion: https://www.notion.so/3628b6b199168177bb44d8fc8d5b58a8
// Order team. Ends the war in The Order's favor — but only if the Ring is
// already in Order's hands and integrity is high enough.

import type { Tool } from "./_types";

export const unmake_ring: Tool = {
	name: "unmake_ring",
	description:
		"Unmake the Ring. This ends the war in The Order's favor. Only attempt when integrity is ≥ 60 and the Ring is in your hands; otherwise the unmaking fails and the turn falls to The Shadow.",
	inputSchema: {
		type: "object",
		properties: {},
		additionalProperties: false,
	},
	async execute(_input, state, _ctx) {
		if (state.holder !== "order" || state.integrity < 60) {
			return { failed: true };
		}
		return { status: "destroyed" };
	},
};

export default unmake_ring;
