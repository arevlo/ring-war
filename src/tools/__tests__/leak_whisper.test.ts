import { beforeAll, describe, expect, it } from "vitest";
import { leak_whisper } from "../leak_whisper";
import { makeMockNotion, makeState, setupEnv } from "./_helpers";

beforeAll(setupEnv);

describe("leak_whisper", () => {
	it("appends a paragraph with rumor_text on a Public page", async () => {
		const { ctx, appendCalls } = makeMockNotion({
			publicPages: [{ id: "pub-1" }, { id: "pub-2" }],
		});

		const delta = await leak_whisper.execute(
			{ rumor_text: "Have you heard about the gold in the basement?" },
			makeState(),
			ctx,
		);

		expect(delta).toEqual({ secrecyDelta: -9 });
		expect(appendCalls).toHaveLength(1);
		expect(["pub-1", "pub-2"]).toContain(appendCalls[0].block_id);
		const children = appendCalls[0].children as Array<{
			paragraph: { rich_text: Array<{ text: { content: string } }> };
		}>;
		const para = children[0];
		expect(para.paragraph.rich_text[0].text.content).toContain(
			"Have you heard about the gold in the basement?",
		);
	});

	it("still returns the delta when Public DB is empty", async () => {
		const { ctx, appendCalls } = makeMockNotion({ publicPages: [] });

		const delta = await leak_whisper.execute(
			{ rumor_text: "a whisper into silence" },
			makeState(),
			ctx,
		);

		expect(delta).toEqual({ secrecyDelta: -9 });
		expect(appendCalls).toHaveLength(0);
	});
});
