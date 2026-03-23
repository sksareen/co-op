# claude-coop

Pair programming with AI agents. Two developers, each in their own Claude Code instance, sharing context in real time.

## How it works

```
Developer A (Claude Code)          Developer B (Claude Code)
       │                                  │
       ├── /coop start Savar              │
       │        ──────────────►           │
       │   join code: LSX64Z              │
       │                     /coop join LSX64Z Karan
       │                                  │
       ├── "I'll do backend auth"         │
       │   coop_claim_task ──►            │
       │                     ◄── coop_check
       │                     "Savar claimed backend auth"
       │                                  │
       ├── edits auth.ts                  ├── edits Login.tsx
       │   coop_file_changed ──►          │
       │                     ◄── coop_file_changed
       │                                  │
       ├── "auth routes done"             │
       │   coop_complete_task ──►         │
       │                     ◄── coop_check
       │                     "Savar completed backend auth"
```

Both Claude instances share context through a lightweight relay server. Each developer works normally in Claude Code — the co-op layer syncs what they're doing, prevents file conflicts, and splits tasks.

## Install

```bash
# Clone
git clone git@github.com:sksareen/co-op.git
cd co-op
npm install
npm run build

# Add the MCP server to Claude Code
# (add to ~/.claude.json under mcpServers)
```

Add this to your `~/.claude.json`:

```json
{
  "mcpServers": {
    "coop": {
      "command": "node",
      "args": ["/path/to/co-op/dist/mcp.js"],
      "type": "stdio",
      "env": {
        "COOP_RELAY_URL": "http://localhost:4545"
      }
    }
  }
}
```

Copy the skill for `/coop` slash commands:

```bash
mkdir -p ~/.claude/skills/coop
cp skills/SKILL.md ~/.claude/skills/coop/SKILL.md
```

## Usage

### Terminal 1 — start the relay

```bash
npx tsx src/relay.ts
```

### Terminal 2 — Developer A

```bash
claude
```

```
/coop start Savar
# → Session code: LSX64Z
```

### Terminal 3 — Developer B

```bash
claude
```

```
/coop join LSX64Z Karan
```

### Commands

| Command | What it does |
|---|---|
| `/coop start <name>` | Start a session, get a join code |
| `/coop join <code> <name>` | Join your partner's session |
| `/coop check` | See what your partner's been doing |
| `/coop status` | Session info |
| `/coop share <message>` | Share context with partner |
| `/coop tasks` | View task board |
| `/coop claim <task>` | Claim a task ("I'll do backend") |
| `/coop done <task>` | Mark a task complete |

## MCP Tools

The MCP server provides 9 tools that Claude Code can call:

- **`coop_start`** — Start a new session
- **`coop_join`** — Join with a code
- **`coop_check`** — See partner updates
- **`coop_share`** — Share context/progress
- **`coop_file_changed`** — Notify partner about file edits
- **`coop_claim_task`** — Claim a task so partner knows you're on it
- **`coop_tasks`** — View all tasks and assignments
- **`coop_complete_task`** — Mark a task done
- **`coop_status`** — Session info

## Architecture

```
┌─────────────────────────────────────────┐
│           RELAY SERVER (HTTP)           │
│         localhost:4545                  │
│                                         │
│  Sessions → messages, tasks, members    │
└──────────┬──────────────────┬───────────┘
      HTTP POST/GET      HTTP POST/GET
           │                  │
┌──────────┴───────┐ ┌───────┴──────────┐
│  Developer A     │ │  Developer B     │
│  Claude Code     │ │  Claude Code     │
│    └── MCP Server│ │    └── MCP Server│
│       (coop)     │ │       (coop)     │
└──────────────────┘ └──────────────────┘
```

- **Relay server** — Express HTTP server, in-memory session store, manages messages and tasks
- **MCP server** — Stdio-based, provides coop tools to Claude Code, talks to relay via HTTP
- **Slash command** — `/coop` skill for quick access to all commands

## What makes this different from stoops

| | **claude-coop** | **stoops** |
|---|---|---|
| Framing | Pair programming (2 devs) | Chat room (N agents) |
| Integration | MCP-native | tmux injection |
| File awareness | Built-in | No |
| Task splitting | Built-in | No |
| Complexity | 4 commands to learn | 8 engagement modes |

## Roadmap

See [ROADMAP.md](ROADMAP.md) for levels 2 (SSE real-time streaming) and 3 (live TUI dashboard).

## License

MIT
