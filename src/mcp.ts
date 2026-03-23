import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// --- Config ---

const RELAY_URL = process.env["COOP_RELAY_URL"] ?? "http://localhost:4545";
const SESSION_FILE = `${process.env["HOME"]}/.claude-coop-session.json`;

// Load session from disk (written by CLI)
interface SessionState {
  code: string;
  name: string;
  lastSeen: number;
}

function loadSession(): SessionState | null {
  try {
    if (!existsSync(SESSION_FILE)) return null;
    return JSON.parse(readFileSync(SESSION_FILE, "utf-8")) as SessionState;
  } catch {
    return null;
  }
}

function saveSession(state: SessionState): void {
  writeFileSync(SESSION_FILE, JSON.stringify(state));
}

// Session state — loaded from disk, updated in memory
let session = loadSession();

// --- Helper: call relay server ---

async function relayFetch(
  path: string,
  options: { method?: string; body?: Record<string, unknown> } = {}
): Promise<unknown> {
  const resp = await fetch(`${RELAY_URL}${path}`, {
    method: options.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data: unknown = await resp.json();

  if (!resp.ok) {
    const err = data as { error?: string };
    throw new Error(err.error ?? `relay error ${resp.status}`);
  }

  return data;
}

// --- MCP Server ---

const server = new McpServer({
  name: "claude-coop",
  version: "0.1.0",
});

// Tool: start a co-op session
server.tool(
  "coop_start",
  "Start a new co-op pair programming session. Returns a join code to share with your partner.",
  { name: z.string().describe("Your name (e.g., 'Savar')") },
  async ({ name }) => {
    const result = (await relayFetch("/session", {
      method: "POST",
      body: { name },
    })) as { code: string };

    session = { code: result.code, name, lastSeen: Date.now() };
    saveSession(session);

    return {
      content: [
        {
          type: "text" as const,
          text: `Co-op session started!\n\nJoin code: ${result.code}\n\nTell your partner to run:\n  claude-coop join ${result.code} --name TheirName`,
        },
      ],
    };
  }
);

// Tool: join an existing session
server.tool(
  "coop_join",
  "Join your partner's co-op session using their join code.",
  {
    code: z.string().describe("The 6-character join code"),
    name: z.string().describe("Your name"),
  },
  async ({ code, name }) => {
    const result = (await relayFetch(`/session/${code}/join`, {
      method: "POST",
      body: { name },
    })) as { session: { members: string[] } };

    session = { code, name, lastSeen: Date.now() };
    saveSession(session);

    return {
      content: [
        {
          type: "text" as const,
          text: `Joined session ${code}! Members: ${result.session.members.join(", ")}`,
        },
      ],
    };
  }
);

// Tool: share context with partner
server.tool(
  "coop_share",
  "Share what you're working on with your pair programming partner. Use this proactively to keep them in the loop — progress updates, decisions made, questions, blockers.",
  {
    content: z.string().describe("What to share with your partner"),
    type: z
      .enum(["context", "chat", "action"])
      .optional()
      .describe("context=status update, chat=direct message, action=something you did"),
  },
  async ({ content, type }) => {
    if (!session) {
      session = loadSession();
      if (!session) {
        return { content: [{ type: "text" as const, text: "Not in a co-op session." }] };
      }
    }

    await relayFetch(`/session/${session.code}/messages`, {
      method: "POST",
      body: { from: session.name, content, type: type ?? "context" },
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Shared with partner: "${content.slice(0, 80)}${content.length > 80 ? "..." : ""}"`,
        },
      ],
    };
  }
);

// Tool: check partner updates
server.tool(
  "coop_check",
  "Check what your pair programming partner has been doing. Shows their recent updates, file changes, and messages since you last checked.",
  {},
  async () => {
    if (!session) {
      session = loadSession();
      if (!session) {
        return { content: [{ type: "text" as const, text: "Not in a co-op session." }] };
      }
    }

    const result = (await relayFetch(
      `/session/${session.code}/messages?since=${session.lastSeen}&name=${session.name}`
    )) as {
      messages: Array<{ from: string; content: string; type: string; timestamp: number }>;
      members: string[];
    };

    if (result.messages.length > 0) {
      const lastMsg = result.messages[result.messages.length - 1];
      if (lastMsg) {
        session.lastSeen = lastMsg.timestamp;
        saveSession(session);
      }
    }

    if (result.messages.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No new updates. Session members: ${result.members.join(", ")}`,
          },
        ],
      };
    }

    const updates = result.messages
      .map((m) => {
        const label = m.type === "file_change" ? "FILE" : m.type === "task" ? "TASK" : m.type.toUpperCase();
        return `[${label}] ${m.from}: ${m.content}`;
      })
      .join("\n");

    return {
      content: [{ type: "text" as const, text: `Partner updates:\n\n${updates}` }],
    };
  }
);

