import { describe, expect, it } from 'vitest';
import { NICHT_BEURTEILT, beurteilungText, istBeurteilt } from './beurteilung';

const zeit = (s: string) => `<${s}>`;

describe('beurteilung (LLH-1090)', () => {
  it('nennt ein nie bestätigtes Gebiet „nicht beurteilt“', () => {
    expect(istBeurteilt({})).toBe(false);
    expect(beurteilungText({}, zeit)).toBe(NICHT_BEURTEILT);
    expect(NICHT_BEURTEILT).toBe('nicht beurteilt');
  });

  it('nennt Zeit und Person einer Bestätigung', () => {
    const g = { beurteilt_at: '2026-10-20 13:15:00', beurteilt_von_name: 'Ruben' };
    expect(istBeurteilt(g)).toBe(true);
    expect(beurteilungText(g, zeit)).toBe('beurteilt <2026-10-20 13:15:00> · Ruben');
  });

  it('kommt ohne Namen aus', () => {
    expect(beurteilungText({ beurteilt_at: '2026-10-20 13:15:00' }, zeit)).toBe(
      'beurteilt <2026-10-20 13:15:00>',
    );
  });
});
