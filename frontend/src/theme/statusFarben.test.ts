import { describe, expect, it } from 'vitest';
import { theme } from 'antd';
import * as sf from './statusFarben';
import { antdToken, farbenDunkel, farbenHell, type Farbrollen } from './tokens';
import type { MaterialStatus } from '../api/types';

/** Vollständiger GlobalToken eines Modus — dieselbe Ableitung wie im `ThemeModeProvider`,
 *  damit der Test die echte Kette Rolle → antd-Token prüft und nicht ein Stück davon. */
function tokenFuer(farben: Farbrollen, dunkel: boolean) {
  return theme.getDesignToken({
    algorithm: dunkel ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: antdToken(farben),
  });
}

const hellToken = tokenFuer(farbenHell, false);
const dunkelToken = tokenFuer(farbenDunkel, true);
const ALLE_ROLLEN: sf.Statusrolle[] = ['alarm', 'achtung', 'normal', 'neutral', 'bedien', 'marke'];

/** Bewusst AUS DEM MODUL abgeleitet statt handgepflegt: eine handgeschriebene Liste
 *  ließe eine zusätzliche Map still am Kanal-Test vorbeilaufen. Die Zahl unten ist der
 *  Wächter — kommt ein Enum dazu, wird sie laut, statt dass die Abdeckung schrumpft. */
const ALLE_MAPS = Object.fromEntries(
  Object.entries(sf).filter(
    ([, wert]) =>
      !!wert &&
      typeof wert === 'object' &&
      Object.values(wert).every((e) => !!e && typeof e === 'object' && 'rolle' in e),
  ),
) as Record<string, Record<string, sf.StatusDarstellung>>;

