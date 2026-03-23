#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { startRelay } from "./relay.js";

const HOME = process.env["HOME"] ?? "";
const CLAUDE_DIR = join(HOME, ".claude");
const SETTINGS_FILE = join(CLAUDE_DIR, "settings.json");
const SESSION_FILE = join(HOME, ".claude-coop-session.json");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..");

// --- Settings management ---

interface HookEntry {
  matcher?: string;
  hooks: Array<{ type: string; command: string }>;
}

interface Settings {
  mcpServers?: Record<
    string,
    { command: string; args?: string[]; env?: Record<string, string> }
  >;
  hooks?: Record<string, HookEntry[]>;
  [key: string]: unknown;
}

function loadSettings(): Settings {
  if (!existsSync(SETTINGS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, "utf-8")) as Settings;
  } catch {
    return {};
  }
}

function saveSettings(settings: Settings): void {
  if (!existsSync(CLAUDE_DIR)) {
    mkdirSync(CLAUDE_DIR, { recursive: true });
  }
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + "\n");
}

function installMcp(relayUrl: string): void {
  const settings = loadSettings();
  const mcpPath = join(PROJECT_ROOT, "dist", "mcp.js");
  const hookPath = join(PROJECT_ROOT, "dist", "hook.js");

  // Add MCP server — use compiled JS with node, works on any machine
  if (!settings.mcpServers) settings.mcpServers = {};
  settings.mcpServers["coop"] = {
    command: "node",
    args: [mcpPath],
    env: { COOP_RELAY_URL: relayUrl },
  };

  // Add Stop hook
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks["Stop"]) settings.hooks["Stop"] = [];

  const hookExists = settings.hooks["Stop"]!.some((entry) =>
    entry.hooks?.some((h) => h.command.includes("hook"))
  );
  if (!hookExists) {
    settings.hooks["Stop"]!.push({
      matcher: "",
      hooks: [{ type: "command", command: `node ${hookPath}` }],
    });
  }

  saveSettings(settings);
}

function uninstallMcp(): void {
  const settings = loadSettings();

  if (settings.mcpServers) {
    delete settings.mcpServers["coop"];
  }

  if (settings.hooks?.["Stop"]) {
    settings.hooks["Stop"] = settings.hooks["Stop"]!.filter(
      (entry) => !entry.hooks?.some((h) => h.command.includes("claude-coop"))
    );
  }

  saveSettings(settings);

  // Clean up session file
  try {
    unlinkSync(SESSION_FILE);
  } catch {
    // ignore
  }
}

// --- Parse args ---

function parseArgs(): {
  command: string;
  name: string;
  code: string;
  port: number;
} {
  const args = process.argv.slice(2);
  let command = "start";
  let name = "";
  let code = "";
  let port = 4545;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === "join" && !code) {
      command = "join";
      code = args[++i] ?? "";
    } else if (arg === "remove" || arg === "uninstall") {
      command = "remove";
    } else if (arg === "--name" || arg === "-n") {
      name = args[++i] ?? "";
    } else if (arg === "--port" || arg === "-p") {
      port = parseInt(args[++i] ?? "4545");
    } else if (arg === "--help" || arg === "-h") {
      command = "help";
    } else if (!name && !arg.startsWith("-")) {
      // Positional: if we're in join mode, it's the code; otherwise it's the name
      if (command === "join" && !code) {
        code = arg;
      } else if (!name) {
        name = arg;
      }
    }
  }

  return { command, name, code, port };
}

// --- Commands ---

async function start(name: string, port: number): Promise<void> {
  if (!name) {
    console.error("  Error: --name is required\n  Usage: claude-coop --name YourName");
    process.exit(1);
  }

  const relayUrl = `http://localhost:${port}`;

  // Step 1: Start embedded relay
  console.log(`\n  Starting relay on port ${port}...`);
  startRelay(port);

  // Step 2: Create session
  const resp = await fetch(`${relayUrl}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = (await resp.json()) as { code: string };

  // Step 3: Save session state for MCP + hook
  writeFileSync(SESSION_FILE, JSON.stringify({ code: data.code, name, lastSeen: Date.now() }));

  // Step 4: Install MCP server + hook into Claude Code settings
  installMcp(relayUrl);

  console.log(`
  ╔═══════════════════════════════════════════╗
  ║           claude-coop started             ║
  ╠═══════════════════════════════════════════╣
  ║                                           ║
  ║  Session code:  ${data.code}                    ║
  ║  Your name:     ${name.padEnd(25)}║
  ║  Relay:         localhost:${String(port).padEnd(15)}║
  ║                                           ║
  ║  Share this with your partner:            ║
  ║  claude-coop join ${data.code} --name TheirName  ║
  ║                                           ║
  ╚═══════════════════════════════════════════╝

  Claude Code is now configured with co-op tools.
  Open a new terminal and run: claude

  Then say: "I'm in a co-op session, check for my partner"
  `);

  // Keep the process alive (relay is running)
  process.on("SIGINT", () => {
    console.log("\n  Shutting down co-op session...");
    uninstallMcp();
    process.exit(0);
  });
}

async function joinSession(
  code: string,
  name: string,
  port: number
): Promise<void> {
  if (!code || !name) {
    console.error(
      "  Error: code and --name are required\n  Usage: claude-coop join ABC123 --name YourName"
    );
    process.exit(1);
  }

  const relayUrl = `http://localhost:${port}`;

  // Try to join — relay should already be running (started by partner)
  try {
    const resp = await fetch(`${relayUrl}/session/${code}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    if (!resp.ok) {
      const err = (await resp.json()) as { error: string };
      console.error(`  Error: ${err.error}`);
      process.exit(1);
    }

    const data = (await resp.json()) as {
      session: { members: string[] };
    };

    // Save session state
    writeFileSync(
      SESSION_FILE,
      JSON.stringify({ code, name, lastSeen: Date.now() })
    );

    // Install MCP + hook
    installMcp(relayUrl);

    console.log(`
  ╔═══════════════════════════════════════════╗
  ║         joined co-op session!             ║
  ╠═══════════════════════════════════════════╣
  ║                                           ║
  ║  Session:  ${code}                            ║
  ║  Members:  ${data.session.members.join(", ").padEnd(30)}║
  ║                                           ║
  ╚═══════════════════════════════════════════╝

  Claude Code is now configured with co-op tools.
  Open a new terminal and run: claude

  Then say: "I'm in a co-op session, check what my partner is doing"
    `);
  } catch {
    console.error(
      `  Error: Could not connect to relay at ${relayUrl}\n  Make sure your partner has started a session first.`
    );
    process.exit(1);
  }
}

function showHelp(): void {
  console.log(`
  claude-coop — Pair program with AI agents together

  Usage:
    claude-coop --name YourName              Start a new co-op session
    claude-coop join <code> --name YourName  Join your partner's session
    claude-coop remove                       Remove co-op from Claude Code

  Options:
    --name, -n    Your display name
    --port, -p    Relay server port (default: 4545)
    --help, -h    Show this help

  How it works:
    1. You start a session → get a join code
    2. Your partner joins with the code
    3. Both open Claude Code in separate terminals
    4. Your AI agents share context automatically
  `);
}

// --- Main ---

const { command, name, code, port } = parseArgs();

switch (command) {
  case "start":
    start(name, port);
    break;
  case "join":
    joinSession(code, name, port);
    break;
  case "remove":
    uninstallMcp();
    console.log("  claude-coop removed from Claude Code settings.");
    break;
  case "help":
    showHelp();
    break;
  default:
    showHelp();
}
