import { describe, expect, it } from 'vitest';
import { VORLAGEN, mitteilungVorlage } from './vorlagen';

describe('Pressemitteilungs-Vorlagen (LFH-554)', () => {
  it('Schlüssel und Reihenfolge decken sich mit dem Backend (Drift-Schutz)', () => {
    const schluessel = (v: Parameters<typeof mitteilungVorlage>[0]) =>
      mitteilungVorlage(v)?.abschnitte.map((a) => a.schluessel);
    // Als Literale gegen `src/presse/mitteilung.rs::VORLAGEN`, nicht aus dem Modul abgeleitet.
    expect(schluessel('erstinformation')).toEqual([
      'sachverhalt',
      'massnahmen',
      'hinweise',
      'naechste_information',
      'rueckfragen',
    ]);
    expect(schluessel('folgeinformation')).toEqual([
      'neue_entwicklung',
      'massnahmen',
      'hinweise',
      'naechste_information',
      'rueckfragen',
    ]);
    expect(schluessel('bevoelkerungshinweis')).toEqual([
      'gefahr',
      'gebiet',
      'verhaltenshinweise',
      'weitere_informationen',
    ]);
    expect(schluessel('freitext')).toEqual(['text']);
    expect(VORLAGEN.map((v) => v.schluessel)).toEqual([
      'erstinformation',
      'folgeinformation',
      'bevoelkerungshinweis',
      'freitext',
    ]);
  });

  it('kennt keine Suchhinweis-Vorlage', () => {
    expect(mitteilungVorlage('suchhinweis' as never)).toBeUndefined();
  });
});
