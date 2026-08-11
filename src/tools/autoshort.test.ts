import { describe, expect, it } from 'vitest';
import { realSpeechWords, slugifyTitle, titleFromScript } from '../lib/autoshort-plan.js';
import { ydifToIdleSpans } from './autoshort.js';
import {
  classifyInputs,
  dedupeRetakes,
  scriptToSrt,
  spansWithText,
  speedFor,
  subtitleToText,
} from './autoshort.js';

describe('classifyInputs', () => {
  it('sorts a mixed attachment list into roles, preserving video order', () => {
    const files = classifyInputs([
      '/a/clip2.mp4',
      '/a/notes.txt',
      '/a/clip1.mov',
      '/a/subs.srt',
      '/a/bed.mp3',
    ]);
    expect(files.videos).toEqual(['/a/clip2.mp4', '/a/clip1.mov']);
    expect(files.narrationPath).toBe('/a/notes.txt');
    expect(files.subtitlePath).toBe('/a/subs.srt');
    expect(files.musicPath).toBe('/a/bed.mp3');
  });

  it('keeps the first of duplicate roles and flags what it cannot place', () => {
    const files = classifyInputs(['/a/one.srt', '/a/two.srt', '/a/mystery.xyz']);
    expect(files.subtitlePath).toBe('/a/one.srt');
    expect(files.ignored).toEqual(['/a/mystery.xyz']);
  });
});

describe('subtitleToText', () => {
  it('strips SRT indices, timestamps and tags down to speech', () => {
    const srt =
      '1\n00:00:00,000 --> 00:00:02,000\nHello <i>there</i>\n\n2\n00:00:02,000 --> 00:00:04,000\nGeneral Kenobi\n';
    expect(subtitleToText(srt)).toBe('Hello there General Kenobi');
  });

  it('handles VTT headers', () => {
    expect(subtitleToText('WEBVTT\n\n00:00.000 --> 00:02.000\nHi\n')).toBe('Hi');
  });
});

describe('speedFor', () => {
  it('never slows down footage that already fits', () => {
    expect(speedFor(30, 57)).toBe(1);
  });

  it('lands exactly on the ceiling', () => {
    expect(speedFor(570, 57)).toBeCloseTo(10);
  });

  it('caps at 60x', () => {
    expect(speedFor(100_000, 57)).toBe(60);
  });
});

describe('spansWithText', () => {
  it('attaches transcript text by timestamp overlap', () => {
    const spans = [
      { start: 0, end: 5 },
      { start: 10, end: 15 },
    ];
    const transcript = [
      { start: 1, end: 3, text: 'click the button' },
      { start: 11, end: 14, text: 'save the file' },
      { start: 20, end: 22, text: 'unrelated tail' },
    ];
    const result = spansWithText(spans, transcript);
    expect(result[0].text).toBe('click the button');
    expect(result[1].text).toBe('save the file');
  });
});

describe('dedupeRetakes', () => {
  it('collapses near-duplicate takes to the longest one', () => {
    const spans = [
      { start: 0, end: 4, text: 'so first we open the settings panel and click export' },
      {
        start: 5,
        end: 12,
        text: 'okay so first we open up the settings panel and then click export button',
      },
      { start: 13, end: 18, text: 'now we choose the output format for the render' },
    ];
    const kept = dedupeRetakes(spans);
    expect(kept).toHaveLength(2);
    expect(kept[0].start).toBe(5); // the longer retake won
    expect(kept[1].start).toBe(13);
  });

  it('keeps spans with too little text to judge', () => {
    const spans = [
      { start: 0, end: 2, text: 'mm' },
      { start: 3, end: 5, text: 'mm' },
    ];
    expect(dedupeRetakes(spans)).toHaveLength(2);
  });

  it('does not merge genuinely different steps', () => {
    const spans = [
      { start: 0, end: 4, text: 'we start by importing the model into the scene' },
      { start: 5, end: 9, text: 'next the rig gets weight painted for the animation' },
    ];
    expect(dedupeRetakes(spans)).toHaveLength(2);
  });

  it('returns kept spans in chronological order', () => {
    const spans = [
      { start: 0, end: 3, text: 'short take about the export settings panel here' },
      { start: 10, end: 20, text: 'longer retake about the export settings panel here with more' },
    ];
    const kept = dedupeRetakes(spans);
    expect(kept.map((s) => s.start)).toEqual([10]);
  });
});

