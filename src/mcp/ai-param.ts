/**
 * The `ai` input shared by every tool that can delegate its writing.
 *
 * Second leg of the handshake: the tool returns a brief naming the fields it
 * needs, the caller writes them, and passes them back here. Read by gate.ts
 * into the call context, not by the handlers - see ../lib/ai-context.ts.
 *
 * Deliberately loose (`additionalProperties: true`, nothing required): which
 * fields a run needs depends on the footage, and the brief says which ones on
 * the call that asks for them. A strict schema would reject a caller answering
 * exactly what it was asked for.
 */
export const AI_PROPERTY = {
  type: 'object' as const,
  description:
    "Writing you produced from this tool's brief, keyed by the fields it asked for (e.g. " +
    '{"narration": "...", "frame_descriptions": ["..."]}). Each value is used verbatim and ' +
    'no Groq call is made for it. Omit on the first call: the tool will tell you what it ' +
    'needs. This server never generates text itself - you are the model it delegates to.',
  additionalProperties: true,
  properties: {
    narration: { type: 'string', description: 'Finished voiceover script.' },
    demo_script: {
      type: 'object',
      description: 'Demo voiceover: {narration, short_narration}.',
    },
    frame_descriptions: {
      type: 'array',
      items: { type: 'string' },
      description: 'One short description per attached frame, in order.',
    },
    frame_assignment: {
      type: 'array',
      items: { type: 'number' },
      description: 'One frame index per narration line, never decreasing.',
    },
    highlights: {
      type: 'array',
      description: 'Clips to keep: [{start, end, reason}].',
    },
    batch_highlights: {
      type: 'object',
      description: 'Several distinct shorts: {shorts: [{score, angle, clips}]}.',
    },
    post_copy: {
      type: 'object',
      description: 'Post metadata: {title, description, hashtags}.',
    },
    titles: { type: 'object', description: 'A/B title variants: {a, b}.' },
    hashtags: { type: 'array', items: { type: 'string' }, description: 'Chosen hashtags.' },
    hashtag_sets: {
      type: 'object',
      description: 'Fallback tags: {popular: [...], trending: [...]}.',
    },
  },
};
