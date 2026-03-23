import express, { type Request, type Response } from "express";

// --- Types ---

interface Message {
  from: string;
  content: string;
  timestamp: number;
  type: "context" | "chat" | "action" | "file_change" | "task";
}

interface Task {
  id: string;
  description: string;
  assignee: string;
  status: "todo" | "in_progress" | "done";
  createdAt: number;
}

interface Session {
  code: string;
  members: string[];
  messages: Message[];
  tasks: Task[];
  createdAt: number;
}

// --- In-memory store ---

const sessions = new Map<string, Session>();

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// --- Server ---

function createApp(): ReturnType<typeof express> {
  const app = express();
  app.use(express.json());

  // Health check
  app.get("/", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      service: "claude-coop relay",
      sessions: sessions.size,
    });
  });

  // Create session
  app.post("/session", (req: Request, res: Response) => {
    const { name } = req.body as { name?: string };
    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const code = generateCode();
    const session: Session = {
      code,
      members: [name],
      messages: [],
      tasks: [],
      createdAt: Date.now(),
    };
    sessions.set(code, session);
    console.log(`  [session] created ${code} by ${name}`);
    res.json({ code, session });
  });

  // Join session
  app.post("/session/:code/join", (req: Request, res: Response) => {
    const code = req.params["code"] as string;
    const { name } = req.body as { name?: string };

    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const session = sessions.get(code);
    if (!session) {
      res.status(404).json({ error: `session ${code} not found` });
      return;
    }

    if (!session.members.includes(name)) {
      session.members.push(name);
    }

    console.log(
      `  [session] ${name} joined ${code} (${session.members.join(", ")})`
    );
    res.json({ session });
  });

  // Post message
  app.post("/session/:code/messages", (req: Request, res: Response) => {
    const code = req.params["code"] as string;
    const { from, content, type } = req.body as {
      from?: string;
      content?: string;
      type?: Message["type"];
    };

    if (!from || !content) {
      res.status(400).json({ error: "from and content are required" });
      return;
    }

    const session = sessions.get(code);
    if (!session) {
      res.status(404).json({ error: `session ${code} not found` });
      return;
    }

    const message: Message = {
      from,
      content,
      timestamp: Date.now(),
      type: type ?? "context",
    };
    session.messages.push(message);

    console.log(`  [msg] ${from}: ${content.slice(0, 60)}${content.length > 60 ? "..." : ""}`);
    res.json({ message });
  });

  // Get messages
  app.get("/session/:code/messages", (req: Request, res: Response) => {
    const code = req.params["code"] as string;
    const since = parseInt(req.query["since"] as string) || 0;
    const requester = req.query["name"] as string | undefined;

    const session = sessions.get(code);
    if (!session) {
      res.status(404).json({ error: `session ${code} not found` });
      return;
    }

    let messages = session.messages.filter((m) => m.timestamp > since);
    if (requester) {
      messages = messages.filter((m) => m.from !== requester);
    }

    res.json({ messages, members: session.members });
  });

  // Get session info
  app.get("/session/:code", (req: Request, res: Response) => {
    const code = req.params["code"] as string;
    const session = sessions.get(code);
    if (!session) {
      res.status(404).json({ error: `session ${code} not found` });
      return;
    }
    res.json({ session });
  });

  // --- Task endpoints ---

  // Add task
  app.post("/session/:code/tasks", (req: Request, res: Response) => {
    const code = req.params["code"] as string;
    const { description, assignee } = req.body as {
      description?: string;
      assignee?: string;
    };

    if (!description || !assignee) {
      res.status(400).json({ error: "description and assignee are required" });
      return;
    }

    const session = sessions.get(code);
    if (!session) {
      res.status(404).json({ error: `session ${code} not found` });
      return;
    }

    const task: Task = {
      id: `t${Date.now()}`,
      description,
      assignee,
      status: "todo",
      createdAt: Date.now(),
    };
    session.tasks.push(task);

    // Also post as a message so partner sees it
    session.messages.push({
      from: assignee,
      content: `Claimed task: ${description}`,
      timestamp: Date.now(),
      type: "task",
    });

    console.log(`  [task] ${assignee} claimed: ${description}`);
    res.json({ task });
  });

  // Update task status
  app.patch("/session/:code/tasks/:taskId", (req: Request, res: Response) => {
    const code = req.params["code"] as string;
    const taskId = req.params["taskId"] as string;
    const { status } = req.body as { status?: Task["status"] };

    const session = sessions.get(code);
    if (!session) {
      res.status(404).json({ error: `session ${code} not found` });
      return;
    }

    const task = session.tasks.find((t) => t.id === taskId);
    if (!task) {
      res.status(404).json({ error: `task ${taskId} not found` });
      return;
    }

    if (status) task.status = status;

    session.messages.push({
      from: task.assignee,
      content: `Task "${task.description}" → ${status}`,
      timestamp: Date.now(),
      type: "task",
    });

    res.json({ task });
  });

  // List tasks
  app.get("/session/:code/tasks", (req: Request, res: Response) => {
    const code = req.params["code"] as string;
    const session = sessions.get(code);
    if (!session) {
      res.status(404).json({ error: `session ${code} not found` });
      return;
    }
    res.json({ tasks: session.tasks });
  });

  return app;
}

// Export for embedded use
export function startRelay(port: number): void {
  const app = createApp();
  app.listen(port, () => {
    console.log(`  Relay running on http://localhost:${port}`);
  });
}

// Allow standalone execution
const isMain = process.argv[1]?.endsWith("relay.ts") || process.argv[1]?.endsWith("relay.js");
if (isMain) {
  const port = parseInt(process.env["PORT"] ?? "4545");
  startRelay(port);
}
