import { beforeAll, describe, expect, it } from "vitest";
import { pilfer_ring } from "../pilfer_ring";
import { makeMockNotion, makeState, setupEnv } from "./_helpers";

beforeAll(setupEnv);

describe("pilfer_ring", () => {
	it("appends the credential to an existing target page", async () => {
		const { ctx, appendCalls, createPageCalls } = makeMockNotion({
			publicMatch: { pageId: "existing-public" },
		});

		const delta = await pilfer_ring.execute(
			{ target_page: "Public Memo" },
			makeState(),
			ctx,
		);

		expect(delta).toEqual({ secrecyDelta: -10 });
		expect(createPageCalls).toHaveLength(0);
		expect(appendCalls).toHaveLength(1);
		expect(appendCalls[0].block_id).toBe("existing-public");
	});

	it("creates the page in Public DB when the target is missing", async () => {
		const { ctx, appendCalls, createPageCalls } = makeMockNotion();

		const delta = await pilfer_ring.execute(
			{ target_page: "Brand New Page" },
			makeState(),
			ctx,
		);

		expect(delta).toEqual({ secrecyDelta: -10 });
		expect(createPageCalls).toHaveLength(1);
		expect(appendCalls).toHaveLength(1);
		expect(appendCalls[0].block_id).toBe("created-page-1");
	});
});
