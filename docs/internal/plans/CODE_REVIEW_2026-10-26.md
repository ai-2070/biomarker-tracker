# Code review — 2026-10-26

## Scope

Reviewed repository HEAD `1f3004521ef92d5f473f7a66f34b7c8f6e5ec6fd` (code links below point at that revision), focusing on security boundaries, project isolation, and agent/chat lifecycle correctness. No production source files were changed during the review.

Seven prioritized findings follow. P1 findings affect authorization or can direct work into the wrong project; P2 findings affect persistence or lifecycle correctness. Runtime-reproduced findings are distinguished from source-established findings.

## 1. [P1] Active runs write into whichever project becomes active

**Locations:**
- [server/engines/index.ts:188–192](https://github.com/ai-2070/ai-dashboard/blob/1f3004521ef92d5f473f7a66f34b7c8f6e5ec6fd/server/engines/index.ts#L188-L192)
- [server/tools.ts:86–101](https://github.com/ai-2070/ai-dashboard/blob/1f3004521ef92d5f473f7a66f34b7c8f6e5ec6fd/server/tools.ts#L86-L101)

### Problem

Runs do not retain their originating project. Chat persistence and default workspace resolution consult global active-project state. Switching projects while an agent is running can therefore redirect subsequent tool operations and chat writes into the newly active project.

### Reproduction and evidence

**Runtime-reproduced** against the production run and tool paths with a controlled local OpenAI-compatible SSE provider:

1. Create project A and an API-model agent with Files tools and Auto autonomy.
2. Start an agent run in A and hold the provider response.
3. Create and activate project B.
4. Release a model response requesting `write_file` with a relative output path, then complete the model turn.

Observed:

```text
A file exists: false
B file exists: true
A chat item types: [ "user" ]
B chat item types: [ "user", "tool", "assistant" ]
B content: from-project-a-run
```

The tool result is stored within the tool item. The output file and completed chat landed in B, while A retained only its initial user message.

### Recommended change

Capture project identity and workspace for the entire run. Carry that context through chat persistence, agent updates, delegation, and tool execution instead of consulting the global active project after asynchronous boundaries.

## 2. [P1] Filesystem authorization follows symlinks outside allowed folders

**Location:** [server/tools.ts:97–101](https://github.com/ai-2070/ai-dashboard/blob/1f3004521ef92d5f473f7a66f34b7c8f6e5ec6fd/server/tools.ts#L97-L101)

### Problem

`resolveInside()` authorizes paths using lexical prefixes, but the subsequent filesystem operations follow symlinks. A link inside an allowed workspace can therefore point outside every allowed root without failing authorization.

### Reproduction and evidence

**Runtime-reproduced** using a files-only agent with `autonomy: 'auto'` and temporary workspace/outside directories:

1. Create an outside file containing `private-sentinel`.
2. Create a directory symlink inside the workspace pointing to the outside directory.
3. Call `read_file` using the outside file's direct path.
4. Call `read_file` and `write_file` using the workspace symlink path.

Observed:

```text
Direct outside read: denied as outside the folders the agent may use
Symlink outside read: private-sentinel
Symlink outside write: succeeded
Victim content: modified-without-approval
Pending approvals: 0
```

The reproduction exercised symlinks on macOS; Windows-specific link behavior was not exercised.

### Recommended change

Authorize canonical filesystem targets rather than unresolved paths. For writes to new files, validate existing parent directories as well. Apply the same containment policy consistently to file listing, reading, and writing.

## 3. [P1] Claude “Ask first” mode automatically permits native edits

**Location:** [server/engines/claude.ts:105–109](https://github.com/ai-2070/ai-dashboard/blob/1f3004521ef92d5f473f7a66f34b7c8f6e5ec6fd/server/engines/claude.ts#L105-L109)

### Problem

`autonomy: 'ask'` maps to `--permission-mode acceptEdits`. Claude documents that mode as automatically accepting file edits and common filesystem mutations. Native operations approved by this mode need not reach the dashboard's permission callback, contradicting the advertised Ask first policy.

### Evidence

**Source-established; no live-model execution.**

The production argument builder selects:

```typescript
args.push('--permission-mode', mode === 'auto' ? 'auto' : 'acceptEdits');
```

The [official Claude permission-mode documentation](https://code.claude.com/docs/en/permissions#permission-modes) describes `acceptEdits` as automatically accepting file edits and common filesystem commands such as `mkdir`, `touch`, `mv`, and `cp` for paths in the working directory or additional directories.

### Recommended change

Use prompting permissions for ask-mode agents, with explicit permission rules where necessary to enforce the dashboard's approval contract. Do not rely on the permission callback to intercept operations that the selected Claude mode automatically permits.

## 4. [P1] Queued Brain commands can execute against a different project

**Location:** [web/dock.ts:278–295](https://github.com/ai-2070/ai-dashboard/blob/1f3004521ef92d5f473f7a66f34b7c8f6e5ec6fd/web/dock.ts#L278-L295)

**Related server path:** [server/overseer.ts:452–468](https://github.com/ai-2070/ai-dashboard/blob/1f3004521ef92d5f473f7a66f34b7c8f6e5ec6fd/server/overseer.ts#L452-L468)

### Problem

Brain messages wait behind the global `brainTurn` promise, carrying only their text. Their HTTP requests are not dispatched immediately and do not identify the project in which the user submitted them.

If two messages are submitted in A and the user activates B before the second dispatches, the second request reaches `overseer.ask()` as a request for B. The server's project-switch guard cannot detect the original intent because it captures the project only upon request arrival.

### Trigger and evidence

**Source-established; not runtime-reproduced.**

1. Submit a Brain command in project A and keep its response pending.
2. Submit a second command in A; it waits behind `brainTurn`.
3. Activate project B before the first command completes.
4. Complete the first request, allowing the second request to dispatch.

The queued command is interpreted using B's snapshot and history and can apply generated actions to B. This is separate from finding 1: the wrong project is selected before the deferred server request begins.

### Recommended change

Bind queued commands to their submission project. Reject or invalidate queued work when that context changes, and carry explicit project identity to the server if queued work may remain valid across navigation.

## 5. [P2] Project snapshots omit agent conversations

**Locations:**
- [server/projectsync.ts:148–160](https://github.com/ai-2070/ai-dashboard/blob/1f3004521ef92d5f473f7a66f34b7c8f6e5ec6fd/server/projectsync.ts#L148-L160)
- [server/projectsync.ts:204–220](https://github.com/ai-2070/ai-dashboard/blob/1f3004521ef92d5f473f7a66f34b7c8f6e5ec6fd/server/projectsync.ts#L204-L220)

### Problem

Snapshots preserve agents, teams, Brain history, and shared team threads, but never copy the project's `chats/` directory. Direct-agent conversations and engine-session memory are absent despite the README's claim that project chats are saved into the project folder for portability.

### Reproduction and evidence

**Runtime-reproduced:**

1. Create a project and an agent.
2. Create and save an agent conversation containing a distinctive user message.
3. Call `saveProject()`.
4. Open the saved folder as another project and call `restoreInto()`.
5. Inspect the restored agent and its conversations.

Observed:

```text
Source chats: 1
Snapshot directories: [ "project.json", "README.txt" ]
Restored agent exists: true
Restored chats: []
```

The snapshot save reported one agent and no error; restoration returned the agent but not its conversation.

### Recommended change

Include agent chats in snapshot save/restore and trigger autosaving when those chats change. Preserve their engine-session state along with the visible conversation history.

## 6. [P2] A late Brain response restores cleared history

**Location:** [server/overseer.ts:452–471](https://github.com/ai-2070/ai-dashboard/blob/1f3004521ef92d5f473f7a66f34b7c8f6e5ec6fd/server/overseer.ts#L452-L471)

### Problem

`ask()` captures history before awaiting the model, then writes that captured history back unconditionally. Clearing the conversation while a request is pending does not invalidate the pending completion's write.

### Reproduction and evidence

**Runtime-reproduced** against the production Brain history lifecycle, with the external model response controlled at the fetch boundary:

1. Establish a prior Brain exchange.
2. Start another Brain request and hold its model response.
3. Call `clearHistory()` and verify history is empty.
4. Release the pending response and inspect history again.

Observed:

```text
History before pending ask:
  old-question-sentinel
  old-answer-sentinel

History after clear: []

History after late answer:
  old-question-sentinel
  old-answer-sentinel
  pending-question-sentinel
  late-answer-sentinel
```

The pending answer restored both the previous conversation and the pending exchange after the clear succeeded.

### Recommended change

Use a conversation generation or cancellation mechanism so clearing history prevents stale completions from persisting. Apply the same invalidation to pending frontend continuations.

## 7. [P2] Stopping the final workflow agent step records success

**Location:** [server/workflows.ts:126–166](https://github.com/ai-2070/ai-dashboard/blob/1f3004521ef92d5f473f7a66f34b7c8f6e5ec6fd/server/workflows.ts#L126-L166)

**Related agent cancellation path:** [server/engines/index.ts:245–253](https://github.com/ai-2070/ai-dashboard/blob/1f3004521ef92d5f473f7a66f34b7c8f6e5ec6fd/server/engines/index.ts#L245-L253)

### Problem

A stopped agent resolves normally with an empty answer. The workflow marks its step done and, when that is the final step, marks the whole run done without checking cancellation again.

### Reproduction and evidence

**Runtime-reproduced** using a single-agent workflow and a controlled local model provider:

1. Start a workflow containing one agent step.
2. Wait until the model request is in flight.
3. Call `stopWorkflowRun()`.
4. Wait for the workflow to settle and inspect its persisted record.

Observed:

```text
Stop accepted: true
Workflow final status: done
Final step status: done
Final step output: "(no answer)"
```

The cancellation request was accepted, but the persisted result represented successful completion.

### Recommended change

Check cancellation after awaited work and before recording successful step or workflow completion. Preserve stopped status even when an underlying agent cancellation resolves normally.

## Verification and limits

- `bun install --frozen-lockfile` completed successfully to provision review dependencies.
- `bun run check` exited successfully: server/web typechecking and **118 tests across 19 files** passed.
- Five isolated runtime probes reproduced findings **1, 2, 5, 6, and 7**, using temporary data and controlled model responses.
- Findings **3 and 4** are source-established, not runtime-reproduced.
- No paid model calls were made.
- Temporary probe data and probe-created project folders were removed.
- No production source files were edited or fixes applied during the review.

## Resolution

All seven findings are fixed on branch `LZL0/code-review`, each with regression tests that fail on the code reviewed above.

| # | Fix | Commit | Tests |
|---|-----|--------|-------|
| 1 | `store.withProject()` pins a run (and workflow runs) to the project it started in; MCP bridge routes run in the run's project | `b6f8986` | `tests/server/run-project.test.ts`, `tests/server/api.test.ts` (bridge) |
| 2 | File tools and `/api/file` check the real path (links followed; dangling links refused) | `e97fb86` | `tests/server/file-tools.test.ts` |
| 3 | "Ask first" maps to Claude's `default` permission mode, not `acceptEdits` | `60ebaef` | `tests/server/claude-args.test.ts` |
| 4 | The dock binds Brain messages to their project; the server refuses a message for a project that isn't open (409) | `75536af` | `tests/web/brainqueue.test.ts`, `tests/server/brain-chat.test.ts` |
| 5 | Agent chats (with `sessionId` / `llm`) are saved to `.dashboard/chats` and restored; chat changes trigger the auto-save | `c60ecb7` | `tests/server/projectsync.test.ts` |
| 6 | Clearing the Brain chat bumps a generation; late answers neither restore history nor apply actions; the dock drops them | `75536af` | `tests/server/brain-chat.test.ts`, `tests/web/brainqueue.test.ts` |
| 7 | Workflows recheck for a stop after each step and before finishing; `askAgent()` throws when stopped | `a018476` | `tests/server/workflow-stop.test.ts` |

Not covered: Hermes reaches the dashboard tools through a globally registered bridge with no run id, so its tool calls still use the open project (unchanged; not part of finding 1's reproduction). Windows link behavior is still not exercised by the tests.

### Follow-ups from the PR #10 review

- Path checks ignore case only on Windows (a case-only sibling folder was reachable on Linux).
- Project restore reads only from the real `<folder>/.dashboard` (linked `chats/`, `teamchats/`, `knowledge/` or `.dashboard` are refused).
- A run stopped directly (its own Stop button) makes `askAgent()` reject with `RunStopped`; workflows record it as stopped, teams hand nothing on.
- The Brain skips a turn's actions after any project switch during it, including a switch away and back.
- The dock never sends a Brain message before the open project is known, and only the newest history load fills the chat.
