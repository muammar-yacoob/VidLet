/**
 * The subtitle track for a rendered project.
 *
 * A project's subtitle style is declared against the PROJECT canvas, but a
 * render can target a different one (a draft at quarter size, an export at
 * 4K). Everything here scales to the render canvas so a draft and a final
 * lay their text out the same way, just at different pixel sizes.
 */
import { assTime, buildAssHeader, type CaptionWord, hexToAss } from '@spark-apps/video-kit';
import type { VidletProject } from '../lib/vidlet-project.js';

export interface Canvas {
  width: number;
  height: number;
}

const ASS_ALIGNMENT = { bottom: 2, center: 5, top: 8 } as const;

/**
 * Project colours are "#RRGGBB"; ASS wants BGR with an alpha byte. The
 * kit's converter emits "&HAABBGGRR", which is the same thing with the
 * alpha spelled out, and 00 alpha is fully opaque.
 */
function projectColorToAss(hex: string): string {
  return hexToAss(hex);
}

/** Build ASS for the project's subtitles block, or null when there are none. */
export function buildSubtitleAss(project: VidletProject, canvas: Canvas): string | null {
  const { style, entries } = project.subtitles;
  if (entries.length === 0) return null;

  const fontSize = Math.max(
    8,
    Math.round(style.fontSize * (canvas.height / project.settings.height))
  );
  const alignment = ASS_ALIGNMENT[style.position];
  const marginV = style.position === 'center' ? 0 : Math.max(10, Math.round(canvas.height * 0.04));
  const outline = style.outline ? Math.max(1, Math.round(fontSize / 16)) : 0;
  const color = projectColorToAss(style.color);

  const header = buildAssHeader({
    title: 'VidLet Render',
    width: canvas.width,
    height: canvas.height,
    // Outline weight must not change between a draft and a final render.
    scaledBorderAndShadow: true,
    styles: [
      `Style: Default,${style.fontFamily},${fontSize},${color},${color},&H00202020,&H80000000,0,0,0,0,100,100,0,0,1,${outline},0,${alignment},40,40,${marginV},1`,
    ],
  });

  const lines = [...entries]
    .sort((a, b) => a.start - b.start)
    .map((entry) => {
      // A literal newline in a project entry is an intentional line break.
      const text = entry.text.replace(/\r?\n/g, '\\N');
      return `Dialogue: 0,${assTime(entry.start)},${assTime(entry.end)},Default,,0,0,0,,${text}`;
    });

  return header + lines.join('\n');
}

export type { CaptionWord };
