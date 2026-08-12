import { describe, expect, it } from 'vitest';
import {
  allocateLinesToSections,
  fitBeatsToRuntime,
  outputTimeToSource,
  planNarrationBeats,
  realSpeechWords,
  slugifyTitle,
  sourceTimeToOutput,
  speedPerSection,
  splitScriptSections,
  splitSentences,
  startsFromAssignment,
  timeWordsInLine,
  titleFromScript,
  windowsFromSpeeds,
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

  it('hard-limits true peak after loudnorm, since single-pass loudnorm can overshoot it', () => {
    // Regression: measured +0.9 dBTP on a real render despite TP=-1.5 being
    // requested - loudnorm alone is not a peak guarantee.
    const g = buildRenderGraph({ ...base, ttsIndex: 1 });
    expect(g).toMatch(/loudnorm=I=-14[^,]*,alimiter=/);
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

describe('outputTimeToSource', () => {
  const clips = [{ spans: [{ start: 100, end: 110 }] }, { spans: [{ start: 500, end: 520 }] }];

  it('returns null while the intro is still playing', () => {
    expect(outputTimeToSource(clips, 2, 5, 3)).toBeNull();
  });

  it('maps into the first clip', () => {
    // 1s of output past the intro, at 2x, is 2s into the first span.
    expect(outputTimeToSource(clips, 2, 5, 6)).toEqual({ clipIndex: 0, sourceTime: 102 });
  });

  it('crosses into the second clip once the first is exhausted', () => {
    // First span is 10s of source = 5s of output, so t=11 lands in clip 2.
    expect(outputTimeToSource(clips, 2, 5, 11)).toEqual({ clipIndex: 1, sourceTime: 502 });
  });

  it('clamps past the end to the last real frame', () => {
    expect(outputTimeToSource(clips, 2, 5, 9999)).toEqual({ clipIndex: 1, sourceTime: 520 });
  });
});

describe('startsFromAssignment', () => {
  const lines = [{ duration: 2 }, { duration: 2 }, { duration: 2 }];
  const times = [0, 10, 20, 30];

  it('starts each line at the moment it was assigned to', () => {
    expect(startsFromAssignment(lines, [0, 1, 2], times, 0, 40)).toEqual([0, 10, 20]);
  });

  it('refuses to run the script backwards', () => {
    // A model that assigns 2 then 0 must not rewind the narration.
    const starts = startsFromAssignment(lines, [2, 0, 3], times, 0, 40);
    for (let i = 1; i < starts.length; i++) expect(starts[i]).toBeGreaterThanOrEqual(starts[i - 1]);
  });

  it('never overlaps two lines', () => {
    const starts = startsFromAssignment(lines, [1, 1, 1], times, 0, 40);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]).toBeGreaterThanOrEqual(starts[i - 1] + 2);
    }
  });

  it('keeps every line inside the runtime', () => {
    const starts = startsFromAssignment(lines, [3, 3, 3], times, 0, 25);
    for (let i = 0; i < starts.length; i++) {
      expect(starts[i] + lines[i].duration).toBeLessThanOrEqual(25.01);
    }
  });

  it('survives an out-of-range or missing assignment', () => {
    expect(() => startsFromAssignment(lines, [99, Number.NaN], times, 0, 40)).not.toThrow();
  });

  it('never opens with a long stretch of silence', () => {
    // Regression: a vision model anchored the opening line to a keyframe 20s
    // in, so the Short began with twenty seconds of nothing being said.
    const starts = startsFromAssignment(lines, [2, 3, 3], times, 0, 60);
    expect(starts[0]).toBeLessThanOrEqual(2.5);
  });

  it('preserves the relative spacing the model chose when it slides the run', () => {
    const starts = startsFromAssignment(lines, [2, 3, 3], times, 0, 60);
    // Assigned to t=20 and t=30: a 10s gap that must survive the shift.
    expect(starts[1] - starts[0]).toBeCloseTo(10, 5);
  });

  it('pins the opening beat, whatever keyframe the model picked', () => {
    // The opening pause is fixed for every Short, so the model decides the
    // SPACING of the lines but never when the video starts talking.
    const starts = startsFromAssignment(lines, [1, 2, 3], times, 8, 60);
    expect(starts[0]).toBe(8);
    // Relative spacing from the assignment still survives the slide.
    expect(starts[1] - starts[0]).toBeCloseTo(10, 5);
  });
});

describe('splitScriptSections', () => {
  it('splits on a --- marker line', () => {
    expect(splitScriptSections('We model it.\n---\nThen we rig it.')).toEqual([
      'We model it.',
      'Then we rig it.',
    ]);
  });

  it('returns one section when there is no marker', () => {
    expect(splitScriptSections('All one piece.')).toEqual(['All one piece.']);
  });

  it('ignores a dash inside a sentence', () => {
    expect(splitScriptSections('A well-made duck.')).toHaveLength(1);
  });

  it('drops empty sections from stray markers', () => {
    expect(splitScriptSections('one\n---\n---\ntwo')).toEqual(['one', 'two']);
  });
});

