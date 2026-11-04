// What Brain reports while it works, the same for every engine (API models, agent programs, eve). Tool
// events carry the display form of the call (toolStep), never more than the final reply would show.
import { studyIdsFromTool, toolStep, validateToolResult } from "../steps";

export type BrainEvent =
  /** More of the answer's text. */
  | { kind: "text"; text: string }
  /** A tool started. `tool`/`server`/`input` are the step's display form. */
  | { kind: "tool"; id: string; name: string; tool: string; server?: string; input: string }
  /** A tool finished; `studyIds` are only IDs its structured result returned. */
  | { kind: "tool_result"; id: string; ok: boolean; studyIds: string[] }
  /** What it is doing, for the status line. */
  | { kind: "status"; text: string };

export type OnEvent = (event: BrainEvent) => void;

export const noEvents: OnEvent = () => {};

export function toolStarted(id: string, name: string, input: unknown): BrainEvent {
  const step = toolStep(name, input);
  return { kind: "tool", id, name, tool: step.tool, ...(step.server !== undefined ? { server: step.server } : {}), input: step.input.slice(0, 200) };
}

export function toolFinished(id: string, name: string, input: unknown, output: unknown, failed = false): BrainEvent {
  const step = toolStep(name, input);
  if (failed) return { kind: "tool_result", id, ok: false, studyIds: [] };
  validateToolResult(step, output);
  return { kind: "tool_result", id, ok: step.success !== false, studyIds: studyIdsFromTool(name, output) };
}