// Tool: notify partner about a file change
server.tool(
  "coop_file_changed",
  "Tell your partner about a file you just created or modified. This helps them stay aware of what's changing in the codebase and avoid conflicts.",
  {
    file: z.string().describe("File path that changed"),
    summary: z.string().describe("Brief description of what changed (1-2 sentences)"),
  },
  async ({ file, summary }) => {
    if (!session) {
      session = loadSession();
      if (!session) {
        return { content: [{ type: "text" as const, text: "Not in a co-op session." }] };
      }
    }

    await relayFetch(`/session/${session.code}/messages`, {
      method: "POST",
      body: {
        from: session.name,
        content: `Modified ${file}: ${summary}`,
        type: "file_change",
      },
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Notified partner about change to ${file}`,
        },
      ],
    };
  }
);

// Tool: claim a task
server.tool(
  "coop_claim_task",
  "Claim a task so your partner knows you're handling it. Use this to split work — e.g., 'I'll handle the backend auth routes' while your partner does frontend.",
  {
    description: z.string().describe("What you're going to work on"),
  },
  async ({ description }) => {
    if (!session) {
      session = loadSession();
      if (!session) {
        return { content: [{ type: "text" as const, text: "Not in a co-op session." }] };
      }
    }

    const result = (await relayFetch(`/session/${session.code}/tasks`, {
      method: "POST",
      body: { description, assignee: session.name },
    })) as { task: { id: string; description: string; assignee: string } };

    return {
      content: [
        {
          type: "text" as const,
          text: `Claimed task: "${result.task.description}"\nYour partner will see this.`,
        },
      ],
    };
  }
);

// Tool: view all tasks
server.tool(
  "coop_tasks",
  "View all tasks in the co-op session — who's working on what, and what's done.",
  {},
  async () => {
    if (!session) {
      session = loadSession();
      if (!session) {
        return { content: [{ type: "text" as const, text: "Not in a co-op session." }] };
      }
    }

    const result = (await relayFetch(`/session/${session.code}/tasks`)) as {
      tasks: Array<{ id: string; description: string; assignee: string; status: string }>;
    };

    if (result.tasks.length === 0) {
      return {
        content: [{ type: "text" as const, text: "No tasks yet. Use coop_claim_task to split work." }],
      };
    }

    const taskList = result.tasks
      .map((t) => {
        const icon = t.status === "done" ? "✓" : t.status === "in_progress" ? "→" : "○";
        return `  ${icon} [${t.assignee}] ${t.description} (${t.status})`;
      })
      .join("\n");

    return {
      content: [{ type: "text" as const, text: `Tasks:\n${taskList}` }],
    };
  }
);

// Tool: complete a task
server.tool(
  "coop_complete_task",
  "Mark a task as done. Your partner will be notified.",
  {
    task_description: z.string().describe("The task description (or part of it) to mark as done"),
  },
  async ({ task_description }) => {
    if (!session) {
      session = loadSession();
      if (!session) {
        return { content: [{ type: "text" as const, text: "Not in a co-op session." }] };
      }
    }

    // Find matching task
    const result = (await relayFetch(`/session/${session.code}/tasks`)) as {
      tasks: Array<{ id: string; description: string; assignee: string; status: string }>;
    };

    const task = result.tasks.find((t) =>
      t.description.toLowerCase().includes(task_description.toLowerCase())
    );

    if (!task) {
      return {
        content: [{ type: "text" as const, text: `No task matching "${task_description}" found.` }],
      };
    }

    await relayFetch(`/session/${session.code}/tasks/${task.id}`, {
      method: "PATCH",
      body: { status: "done" },
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Completed: "${task.description}" ✓\nYour partner has been notified.`,
        },
      ],
    };
  }
);

// Tool: session status
server.tool(
  "coop_status",
  "Check the current co-op session — who's connected and session info.",
  {},
  async () => {
    if (!session) {
      session = loadSession();
      if (!session) {
        return { content: [{ type: "text" as const, text: "Not in a co-op session." }] };
      }
    }

    const result = (await relayFetch(`/session/${session.code}`)) as {
      session: { code: string; members: string[]; messages: unknown[]; tasks: unknown[] };
    };

    return {
      content: [
        {
          type: "text" as const,
          text: `Session: ${result.session.code}\nMembers: ${result.session.members.join(", ")}\nMessages: ${result.session.messages.length}\nTasks: ${result.session.tasks.length}\nYou: ${session.name}`,
        },
      ],
    };
  }
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error("MCP server error:", err);
  process.exit(1);
});
