/**
 * Tool DEFINITIONS for the autoshort family: names, descriptions and JSON
 * schemas, with no behaviour.
 *
 * Split from the handlers because these are the contract the model reads
 * to decide what to call. They are long by necessity (a vague description
 * produces a wrong call) and they change for prompt-engineering reasons,
 * on a completely different rhythm from the code that runs underneath.
 */

import { AI_PROPERTY } from './ai-param.js';
import type { ToolDefinition } from './shared.js';

export const AUTOSHORT_TOOLS: ToolDefinition[] = [
  {
    name: 'preview_music',
    description:
      'Render short audible samples of the bundled CC0 beds, at the level a Short actually ' +
      'mixes them, so a bed can be picked by ear instead of by label. Returns a file:// url ' +
      "per mood - offer them to the user, then pass their choice as generate_short's " +
      '`music`. Writes small mp3s; touches no video.',
    inputSchema: {
      type: 'object',
      properties: {
        output_dir: {
          type: 'string',
          description: 'Where to write the samples. Defaults beside the first input video.',
        },
        seconds: { type: 'number', description: 'Sample length, default 10.' },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional input videos, used only to pick a sensible output_dir.',
        },
      },
    },
  },
  {
    name: 'add_music',
    description:
      'Lay a music bed onto a video that is ALREADY rendered, ducked under any speech it ' +
      'has. The video stream is copied rather than re-encoded, so this takes seconds - use ' +
      'it whenever only the music needs to change, instead of re-running generate_short and ' +
      'redoing the cut, grade, narration and captions. Never overwrites the input; writes ' +
      '"<name>_scored.mp4" beside it unless output_path says otherwise.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The finished video to score.' },
        music: {
          type: 'string',
          description:
            'A bundled CC0 mood ("upbeat", "calm", "tense", "playful") or a path to your own ' +
            'audio file. Use preview_music to choose by ear.',
        },
        volume: { type: 'number', description: 'Bed level 0-1. Default 0.08.' },
        duck: {
          type: 'boolean',
          description: 'Duck the bed under existing speech. Default true.',
        },
        output_path: { type: 'string', description: 'Optional explicit output path.' },
      },
      required: ['path', 'music'],
    },
  },
  {
    name: 'mask_sensitive',
    description:
      'Scan a video for sensitive information on screen (card numbers validated by Luhn, ' +
      'emails, phone numbers, IBANs, SSNs, API keys, street addresses, postcodes) and cover ' +
      'each with a pixel mosaic. Detection needs tesseract installed; without it the tool ' +
      'reports that clearly instead of silently masking nothing. `regions` always works ' +
      'regardless, for areas you pick yourself. Use dry_run to see what WOULD be covered ' +
      'before writing a video. Never overwrites the input.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Video to scan.' },
        sample_fps: {
          type: 'number',
          description: 'Frames per second sampled for OCR. Default 0.5, one every two seconds.',
        },
        regions: {
          type: 'array',
          description: 'Explicit boxes to cover, in SOURCE pixels. Supplying this skips detection.',
          items: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
            },
            required: ['x', 'y', 'width', 'height'],
          },
        },
        blockiness: {
          type: 'number',
          description: 'Mosaic coarseness, 0-1. Default 0.12.',
        },
        dry_run: {
          type: 'boolean',
          description: 'Report the regions found and write nothing.',
        },
        output_path: { type: 'string', description: 'Optional explicit output path.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'preview_short',
    description:
      'Render a FAST, low-quality draft of the Short so the edit can be approved before ' +
      'paying for the real thing. Identical pipeline - same cuts, speed, narration, caption ' +
      'timing and intro - but a 360x640 canvas, the fastest encoder, no music and no ' +
      'sensitive-data scan. It also warms the analysis cache, so approving it and calling ' +
      'generate_short with the same inputs skips re-analysing the footage entirely. Use this ' +
      'whenever the user is iterating on narration or timing; show them the returned url and ' +
      'ask whether to render it properly.',
    inputSchema: {
      type: 'object',
      properties: {
        ai: AI_PROPERTY,
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Same inputs you would give generate_short.',
        },
        narration: { type: 'string', description: 'Draft narration text.' },
        final_script: { type: 'string', description: 'Approved narration, used verbatim.' },
        intro: { type: 'string', description: 'Intro clip or GIF, played at natural speed.' },
        max_duration: { type: 'number', description: 'Length ceiling in seconds, max 59.' },
        voiceover: { type: 'string', enum: ['auto', 'tts', 'keep'] },
        language: { type: 'string' },
        gender: { type: 'string', enum: ['female', 'male'] },
        output_path: { type: 'string', description: 'Optional explicit output path.' },
      },
      required: ['paths'],
    },
  },
  {
    name: 'generate_short',
    description:
      'One call from raw files to a finished YouTube Short. Give it the attached files ' +
      '(videos in story order; optionally .srt/.vtt captions, a .txt/.md narration script, ' +
      'and/or a music audio file) and it: denoises voiced clips, cuts long pauses, drops ' +
      'duplicate retakes, stitches, speeds the result to fit under 59s, matches contrast ' +
      'across clips, frames 9:16, writes and speaks the narration, burns karaoke captions ' +
      'timed to that voice, and mixes a ducked music bed. The output is named after its ' +
      'content, not the source timestamp, and the result carries a `url` (file://) - always ' +
      "surface that url to the user. When a decision is the user's (music, a description " +
      'for silent footage, the TTS voice, approving the narration script) it returns a ' +
      '`questions` array INSTEAD of rendering: relay each question verbatim with its ' +
      'options, then call again with the answers as arguments. A finished render can also ' +
      'carry a `masking` question asking whether to cover what the sensitive-data scan ' +
      'found - relay that one too; the video is already usable and nothing was blurred. A ' +
      'finished render additionally carries a `youtube` block (three graded title variants, ' +
      'three thumbnail frames, hashtags with real view counts) - show it in full and offer ' +
      'to publish via upload_to_youtube, which A/B tests the two titles and thumbs the user ' +
      'picks. Never overwrites inputs.',
    inputSchema: {
      type: 'object',
      properties: {
        ai: AI_PROPERTY,
        paths: {
          type: 'array',
          items: { type: 'string' },
          description:
            'The attached files: videos in story order, plus optional .srt/.vtt, .txt/.md ' +
            'narration and a music audio file.',
        },
        narration: {
          type: 'string',
          description:
            'What the recording shows, or the transcript. A sentence or two is enough - it ' +
            'gets rewritten into a script you will be asked to approve.',
        },
        final_script: {
          type: 'string',
          description:
            'The approved narration, spoken verbatim with no further rewriting. Pass this ' +
            'after the user approves (or edits) the draft returned by the script question. ' +
            'Separate sections with a line containing only --- to pin lines to a specific ' +
            'clip: with two videos, the lines before --- are spoken over the first and the ' +
            'lines after it over the second. This is exact, and beats inferring alignment.',
        },
        music: {
          type: 'string',
          description:
            'A bundled CC0 mood ("upbeat", "calm", "tense", "playful"), a path to your own ' +
            'audio file, or "none". Omit to be asked, with previews.',
        },
        music_volume: {
          type: 'number',
          description: 'Bed level 0-1. Default 0.08, and it ducks under the voice.',
        },
        max_duration: { type: 'number', description: 'Length ceiling in seconds, max 59.' },
        captions: { type: 'boolean', description: 'Burn karaoke captions. Default true.' },
        contrast: {
          type: 'number',
          description:
            'Contrast boost on top of per-clip matching. Every clip is measured and graded ' +
            'onto a shared look first. Default 1.25.',
        },
        voiceover: {
          type: 'string',
          enum: ['auto', 'tts', 'keep'],
          description:
            '"auto" (default) keeps real speech and only narrates silent footage; "tts" ' +
            'always narrates; "keep" never generates a voice.',
        },
        lead_in: {
          type: 'number',
          description: 'Silence before the first word, in seconds. Default 1.',
        },
        intro: {
          type: 'string',
          description:
            'A clip or animated GIF to open with, played at NATURAL speed rather than being ' +
            'swept into the timelapse. Its length is taken out of the duration budget.',
        },
        align_to_content: {
          type: 'boolean',
          description:
            'Place each narration line by LOOKING at the footage (Groq vision) so the words ' +
            'describe what is on screen, instead of spacing them arithmetically. Default ' +
            'true; falls back silently without a Groq key.',
        },
        cta_url: {
          type: 'string',
          description:
            'Domain to pin at the top of the Short as a styled pill with its favicon, e.g. ' +
            '"ducktax.com". This is where a URL belongs: spoken aloud it never sounds right, ' +
            'so write the script to say the brand and let this show the address.',
        },
        cta_tagline: {
          type: 'string',
          description: 'Short line under the domain in the CTA pill.',
        },
        fill: {
          type: 'string',
          enum: ['pad', 'crop'],
          description:
            'How near-square footage meets the 9:16 canvas. "pad" (default) fits the whole ' +
            'frame with a blurred backdrop, keeping screen-recording text readable. "crop" ' +
            'fills the canvas edge to edge but cuts the sides off - on a 320x360 source that ' +
            'is 37% of the width, so side panels are lost.',
        },
        render: {
          type: 'boolean',
          description:
            'Encode the video. Default true. Set false to get ONLY the .vidlet project, for ' +
            'when the edit is going to be tweaked in the editor before it is worth encoding.',
        },
        mask_sensitive: {
          type: 'boolean',
          description:
            'Scan the finished Short for on-screen card numbers, emails, phones, keys and ' +
            'addresses. Default true. Finding something REPORTS it as a `masking` question ' +
            'and covers nothing - on a screen recording the hits are often window titles, ' +
            'so blurring on a guess would damage the edit. Needs tesseract installed; when ' +
            'missing, the result says so in `masking` rather than silently skipping.',
        },
        mask_apply: {
          type: 'boolean',
          description:
            'Pixelate what the scan finds instead of asking. Default false. Use only when ' +
            'the user has already said yes, or the pipeline is unattended.',
        },
        title: {
          type: 'string',
          description:
            'Short human title for the output filename (slugified to dashes). Defaults to ' +
            'one derived from the narration.',
        },
        language: { type: 'string', description: 'TTS language code, default en.' },
        gender: {
          type: 'string',
          enum: ['female', 'male'],
          description: 'TTS voice gender. Omit to be asked (the voice question).',
        },
        output_path: { type: 'string', description: 'Optional explicit output path.' },
      },
      required: ['paths'],
    },
  },
];