describe('Statusfarb-Vertrag', () => {
  it('deckt alle dreizehn Vertrags-Enums ab — eine weitere Map rutscht nicht still durch', () => {
    expect(Object.keys(ALLE_MAPS).sort()).toEqual([
      'belegungsArt',
      'brStatus',
      'etbTyp',
      'materialStatus',
      'personStatus',
      'schadenAusmass',
      'schadenStatus',
      'statusKategorie',
      'uhsStatus',
      'uhsTyp',
      'verfuegbarkeit',
      'warnstufeKarte',
      'warnstufeKennzahl',
    ]);
  });

  it('gibt jedem Eintrag einen zweiten Kanal (WCAG 1.4.1)', () => {
    for (const [name, map] of Object.entries(ALLE_MAPS)) {
      for (const [schluessel, d] of Object.entries(map)) {
        expect(d.label, `${name}.${schluessel} ohne Text`).toBeTruthy();
        expect(d.label.trim(), `${name}.${schluessel} nur Leerraum`).not.toBe('');
      }
    }
  });

  it('hält die zwei Warnstufen-Lesarten getrennt — der Widerspruch ist benannt, nicht zufällig', () => {
    expect(sf.warnstufeKarte.keine.rolle).toBe('alarm');
    expect(sf.warnstufeKennzahl.keine.rolle).toBe('normal');
  });

  it('nutzt keine gesättigte Farbe für den Normalzustand (ASM, A1 Festlegung 5)', () => {
    expect(sf.uhsStatus.aktiv.rolle).toBe('normal');
    expect(sf.statusKategorie.verfuegbar.rolle).toBe('normal');
  });

  it('löst die Divergenz `gebunden` (gold vs. orange) zu EINER Rolle auf', () => {
    expect(sf.statusKategorie.gebunden.rolle).toBe('achtung');
  });

  it('trägt selbst keinen Farbwert — Farben stehen nur in tokens.ts/rollen.css', () => {
    for (const map of Object.values(ALLE_MAPS)) {
      for (const d of Object.values(map)) {
        expect(JSON.stringify(d)).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
      }
    }
  });

  it('übersetzt jede Rolle in einen Farbwert des aktiven Modus', () => {
    for (const rolle of ALLE_ROLLEN) {
      for (const token of [hellToken, dunkelToken]) {
        expect(sf.rollenFarbe(rolle, token), `${rolle} ohne Farbwert`).toMatch(/^(#|rgb)/i);
      }
    }
  });

  // Absichtlich nur Verschiedenheit, nicht Unterscheidbarkeit: `marke` und `alarm` sind
  // beide Rot in anderer Sättigung (A0: „ROT BEDIENT NICHTS" trennt Marke von Gefahr über
  // den Ort, nicht über den Farbton). Den zweiten Kanal trägt `label`, nicht der Abstand.
  it('gibt in BEIDEN Modi keiner Rolle den Farbwert einer anderen', () => {
    for (const token of [hellToken, dunkelToken]) {
      const werte = ALLE_ROLLEN.map((r) => sf.rollenFarbe(r, token).toLowerCase());
      expect(new Set(werte).size).toBe(werte.length);
    }
  });

  it('folgt dem Modus — `marke` hat keinen antd-Token und muss trotzdem umschalten', () => {
    expect(sf.rollenFarbe('marke', hellToken)).toBe(farbenHell.marke);
    expect(sf.rollenFarbe('marke', dunkelToken)).toBe(farbenDunkel.marke);
    expect(sf.rollenFarbe('alarm', hellToken)).not.toBe(sf.rollenFarbe('alarm', dunkelToken));
  });

  it('fällt ohne unsere Tokens auf den Hellmodus zurück, statt zu werfen', () => {
    expect(sf.rollenFarbe('marke', theme.getDesignToken({}))).toBe(farbenHell.marke);
  });
});

describe('Warnstufe als Fläche (LFH-368 · B5h)', () => {
  it('pinnt die zwei neuen Intensitäten byte-genau', () => {
    expect(farbenHell.achtungFuellungStark).toBe('rgba(122, 82, 0, 0.2)');
    expect(farbenHell.alarmFuellungStark).toBe('rgba(176, 35, 24, 0.2)');
    expect(farbenDunkel.achtungFuellungStark).toBe('rgba(245, 185, 66, 0.24)');
    expect(farbenDunkel.alarmFuellungStark).toBe('rgba(255, 122, 127, 0.24)');
  });

  it('nutzt DREI Farbtöne für fünf Stufen — keine sechste Farbe', () => {
    expect(sf.warnstufeFlaeche.keine.fuellung).toBeNull();
    expect(sf.warnstufeFlaeche.niedrig.fuellung).toBe('achtungFuellung');
    expect(sf.warnstufeFlaeche.mittel.fuellung).toBe('achtungFuellungStark');
    expect(sf.warnstufeFlaeche.hoch.fuellung).toBe('alarmFuellung');
    expect(sf.warnstufeFlaeche.akut.fuellung).toBe('alarmFuellungStark');
  });

  it('gibt jeder Stufe einen zweiten Kanal — Text UND Kürzel', () => {
    for (const [stufe, d] of Object.entries(sf.warnstufeFlaeche)) {
      expect(d.label.trim(), `${stufe} ohne Text`).not.toBe('');
      expect(d.kuerzel.trim(), `${stufe} ohne Kürzel`).not.toBe('');
    }
    // Fünf Kürzel, fünf verschiedene — sonst trägt der Kanal nichts.
    const kuerzel = Object.values(sf.warnstufeFlaeche).map((d) => d.kuerzel);
    expect(new Set(kuerzel).size).toBe(kuerzel.length);
  });

  it('folgt dem Modus — genau das konnte `warnstufeFarbe` nicht', () => {
    expect(sf.flaechenFarbe('akut', hellToken)).toBe(farbenHell.alarmFuellungStark);
    expect(sf.flaechenFarbe('akut', dunkelToken)).toBe(farbenDunkel.alarmFuellungStark);
    expect(sf.flaechenFarbe('akut', hellToken)).not.toBe(sf.flaechenFarbe('akut', dunkelToken));
  });

  it('liefert für `keine` eine leere Fläche, keinen Farbwert', () => {
    expect(sf.flaechenFarbe('keine', hellToken)).toBe('transparent');
    expect(sf.flaechenFarbe('keine', dunkelToken)).toBe('transparent');
  });

  it('bleibt wie die Sichtung aus der Rollen-Abdeckung heraus', () => {
    // `warnstufeFlaeche`-Einträge tragen KEIN `rolle`-Feld und werden von `ALLE_MAPS`
    // deshalb nicht erfasst. Das ist Absicht: eine Fläche ist keine Statusrolle, und
    // `StatusDarstellung` hineinzubiegen hätte den Kanal-Vertrag verwässert.
    expect(Object.keys(ALLE_MAPS)).not.toContain('warnstufeFlaeche');
    expect(Object.keys(ALLE_MAPS)).not.toContain('sichtung');
    expect(Object.keys(ALLE_MAPS)).toHaveLength(13);
  });
});

describe('materialStatus', () => {
  // Byte-Pin gegen HANDGESCHRIEBENE Literale, nie gegen die Konstante selbst:
  // sonst prüfte der Test die Karte gegen sich selbst.
  it('bildet alle fünf Wire-Werte auf Rolle und Label ab', () => {
    expect(sf.materialStatus.einsatzbereit).toEqual({ rolle: 'normal', label: 'einsatzbereit' });
    expect(sf.materialStatus.im_einsatz).toEqual({ rolle: 'bedien', label: 'im Einsatz' });
    expect(sf.materialStatus.defekt).toEqual({ rolle: 'alarm', label: 'defekt' });
    expect(sf.materialStatus.verbraucht).toEqual({ rolle: 'alarm', label: 'verbraucht' });
    expect(sf.materialStatus.desinfektion_noetig).toEqual({
      rolle: 'achtung',
      label: 'Desinfektion nötig',
    });
  });

  it('deckt das Enum vollständig ab — eine sechste Variante bricht hier', () => {
    const alle: MaterialStatus[] = [
      'einsatzbereit', 'im_einsatz', 'defekt', 'verbraucht', 'desinfektion_noetig',
    ];
    expect(Object.keys(sf.materialStatus).sort()).toEqual([...alle].sort());
  });

  it('trägt an jedem Wert den zweiten Kanal — zwei Werte teilen sich `alarm`', () => {
    // `defekt` und `verbraucht` sind beide rot. Ohne unterscheidbares Label wäre die
    // Farbe der einzige Kanal, und genau das verbietet WCAG 1.4.1.
    expect(sf.materialStatus.defekt.label).not.toBe(sf.materialStatus.verbraucht.label);
    for (const d of Object.values(sf.materialStatus)) expect(d.label.length).toBeGreaterThan(0);
  });
});

describe('Betroffenen-Farbachsen (LFH-455)', () => {
  it('bewahrt die fachliche Farbsprache als eigene Achse', () => {
    expect(Object.fromEntries(Object.entries(sf.sichtung).map(([k, d]) => [k, d.farbe])))
      .toEqual({ sk1: 'rot', sk2: 'gelb', sk3: 'gruen', sk4: 'blau', tot: 'schwarz', unverletzt: null });
    expect(Object.values(sf.sichtung).every((d) => d.label.trim().length > 0)).toBe(true);
  });
  it('ordnet Schadensstatus und Schadensausmaß ihren Rollen zu', () => {
    expect(sf.schadenStatus).toEqual({
      offen: { label: 'offen', rolle: 'achtung' },
      uebergeben: { label: 'übergeben', rolle: 'bedien' },
      abgeschlossen: { label: 'abgeschlossen', rolle: 'neutral' },
    });
    expect(Object.fromEntries(Object.entries(sf.schadenAusmass).map(([k, d]) => [k, d.rolle])))
      .toEqual({ gering: 'neutral', mittel: 'achtung', gross: 'achtung', katastrophal: 'alarm' });
  });
  it('kennzeichnet Bezüge als Beziehung mit expliziter Beschriftung', () => {
    expect(sf.bezugsDarstellung('UHS Nord')).toEqual({ label: 'UHS Nord', rolle: 'bedien' });
  });
});
