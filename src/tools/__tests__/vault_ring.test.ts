import { beforeAll, describe, expect, it } from "vitest";
import { vault_ring } from "../vault_ring";
import { makeMockNotion, makeState, setupEnv } from "./_helpers";

beforeAll(setupEnv);

describe("vault_ring", () => {
	it("appends to the Ring page and returns the Order delta", async () => {
		const { ctx, appendCalls } = makeMockNotion({ ringPageId: "ring-1" });
		const delta = await vault_ring.execute({}, makeState(), ctx);

		expect(delta).toEqual({
			holder: "order",
			integrityDelta: 8,
			capAt100: true,
		});
		expect(appendCalls).toHaveLength(1);
		expect(appendCalls[0].block_id).toBe("ring-1");
	});

	it("has the verbatim watcher voice", () => {
		expect(vault_ring.description).toBe(
			"Pull the Ring back into the Vault. Restores some of its integrity and places it in your hands.",
		);
	});
});
