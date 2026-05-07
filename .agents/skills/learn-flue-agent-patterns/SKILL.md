---
name: learn-flue-agent-patterns
description: Guide the user through the Flue framework source code (/tmp/flue) to understand how a production coding agent is built, grounded in the fox codebase they've already written. Use when the user wants to study Flue's architecture, understand what's missing from their current agent, or learn how sessions/compaction/structured output/task delegation work by reading real production code.
---

# Learn Flue Agent Patterns

This skill teaches the user how a production coding agent is built by comparing what they've already built (the fox agent at `/Users/ashwinanil/Desktop/projects/fox`) against what Flue does at `/tmp/flue`. The user has a working agent — the goal is to deepen their understanding of the patterns by studying Flue's production implementations of concepts they've already touched.

**Do not start from scratch.** The user has already implemented the core loop. Always anchor the lesson to their existing code before showing them Flue's version.

---

## Rules — you guide, the human does

These are hard constraints for every interaction in this skill:

1. **Never write code into fox files.** Do not use any file editing or writing tools on the fox codebase. The human types all code themselves.

2. **When a phase involves implementing something in fox:** Describe the change in plain language — which file to open, what to add, what it should look like structurally. Do not produce the finished code block for them to paste in.

3. **When the human is stuck:** Show the abstract pattern or pseudocode from Flue's source as a reference. Do not write their specific implementation. Wait for them to try before offering more.

4. **Ask before advancing.** After every phase, ask the human to summarise what they learned or show you what they wrote before moving to the next phase. Do not skip this.

5. **Flue code is reference, not answer.** You may quote lines from `/tmp/flue` to illustrate a concept. You may not rewrite those lines into fox-specific code for the human.

6. **The human confirms completion.** Only mark a phase done in `learning-progress.yaml` after the human says they've understood and applied it — not after you've explained it.

---

## The current state of the fox codebase

Before starting any phase, orient the user by summarizing where they are:

- **`agent.ts`** — the core agent is done. The `chat()` function IS the loop:
  - Pushes user message to `messages[]`
  - Calls Gemini API in a `while(true)` loop
  - On `functionCall` → executes the tool → pushes result → continues
  - On text response → returns it
  - Handles 429 rate limiting with backoff
- **`tools.ts`** — 5 tools defined in Gemini's `functionDeclarations` format: `list_files`, `read_file`, `run_bash`, `edit_file`, `search_code`
- **`system-prompt.ts`** — working system prompt with code-search guidance and working directory injection
- **What's missing** (what Flue teaches): typed interfaces, session abstraction, context window management (compaction), structured output extraction, task delegation

---

## Progress tracking

At the start of every session, read `.claude/learning-progress.yaml`. Use it to:
- Know which phases are already done — skip them or offer a quick recap
- Resume from the correct phase without asking the user to repeat context
- Know what was noted in previous sessions

At the end of every session (or after each completed phase), update the file:
- Set `status` to `in_progress` or `done`
- Set `session_date` to today's date (YYYY-MM-DD)
- Write a one-line `notes` value capturing the key insight from that phase
- Update `next` to the next phase title or a specific sub-topic if mid-phase

Only update fields that changed. Do not rewrite the whole file.

---

## How to teach

Work through phases in order. Each phase:
1. Shows the user what they already have in fox
2. Shows them the equivalent in Flue
3. Asks them what Flue does differently and why
4. Extracts the pattern they should consider adding to fox

Between phases, check in: "Does that click? Anything you want to try before we move on?"

The output of this session should be a concrete list of improvements the user can make to fox, grounded in what they learned.

---

## Phase 1 — You Already Built the Loop

**The point:** The user's `chat()` function in `agent.ts` is fundamentally the same as Flue's `prompt()`. Make this explicit so they feel grounded, not lost.

Walk them through the equivalence line by line:

| fox (`agent.ts`) | Flue (`session.ts`) |
|---|---|
| `messages.push({ role: "user", ... })` | Appends to session history |
| `fetch(gemini_url, { body: messages })` | `harness.prompt(text)` → calls LLM |
| `parts.find(p => p.functionCall)` | Harness detects `tool_use` stop reason |
| `await executeTool(name, args)` | `tool.execute(args)` |
| `messages.push({ role: "function", ... })` | Appends `tool_result` block |
| `continue` (loop again) | Loop continues |
| `return text` | Returns on `end_turn` |

**Key difference to surface:** Flue wraps this loop in a harness library (`pi-agent-core`). Their fox loop does the same thing manually. Both are correct — fox's version is more transparent.

**File to read:** `/tmp/flue/packages/sdk/src/session.ts` — search for `withScopedRuntime` and the `prompt()` method. Read just the structure, not every line.

Ask the user: "What does fox do that Flue also does? What does Flue do that fox doesn't?"

---

## Phase 2 — Types: Making the Implicit Explicit

**The point:** fox uses `any` throughout (`messages: any[]`, `data: any`). Flue defines precise TypeScript interfaces. This matters when the codebase grows.

**File to read:** `/tmp/flue/packages/sdk/src/types.ts`
- Find `AgentMessage` — the typed shape of a message
- Find `ToolDef` — typed tool interface
- Find `FlueSession` — the public API surface

