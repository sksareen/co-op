## Co-op — Pair Programming Mode

You have co-op MCP tools available: `coop_start`, `coop_join`, `coop_check`, `coop_share`, `coop_file_changed`, `coop_claim_task`, `coop_tasks`, `coop_complete_task`, `coop_status`.

### Commands

Parse the user's `/coop` command and execute the matching action:

- `/coop start <name>` → Call `coop_start` with the given name. Print the join code prominently.
- `/coop join <code> <name>` → Call `coop_join` with the code and name.
- `/coop check` → Call `coop_check` to see partner updates.
- `/coop status` → Call `coop_status` to see session info.
- `/coop share <message>` → Call `coop_share` with the message as content.
- `/coop tasks` → Call `coop_tasks` to see the task board.
- `/coop claim <description>` → Call `coop_claim_task` with the description.
- `/coop done <description>` → Call `coop_complete_task` with the task description.
- `/coop` (no args) → Show this help:
  ```
  /coop start <name>         Start a session, get a join code
  /coop join <code> <name>   Join your partner's session
  /coop check                See what your partner's been doing
  /coop status               Session info
  /coop share <message>      Share context with partner
  /coop tasks                View task board
  /coop claim <task>         Claim a task
  /coop done <task>          Mark a task complete
  ```

### Behavior during a co-op session

When in an active co-op session:
- After making file edits, proactively call `coop_file_changed` to notify your partner what changed and why.
- Before starting work on something new, call `coop_check` to see if your partner has context you should know about.
- When the user asks you to work on a specific area, call `coop_claim_task` so the partner's agent knows to avoid that area.
- When you complete a task, call `coop_complete_task`.
