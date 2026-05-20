---
name: learn-pi-agent-patterns
description: Guide the user through the pi-mono source code (~/Desktop/learn/pi) to understand how a production-grade agent runtime is built, grounded in the fox codebase they've already written. Use when the user wants to study pi's architecture, understand streaming, event-driven design, parallel tool execution, or mid-run message injection — by reading real production code.
---

# Learn Pi Agent Patterns

This skill teaches the user how a production agent runtime is built by comparing what they've already built (the fox agent at `/Users/ashwinanil/Desktop/projects/fox`) against what pi does at `~/Desktop/learn/pi`. Fox has a working agent — the goal is to deepen understanding of the patterns by studying pi's production implementations of concepts fox hasn't touched yet.

**Do not start from scratch.** The user already has a working loop. Always anchor the lesson in their existing code before showing pi's version.

---

## Rules — you guide, the human does

These are hard constraints for every interaction in this skill:

1. **Never write code into fox files.** Do not use any file editing or writing tools on the fox codebase. The human types all code themselves.

2. **When a phase involves implementing something in fox:** Describe the change in plain language — which file to open, what to add, what it should look like structurally. Do not produce the finished code block for them to paste in.

3. **When the human is stuck:** Show the abstract pattern or pseudocode from pi's source as a reference. Do not write their specific implementation. Wait for them to try before offering more.

4. **Ask before advancing.** After every phase, ask the human to summarise what they learned or show you what they wrote before moving to the next phase. Do not skip this.

5. **Pi code is reference, not answer.** You may quote lines from `~/Desktop/learn/pi` to illustrate a concept. You may not rewrite those lines into fox-specific code for the human.

6. **Keep fox on Gemini.** Pi uses a provider abstraction (`@mariozechner/pi-ai`) that wraps many LLMs. Do not suggest migrating fox off its raw Gemini fetch — the goal is to extract the patterns and apply them natively to fox's existing Gemini setup.

7. **The human confirms completion.** Only mark a phase done in `pi-learning-progress.yaml` after the human says they've understood and applied it — not after you've explained it.

---

## The current state of the fox codebase

Before starting any phase, orient the user by summarizing where they are:

- **`agent.ts`** — the core agent: one global `messages: any[]`, a `chat()` function that is the loop, and `executeTool()` for tool dispatch. One function call per response. No streaming — full JSON response per fetch. No cancellation, no observability, no session abstraction.
- **`tools.ts`** — 5 tools defined in Gemini's `functionDeclarations` format: `list_files`, `read_file`, `run_bash`, `edit_file`, `search_code`.
- **`system-prompt.ts`** — working system prompt with code-search guidance and working directory injection.
- **What's missing** (what pi teaches): real-time streaming output, event-driven observability, typed message interfaces, parallel tool execution, mid-run message injection, tool lifecycle hooks, cancellation.

---

## Progress tracking

At the start of every session, read `.claude/pi-learning-progress.yaml`. Use it to:
- Know which phases are already done — skip them or offer a quick recap
- Resume from the correct phase without asking the user to repeat context
- Know what was noted in previous sessions

At the end of every session (or after each completed phase), update the file:
- Set `status` to `in_progress` or `done`
- Set `session_date` to today's date (YYYY-MM-DD)
- Write a one-line `notes` value capturing the key insight from that phase
- Update `next` to the next phase title or a specific sub-topic if mid-phase

Only update fields that changed. Do not rewrite the whole file. Create the file on first use.

---

## How to teach

Work through phases in order. Each phase:
1. Shows the user what they already have in fox
2. Shows them the equivalent in pi
3. Asks them what pi does differently and why
4. Extracts the pattern they should consider adding to fox

Between phases, check in: "Does that click? Anything you want to try before we move on?"

The output of this session should be a concrete list of improvements the user can make to fox, grounded in what they learned.

---

## Phase 1 — The Loop: fox vs pi's Layered Architecture

**The point:** fox's `chat()` function is fundamentally the same control flow as pi's inner loop — but pi splits it into four distinct layers. Make this visible so the user sees that complexity isn't magic, it's decomposition.

**File to read:** `~/Desktop/learn/pi/packages/agent/src/agent-loop.ts` — focus on `runLoop()` (lines 155–246) and `runAgentLoop()` (lines 95–118).
**File to read:** `~/Desktop/learn/pi/packages/agent/src/agent.ts` — focus on `Agent.prompt()` (line 313) and `runWithLifecycle()` (line 438).

Walk them through this correspondence:

