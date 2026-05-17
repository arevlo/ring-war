# Ring War

> Two AI agent teams fighting over a single credential — and the only way to advance the game is to tap the Ring.

Ring War is a turn-based capture-the-flag game between two AI agent teams (**The Order** and **The Shadow**), triggered by an NFC ring tap. Every tap fires three sequential Claude calls — Order moves, Shadow moves, the Throne judges — and only the winner's tool runs against Notion. State, history, and the public-facing world all live inside Notion databases. The dashboard is a thin Vercel-hosted view that polls a `/api/state` endpoint every 2 seconds.

Built for the **Notion Developer Platform hackathon** on the Notion Workers runtime + Notion API, with **Claude Sonnet 4.6** as the brain for both teams and the arbiter.

## Architecture

```mermaid
flowchart TD
  subgraph Triggers
    NFC["NFC ring tap (iPhone Shortcut)"]
    Button["Dashboard 'Tap to Summon' button"]
    Curl["curl / external POST"]
  end

  NFC -->|POST| Webhook
  Button -->|POST /api/tap| TapProxy["Vercel /api/tap (proxy)"]
  Curl -->|POST| Webhook
  TapProxy -->|forward POST| Webhook

  Webhook["Notion Worker — /tap webhook"]
  Webhook --> Dedupe{"8s in-mem<br/>debounce +<br/>deliveryId set"}
  Dedupe -->|fresh| ReadState["Read Ring State + last 3 Turns from Notion"]
  Dedupe -->|duplicate| Skip1["Skip silently"]

  ReadState --> StatusCheck{"status == 'active'?"}
  StatusCheck -->|no| Skip2["Skip (terminal or summoning lock)"]
  StatusCheck -->|yes| Mark["Write status='summoning' to Ring State<br/>(in-flight marker + soft lock)"]

  Mark --> Order["Claude call 1 — The Order<br/>(3 tools)"]
  Order --> Shadow["Claude call 2 — The Shadow<br/>(3 tools)"]
  Shadow --> Throne["Claude call 3 — The Throne<br/>(no tools, strict JSON verdict)"]
  Throne --> Execute["Execute winner's tool against Notion"]
  Execute --> Recheck{"Recheck Ring State —<br/>turnNumber unchanged?"}
  Recheck -->|moved (concurrent winner)| Restore["Restore status='active', skip write"]
  Recheck -->|unchanged| WriteTurn["Write Turn row +<br/>write new Ring State (status active/terminal)"]
  WriteTurn --> Check{"Terminal?"}
  Check -->|destroyed / exfiltrated / turn≥10| Freeze["Freeze in terminal status"]
  Check -->|active| Return["Return 200"]

  Dashboard["Vercel dashboard"]
  Dashboard -. polls /api/state every 2s .-> StateProxy["Vercel /api/state"]
  StateProxy -. queries Ring State + Turns DB .-> Notion[(Notion DBs:<br/>Ring State / Turns / Games / Public)]
  Dashboard -. POST /api/reset .-> ResetProxy["Vercel /api/reset"]
  ResetProxy -. snapshot to Games DB<br/>+ archive Turns<br/>+ reset Ring State .-> Notion
  ReadState -.-> Notion
  Mark -.-> Notion
  Execute -.-> Notion
  WriteTurn -.-> Notion
```

Three Claude calls per tap, in order. The Throne is the arbiter — no tools registered, strict JSON verdict. Tools return a `StateDelta`; the Worker handler applies it. Tools never mutate state directly.

The **summoning** status is a transient in-flight marker the handler writes at the start of `runTurn` and clears at the end. It serves three purposes:

1. **Dashboard UX** — `/api/state` exposes it, so the dashboard can render the same red-eye + locked-button + placeholder-card UI for an NFC tap as it does for a local button click, within ~4 seconds. (Notion's `last_edited_time` has minute-precision and can't carry this signal — a status select value updates instantly.)
2. **Soft lock against parallel cold-starts** — a second instance reads the marker and the existing terminal-status guard skips it.
3. **Self-healing on error** — a `finally` block restores `status='active'` if the run aborts after writing the marker (errors, concurrent-winner abort), so the lock auto-clears.

## Invariants

- **One Worker file**: `src/index.ts`. Two webhooks (`tap`, `state`) and two tool capabilities (`tapTool`, `stateTool`) for Custom Agent integration.
- **Three teams, six tools**:
  - **Order** — `vault_ring`, `audit_public`, `unmake_ring`
  - **Shadow** — `pilfer_ring`, `corrupt_vault`, `leak_whisper`
  - Per-team restriction is enforced via system prompts, not API permissions.
