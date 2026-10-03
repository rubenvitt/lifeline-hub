import { describe, expect, it } from 'vitest';
import { zeichenAuftragZuEntwurf } from './zeichenAuftrag';
import { FREIE_SKIZZE_VORGABEFARBE, ZONE_TYPEN } from './zonenStil';

describe('zeichenAuftragZuEntwurf (LFH-825)', () => {
  /**
   * Tabelle über ALLE Einträge des Paneels: der Link betritt denselben Modus wie der Knopf. Ein
   * neuer Eintrag in `ZONE_TYPEN` läuft hier ohne Zutun mit.
   */
  it('startet jeden Typ des Paneels in seiner Geometrie', () => {
    for (const t of ZONE_TYPEN) {
      const entwurf = zeichenAuftragZuEntwurf({ typ: t.typ });
      if (t.geometrie === 'beides') {
        expect(entwurf).toEqual({ typ: t.typ, modus: 'polygon', farbe: FREIE_SKIZZE_VORGABEFARBE });
      } else {
        expect(entwurf).toEqual({
          typ: t.typ,
          modus: t.geometrie === 'Polygon' ? 'polygon' : 'linie',
        });
      }
    }
  });

  it('nimmt bei fester Geometrie die passende Form an und verwirft die andere', () => {
    for (const t of ZONE_TYPEN.filter((x) => x.geometrie !== 'beides')) {
      const passend = t.geometrie === 'Polygon' ? 'flaeche' : 'linie';
      const andere = t.geometrie === 'Polygon' ? 'linie' : 'flaeche';
      expect(zeichenAuftragZuEntwurf({ typ: t.typ, form: passend })).toEqual(
        zeichenAuftragZuEntwurf({ typ: t.typ }),
      );
      expect(zeichenAuftragZuEntwurf({ typ: t.typ, form: andere })).toBeNull();
    }
    expect(zeichenAuftragZuEntwurf({ typ: 'absperrgrenze', form: 'flaeche' })).toBeNull();
  });

  it('lässt bei „beides“ die Form wählen', () => {
    expect(zeichenAuftragZuEntwurf({ typ: 'freie_skizze', form: 'flaeche' })).toEqual({
      typ: 'freie_skizze',
      modus: 'polygon',
      farbe: FREIE_SKIZZE_VORGABEFARBE,
    });
    expect(zeichenAuftragZuEntwurf({ typ: 'freie_skizze', form: 'linie' })).toEqual({
      typ: 'freie_skizze',
      modus: 'linie',
      farbe: FREIE_SKIZZE_VORGABEFARBE,
    });
  });

  it('liefert null für einen Typ, den das Paneel nicht kennt', () => {
    // Ein API-Typ, der (noch) keinen Eintrag in `ZONE_TYPEN` hat, wird nur geräumt.
    expect(zeichenAuftragZuEntwurf({ typ: 'unbekannt' as unknown as 'gefahrengebiet' })).toBeNull();
  });
});
