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
  /** Every generation refused during this tool call, in the order reached. */
  pending: DelegatedGenerationError[];
  /** Answers the caller supplied in `ai`, keyed by step. */
  answers: Record<string, unknown>;
}

const mcpCall = new AsyncLocalStorage<McpCall>();

/**
 * Run a tool handler inside the MCP context. Applied once, in mcp/gate.ts.
 *
 * `answers` is the tool's `ai` argument - the second leg of the handshake.
 * Reading it here rather than in each handler is what keeps the eleven Groq
 * call sites unchanged: they still ask for generation, and groqChatJSON hands
 * back what the caller already wrote.
 */
export function runInMcpTool<T>(
  tool: string,
  fn: () => Promise<T>,
  answers: Record<string, unknown> = {}
): Promise<T> {
  return mcpCall.run({ tool, pending: [], answers }, fn);
}

/** The caller's answer for a step, or undefined if they did not supply one. */
export function suppliedAnswer(step: string): unknown {
  const value = mcpCall.getStore()?.answers?.[step];
  // null is a real "nothing to say here" from a model; only absence delegates.
  return value === undefined ? undefined : value;
}

/** The tool currently executing, or null when running from the CLI or GUI. */
export function currentMcpTool(): string | null {
  return mcpCall.getStore()?.tool ?? null;
}

/**
 * Record a refused generation so the boundary can surface it.
 *
 * All of them, not just the first. A pipeline usually needs several - narration,
 * then frame descriptions, then the assignment between them - and stopping at
 * the first would cost a round trip per step. The AI call sites already swallow
 * failures and carry on with a fallback, so one pass reaches every step and
 * collects the lot; abortBeforeExpensiveWork then stops the run before anything
 * is encoded around the answers we do not have yet.
 */
export function recordDelegation(e: DelegatedGenerationError): void {
  const store = mcpCall.getStore();
  // One per step: a retried stage would otherwise brief the same thing twice.
  if (store && !store.pending.some((p) => p.step === e.step)) store.pending.push(e);
}

/** Every generation refused during this tool call. */
export function pendingDelegations(): DelegatedGenerationError[] {
  return mcpCall.getStore()?.pending ?? [];
}

/**
 * Stop before work that only makes sense once the writing exists.
 *
 * Called at the top of the encode. Without it a delegated run renders a whole
 * Short around an unwritten script and the boundary throws it away - minutes
 * of ffmpeg for output nobody sees.
 */
export function abortBeforeExpensiveWork(): void {
  const store = mcpCall.getStore();
  if (store?.pending.length) throw store.pending[0];
}
