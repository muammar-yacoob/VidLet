import { describe, expect, it } from 'vitest';
import {
  type OcrWord,
  classifyText,
  luhnValid,
  regionsForFrame,
  unionRegions,
  withinAreaLimit,
} from './pii.js';

const w = (text: string, x: number, y = 100, width = 40, height = 12): OcrWord => ({
  text,
  x,
  y,
  width,
  height,
});

describe('luhnValid', () => {
  it('accepts real test card numbers', () => {
    expect(luhnValid('4242 4242 4242 4242')).toBe(true); // Stripe Visa
    expect(luhnValid('5555555555554444')).toBe(true); // Mastercard
    expect(luhnValid('378282246310005')).toBe(true); // Amex, 15 digits
  });

  it('rejects a sequential number that merely looks like a card', () => {
    expect(luhnValid('1234 5678 9012 3456')).toBe(false);
  });

  it('rejects runs that are too short or too long to be a card', () => {
    expect(luhnValid('42424242')).toBe(false);
    expect(luhnValid('4242424242424242424242')).toBe(false);
  });
});

describe('classifyText', () => {
  it('flags a Luhn-valid card number', () => {
    expect(classifyText('4242 4242 4242 4242').map((m) => m.kind)).toContain('card');
  });

  it('does NOT flag a long number that fails Luhn', () => {
    expect(classifyText('1234 5678 9012 3456').map((m) => m.kind)).not.toContain('card');
  });

  it('flags emails, IBANs and SSNs', () => {
    expect(classifyText('me@example.com').map((m) => m.kind)).toContain('email');
    expect(classifyText('GB29NWBK60161331926819').map((m) => m.kind)).toContain('iban');
    expect(classifyText('078-05-1120').map((m) => m.kind)).toContain('ssn');
  });

  it('flags API keys by prefix', () => {
    expect(classifyText('sk-abcdefghijklmnopqrstuv').map((m) => m.kind)).toContain('key');
    expect(classifyText('gsk_ABCDEFGHIJKLMNOPQRST').map((m) => m.kind)).toContain('key');
  });

  it('flags street addresses and postcodes', () => {
    expect(classifyText('42 Elm Street').map((m) => m.kind)).toContain('address');
    expect(classifyText('SW1A 1AA').map((m) => m.kind)).toContain('postcode');
  });

  it('flags a phone number but not a short numeric run', () => {
    expect(classifyText('+44 7700 900123').map((m) => m.kind)).toContain('phone');
    expect(classifyText('1234').map((m) => m.kind)).toHaveLength(0);
  });

  it('leaves ordinary UI text alone', () => {
    // These are the strings that would ruin a screen recording if masked.
    for (const text of [
      'Scene Collection',
      'Blender 5.2.3 LTS',
      'v1.2.0',
      '00:00:12',
      'Weight 1.000',
      'Add Modifier',
      'x 1080 y 1920',
    ]) {
      expect(classifyText(text), `should not flag: ${text}`).toHaveLength(0);
    }
  });

  it('does not let the loose phone rule shadow a card', () => {
    const kinds = classifyText('4242 4242 4242 4242').map((m) => m.kind);
    expect(kinds).toContain('card');
    expect(kinds).not.toContain('phone');
  });
});

describe('regionsForFrame', () => {
  it('covers a card number split across several OCR word boxes', () => {
    const words = [w('Card', 0), w('4242', 50), w('4242', 100), w('4242', 150), w('4242', 200)];
    const regions = regionsForFrame(words, 1920, 1080);
    expect(regions).toHaveLength(1);
    // The box must span the digits, not just the first one.
    expect(regions[0].x).toBeLessThanOrEqual(50);
    expect(regions[0].x + regions[0].width).toBeGreaterThanOrEqual(240);
    expect(regions[0].kinds).toContain('card');
  });

  it('returns nothing for a frame of ordinary text', () => {
    const words = [w('Scene', 0), w('Collection', 50), w('Blender', 100)];
    expect(regionsForFrame(words, 1920, 1080)).toEqual([]);
  });

  it('keeps boxes inside the frame after padding', () => {
    const regions = regionsForFrame([w('me@example.com', 0, 0, 30, 10)], 1920, 1080);
    expect(regions[0].x).toBeGreaterThanOrEqual(0);
    expect(regions[0].y).toBeGreaterThanOrEqual(0);
  });

  it('merges two overlapping finds into one rectangle', () => {
    const words = [w('me@example.com', 0, 100, 100, 12), w('me@example.com', 50, 100, 100, 12)];
    expect(regionsForFrame(words, 1920, 1080)).toHaveLength(1);
  });
});

describe('unionRegions', () => {
  it('collapses the same field seen across many frames into one box', () => {
    const frame = [{ x: 10, y: 10, width: 100, height: 20, kinds: ['email' as const] }];
    expect(unionRegions([frame, frame, frame])).toHaveLength(1);
  });

  it('keeps genuinely separate fields separate', () => {
    const a = [{ x: 10, y: 10, width: 50, height: 20, kinds: ['email' as const] }];
    const b = [{ x: 500, y: 400, width: 50, height: 20, kinds: ['card' as const] }];
    expect(unionRegions([a, b])).toHaveLength(2);
  });

  it('grows the box to cover a field that drifts between frames', () => {
    const a = [{ x: 10, y: 10, width: 100, height: 20, kinds: ['card' as const] }];
    const b = [{ x: 60, y: 10, width: 100, height: 20, kinds: ['card' as const] }];
    const [merged] = unionRegions([a, b]);
    expect(merged.x).toBe(10);
    expect(merged.width).toBe(150);
  });
});

describe('address rule against OCR noise', () => {
  it('does NOT match the garbage that pixelated a quarter of a frame', () => {
    // Real capture: a Blender panel OCR'd as this, and the loose rule read
    // "4 HT way" as a street address.
    for (const junk of ['= owe & 4 HT way)', '4 HT way) v 7', '& 4 HT way) v', '1B tees at Ci']) {
      expect(
        classifyText(junk).map((m) => m.kind),
        junk
      ).not.toContain('address');
    }
  });

  it('still matches genuine addresses', () => {
    for (const real of ['42 Elm Street', '7 Abbey Road', '221 Baker Street', '10 Kings Ave.']) {
      expect(
        classifyText(real).map((m) => m.kind),
        real
      ).toContain('address');
    }
  });

  it('requires a real name, not a single stray token', () => {
    expect(classifyText('4 x Way').map((m) => m.kind)).not.toContain('address');
  });
});

describe('withinAreaLimit', () => {
  it('rejects a region covering a fifth of the frame or more', () => {
    // The false positive was 560x411 on a 720x1280 frame: 25%.
    expect(withinAreaLimit({ width: 560, height: 411 }, 720, 1280)).toBe(false);
  });

  it('accepts a plausibly sized field', () => {
    expect(withinAreaLimit({ width: 300, height: 40 }, 720, 1280)).toBe(true);
  });
});

describe('regionsForFrame area guard', () => {
  it('drops an oversized merged region rather than covering the video', () => {
    // Two far-apart emails that merge into a box spanning the frame.
    const wide = [
      { text: 'a@b.com', x: 0, y: 0, width: 700, height: 600 },
      { text: 'c@d.com', x: 10, y: 10, width: 700, height: 600 },
    ];
    expect(regionsForFrame(wide, 720, 1280)).toEqual([]);
  });
});
