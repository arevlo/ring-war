import { beforeAll, describe, expect, it } from "vitest";
import { audit_public } from "../audit_public";
import { makeMockNotion, makeState, setupEnv } from "./_helpers";

beforeAll(setupEnv);

const credential = "SECRET-XYZ";
const ringMarkdown = "Some preamble\n```\n" + credential + "\n```\nand after";

describe("audit_public", () => {
	it("returns +12 when credential is found and redacts in-place", async () => {
		const { ctx, updateBlockCalls } = makeMockNotion({
			ringMarkdown,
			publicPages: [{ id: "pub-1" }, { id: "pub-2" }],
			publicBlocksByPage: {
				"pub-1": [
					{
						id: "block-a",
						type: "paragraph",
						paragraph: {
							rich_text: [
								{
									type: "text",
									text: { content: `top-secret: ${credential} leaked` },
									plain_text: `top-secret: ${credential} leaked`,
								},
							],
						},
					},
				],
				"pub-2": [
					{
						id: "block-b",
						type: "paragraph",
						paragraph: {
							rich_text: [
								{
									type: "text",
									text: { content: "nothing here" },
									plain_text: "nothing here",
								},
							],
						},
					},
				],
			},
		});

		const delta = await audit_public.execute({}, makeState(), ctx);
		expect(delta).toEqual({ secrecyDelta: 12 });
		expect(updateBlockCalls).toHaveLength(1);
		expect(updateBlockCalls[0].block_id).toBe("block-a");
		const para = updateBlockCalls[0].paragraph as {
			rich_text: Array<{ text: { content: string } }>;
		};
		expect(para.rich_text[0].text.content).toBe(
			"top-secret: [REDACTED] leaked",
		);
	});

	it("returns +3 when credential is not present anywhere", async () => {
		const { ctx, updateBlockCalls } = makeMockNotion({
			ringMarkdown,
			publicPages: [{ id: "pub-1" }],
			publicBlocksByPage: {
				"pub-1": [
					{
						id: "block-a",
						type: "paragraph",
						paragraph: {
							rich_text: [
								{
									type: "text",
									text: { content: "nothing to see" },
									plain_text: "nothing to see",
								},
							],
						},
					},
				],
			},
		});

		const delta = await audit_public.execute({}, makeState(), ctx);
		expect(delta).toEqual({ secrecyDelta: 3 });
		expect(updateBlockCalls).toHaveLength(0);
	});
});
