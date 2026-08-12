import { describe, expect, it } from 'vitest';
import { buildCtaSvg, displayDomain, escapeXml, layoutPill } from './cta-overlay.js';

describe('displayDomain', () => {
  it('strips what nobody reads', () => {
    expect(displayDomain('https://www.ducktax.com/')).toBe('ducktax.com');
    expect(displayDomain('http://ducktax.com')).toBe('ducktax.com');
    expect(displayDomain('ducktax.com')).toBe('ducktax.com');
  });
});

describe('escapeXml', () => {
  it('escapes text that would otherwise break the SVG document', () => {
    expect(escapeXml('Tax & "returns" <fast>')).toBe('Tax &amp; &quot;returns&quot; &lt;fast&gt;');
  });
});

describe('layoutPill', () => {
  it('never spans the whole frame', () => {
    const L = layoutPill('averyveryverylongdomainname.example.com', 'a long tagline too', 720);
    expect(L.width).toBeLessThanOrEqual(720 * 0.92);
  });

  it('is taller when there is a tagline to fit', () => {
    expect(layoutPill('ducktax.com', 'Tax returns', 720).height).toBeGreaterThan(
      layoutPill('ducktax.com', undefined, 720).height
    );
  });

  it('scales with the canvas', () => {
    expect(layoutPill('ducktax.com', undefined, 1080).fontSize).toBeGreaterThan(
      layoutPill('ducktax.com', undefined, 720).fontSize
    );
  });
});

describe('buildCtaSvg', () => {
  it('renders the domain and tagline', () => {
    const svg = buildCtaSvg({ domain: 'ducktax.com', tagline: 'Less pain', canvasWidth: 720 });
    expect(svg).toContain('ducktax.com');
    expect(svg).toContain('Less pain');
    expect(svg).toContain('<svg');
  });

  it('omits the icon element entirely when there is no favicon', () => {
    // A missing icon must degrade to a text-only pill, not a broken render.
    expect(buildCtaSvg({ domain: 'ducktax.com', canvasWidth: 720 })).not.toContain('<image');
  });

  it('embeds the favicon inline so rasterising never hits the network', () => {
    const svg = buildCtaSvg({
      domain: 'ducktax.com',
      faviconDataUri: 'data:image/png;base64,AAAA',
      canvasWidth: 720,
    });
    expect(svg).toContain('<image');
    expect(svg).toContain('data:image/png;base64,AAAA');
    expect(svg).not.toMatch(/href="https?:/);
  });

  it('escapes a tagline containing markup', () => {
    const svg = buildCtaSvg({ domain: 'x.com', tagline: '<script>', canvasWidth: 720 });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });
});
