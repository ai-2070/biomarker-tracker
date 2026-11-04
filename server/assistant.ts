// The assistant (Brain): one model with the health tools, skills and MCP tools. The parts live in brain/:
// ask.ts (modes and engines), prompt.ts (system prompt), cache.ts (prompt caching), tools.ts (which tools),
// apiModel.ts (API and local models), agentRun.ts (agent programs), claimReview.ts (claim checks).
import { setIdleTools } from "./bridge";
import { healthTools } from "./healthTools";
import { EMPTY_SNAPSHOT } from "./brain/tools";

export { ask, ASSISTANT_TIMEOUT_MS, type AskOptions, type AssistantReply, type ChatMessage } from "./brain/ask";
export { dataPack } from "./brain/dataPack";
export { promptParts, systemPrompt, type PromptParts } from "./brain/prompt";
export type { ToolStep } from "./steps";
export { studyIdsIn } from "./steps";

// What an agent sees when it checks the app's tools between questions.
setIdleTools(() => healthTools({ ...EMPTY_SNAPSHOT, profile: {} }));
