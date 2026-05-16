import { beforeAll, describe, expect, it } from "vitest";
import { corrupt_vault } from "../corrupt_vault";
import { makeMockNotion, makeState, setupEnv } from "./_helpers";

beforeAll(setupEnv);

describe("corrupt_vault", () => {
	it("appends a corruption marker to a non-Ring vault page", async () => {
		const { ctx, appendCalls } = makeMockNotion({
			ringPageId: "ring-1",
			vaultPages: [{ id: "ring-1" }, { id: "vault-2" }, { id: "vault-3" }],
		});

		const delta = await corrupt_vault.execute({}, makeState(), ctx);

		expect(delta).toEqual({ integrityDelta: -6 });
		expect(appendCalls).toHaveLength(1);
		expect(appendCalls[0].block_id).not.toBe("ring-1");
	});

	it("returns the delta even if the Ring is the only Vault page", async () => {
		const { ctx, appendCalls } = makeMockNotion({
			ringPageId: "ring-1",
			vaultPages: [{ id: "ring-1" }],
		});

		const delta = await corrupt_vault.execute({}, makeState(), ctx);

		expect(delta).toEqual({ integrityDelta: -6 });
		expect(appendCalls).toHaveLength(0);
	});
});