**Exercise for the user:**
Look at fox's `messages: any[]` in `agent.ts:15`. Ask them: what is the actual shape of a message in this array? It's one of:
- `{ role: "user", parts: [{ text: string }] }` — user turn
- `{ role: "model", parts: [...] }` — assistant turn (Gemini format)
- `{ role: "function", parts: [{ functionResponse: ... }] }` — tool result

Then show them how Flue's `AgentMessage` makes these shapes explicit.

**Pattern to extract for fox:**
```ts
// types.ts (new file to create)
interface UserMessage {
  role: "user"
  parts: [{ text: string }]
}

interface ModelMessage {
  role: "model"
  parts: Array<{ text?: string } | { functionCall?: { name: string; args: any } }>
}

interface FunctionMessage {
  role: "function"
  parts: [{ functionResponse: { name: string; response: { name: string; content: any } } }]
}

type Message = UserMessage | ModelMessage | FunctionMessage

interface Tool {
  name: string
  description: string
  execute(args: Record<string, any>): Promise<string>
}
```

Ask the user: "If you typed `messages` as `Message[]`, what would TypeScript catch that it currently misses?"

---

## Phase 3 — Tools: Descriptions Are the Interface

**The point:** fox's tools work, but compare their descriptions to Flue's. Description quality directly determines how reliably the LLM calls the tool correctly.

**File to read:** `/tmp/flue/packages/sdk/src/agent.ts` — read the `description` field of each built-in tool.

Walk through this comparison:

| Tool | fox description | Flue description style |
|---|---|---|
| `read_file` | "Read the contents of a file at the given path" | Includes what happens on error, what format is returned, edge cases (is it a directory?) |
| `run_bash` | "Execute a bash command and return its output" | Specifies what's returned (stdout + stderr + exit code), timeout behavior, when to prefer this vs other tools |
| `edit_file` | "Edit a file by replacing a specific string..." | Explicit about uniqueness requirement, what happens if string not found, create-vs-edit behavior |

**Key insight to surface:** Tool descriptions are documentation *for the LLM*, not for humans. The LLM uses them to decide:
1. Whether to call this tool at all
2. How to construct valid arguments
3. What to expect from the response

Better descriptions = fewer tool call failures = shorter task completion.

**Exercise:** Pick one fox tool together with the user. Rewrite its description to be more precise. Notice how the Flue version handles edge cases in the description itself, not just in the implementation.

Also point out that Flue's `edit` tool uses `startLine`/`endLine` (line-range replacement) rather than fox's string-match approach. Ask: what are the tradeoffs? String-match fails on duplicates; line-range is fragile to insertions. Both are real problems in production.

---

## Phase 4 — Session Abstraction

**The point:** fox has one global `messages` array. Flue wraps it in a `FlueSession` object. This matters as soon as you want multiple conversations, persistence, or tasks.

**File to read:** `/tmp/flue/packages/sdk/src/agent-client.ts` — focus on `session()` and `createTaskSession()`

**File to read:** `/tmp/flue/packages/sdk/src/session-history.ts` — focus on the tree structure and `buildContext()`

Walk through what fox does vs what Flue does:

| Concern | fox | Flue |
|---|---|---|
| Where messages live | Global `messages` array | `SessionHistory` object keyed by session ID |
| Multiple conversations | Not supported (restart = new process) | `agent.session(id)` — same id = same history |
| Persistence | In-memory only | `SessionStore` interface — plug in any backend |
| Task branches | Not supported | Child session with own history, inherits sandbox |

**Key insight to surface:** The session ID is how Flue supports multi-turn, multi-conversation, and multi-agent workflows. fox's global array means every process restart loses history, and you can't run two conversations at once.

**Pattern to extract for fox:**
```ts
// The simplest possible session abstraction
class Session {
  private messages: Message[] = []
  
  addUserMessage(text: string) {
    this.messages.push({ role: "user", parts: [{ text }] })
  }
  
  addModelMessage(content: any) {
    this.messages.push(content)
  }
  
  addToolResult(name: string, result: any) {
    this.messages.push({
      role: "function",
      parts: [{ functionResponse: { name, response: { name, content: result } } }]
    })
  }
  
  getMessages(): Message[] {
    return [...this.messages]
  }
}
```

Ask the user: "What would you need to add to fox to support saving and resuming a conversation?"

---

## Phase 5 — Compaction: Handling Long Sessions

**The point:** fox will eventually fail on long tasks because the `messages` array will grow until Gemini rejects the request with a context length error. Flue solves this with compaction.

