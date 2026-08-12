/**
 * Shared GUI plumbing for single-tool windows.
 *
 * Every tool's GUI does the same four things: probe the input, seed the form
 * with saved config, run the tool when the form is submitted, and turn the
 * result into the `{ success, output, logs }` shape the pages expect. This
 * module owns that shape so each tool only declares what differs.
 */
import { getToolConfig, type ToolsConfig } from '../lib/config.js';
import { getVideoInfoForGui, startGuiServer, type VideoInfo } from '../lib/gui-server.js';

/** Form values posted back by a GUI page. */
export type GuiOptions = Record<string, unknown>;

/** A log line that is either fixed or derived from the submitted form. */
type Message = string | ((opts: GuiOptions, input: string) => string);

export interface GuiToolSpec {
  /** Page to serve from dist/gui/. */
  htmlFile: string;
  /** Window title, or a function of the input when it varies by file type. */
  title: string | ((input: string) => string);
  /** Config section whose saved values seed the form. */
  settings?: keyof ToolsConfig;
  /** Defaults merged over the saved config — values derived from the input. */
  extraDefaults?: (input: string, videoInfo: VideoInfo) => GuiOptions;
  /** Describe the input. Defaults to probing it as a video. */
  probe?: (input: string) => Promise<VideoInfo>;
  /** Logged when work starts. */
  start: Message;
  /** Logged when work succeeds. */
  done: Message;
  /** Do the work; resolves to the output path. */
  run: (input: string, opts: GuiOptions) => Promise<string>;
}

function render(message: Message, opts: GuiOptions, input: string): string {
  return typeof message === 'function' ? message(opts, input) : message;
}

/**
 * Build the `runGUI` implementation for a tool from its spec.
 */
export function guiRunner(spec: GuiToolSpec): (input: string) => Promise<void> {
  return async (input) => {
    const videoInfo = await (spec.probe ?? getVideoInfoForGui)(input);
    const saved = spec.settings ? await getToolConfig(spec.settings) : {};

    await startGuiServer({
      htmlFile: spec.htmlFile,
      title: typeof spec.title === 'function' ? spec.title(input) : spec.title,
      videoInfo,
      defaults: { ...saved, ...spec.extraDefaults?.(input, videoInfo) },
      onProcess: async (opts) => {
        const logs: Array<{ type: string; message: string }> = [];
        try {
          logs.push({ type: 'info', message: render(spec.start, opts, input) });
          const output = await spec.run(input, opts);
          logs.push({ type: 'success', message: render(spec.done, opts, input) });
          return { success: true, output, logs };
        } catch (err) {
          const message = (err as Error).message;
          logs.push({ type: 'error', message });
          return { success: false, error: message, logs };
        }
      },
    });
  };
}
