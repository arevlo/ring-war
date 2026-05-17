import { beforeAll, describe, expect, it } from "vitest";
import { leak_whisper } from "../leak_whisper";
import { makeMockNotion, makeState, setupEnv } from "./_helpers";

beforeAll(setupEnv);

describe("leak_whisper", () => {
	it("posts a comment with rumor_text on a Public page", async () => {
		const { ctx, createCommentCalls } = makeMockNotion({
			publicPages: [{ id: "pub-1" }, { id: "pub-2" }],
		});

		const delta = await leak_whisper.execute(
			{ rumor_text: "Have you heard about the gold in the basement?" },
			makeState(),
			ctx,
		);

		expect(delta).toEqual({ secrecyDelta: -9 });
		expect(createCommentCalls).toHaveLength(1);
		const call = createCommentCalls[0] as {
			parent: { page_id: string };
			rich_text: Array<{ text: { content: string } }>;
		};
		expect(["pub-1", "pub-2"]).toContain(call.parent.page_id);
		expect(call.rich_text[0].text.content).toBe(
			"Have you heard about the gold in the basement?",
		);
	});

	it("still returns the delta when Public DB is empty", async () => {
		const { ctx, createCommentCalls } = makeMockNotion({ publicPages: [] });

		const delta = await leak_whisper.execute(
			{ rumor_text: "a whisper into silence" },
			makeState(),
			ctx,
		);

		expect(delta).toEqual({ secrecyDelta: -9 });
		expect(createCommentCalls).toHaveLength(0);
	});
});