describe('sourceTimeToOutput', () => {
  const clips = [{ spans: [{ start: 100, end: 110 }] }, { spans: [{ start: 500, end: 520 }] }];

  it('maps a kept source moment onto the finished timeline', () => {
    expect(sourceTimeToOutput(clips, 2, 5, 0, 102)).toBeCloseTo(6, 6);
  });

  it('accounts for earlier clips when mapping a later one', () => {
    // 10s of clip one is 5s of output, so 502 lands at 5 + 5 + 1 = 11.
    expect(sourceTimeToOutput(clips, 2, 5, 1, 502)).toBeCloseTo(11, 6);
  });

  it('returns null for a moment that was cut out', () => {
    expect(sourceTimeToOutput(clips, 2, 5, 0, 300)).toBeNull();
  });

  it('round-trips with outputTimeToSource', () => {
    const point = outputTimeToSource(clips, 2, 5, 11);
    if (!point) throw new Error('expected a mapped point');
    const back = sourceTimeToOutput(clips, 2, 5, point.clipIndex, point.sourceTime);
    expect(back).toBeCloseTo(11, 6);
  });
});

describe('fitBeatsToRuntime', () => {
  const beat = (start: number, duration: number, text = 'x') => ({ text, start, duration });

  it('leaves a narration that already fits untouched', () => {
    const beats = [beat(1, 3), beat(5, 3)];
    const out = fitBeatsToRuntime(beats, 20);
    expect(out.overran).toBe(false);
    expect(out.beats).toEqual(beats);
  });

  it('pulls an overrunning narration back inside the runtime', () => {
    // Regression: real TTS ran longer than the estimate used for placement,
    // so the closing lines fell off the end and were silently cut.
    const beats = [beat(1, 10), beat(20, 10)];
    const out = fitBeatsToRuntime(beats, 25);
    expect(out.overran).toBe(true);
    const last = out.beats[out.beats.length - 1];
    expect(last.start + last.duration).toBeLessThanOrEqual(25.01);
  });

  it('keeps the opening beat where it was', () => {
    const out = fitBeatsToRuntime([beat(2, 10), beat(20, 10)], 25);
    expect(out.beats[0].start).toBe(2);
  });

  it('never reorders or overlaps lines', () => {
    const out = fitBeatsToRuntime([beat(1, 8), beat(12, 8), beat(24, 8)], 26);
    for (let i = 1; i < out.beats.length; i++) {
      expect(out.beats[i].start).toBeGreaterThanOrEqual(
        out.beats[i - 1].start + out.beats[i - 1].duration - 0.001
      );
    }
  });

  it('packs tight and still reports when the script simply cannot fit', () => {
    const out = fitBeatsToRuntime([beat(1, 20), beat(22, 20)], 25);
    expect(out.overran).toBe(true);
    // Shoulder to shoulder from the opening beat, no gaps left to give.
    expect(out.beats[1].start).toBeCloseTo(21, 5);
  });

  it('handles an empty narration', () => {
    expect(fitBeatsToRuntime([], 10)).toEqual({ beats: [], overran: false });
  });
});

describe('splitSentences with dots that are not sentence ends', () => {
  it('keeps a domain whole', () => {
    // Regression: "ducktax.com" split into "ducktax." and "com.", and the
    // TTS spoke "com." as its own sentence.
    expect(splitSentences('Find him on ducktax.com.')).toEqual(['Find him on ducktax.com.']);
  });

  it('keeps a multi-part domain and a path whole', () => {
    expect(splitSentences('Go to my.site.co.uk now.')).toEqual(['Go to my.site.co.uk now.']);
  });

  it('keeps version numbers whole', () => {
    expect(splitSentences('This is Blender 5.2.3 LTS.')).toEqual(['This is Blender 5.2.3 LTS.']);
  });

  it('still splits genuine sentences', () => {
    expect(splitSentences('One thing. Then another.')).toEqual(['One thing.', 'Then another.']);
  });

  it('splits a sentence that ends immediately before a domain', () => {
    expect(splitSentences('That is done. ducktax.com is live.')).toEqual([
      'That is done.',
      'ducktax.com is live.',
    ]);
  });
});

describe('speedPerSection', () => {
  it('gives the talkative clip more runtime than its footage earned', () => {
    // Clip 1 has twice the footage but clip 2 has three times the narration.
    const speeds = speedPerSection([1000, 500], [10, 30], 50);
    const w = windowsFromSpeeds([1000, 500], speeds, 0);
    const first = w[0].end - w[0].start;
    const second = w[1].end - w[1].start;
    expect(second).toBeGreaterThan(first);
  });

  it('fills the available runtime', () => {
    const kept = [1000, 500];
    const speeds = speedPerSection(kept, [20, 20], 50);
    const w = windowsFromSpeeds(kept, speeds, 0);
    expect(w[w.length - 1].end).toBeCloseTo(50, 1);
  });

  it('never slows footage below realtime', () => {
    // A tiny clip with most of the narration must not be stretched.
    for (const s of speedPerSection([5, 1000], [40, 1], 50)) {
      expect(s).toBeGreaterThanOrEqual(1);
    }
  });

  it('still shows a section with no narration at all', () => {
    const kept = [1000, 500];
    const w = windowsFromSpeeds(kept, speedPerSection(kept, [40, 0], 50), 0);
    expect(w[1].end - w[1].start).toBeGreaterThan(0);
  });

  it('falls back to one uniform speed when there is no narration', () => {
    const speeds = speedPerSection([600, 600], [0, 0], 60);
    expect(speeds[0]).toBeCloseTo(speeds[1], 6);
  });
});
