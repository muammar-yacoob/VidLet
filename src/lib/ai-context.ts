/**
 * Marks the async region of an MCP tool call, so the Groq client can refuse
 * to run inside one.
 *
 * Policy: no MCP tool calls Groq. The caller is already a model, and a
 * stronger one than the tiers in groq.ts, so generation belongs to it. A tool
 * that needs writing done hands over a brief and takes the result back as a
 * parameter on the next call.
 *
 * This is a runtime guard rather than a convention because the AI calls sit
 * three or four modules below the handlers (`generate_short` reaches Groq via
 * autoshort -> stages -> voice -> narration-align), and every one of those
 * paths is shared with the CLI, where there is no client to delegate to and
 * Groq stays correct. The context, not the module, decides.
 *
 * AsyncLocalStorage rather than a module flag: stdio serves tool calls
 * concurrently, and a flag would leak across them.
 *
 * The refusal is BOTH thrown and recorded here. Recording matters because
 * most AI call sites in this codebase treat a model failure as optional and
 * swallow it (`rephraseScript` returns null, the hashtag helpers return [],
 * narration-align falls back to a mechanical assignment). Those catches are
 * right for Groq being down and wrong for this, and rewriting all ten of them
 * would still leave the eleventh to be got wrong later. So the boundary reads
 * the recorded brief regardless of what the handler managed to return.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { DelegatedGenerationError } from './groq.js';

interface McpCall {
  tool: string;
  /** Set when a Groq call was refused during this tool call. */
  pending: DelegatedGenerationError | null;
}

const mcpCall = new AsyncLocalStorage<McpCall>();

/** Run a tool handler inside the MCP context. Applied once, in mcp/gate.ts. */
export function runInMcpTool<T>(tool: string, fn: () => Promise<T>): Promise<T> {
  return mcpCall.run({ tool, pending: null }, fn);
}

/** The tool currently executing, or null when running from the CLI or GUI. */
export function currentMcpTool(): string | null {
  return mcpCall.getStore()?.tool ?? null;
}

/** Record a refused generation so the boundary can surface it. */
export function recordDelegation(e: DelegatedGenerationError): void {
  const store = mcpCall.getStore();
  // First one wins: it is the earliest point the pipeline needed writing, so
  // it is the step the caller has to satisfy before anything downstream runs.
  if (store && !store.pending) store.pending = e;
}

/** The refused generation for this tool call, if there was one. */
export function pendingDelegation(): DelegatedGenerationError | null {
  return mcpCall.getStore()?.pending ?? null;
}
