import { describe, expect, it } from 'vitest';
import { werkzeugZeilen } from './werkzeugZeilen';
import { FREIE_SKIZZE_VORGABEFARBE, ZONE_TYPEN } from './zonenStil';
import { parseZeichnenAuftrag } from '../../routing/deeplinks';
import { zeichenAuftragZuEntwurf } from './zeichenAuftrag';

describe('werkzeugZeilen (LLH-1038): Einträge des Werkzeugmenüs aus ZONE_TYPEN', () => {
  const zeilen = werkzeugZeilen(ZONE_TYPEN);
  const zeile = (typ: string) => zeilen.find((z) => z.typ === typ)!;

  it('eine Zeile je Zonentyp, in der Reihenfolge des Katalogs', () => {
    expect(zeilen.map((z) => z.typ)).toEqual(ZONE_TYPEN.map((t) => t.typ));
  });

  it('eine Flächenart: Hauptknopf Fläche mit dem Typnamen, daneben „Kreis“', () => {
    const z = zeile('absperrbereich');
    expect(z.haupt).toEqual({
      name: 'Absperrbereich',
      text: 'Absperrbereich',
      entwurf: { typ: 'absperrbereich', modus: 'polygon' },
    });
    expect(z.weitere).toEqual([
      {
        name: 'Absperrbereich als Kreis',
        text: 'Kreis',
        entwurf: { typ: 'absperrbereich', modus: 'kreis' },
      },
    ]);
  });

  it('eine Linienart: nur die Linie, kein Kreis', () => {
    const z = zeile('absperrgrenze');
    expect(z.haupt.entwurf).toEqual({ typ: 'absperrgrenze', modus: 'linie' });
    expect(z.weitere).toEqual([]);
  });

  it('die freie Skizze: Fläche vorn, Linie und Kreis daneben, jede mit der Vorgabefarbe', () => {
    const z = zeile('freie_skizze');
    expect(z.haupt.name).toBe('Freie Skizze');
    expect(z.haupt.entwurf).toEqual({
      typ: 'freie_skizze',
      modus: 'polygon',
      farbe: FREIE_SKIZZE_VORGABEFARBE,
    });
    expect(z.weitere.map((f) => [f.name, f.text, f.entwurf.modus, f.entwurf.farbe])).toEqual([
      ['Freie Skizze als Linie', 'Linie', 'linie', FREIE_SKIZZE_VORGABEFARBE],
      ['Freie Skizze als Kreis', 'Kreis', 'kreis', FREIE_SKIZZE_VORGABEFARBE],
    ]);
  });

  it('jede Flächenart trägt genau einen Kreis, keine Linienart einen', () => {
    for (const t of ZONE_TYPEN) {
      const kreise = zeile(t.typ).weitere.filter((f) => f.entwurf.modus === 'kreis');
      expect(kreise, t.typ).toHaveLength(t.geometrie === 'LineString' ? 0 : 1);
    }
  });

  it('ein neuer Zonentyp erscheint ohne Änderung am Menü', () => {
    const neu = werkzeugZeilen([
      ...ZONE_TYPEN,
      { typ: 'gefahrengebiet', label: 'Probe', geometrie: 'LineString' },
    ]);
    expect(neu[neu.length - 1].haupt.name).toBe('Probe');
  });

  // Der Hauptknopf ist derselbe Start wie der Deeplink ohne Form (Spec „Zeichnen per Link“).
  it('der Hauptknopf startet dasselbe wie der Link ohne Form', () => {
    for (const t of ZONE_TYPEN) {
      const auftrag = parseZeichnenAuftrag(t.typ);
      expect(auftrag, t.typ).not.toBeNull();
      expect(zeichenAuftragZuEntwurf(auftrag!), t.typ).toEqual(zeile(t.typ).haupt.entwurf);
    }
  });
});
