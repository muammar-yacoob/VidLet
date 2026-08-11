/**
 * YouTube title virality scorer, ported verbatim from ViralCat
 * (lib/youtube/title-scorer.ts) rather than re-derived - the scoring
 * criteria came from analysis of 50+ top-performing videos in the
 * social-media-automation niche (June 2026 data), and that analysis is the
 * value, not the code around it.
 *
 * Each signal returns 0-100 and a weight; the final score is the weighted
 * average clamped to [0, 100].
 */

/** Words that earn ALL-CAPS treatment in top-performing titles. */
const POWER_WORDS = [
  'viral',
  'free',
  'insane',
  'best',
  'new',
  'secret',
  'ultimate',
  'proven',
  'easy',
  'fast',
] as const;

/** Opening patterns correlated with high view counts. */
const STRONG_OPENERS = [
  /^this\s+(app|tool|ai|system|software)\b/i,
  /^how\s+to\b/i,
  /^how\s+\w+\s+(makes?|creates?|posts?|finds?|runs?|gets?)\b/i,
  /^the\s+(best|only|fastest|easiest)\b/i,
  /^stop\s/i,
  /^why\s/i,
] as const;

const EMOJI_RE = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1FA00}-\u{1FAFF}]/u;

export interface TitleSignal {
  key: string;
  label: string;
  score: number; // 0-100
  tip: string;
  weight: number;
}

function scoreLength(title: string): TitleSignal {
  const len = title.length;
  let score: number;
  let tip: string;

  if (len === 0) {
    score = 0;
    tip = 'Type a title to see your score';
  } else if (len < 30) {
    score = 30;
    tip = 'Too short: aim for 45-65 characters';
  } else if (len < 45) {
    score = 60;
    tip = 'Almost there: a few more words would help';
  } else if (len <= 65) {
    score = 100;
    tip = 'Sweet spot! Top performers cluster here';
  } else if (len <= 80) {
    score = 60;
    tip = 'Getting long: may get truncated in search';
  } else {
    score = 25;
    tip = 'Way too long: YouTube cuts titles at ~70 chars';
  }

  return { key: 'length', label: `Length (${len})`, score, tip, weight: 25 };
}

function scoreOpener(title: string): TitleSignal {
  const matched = STRONG_OPENERS.some((re) => re.test(title));
  return {
    key: 'opener',
    label: 'Opening hook',
    score: matched ? 100 : 30,
    tip: matched
      ? 'Strong opener pattern detected'
      : 'Try starting with "This app...", "How to...", or "The best..."',
    weight: 20,
  };
}

function scorePowerWords(title: string): TitleSignal {
  const lower = title.toLowerCase();
  const found = POWER_WORDS.filter((w) => lower.includes(w));
  const capsCount = (title.match(/\b[A-Z]{3,}\b/g) ?? []).length;

  let score: number;
  let tip: string;

  if (found.length === 0) {
    score = 20;
    tip = 'Add a power word: VIRAL, FREE, BEST, etc.';
  } else if (capsCount === 1) {
    score = 100;
    tip = 'One caps power word is the sweet spot (32% of top videos)';
  } else if (capsCount === 0) {
    score = 70;
    tip = 'Try capitalizing one power word for emphasis';
  } else {
    score = 45;
    tip = 'Too many ALL-CAPS words: keep it to one';
  }

  return { key: 'power', label: 'Power words', score, tip, weight: 15 };
}

function scoreNumbers(title: string): TitleSignal {
  const hasNumber = /\d/.test(title);
  return {
    key: 'numbers',
    label: 'Specificity',
    score: hasNumber ? 100 : 35,
    tip: hasNumber
      ? 'Numbers add credibility and specificity'
      : 'Add a number: "7 platforms", "in 5 minutes", "100% automated"',
    weight: 15,
  };
}

function scoreParenthetical(title: string): TitleSignal {
  const has = /\(.*\)/.test(title);
  return {
    key: 'paren',
    label: 'Parenthetical hook',
    score: has ? 100 : 40,
    tip: has
      ? '46% of top videos use a parenthetical hook'
      : 'Add a hook: "(Here\'s How)", "(100% Automated)", "(Free)"',
    weight: 10,
  };
}

function scoreFormatting(title: string): TitleSignal {
  const hasEmoji = EMOJI_RE.test(title);
  const hasExclamation = title.includes('!');
  let score = 100;
  let tip = 'Clean formatting';

  if (hasEmoji) {
    score -= 40;
    tip = 'Skip emojis: 0% of top performers use them in titles';
  }
  if (hasExclamation) {
    score -= 20;
    tip = hasEmoji
      ? 'Drop emojis and exclamation marks'
      : 'Exclamation marks only appear in 10% of top titles';
  }

  return {
    key: 'format',
    label: 'Formatting',
    score: Math.max(0, score),
    tip,
    weight: 15,
  };
}

export interface TitleScore {
  total: number; // 0-100
  grade: string; // e.g. "A", "B+", "C"
  signals: TitleSignal[];
}

const GRADES: [number, string][] = [
  [90, 'A+'],
  [80, 'A'],
  [70, 'B+'],
  [60, 'B'],
  [50, 'C+'],
  [40, 'C'],
  [30, 'D'],
  [0, 'F'],
];

function toGrade(score: number): string {
  for (const [threshold, grade] of GRADES) {
    if (score >= threshold) return grade;
  }
  return 'F';
}

/**
 * Score a YouTube title for virality potential.
 * Returns a total 0-100 score, letter grade, and per-signal breakdown.
 */
export function scoreYouTubeTitle(rawTitle: string): TitleScore {
  const title = rawTitle.trim();
  if (!title) {
    return { total: 0, grade: 'F', signals: [scoreLength(title)] };
  }

  const signals = [
    scoreLength(title),
    scoreOpener(title),
    scorePowerWords(title),
    scoreNumbers(title),
    scoreParenthetical(title),
    scoreFormatting(title),
  ];

  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const weighted = signals.reduce((sum, s) => sum + s.score * s.weight, 0);
  const total = Math.round(Math.min(100, Math.max(0, weighted / totalWeight)));

  return { total, grade: toGrade(total), signals };
}