**File to read:** `/tmp/flue/packages/sdk/src/compaction.ts` — read the full file (it's 200 lines)
**Also read:** `checkCompaction()` in `/tmp/flue/packages/sdk/src/session.ts`

Walk through the flow:

1. After each LLM response, check: how many tokens are in `messages`?
2. If `totalTokens > contextWindow - reserveTokens` → trigger compaction
3. Compaction: make a *separate* LLM call asking it to summarize the old messages
4. Replace old messages with the summary
5. Continue the conversation — the LLM sees `[summary] + [recent messages]`

Two triggers:
- **Threshold**: proactive, before overflow
- **Overflow**: `stop_reason === 'error'` → compact → retry the failed turn transparently

**Key insight to surface:** The compaction summary call uses the *same LLM* as the main loop. Flue sends a specific prompt that asks the LLM to preserve: what the goal was, what was done, what files were modified, what decisions were made. The result is a dense summary that lets the next call continue without losing context.

**Exercise:** Look at the summarization prompt in `compaction.ts`. Ask the user: "What would you ask the LLM to preserve if you had to summarize a coding session in 500 tokens?"

**Pattern to extract for fox:**
```ts
async function maybeCompact(messages: Message[], model: string): Promise<Message[]> {
  const tokenEstimate = JSON.stringify(messages).length / 4  // rough estimate
  if (tokenEstimate < COMPACTION_THRESHOLD) return messages
  
  // Keep last N messages untouched
  const recent = messages.slice(-KEEP_RECENT_COUNT)
  const old = messages.slice(0, -KEEP_RECENT_COUNT)
  
  const summary = await summarizeMessages(old, model)  // separate LLM call
  
  return [
    { role: "user", parts: [{ text: `[Previous session summary]\n${summary}` }] },
    ...recent
  ]
}
```

---

## Phase 6 — Structured Output

**The point:** Right now fox just returns `text || ""`. Flue can return typed, validated objects from any prompt. This is critical for agents that need to report structured results (lists of files changed, test results, etc.).

**File to read:** `/tmp/flue/packages/sdk/src/result.ts` — read the full file (129 lines)

Walk through the pattern:
1. Append to the prompt: "Wrap your final answer in `---RESULT_START---` / `---RESULT_END---` delimiters. The answer must be valid JSON matching this schema: `{...}`"
2. After the loop, find the last block matching those delimiters
3. Parse the JSON
4. Validate against the schema with valibot
5. If no block found → send a follow-up prompt asking for the result again in the correct format

**Key insight to surface:** This is how you get reliable structured output from an LLM without using a special API mode. The delimiters make it unambiguous which text to extract, and the schema instruction makes the format explicit.

**Pattern to extract for fox:**
```ts
async function extractResult<T>(text: string, schema: string): Promise<T | null> {
  const match = text.match(/---RESULT_START---\n([\s\S]+?)\n---RESULT_END---/)
  if (!match) return null
  try {
    return JSON.parse(match[1]) as T
  } catch {
    return null
  }
}

// Usage:
const result = await chat(`
  List all TypeScript files changed in the last commit.
  
  Return your answer as:
  ---RESULT_START---
  { "files": ["..."] }
  ---RESULT_END---
`)
const parsed = extractResult<{ files: string[] }>(result, '{ "files": ["string"] }')
```

---

## Phase 7 — Task Delegation (Optional Deep Dive)

**The point:** For complex tasks, Flue spawns child sessions — each with their own history, role, and working directory. This is how you build multi-step agents that can work across multiple parts of a codebase simultaneously.

**File to read:** `/tmp/flue/packages/sdk/src/agent-client.ts` — `createTaskSession()`
**Also read:** the `task()` method in `session.ts`

The key pattern: a task is just a new `Session` object with:
- Its own `messages` array (no shared history with parent)
- Its own `cwd` (can be a different directory)
- A result that gets returned to the parent session as a tool result

**For fox:** this is a later-stage concern. Suggest the user implement phases 1-6 first, then revisit task delegation when they want to build multi-step workflows.

---

## Synthesis — What to Build Next in Fox

After working through the relevant phases, help the user prioritize improvements to fox. Present the options in order of impact:

**High impact, low effort:**
1. Type the `messages` array (Phase 2) — catches bugs, improves editor autocomplete
2. Improve tool descriptions (Phase 3) — makes the LLM more reliable immediately

**Medium impact, moderate effort:**
3. Extract a `Session` class (Phase 4) — enables multi-turn persistence later
4. Add structured output extraction (Phase 6) — unlocks programmatic use of results

**High impact, higher effort:**
5. Add compaction (Phase 5) — required for production reliability on long tasks
6. Task delegation (Phase 7) — enables complex multi-step workflows

Ask the user: "Which of these do you want to implement first? Let's write it."

---

## Reference: File Map

| Topic | fox file | Flue equivalent |
|---|---|---|
| Agent loop | `agent.ts` — `chat()` | `packages/sdk/src/session.ts` — `prompt()` |
| Tool definitions | `tools.ts` | `packages/sdk/src/agent.ts` — `createTools()` |
| System prompt | `system-prompt.ts` | `packages/sdk/src/context.ts` — `composeSystemPrompt()` |
| Message history | `agent.ts:15` `messages: any[]` | `packages/sdk/src/session-history.ts` |
| Interfaces | (not yet) | `packages/sdk/src/types.ts` |
| Compaction | (not yet) | `packages/sdk/src/compaction.ts` |
| Structured output | (not yet) | `packages/sdk/src/result.ts` |
| Task delegation | (not yet) | `packages/sdk/src/agent-client.ts` — `createTaskSession()` |