describe('scriptToSrt', () => {
  it('splits by sentence and spans the full duration', () => {
    const srt = scriptToSrt('First thing. Second longer sentence here. Done.', 30);
    expect(srt).toContain('1\n00:00:00,000');
    const blocks = srt.trim().split('\n\n');
    expect(blocks).toHaveLength(3);
    expect(blocks[2]).toContain('00:00:30,000');
  });

  it('handles a script with no sentence punctuation', () => {
    const srt = scriptToSrt('just one run on line with no periods', 10);
    expect(srt.trim().split('\n\n')).toHaveLength(1);
    expect(srt).toContain('00:00:10,000');
  });
});

describe('realSpeechWords', () => {
  it('ignores whisper non-speech markers', () => {
    expect(realSpeechWords('[BLANK_AUDIO]')).toBe(0);
    expect(realSpeechWords('(soft piano music)')).toBe(0);
    expect(realSpeechWords('[Music] [BLANK_AUDIO] (hum)')).toBe(0);
  });

  it('counts actual words', () => {
    expect(realSpeechWords('so first we open the panel')).toBe(6);
    expect(realSpeechWords('[Music] okay click export now')).toBe(4);
  });
});

describe('slugifyTitle', () => {
  it('turns a spoken title into a dashed filename stem', () => {
    expect(slugifyTitle('Rigging a low-poly duck in Blender!')).toBe(
      'rigging-a-low-poly-duck-in-blender'
    );
  });

  it('stays within the character budget on whole words', () => {
    const slug = slugifyTitle('one two three four five six seven eight nine ten eleven', 20);
    expect(slug.length).toBeLessThanOrEqual(20);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('strips punctuation and accents rather than emitting them', () => {
    expect(slugifyTitle('Café: naïve — résumé?')).toBe('cafe-naive-resume');
  });

  it('still yields something for a single over-long word', () => {
    expect(slugifyTitle('supercalifragilisticexpialidocious', 10)).toBe('supercalif');
  });

  it('falls back rather than returning an empty name', () => {
    expect(slugifyTitle('!!! ???')).toBe('short');
  });
});

describe('titleFromScript', () => {
  it('takes the first sentence', () => {
    expect(titleFromScript('Your duck is coming to life. Then we rig it.')).toBe(
      'Your duck is coming to life'
    );
  });

  it('handles a script with no terminator', () => {
    expect(titleFromScript('just one line')).toBe('just one line');
  });
});

describe('ydifToIdleSpans', () => {
  it('marks runs of low frame difference as idle', () => {
    // 0.5s steps: frames 2-7 are static -> one 3s idle span.
    const ydif = [5, 5, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 5, 5];
    expect(ydifToIdleSpans(ydif, 0.5, 2)).toEqual([{ start: 1, end: 4 }]);
  });

  it('ignores a static run shorter than the minimum', () => {
    expect(ydifToIdleSpans([5, 0.1, 0.1, 5], 0.5, 2)).toEqual([]);
  });

  it('closes a run that reaches the end of the clip', () => {
    expect(ydifToIdleSpans([5, 0.1, 0.1, 0.1, 0.1], 0.5, 2)).toEqual([{ start: 0.5, end: 2.5 }]);
  });

  it('treats a busy clip as having no idle time', () => {
    expect(ydifToIdleSpans([9, 8, 7, 6], 0.5, 2)).toEqual([]);
  });
});