| fox (`agent.ts`) | pi layer | pi function |
|---|---|---|
| `messages.push(user message)` | User input enters context | `runAgentLoop` adds prompts to `currentContext.messages` |
| `while(true) { fetch(...) }` | Inner loop iterating LLM calls | `runLoop()` — the shared inner loop |
| `parts.find(p => p.functionCall)` | Detect tool use stop | `toolCalls = message.content.filter(c => c.type === "toolCall")` |
| `await executeTool(name, args)` | Tool execution | `executeToolCalls()` → dispatches to `AgentTool.execute()` |
| `messages.push(functionResponse)` | Append tool result | `currentContext.messages.push(result)` |
| `continue` | Loop again | `hasMoreToolCalls = !executedToolBatch.terminate` |
| `return text` | Exit loop | `emit({ type: "agent_end", ... })` |
| _(no lifecycle)_ | Observable wrapper | `Agent.prompt()` → `runWithLifecycle()` → emits events |

**Key difference to surface:** pi's `runLoop` is a pure function — it takes context and config, emits events, and returns messages. It knows nothing about state. The `Agent` class (layer 4) owns state and calls the loop. fox fuses all four layers into one function — which is valid but harder to test and extend.

Ask the user: "What would you need to split in `chat()` to make it testable without running the real Gemini API?"

---

## Phase 2 — Streaming: From Fetch to EventStream

**The point:** fox blocks on each full JSON response from Gemini. pi streams tokens as they arrive. This matters for user experience (text appears in real time) and for long tool runs (you can see what the LLM is doing).

**File to read:** `~/Desktop/learn/pi/packages/agent/src/agent-loop.ts` — focus on `streamAssistantResponse()` (lines 252–345). Read the `for await (const event of response)` loop.

**File to read:** `~/Desktop/learn/pi/packages/ai/src/utils/event-stream.ts` — this is the `EventStream` class that all streaming is built on.

Walk through pi's streaming event protocol:

| Event type | What it means |
|---|---|
| `start` | LLM started responding; `partial` has the empty shell |
| `text_delta` | A chunk of text arrived; `delta` is the new characters |
| `toolcall_start` | LLM started a tool call |
| `toolcall_delta` | JSON argument fragment arrived |
| `toolcall_end` | Full tool call is ready |
| `done` | Response complete; `message` is the final `AssistantMessage` |
| `error` | Request failed; `error` is an `AssistantMessage` with `stopReason: "error"` |

**Key insight to surface:** pi never buffers the full response. It updates a `partialMessage` in place with each delta, and the agent loop pushes that partial into `context.messages` immediately so subscribers can render it. The `EventStream` is just an async iterable that resolves to a final value via `.result()`.

**Gemini streaming for fox:** Gemini supports streaming via `streamGenerateContent` (REST) or by appending `?alt=sse` to the URL. The response is a sequence of SSE events, each containing a partial `GenerateContentResponse`. The last event has the full accumulated content.

**Exercise for the user:**
Look at fox's `chat()` at line 131 — the `await fetch(...)` call. Ask them:
1. What URL would you change to get a streaming response from Gemini?
2. What does the response body look like as a stream of SSE lines?
3. What would you need to accumulate across chunks to know when a tool call is complete?

Show them the structure of a Gemini SSE response if they're stuck: each `data:` line is a partial `GenerateContentResponse`. Tool calls may span multiple chunks — the `functionCall` only appears complete in the final chunk for that turn.

**Pattern to extract for fox:**
```ts
// Instead of: const data = await response.json()
// Use:
const reader = response.body.getReader()
const decoder = new TextDecoder()
let buffer = ""
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  buffer += decoder.decode(value, { stream: true })
  // parse SSE lines from buffer, accumulate partial response
}
```

---

## Phase 3 — Types: The Message Taxonomy

**The point:** fox uses `messages: any[]` throughout. pi defines a strict message union that makes every possible message shape explicit. This matters as the codebase grows — TypeScript catches malformed messages at compile time instead of at runtime.

**File to read:** `~/Desktop/learn/pi/packages/ai/src/types.ts` — focus on `UserMessage`, `AssistantMessage`, `ToolResultMessage`, and the `Message` union (around line 214–245).
**File to read:** `~/Desktop/learn/pi/packages/agent/src/types.ts` — focus on `AgentMessage` (line 280), `AgentTool` (line 332), and `AgentToolResult` (line 316).

Three things to highlight that fox doesn't have:

**1. The `Message` union:**
```ts
type Message = UserMessage | AssistantMessage | ToolResultMessage
```
fox's equivalent is implicit: three different object shapes pushed into the same `any[]`.

