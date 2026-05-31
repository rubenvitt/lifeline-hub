import { describe, expect, it } from 'vitest';
import { erzeugeTaktischesZeichen } from 'taktische-zeichen-react';
import { baueTzProps, groesseAusLabel } from './taktischesZeichen';

describe('taktischesZeichen', () => {
  it('Einheit: Grundzeichen + Größe aus Label + Org-Default', () => {
    const p = baueTzProps({ objekttyp: 'einheit', einheitTypLabel: 'Gruppe', orgDefault: 'hilfsorganisation' });
    expect(p.grundzeichen).toBe('taktische-formation');
    expect(p.einheit).toBe('gruppe');
    expect(p.organisation).toBe('hilfsorganisation');
  });
  it('Objekt-Override schlägt Org-Default', () => {
    const p = baueTzProps({ objekttyp: 'fahrzeug', organisation: 'feuerwehr', orgDefault: 'hilfsorganisation' });
    expect(p.grundzeichen).toBe('kraftfahrzeug-landgebunden');
    expect(p.organisation).toBe('feuerwehr');
  });
  it('Abschnitt/Führung default fachaufgabe = fuehrung', () => {
    expect(baueTzProps({ objekttyp: 'abschnitt' }).fachaufgabe).toBe('fuehrung');
    expect(baueTzProps({ objekttyp: 'fuehrung' }).grundzeichen).toBe('person');
  });
  it('unbekanntes Größen-Label → keine Größe', () => {
    expect(groesseAusLabel('Sonstige')).toBeUndefined();
  });
  it('erzeugt valides SVG je Objekttyp', () => {
    for (const objekttyp of ['einheit', 'fahrzeug', 'fuehrung', 'abschnitt'] as const) {
      const svg = erzeugeTaktischesZeichen({
        ...baueTzProps({ objekttyp, einheitTypLabel: 'Gruppe', orgDefault: 'hilfsorganisation' }),
        skipFontRegistration: true,
      }).svg.render();
      expect(svg).toContain('<svg');
    }
  });
});