- **Three Claude calls per tap, in order**: Order → Shadow → Throne. The Throne outputs strict JSON: `{ "winner": "order" | "shadow", "reasoning": "<one sentence>" }`.
- **`max_tokens: 1024`** on every Claude call. Anthropic console cap: **$30**. Hard caps.
- **Model**: `claude-sonnet-4-6` for all three personas.
- **Game caps at turn 10** or on terminal state (`destroyed` / `exfiltrated`).
- **Tap dedupe — five overlapping layers, source-first**:
  1. **iPhone Shortcut** — reads a `ring-war-lasttap` Reminder; exits silently if its Date Created is less than 5s ago. Catches NFC double-reads before any POST is sent.
  2. **Worker `MIN_TAP_INTERVAL_MS = 8s`** in-memory cooldown — catches re-taps on the same warm worker instance.
  3. **`deliveryId` Set** (last 32) — catches Notion-side re-deliveries of the same webhook event.
  4. **`status='summoning'` soft lock** — second cold-start instance reads it and skips.
  5. **Concurrent-winner recheck** — re-reads Ring State just before write; if `turnNumber` moved during the Claude window, aborts the write.

Per-tap cost with prompt caching: **~$0.04–0.08**. Full 6-turn game: **~$0.40**.

## Tech stack

- **Notion Workers** (`@notionhq/workers`) — webhook + tool runtime, hosted by Notion
- **Notion API** — game state, turn log, chronicles, public world
- **Anthropic Claude Sonnet 4.6** — Order, Shadow, Throne
- **Vercel** — static HTML dashboard + serverless `/api/*` routes
- **TypeScript** (Node ≥ 22, npm ≥ 10.9.2)
- **iOS Shortcuts** — NFC ring tap → POST to Worker webhook (with built-in Reminders-based dedupe)

## Repo layout

```
src/
  index.ts                 # Worker entry: tap+state webhooks, tapTool+stateTool capabilities,
                           # in-memory debounce, deliveryId dedupe
  handler.ts               # runTurn() — read state → mark summoning → 3 Claude calls →
                           # execute winner tool → recheck → write Turn + Ring State →
                           # finally restore status on abort
  agents.ts                # System prompts + Claude call helpers (Order, Shadow, Throne)
  state.ts                 # applyDelta, checkTerminal, scoreWinner
  notion.ts                # readRingState, writeRingState, appendTurn, readRecentTurns
  types.ts                 # RingState, StateDelta, TurnRecord, GameStatus, etc.
  tools-bridge.ts          # resolveTool() — dispatch by tool name to one of the six
  tools/
    index.ts               # Barrel re-exporting all six tools
    _notion_helpers.ts     # Shared Notion-side helpers (Vault writes, Public writes)
    vault_ring.ts          # Order: pull the Ring into the Vault
    audit_public.ts        # Order: scrub a Shadow leak from Public
    unmake_ring.ts         # Order: destroy the Ring (terminal)
    pilfer_ring.ts         # Shadow: steal the Ring from the Vault
    corrupt_vault.ts       # Shadow: degrade Vault integrity
    leak_whisper.ts        # Shadow: publish a whisper to Public
    __tests__/             # Vitest tests covering each tool's StateDelta contract

dashboard/
  index.html               # Static dashboard (orb, bars, live chronicle, beats, audio)
  api/
    state.js               # GET — returns { state, turns } from Notion
    tap.js                 # POST — proxies to the Worker tap webhook
    reset.js               # POST — snapshot Games DB + reset Ring State + archive Turns
    games.js               # GET — list past games from the Games DB (Chronicles panel)
  audio/                   # 12 pre-rendered MiniMax MP3s (intro + per-tool + verdicts)
  vercel.json
  package.json

prompts/
  order.md, shadow.md      # Team system prompts
  throne.md                # Arbiter system prompt (strict JSON verdict)
  seed-public.md           # Optional seed content for the Public DB
  ring-page.md             # Landing page copy the NFC URL resolves to

.dev.vars.example          # Worker env var template
workers.json               # Notion CLI worker config
LICENSE                    # MIT
README.md                  # this file
CLAUDE.md                  # Load-bearing context for Claude Code sessions
AGENTS.md                  # Companion file for non-Claude agents
```

## Notion databases

The Worker reads from and writes to four databases in the connected workspace. Their IDs are passed via env vars (see Quick start).

| DB | Purpose | Schema highlight |
|---|---|---|
| **Ring State** | Single-row game state | `Holder` (select), `Integrity`, `Secrecy` (number), `Turn number` (number), `Status` (select: `active` / `destroyed` / `exfiltrated` / `stalemate` / `summoning`) |
| **Turns** | One row per resolved turn | `Turn` (title), `Order move`, `Shadow move`, `Winner`, `Throne verdict`, `Integrity/Secrecy after`, `Timestamp` |
| **Games** | One row per *completed* game (Chronicles archive) | `Game ID`, `Started`, `Ended`, `Final holder/integrity/secrecy/status`, `Total turns`, `Order/Shadow wins`, `Outcome`, `Summary` |
| **Vault** / **Public** | Optional — tool side-effects (vaulted ring page, public whispers) | Per tool's `_notion_helpers.ts` |

