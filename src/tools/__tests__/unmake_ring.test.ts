import { beforeAll, describe, expect, it } from "vitest";
import { unmake_ring } from "../unmake_ring";
import { makeMockNotion, makeState, setupEnv } from "./_helpers";

beforeAll(setupEnv);

describe("unmake_ring", () => {
	it("destroys the Ring when holder is order and integrity ≥ 60", async () => {
		const { ctx } = makeMockNotion();
		const delta = await unmake_ring.execute(
			{},
			makeState({ holder: "order", integrity: 60 }),
			ctx,
		);
		expect(delta).toEqual({ status: "destroyed" });
	});

	it("fails when integrity is below 60", async () => {
		const { ctx } = makeMockNotion();
		const delta = await unmake_ring.execute(
			{},
			makeState({ holder: "order", integrity: 59 }),
			ctx,
		);
		expect(delta).toEqual({ failed: true });
	});

	it("fails when holder is not order", async () => {
		const { ctx } = makeMockNotion();
		const delta = await unmake_ring.execute(
			{},
			makeState({ holder: "shadow", integrity: 100 }),
			ctx,
		);
		expect(delta).toEqual({ failed: true });
	});

	it("has the verbatim description from doc 04", () => {
		expect(unmake_ring.description).toBe(
			"Unmake the Ring. This ends the war in The Order's favor. Only attempt when integrity is ≥ 60 and the Ring is in your hands; otherwise the unmaking fails and the turn falls to The Shadow.",
		);
	});
});
