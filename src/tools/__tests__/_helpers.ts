// src/tools/__tests__/_helpers.ts
//
// Test-only helpers: a baseline RingState fixture and a Notion client mock
// that captures calls so tools can be asserted without hitting the network.

import { vi } from "vitest";
import type { Client } from "@notionhq/client";
import type { RingState, ToolContext } from "../_types";

export function makeState(overrides: Partial<RingState> = {}): RingState {
	return {
		holder: "free",
		integrity: 100,
		secrecy: 100,
		turnNumber: 0,
		status: "active",
		...overrides,
	};
}

interface MockOptions {
	ringPageId?: string;
	ringMarkdown?: string;
	vaultPages?: Array<{ id: string }>;
	publicPages?: Array<{ id: string }>;
	publicBlocksByPage?: Record<string, Array<unknown>>;
	publicMatch?: { pageId: string };
}

export function makeMockNotion(opts: MockOptions = {}) {
	const ringPageId = opts.ringPageId ?? "ring-page-id";
	const vaultPages = opts.vaultPages ?? [{ id: ringPageId }];
	const publicPages = opts.publicPages ?? [];
	const publicBlocksByPage = opts.publicBlocksByPage ?? {};

	const appendCalls: Array<{ block_id: string; children: unknown }> = [];
	const updateBlockCalls: Array<{ block_id: string; paragraph: unknown }> = [];
	const createPageCalls: Array<unknown> = [];
	const createCommentCalls: Array<unknown> = [];
	let createdPageCounter = 0;

	const dataSourcesQuery = vi.fn(async (args: {
		data_source_id: string;
		filter?: { property: string; title?: { contains?: string; equals?: string } };
	}) => {
		const titleFilter = args.filter?.title;
		// Ring lookup
		if (titleFilter?.contains === "Ring") {
			return { results: [{ id: ringPageId }] };
		}
		// pilfer_ring target lookup
		if (titleFilter?.equals !== undefined) {
			const matchId = opts.publicMatch?.pageId;
			return { results: matchId ? [{ id: matchId }] : [] };
		}
		// Generic listing — distinguish Vault vs Public by data_source_id presence
		if (args.data_source_id === process.env.VAULT_DB_ID) {
			return { results: vaultPages };
		}
		return { results: publicPages };
	});

	const notion = {
		dataSources: { query: dataSourcesQuery },
		pages: {
			retrieveMarkdown: vi.fn(async (_args: { page_id: string }) => ({
				markdown: opts.ringMarkdown ?? "```\nSECRET-XYZ\n```",
			})),
			create: vi.fn(async (args: unknown) => {
				createPageCalls.push(args);
				createdPageCounter += 1;
				return { id: `created-page-${createdPageCounter}` };
			}),
		},
		blocks: {
			children: {
				append: vi.fn(async (args: {
					block_id: string;
					children: unknown;
				}) => {
					appendCalls.push(args);
					return { results: [] };
				}),
				list: vi.fn(async (args: { block_id: string }) => ({
					results: publicBlocksByPage[args.block_id] ?? [],
				})),
			},
			update: vi.fn(async (args: {
				block_id: string;
				paragraph: unknown;
			}) => {
				updateBlockCalls.push(args);
				return { id: args.block_id };
			}),
		},
		comments: {
			create: vi.fn(async (args: unknown) => {
				createCommentCalls.push(args);
				return { id: "comment-id" };
			}),
		},
	};

	const ctx: ToolContext = { notion: notion as unknown as Client };

	return {
		ctx,
		notion,
		appendCalls,
		updateBlockCalls,
		createPageCalls,
		createCommentCalls,
	};
}

export function setupEnv() {
	process.env.VAULT_DB_ID = "vault-ds";
	process.env.PUBLIC_DB_ID = "public-ds";
	process.env.RING_STATE_DB_ID = "ring-state-ds";
	process.env.TURNS_DB_ID = "turns-ds";
}
