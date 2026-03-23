#!/usr/bin/env node

// Stop hook: checks relay for partner updates and prints them
// so Claude sees the context on the next turn.

const RELAY_URL = process.env["COOP_RELAY_URL"] ?? "http://localhost:4545";
const SESSION_FILE = `${process.env["HOME"]}/.claude-coop-session.json`;

import { readFileSync, writeFileSync } from "node:fs";

interface SessionState {
  code: string;
  name: string;
  lastSeen: number;
}

function loadSession(): SessionState | null {
  try {
    const data = readFileSync(SESSION_FILE, "utf-8");
    return JSON.parse(data) as SessionState;
  } catch {
    return null;
  }
}

function saveSession(state: SessionState): void {
  writeFileSync(SESSION_FILE, JSON.stringify(state));
}

async function checkForUpdates(): Promise<void> {
  const session = loadSession();
  if (!session) return;

  try {
    const resp = await fetch(
      `${RELAY_URL}/session/${session.code}/messages?since=${session.lastSeen}&name=${session.name}`
    );

    if (!resp.ok) return;

    const data = (await resp.json()) as {
      messages: Array<{
        from: string;
        content: string;
        type: string;
        timestamp: number;
      }>;
    };

    if (data.messages.length === 0) return;

    // Print to stdout so it appears in the Claude Code conversation
    console.log(`\n[co-op update from partner]`);
    for (const msg of data.messages) {
      const label = msg.type === "file_change" ? "FILE" : msg.type === "task" ? "TASK" : "MSG";
      console.log(`  [${label}] ${msg.from}: ${msg.content}`);
    }

    // Update last seen
    const lastMsg = data.messages[data.messages.length - 1];
    if (lastMsg) {
      session.lastSeen = lastMsg.timestamp;
      saveSession(session);
    }
  } catch {
    // Relay not running — silently skip
  }
}

checkForUpdates();
