import { describe, expect, it } from 'vitest';
import { UNBESTAETIGT, beurteilungText, istBeurteilt } from './beurteilung';

const zeit = (s: string) => `<${s}>`;

describe('beurteilung (LLH-1090)', () => {
  it('nennt ein nie bestätigtes Gebiet „unbestätigt“', () => {
    expect(istBeurteilt({})).toBe(false);
    expect(beurteilungText({}, zeit)).toBe(UNBESTAETIGT);
    expect(UNBESTAETIGT).toBe('unbestätigt');
  });

  it('nennt Zeit und Person einer Bestätigung', () => {
    const g = { beurteilt_at: '2026-10-20 13:15:00', beurteilt_von_name: 'Ruben' };
    expect(istBeurteilt(g)).toBe(true);
    expect(beurteilungText(g, zeit)).toBe('bestätigt <2026-10-20 13:15:00> · Ruben');
  });

  it('kommt ohne Namen aus', () => {
    expect(beurteilungText({ beurteilt_at: '2026-10-20 13:15:00' }, zeit)).toBe(
      'bestätigt <2026-10-20 13:15:00>',
    );
  });
});