The `Status` select on Ring State auto-acquires the `summoning` option on the first tap after deploy — Notion creates select options on first write, no manual schema work.

## Quick start

Prereqs: Node ≥ 22, npm ≥ 10.9.2, the `ntn` CLI, an Anthropic API key, and a Notion workspace with the Ring War databases created (see [doc 03 — Notion Schemas](https://www.notion.so/3628b6b1991681a6b235c851685c942f)).

```bash
# 1. Install the Notion CLI (one-time)
curl -fsSL https://ntn.dev | bash

# 2. Install deps and sign in
npm install
ntn login

# 3. Fill in .env with your IDs (copy from .dev.vars.example)
#    ANTHROPIC_API_KEY, RING_STATE_DB_ID, VAULT_DB_ID, TURNS_DB_ID,
#    PUBLIC_DB_ID, GAMES_DB_ID
#    NOTION_TOKEN is auto-injected by the Workers runtime for the Worker;
#    set it manually for the dashboard's Vercel project.

# 4. Worker — run locally
ntn workers dev
# Tail live runs from another terminal:
prev=""; while true; do
  latest=$(ntn workers runs list --plain 2>/dev/null | head -1 | cut -f1)
  if [ -n "$latest" ] && [ "$latest" != "$prev" ]; then
    echo "=== $(date +%T) $latest ==="; ntn workers runs logs "$latest" 2>&1 | tail -15; echo
    prev="$latest"
  fi
  sleep 2
done

# 5. Smoke test
curl -X POST <worker-url>/tap

# 6. Deploy worker
ntn workers deploy
ntn workers webhooks list   # grab the /tap URL for the NFC Shortcut

# 7. Dashboard env (Vercel project)
#    NOTION_TOKEN, RING_STATE_DB_ID, TURNS_DB_ID, GAMES_DB_ID,
#    WORKER_TAP_WEBHOOK_URL  (the /tap URL printed by step 6)

# 8. Deploy dashboard
cd dashboard && vercel deploy --prod
```

Type-check only: `npm run check`. Build: `npm run build`. Tool tests: `npm run test` (Vitest, ~290ms for the full suite).

## NFC Shortcut setup

The NFC ring fires an iOS Shortcut that POSTs to the deployed Worker `/tap` URL. Built-in 5-second debounce uses a Reminders entry as the persistent timestamp:

```
Find Reminders where Title is "ring-war-lasttap" (limit 1)
If Reminders has any value
  Date (Current Date)
  Get seconds between Reminders[Date Created] and Date
  If Time Between Dates < 5
    Stop and Output "tap ignored — debounced"
  End If
End If
Remove Reminders        (input: Reminders)
Add ring-war-lasttap to Reminders with No Alert
Get Contents of <worker-/tap-URL>   (POST, JSON body)
```

iOS Shortcuts has no built-in cross-run persistent variable; the Reminder's Date Created is the stand-in. Catches NFC long-touch double-reads (the dominant duplicate-tap cause) at the source before any network call.

## Docs

The canonical spec lives in Notion. This repo is the implementation.

**Reference**
- [00 — Index](https://www.notion.so/3628b6b19916818c8189d0252bb7f0f2)
- [01 — Architecture](https://www.notion.so/3628b6b19916815db679f3411ddca601)
- [02 — Game Mechanics](https://www.notion.so/3628b6b199168100b985e0aa77302245)
- [03 — Notion Schemas](https://www.notion.so/3628b6b1991681a6b235c851685c942f)
- [04 — Worker Tools](https://www.notion.so/3628b6b1991681fdb0add5b495cfcecf)
- [05 — System Prompts](https://www.notion.so/3628b6b1991681ecb52ccf3c4c13dc00)

**Build (one per worktree)**
- [06 — Agent 1: Worker Core](https://www.notion.so/3628b6b1991681a29b12f1849dff9a64)
- [07 — Agent 2: Notion Tools](https://www.notion.so/3628b6b19916810e95edec46ded25b5f)
- [08 — Agent 3: Dashboard](https://www.notion.so/3628b6b19916811ca5cbc269c61e2b08)
- [09 — Agent 4: Prompts & Content](https://www.notion.so/3628b6b19916814483abd80b2d62c023)
- [10 — Bootstrap & Worktrees](https://www.notion.so/3628b6b199168114a1f4de09d6f9621c)

**Demo & stretch**
- [11 — Demo Arc](https://www.notion.so/3628b6b199168170b5d1e0b78d26a89e)
- [12 — Stretch Goals](https://www.notion.so/3628b6b199168189a9f0ed5f68ef3704)

## Status

Built live during the Notion Developer Platform hackathon. Outside contributions: fork and open a PR; direct pushes to `main` are restricted to the maintainer.

## License

[MIT](./LICENSE) © 2026 Carlos Arevalo
