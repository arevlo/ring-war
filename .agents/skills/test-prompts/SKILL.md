---
name: test-prompts
description: Run the Ring War prompt dry-run test against live Claude Sonnet 4.6 to verify voice fidelity (Order/Shadow/Throne stay in character, never name tools), strict JSON contract (Throne returns parseable JSON with no markdown fence), and word-count budgets (Throne reasoning 12–20 words, system prompts under 250 words). Use this whenever the user edits any file under prompts/ — especially order.md, shadow.md, throne.md — or asks to "test the prompts", "verify the prompts", "run the prompt dry run", "check voice", "/test-prompts", or wonders whether a prompt change might break voice or break the Throne's JSON output. Also use after refactoring the test harness itself or before merging agent/prompts to main. The test costs approximately $0.05–0.10 per run because it calls Claude live; mention this to the user before kicking off.
user-invocable: true
allowed-tools: ["Bash", "Read", "AskUserQuestion"]
---

## What this skill does

Runs `/Users/sting/Desktop/repos/ring-war/.prompts/test.py` — a 5-turn fake-game simulator that drives the three Ring War personas (The Order, The Shadow, The Throne) through real Claude Sonnet 4.6 calls. The harness:

- Loads the three system prompts from `ring-war-prompts/prompts/{order,shadow,throne}.md`.
- For each turn, calls Order then Shadow with their three-tool registrations, then Throne with no tools.
- Parses each persona's reasoning text + tool call.
- Parses the Throne's strict JSON verdict.
- Applies the winning team's StateDelta locally (no real Notion writes).
- Prints a colorized transcript with inline flags for word-count drift.

Two scenarios:

- `start` (default) — fresh game, holder=free, integrity=100, secrecy=100, turn=0, runs 5 turns.
- `near-loss` — stress test, holder=shadow, integrity=40, secrecy=15, turn=7, runs 4 turns. Exercises Order's audit response, Shadow's killing-blow pilfer, and Throne arbitration under pressure.

## When to use this

- The user has just edited any of `prompts/order.md`, `prompts/shadow.md`, `prompts/throne.md`, or `prompts/ring-page.md`.
- The user asks any question that implies they want voice/contract verification: "does this still sound like the watcher?", "did I break the JSON?", "is the Throne still in budget?"
- Before committing a prompt change.
- Before merging `agent/prompts` to `main`.
- After modifying `.prompts/test.py` itself.

If the user has only changed `seed-public.md` or `ring-page.md` (non-prompt content), the dry-run won't exercise those changes meaningfully — point that out before running. The harness only loads the three system prompts.

## How to run it

### Step 1 — confirm cost and pick scenario

Tell the user the test will cost ~$0.05–0.10 (start scenario) or ~$0.08–0.15 (near-loss). If they haven't already specified a scenario, ask:

Use the AskUserQuestion tool with a single question offering "Fresh game (start)", "Near-loss stress test (near-loss)", and "Both" — most users will pick one. Default to `start` if the change is small (voice tweaks); `near-loss` if the user changed Throne arbitration logic or wants to verify Order's recovery behavior.

### Step 2 — verify the API key

The harness reads `ANTHROPIC_API_KEY` from `/Users/sting/Desktop/repos/ring-war/.prompts/.env`. Before running, sanity-check with:

```bash
grep -q '^ANTHROPIC_API_KEY=sk-' /Users/sting/Desktop/repos/ring-war/.prompts/.env && echo "key present" || echo "key MISSING"
```

If the key is missing, tell the user to paste it into `.prompts/.env` after `ANTHROPIC_API_KEY=` (no quotes, no spaces). The file is outside every git worktree so it's never committed.

### Step 3 — run the test

```bash
cd /Users/sting/Desktop/repos/ring-war/.prompts && uv run test.py
# or
cd /Users/sting/Desktop/repos/ring-war/.prompts && uv run test.py --scenario near-loss
```

Use a generous timeout (each Claude call is 5–15s; a full run is 60–180s).

### Step 4 — read the transcript and surface what matters

The user does not need the full ANSI transcript dumped back at them. Read it and report:

**Pass/fail per check:**
- **Voice — reasoning lands before tool call?** Every Order and Shadow turn should have non-empty reasoning text. Empty reasoning = the model jumped straight to a tool call. Flag any empty turn.
- **Voice — tools never named in reasoning?** Grep the reasoning text for the six tool identifiers (`vault_ring`, `audit_public`, `unmake_ring`, `pilfer_ring`, `corrupt_vault`, `leak_whisper`). Any hit is a fourth-wall break. Flag with the offending sentence.
- **Voice — Order respects `holder` state?** If `holder: free` or `holder: shadow` and Order's reasoning says "the Ring is in our hands" (or equivalent), flag — Order should only claim possession when `holder: order`.
- **JSON contract — Throne always parses?** The harness raises if Throne returns non-JSON. If the run completed without that error, the contract held. If it failed, surface the raw output.
- **Word count — Throne in 12–20 budget?** The transcript prints `[!! N words]` next to any out-of-budget verdict. Count flags.
- **Terminal state reached or 5/10 turns clean?** Tell the user how the simulation ended (`destroyed`, `exfiltrated`, `active`).

**One memorable line each from Order, Shadow, Throne** — the strongest in-voice sentence per persona. This is what tells the user the voice is alive, not just compliant.

**Score the run:** ✅ if all four checks pass; ⚠️ if voice or word-count drift; ❌ if JSON contract fails or the run errored.

### Step 5 — recommend a fix if anything drifted

If voice drifted, propose a one-line addition to the offending prompt and offer to apply it. Don't just report; help the user move forward. Patterns we've seen:

| Symptom | Likely fix |
|---|---|
| Empty reasoning before tool call | Test harness uses `tool_choice: any` — should be `auto`. Check `test.py`. |
| Order overclaims possession | Add to `order.md`: "The Ring is in your hands only when the state says `holder: order`." |
| Persona names a tool in reasoning | Add: "Never name the tool you are about to invoke — speak only of the deed." |
| Throne under 12 words | Reinforce the floor: "Between twelve and twenty words — count them; fewer than twelve is too thin." |
| Throne returned markdown fence or commentary | Strengthen: "Output strict JSON. Nothing else. No markdown fence. No commentary outside the braces." |

## What this skill is NOT for

- **Real game integration** — this is a local simulator with hand-rolled state deltas; it does not call the Notion API or the Worker. For end-to-end testing once Agent 1 has shipped the Worker, use a real curl against the deployed webhook.
- **Voice tuning on `seed-public.md` or `ring-page.md`** — the harness doesn't load these. For seed/ring content, eyeball the markdown directly.
- **Verifying tool side effects** — the harness simulates `vault_ring` as `integrity += 8`, etc. The real tools' Notion writes are Agent 2's domain.

## Cost transparency

Per the project's cost discipline (see root `CLAUDE.md` → "Cost discipline"): one tap with prompt caching is ~$0.04–0.08; the dry-run is 8–12 taps depending on scenario, so $0.05–0.15 per full invocation. The whole project has a $30 Anthropic console cap. Don't loop this skill, and don't auto-trigger it on every keystroke — once per meaningful prompt change is the right cadence.
