import { describe, expect, it } from 'vitest';
import {
  allocateLinesToSections,
  planNarrationBeats,
  realSpeechWords,
  slugifyTitle,
  splitSentences,
  timeWordsInLine,
  titleFromScript,
} from '../lib/autoshort-plan.js';
import { buildRenderGraph, clipWindows, ydifToIdleSpans } from './autoshort.js';
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

describe('splitSentences', () => {
  it('keeps terminators with their sentence', () => {
    expect(splitSentences('One thing. Then another! And a third?')).toEqual([
      'One thing.',
      'Then another!',
      'And a third?',
    ]);
  });

  it('handles a script with no terminator', () => {
    expect(splitSentences('just one line')).toEqual(['just one line']);
  });
});

describe('planNarrationBeats', () => {
  const lines = [
    { text: 'a', duration: 3 },
    { text: 'b', duration: 3 },
    { text: 'c', duration: 3 },
  ];

  it('leaves a lead-in before the first word', () => {
    const beats = planNarrationBeats(lines, [], 30, 1);
    expect(beats[0].start).toBeGreaterThanOrEqual(1);
  });

  it('spreads lines across the runtime rather than butting them together', () => {
    const beats = planNarrationBeats(lines, [], 30, 1);
    expect(beats[2].start).toBeGreaterThan(12);
  });

  it('snaps a line onto a nearby cut', () => {
    // Cut at 1.4s is just after the ideal 1.0s start, so line one moves to it.
    const beats = planNarrationBeats(lines, [1.4, 20, 25], 30, 1);
    expect(beats[0].start).toBeCloseTo(1.4, 2);
  });

  it('ignores a cut too far away to snap to', () => {
    const beats = planNarrationBeats(lines, [9.9], 30, 1);
    expect(beats[0].start).toBeCloseTo(1, 2);
  });

  it('never overlaps two lines', () => {
    const beats = planNarrationBeats(lines, [1.1, 1.2, 1.3, 1.4], 30, 1);
    for (let i = 1; i < beats.length; i++) {
      expect(beats[i].start).toBeGreaterThanOrEqual(beats[i - 1].start + beats[i - 1].duration);
    }
  });

  it('keeps every line inside the video, even when speech nearly fills it', () => {
    const tight = [
      { text: 'a', duration: 5 },
      { text: 'b', duration: 5 },
    ];
    const beats = planNarrationBeats(tight, [], 11, 1);
    for (const b of beats) expect(b.start + b.duration).toBeLessThanOrEqual(11.01);
  });

  it('handles a single line', () => {
    expect(planNarrationBeats([{ text: 'only', duration: 4 }], [], 30, 1)).toHaveLength(1);
  });
});

describe('buildRenderGraph audio', () => {
  const base = {
    clips: [{ spans: [{ start: 0, end: 10 }], luma: null }],
    speed: 2,
    contrast: 1.25,
    keepSourceAudio: false,
    musicVolume: 0.08,
    outputDuration: 5,
  };

  it('normalises to -14 LUFS so platforms leave the level alone', () => {
    const g = buildRenderGraph({ ...base, ttsIndex: 1 });
    expect(g).toContain('loudnorm=I=-14');
    expect(g.trim().endsWith('[a]')).toBe(true);
  });

  it('emits no audio chain at all for a silent Short', () => {
    const g = buildRenderGraph(base);
    expect(g).not.toContain('loudnorm');
    expect(g).not.toContain('[a]');
  });

  it('normalises the music-only case too', () => {
    expect(buildRenderGraph({ ...base, musicIndex: 1 })).toContain('loudnorm=I=-14');
  });
});

describe('timeWordsInLine', () => {
  it('spans exactly the measured line duration', () => {
    const words = timeWordsInLine('The beak takes shape.', 10, 2);
    expect(words[0].start).toBe(10);
    expect(words[words.length - 1].end).toBeCloseTo(12, 6);
  });

  it('uses the script text verbatim, never a transcription of it', () => {
    // whisper turned "Been working" into "I've been"; this cannot.
    const words = timeWordsInLine('Been working on my tax ducks project.', 0, 4);
    expect(words.map((w) => w.word)).toEqual([
      'Been',
      'working',
      'on',
      'my',
      'tax',
      'ducks',
      'project.',
    ]);
  });

  it('gives longer words more time than short ones', () => {
    const [a, b] = timeWordsInLine('a considerably', 0, 3);
    expect(b.end - b.start).toBeGreaterThan(a.end - a.start);
  });

  it('buys a beat of silence at a sentence end', () => {
    const noStop = timeWordsInLine('go now', 0, 2)[1];
    const withStop = timeWordsInLine('go now.', 0, 2)[1];
    expect(withStop.end - withStop.start).toBeGreaterThan(noStop.end - noStop.start);
  });

  it('never overlaps or leaves a gap between words', () => {
    const words = timeWordsInLine('one two three four five', 5, 3);
    for (let i = 1; i < words.length; i++) {
      expect(words[i].start).toBeCloseTo(words[i - 1].end, 6);
    }
  });

  it('returns nothing for empty text', () => {
    expect(timeWordsInLine('   ', 0, 2)).toEqual([]);
  });
});

describe('allocateLinesToSections', () => {
  const line = (duration: number, id: string) => ({ duration, id });

  it('sends more lines to the longer section', () => {
    const lines = [line(2, 'a'), line(2, 'b'), line(2, 'c'), line(2, 'd')];
    const groups = allocateLinesToSections(lines, [
      { start: 0, end: 30 },
      { start: 30, end: 40 },
    ]);
    expect(groups[0].length).toBeGreaterThan(groups[1].length);
  });

  it('keeps script order within and across sections', () => {
    const lines = [line(1, 'a'), line(1, 'b'), line(1, 'c'), line(1, 'd')];
    const groups = allocateLinesToSections(lines, [
      { start: 0, end: 10 },
      { start: 10, end: 20 },
    ]);
    expect(groups.flat().map((l) => l.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('puts the rigging half of a script in the rigging clip', () => {
    // Four lines, two equal clips: modelling lines land in clip one.
    const lines = [line(3, 'model1'), line(3, 'model2'), line(3, 'rig1'), line(3, 'rig2')];
    const groups = allocateLinesToSections(lines, [
      { start: 0, end: 20 },
      { start: 20, end: 40 },
    ]);
    expect(groups[0].map((l) => l.id)).toEqual(['model1', 'model2']);
    expect(groups[1].map((l) => l.id)).toEqual(['rig1', 'rig2']);
  });

  it('passes everything through untouched for a single clip', () => {
    const lines = [line(1, 'a'), line(1, 'b')];
    expect(allocateLinesToSections(lines, [{ start: 0, end: 10 }])).toEqual([lines]);
  });

  it('loses no lines', () => {
    const lines = Array.from({ length: 9 }, (_, i) => line(1, `l${i}`));
    const groups = allocateLinesToSections(lines, [
      { start: 0, end: 5 },
      { start: 5, end: 9 },
      { start: 9, end: 30 },
    ]);
    expect(groups.flat()).toHaveLength(9);
  });
});

describe('clipWindows', () => {
  it('lays clips end to end after the intro, at output speed', () => {
    const w = clipWindows([{ kept: 20 }, { kept: 10 }], 2, 5);
    expect(w).toEqual([
      { start: 5, end: 15 },
      { start: 15, end: 20 },
    ]);
  });
});
