# claude-coop Roadmap

## Level 1: MCP Tools + Slash Command (done)

Pair programming via MCP tools that Claude Code can call. `/coop` slash command for quick access.

**Tools:** `coop_start`, `coop_join`, `coop_check`, `coop_share`, `coop_file_changed`, `coop_claim_task`, `coop_tasks`, `coop_complete_task`, `coop_status`

**Architecture:** HTTP relay server + MCP server (stdio) + Stop hook for auto-checking partner updates.

**Limitation:** Pull-based. Partner updates only appear when the Stop hook fires (after Claude responds) or when you manually call `coop_check`.

---

## Level 2: Real-time streaming (SSE)

**Problem:** Partner updates only appear when the Stop hook fires or when you manually check. If your partner shares something while Claude is thinking, you won't see it until Claude finishes.

### Architecture change

```
CURRENT (polling):
  Hook fires → HTTP GET /messages?since=X → print if new

LEVEL 2 (SSE streaming):
  Relay adds: GET /session/:code/stream → SSE connection

  A background process connects to the SSE stream and
  prints partner updates to the terminal in real-time,
  independent of Claude's response cycle.
```

### What to build

1. **SSE endpoint on relay:** `GET /session/:code/stream?name=X`
   - Keeps connection open
   - Pushes new messages as `data: {json}\n\n` events
   - Filters out your own messages

2. **`claude-coop watch` background process:**
   - Connects to the SSE stream
   - Prints partner updates to terminal as they arrive
   - Runs in a tmux pane or background process alongside Claude Code

3. **CLI update:** `claude-coop --name Savar` also spawns the watcher automatically in a tmux split (if tmux is available) or as a background process

**Estimated effort:** Half a day. SSE endpoint is ~30 lines. Watcher is ~50 lines. tmux integration is the fiddly part.

---

## Level 3: Live dashboard TUI

**Problem:** Even with SSE, partner updates are just text lines scrolling in a terminal. Need a structured dashboard — task board, activity feed, member status — all updating live.

### Architecture

```
┌──────────────────────────────────────────────────┐
│  claude-coop dashboard                           │
│                                                  │
│  Session: LSX64Z          Members: Savar, Karan  │
│  ─────────────────────────────────────────────── │
│                                                  │
│  Tasks                                           │
│  ✓ [Savar] Backend auth routes          done     │
│  → [Karan] Frontend login component     active   │
│  ○ [unassigned] Write integration tests  todo    │
│                                                  │
│  ─────────────────────────────────────────────── │
│  Activity Feed                                   │
│  [FILE] Karan: Modified src/Login.tsx —           │
│         added form validation                     │
│  [TASK] Savar: Completed "Backend auth routes"   │
│  [MSG]  Karan: Should login redirect to /home    │
│         or /dashboard?                            │
│  [FILE] Savar: Modified src/routes/auth.ts —     │
│         added JWT refresh endpoint                │
│                                                  │
│  ─────────────────────────────────────────────── │
│  > Type a message to your partner...             │
└──────────────────────────────────────────────────┘
```

### What to build

1. **TUI app using Ink** (React for terminals — same library Nightshift uses)
   - Task board component (reads from `GET /session/:code/tasks`)
   - Activity feed component (reads from SSE stream)
   - Member status bar
   - Text input at bottom for direct messages to partner

2. **Launched via** `claude-coop dashboard` or automatically in a tmux split

3. **File conflict awareness:** Dashboard shows which files each person is currently editing (via `file_changed` events) to prevent conflicts visually

**Estimated effort:** 1-2 days. Ink makes terminal UIs fast to build. The data layer already exists (relay + SSE from level 2).

### Demo video plan

Split screen — left side is Claude Code with `/coop` commands, right side is the dashboard showing live updates. That's the money shot.

---

## Comparison with stoops-cli

| | **claude-coop** | **stoops** |
|---|---|---|
| **Framing** | Pair programming (2 devs) | Chat room (N agents + humans) |
| **Integration** | MCP-native (works with Claude Code's tool system) | tmux injection (forces text into terminal) |
| **Complexity** | Simple — start, join, share | 8 engagement modes, permission tiers |
| **File awareness** | Built-in (`coop_file_changed`) | Not built-in |
| **Task splitting** | Built-in (`coop_claim_task`) | Not built-in |
| **Real-time** | Level 1: polling, Level 2: SSE | SSE from the start |
| **Dashboard** | Level 3 (planned) | No dedicated dashboard |