**2. `AgentToolResult<T>`:**
```ts
interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[]  // what the LLM sees
  details: T                               // arbitrary structured data for UI/logs
  terminate?: boolean                      // hint: stop the loop after this tool batch
}
```
fox returns raw strings from `executeTool`. pi separates what the LLM sees (`content`) from what the UI sees (`details`), and lets tools signal early termination.

**3. TypeBox parameter schemas:**
pi's `AgentTool` extends `Tool<TParameters extends TSchema>` — tool arguments are validated at runtime against a TypeBox schema before `execute()` is called. fox dispatches arguments as raw `any`.

**Exercise for the user:**
Look at fox's `executeTool()` function at line 17. Ask them:
- What is the actual TypeScript type of `args` in each branch?
- What happens if the LLM passes `null` instead of a string for `args.directory` in `list_files`?
- How would you define a TypeBox schema for `run_bash` that marks `command` as required?

**Pattern to extract for fox:**
Suggest creating a `types.ts` with at minimum:
- A `UserMessage`, `ModelMessage`, `FunctionMessage` union (matching Gemini's format)
- An `ToolResult` interface with `content: string` and an optional `terminate: boolean`
- A `FoxTool` interface with `name`, `description`, and `execute(args): Promise<ToolResult>`

---

## Phase 4 — The Event Bus: Observability Without Coupling

**The point:** fox has no way to observe what the agent is doing mid-run except `console.log` baked into the loop. pi's `AgentEvent` system lets any part of the application observe the agent lifecycle without touching the loop code.

**File to read:** `~/Desktop/learn/pi/packages/agent/src/types.ts` — read the `AgentEvent` union (lines 374–389).
**File to read:** `~/Desktop/learn/pi/packages/agent/src/agent.ts` — focus on `Agent.subscribe()` (line 219) and `processEvents()` (line 495).

Walk through the full event lifecycle for one turn:

```
agent_start
  turn_start
    message_start (user message)
    message_end (user message)
    message_start (assistant partial — streaming)
    message_update × N (token by token)
    message_end (assistant final)
    tool_execution_start (tool A)
    tool_execution_start (tool B)        ← parallel: both start before either finishes
    tool_execution_update (tool A, ...)  ← streaming tool output
    tool_execution_end (tool A)
    tool_execution_end (tool B)
    message_start (toolResult A)
    message_end (toolResult A)
    message_start (toolResult B)
    message_end (toolResult B)
  turn_end
  turn_start (next LLM call)
    ...
agent_end
```

**Key insight to surface:** `Agent.subscribe()` returns an unsubscribe function. Listeners are async-awaited in order. The loop doesn't know anything about what listeners do — they can render to a terminal, update a React state, write to a log file, or drive a test assertion. This is the boundary between the agent core and the UI.

**Note about `processEvents()`:** This method is both the state reducer and the event broadcaster. It updates `_state.streamingMessage`, `_state.pendingToolCalls`, etc. before firing listeners. This means any subscriber sees the updated state immediately.

**Exercise for the user:**
Look at fox's `chat()` function. Ask them:
1. Where would you insert an event emission to tell a UI that a tool call is starting?
2. If you wanted to add a terminal spinner while the LLM is thinking, where would you hook into fox right now vs where would you hook in if fox had a `subscribe()` pattern?
3. What is the minimum `AgentEvent` set fox would need to drive a real-time CLI renderer?

**Pattern to extract for fox:**
```ts
// Minimal event system for fox
type FoxEvent =
  | { type: "thinking_start" }
  | { type: "tool_call"; name: string; args: any }
  | { type: "tool_result"; name: string; result: string }
  | { type: "text_delta"; delta: string }
  | { type: "done"; text: string }

// Add to chat() signature:
async function chat(input: string, onEvent?: (event: FoxEvent) => void): Promise<string>
```

Ask them: "How would you call `onEvent` in each branch of fox's current tool dispatch code?"

---

## Phase 5 — Parallel Tool Execution

**The point:** fox processes one function call per response. But LLMs can return multiple tool calls in a single response — and running them sequentially when they're independent is wasted time. pi executes independent tool calls concurrently.

**File to read:** `~/Desktop/learn/pi/packages/agent/src/agent-loop.ts` — focus on `executeToolCalls()` (line 350) and `executeToolCallsParallel()` (lines 424–483).

Walk through the parallel execution pattern:

```ts
// Simplified from executeToolCallsParallel:

// 1. Prepare all tool calls first (sequential — validate args, run beforeToolCall)
for (const toolCall of toolCalls) {
  const preparation = await prepareToolCall(...)  // sequential
  if (preparation.kind === "immediate") {
    finalizedCalls.push(finalized)   // blocked/invalid — resolved immediately
  } else {
    finalizedCalls.push(async () => {
      const executed = await executePreparedToolCall(...)  // will run concurrently
      return finalized
    })
  }
}

// 2. Execute concurrently
const orderedResults = await Promise.all(
  finalizedCalls.map(entry => typeof entry === "function" ? entry() : Promise.resolve(entry))
)

// 3. Emit results in SOURCE ORDER (not completion order)
for (const finalized of orderedResults) {
  const toolResultMessage = createToolResultMessage(finalized)
  await emitToolResultMessage(toolResultMessage, emit)
  messages.push(toolResultMessage)
}
```

**Key insights to surface:**
1. **Prepare is sequential, execute is concurrent.** Validation and `beforeToolCall` hooks run in order because they may depend on context. Execution itself runs in parallel.
2. **Results are always emitted in source order**, not completion order. The LLM expects tool results to match the order it requested them.
3. **Per-tool `executionMode: "sequential"`** forces a specific tool to run alone — useful for tools that modify shared state (e.g., file writes).
4. **`terminate: true`** — if every tool in a batch returns `terminate: true`, the loop exits after this turn without another LLM call.

**Gemini note for fox:** Gemini can return multiple function calls in one response (they appear as multiple objects in the `parts` array). Fox currently only handles one. Ask the user to check: does fox's loop call `find` (returns first) or `filter` (returns all)?

**Exercise for the user:**
Look at fox's `chat()` at line 171 — the `functionCall` variable. Ask them:
1. Does this line handle multiple tool calls? What would happen if Gemini returned two?
2. What would you change to collect ALL function calls from a response?
3. Sketch the structure of code that runs all of them with `Promise.all` and then pushes all results before continuing the loop.

**Pattern to extract for fox:**
```ts
// Instead of: const functionCall = parts.find(...)
const functionCalls = parts.filter((part: any) => part.functionCall).map((p: any) => p.functionCall)

if (functionCalls.length > 0) {
  // Execute concurrently, collect results
  const results = await Promise.all(functionCalls.map(fc => executeTool(fc.name, fc.args)))
  // Push all results before continuing
  for (const [fc, result] of zip(functionCalls, results)) {
    messages.push({ role: "function", parts: [{ functionResponse: { name: fc.name, response: { name: fc.name, content: result } } }] })
  }
  continue
}
```

---

## Phase 6 — Steering & Follow-Up Queues

**The point:** fox requires the user to wait for the full agent response before sending the next message. In a real agent, you often want to inject a correction mid-task ("actually, skip that file") or chain a follow-up task automatically after the agent finishes. pi supports both.

**File to read:** `~/Desktop/learn/pi/packages/agent/src/agent.ts` — focus on `PendingMessageQueue` (lines 113–144), `Agent.steer()` (line 252), `Agent.followUp()` (line 257), and the outer while loop in `~/Desktop/learn/pi/packages/agent/src/agent-loop.ts` (lines 168–244).

Walk through the two queue types:

**Steering messages** (`agent.steer(message)`) — injected between turns:
```
User sends prompt → LLM responds → tool calls execute →
→ [steering queue polled here, before next LLM call] →
→ LLM sees steering message + tool results → responds again
```
Use case: user types "wait, don't modify the README" while the agent is executing tool calls. The steering message arrives between turns, not mid-tool.

**Follow-up messages** (`agent.followUp(message)`) — injected only after the agent would stop:
```
Agent finishes (no more tool calls, no steering) →
→ [follow-up queue polled here] →
→ If messages found: continue with another turn
→ If empty: truly done
```
Use case: automatically chain tasks ("after you finish linting, run the tests").

**`QueueMode: "all" | "one-at-a-time"`:**
- `"all"` — drain the entire queue at once (send all pending messages to LLM in one turn)
- `"one-at-a-time"` (default) — drain one message per poll (useful for sequential steering)

**Key insight to surface:** The outer `while(true)` in `runLoop` exists purely to handle follow-up messages. Without follow-up support, the loop would just exit after the inner loop finishes. This is a clean separation — the inner loop handles one "conversation", the outer loop handles chaining.

**Exercise for the user:**
Ask them to look at fox's `main()` function (line 118). Ask them:
1. Right now, how would a user send a correction mid-task? (They can't — they'd have to wait.)
2. What would you need to change in fox to let a second `readline` input interrupt the agent between tool calls?
3. How would you implement a simple follow-up: after the agent responds, automatically ask it to summarise the changes it made?

**Pattern to extract for fox:**
```ts
// Simplest possible steering hook
let steeringMessages: string[] = []

// In the agent loop, between tool execution and next LLM call:
const steering = steeringMessages.splice(0) // drain queue
if (steering.length > 0) {
  for (const msg of steering) {
    messages.push({ role: "user", parts: [{ text: msg }] })
  }
}
```

The user can push to `steeringMessages` from a parallel `readline` listener. Ask: "How would you wire up a second readline listener in fox's `main()` to let the user inject steering messages while the agent is running?"

---

## Bonus: Tool Hooks and Cancellation

These two patterns appear throughout pi but weren't covered in their own phase. Surface them when relevant.

**`beforeToolCall` / `afterToolCall`** (in `agent-loop.ts`, `prepareToolCall()` and `finalizeExecutedToolCall()`):
- `beforeToolCall` receives the validated args and can return `{ block: true, reason: "..." }` to prevent execution. Use for permission gates ("are you sure you want to delete this?") or safety checks.
- `afterToolCall` receives the tool result and can override `content`, `isError`, or set `terminate: true`. Use for logging, result transformation, or graceful shutdown signals.
- For fox: this is a middleware wrap around `executeTool()`. Ask the user: how would you implement a `before` hook that logs every tool call to a file?

**AbortController** (threaded through `agent-loop.ts` via `signal?: AbortSignal`):
- `agent.abort()` triggers the controller. The signal is passed to `fetch()` (via `streamFunction`), to `beforeToolCall`, to `afterToolCall`, and to `tool.execute()`.
- Tools are responsible for checking `signal.aborted` and stopping early.
- For fox: pass an `AbortSignal` to `fetch()` and add a keyboard interrupt handler (`process.on('SIGINT', ...)`) that calls `abortController.abort()`.

---

## Synthesis — What to Build Next in Fox

After working through the relevant phases, help the user prioritise improvements to fox. Present the options in order of impact:

**High impact, low effort:**
1. Handle multiple tool calls per response (Phase 5) — fox may already miss tool calls silently
2. Type the `messages` array (Phase 3) — catches bugs at compile time

**Medium impact, moderate effort:**
3. Add an `onEvent` callback to `chat()` (Phase 4) — unlocks real-time terminal rendering without coupling UI to the loop
4. Add streaming output (Phase 2) — makes fox feel responsive on long LLM turns
5. Implement parallel tool execution (Phase 5) — meaningful speedup on multi-tool tasks

**High impact, higher effort:**
6. Steering queue (Phase 6) — enables interactive mid-task correction
7. Tool hooks (`beforeToolCall` / `afterToolCall`) — enables permission gates and logging
8. AbortController throughout — enables clean Ctrl+C cancellation

Ask the user: "Which of these do you want to implement first? Let's walk through it."

---

## Reference: File Map

| Topic | fox file | pi equivalent |
|---|---|---|
| Agent loop | `agent.ts` — `chat()` | `packages/agent/src/agent-loop.ts` — `runLoop()` |
| Stateful wrapper | _(no equivalent)_ | `packages/agent/src/agent.ts` — `Agent` class |
| Tool definitions | `tools.ts` | `packages/agent/src/types.ts` — `AgentTool<TParameters>` |
| Message types | `agent.ts:15` `messages: any[]` | `packages/ai/src/types.ts` — `UserMessage`, `AssistantMessage`, `ToolResultMessage` |
| Streaming protocol | _(no equivalent)_ | `packages/ai/src/utils/event-stream.ts` — `EventStream` |
| Event bus | _(no equivalent)_ | `packages/agent/src/types.ts` — `AgentEvent` union + `Agent.subscribe()` |
| Parallel tool execution | _(no equivalent)_ | `packages/agent/src/agent-loop.ts` — `executeToolCallsParallel()` |
| Steering/follow-up | _(no equivalent)_ | `packages/agent/src/agent.ts` — `PendingMessageQueue`, `steer()`, `followUp()` |
| Tool hooks | _(no equivalent)_ | `packages/agent/src/agent-loop.ts` — `prepareToolCall()`, `finalizeExecutedToolCall()` |
| Cancellation | _(no equivalent)_ | `AbortController` threaded through `agent-loop.ts` via `signal` param |
| System prompt | `system-prompt.ts` | `AgentContext.systemPrompt` field (passed per-run) |
| Proxy streaming | _(not needed)_ | `packages/agent/src/proxy.ts` — `streamProxy()` |
