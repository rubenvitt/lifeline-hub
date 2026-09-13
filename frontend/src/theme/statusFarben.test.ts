import { describe, expect, it } from 'vitest';
import { theme } from 'antd';
import * as sf from './statusFarben';
import { antdToken, farbenDunkel, farbenHell, type Farbrollen } from './tokens';
import type { EinsatzStatus, MaterialStatus } from '../api/types';

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
  it('deckt alle fünfzehn Vertragskarten ab — eine weitere Map rutscht nicht still durch', () => {
    // „Karten", nicht „Enums": `dringlichkeit` ist über eine {@link Statusrolle} geschlüsselt
    // und damit die eine Karte, die keine Domänen-Achse beschriftet, sondern die Stufe selbst.
    // Beide Zugänge von LFH-358 stehen hier — sie lagen bis dahin AUSSERHALB und liefen damit
    // an genau dieser Liste vorbei; das war der Befund, nicht die Zahl.
    expect(Object.keys(ALLE_MAPS).sort()).toEqual([
      'belegungsArt',
      'brStatus',
      'dringlichkeit',
      'einsatzStatus',
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
    expect(Object.keys(ALLE_MAPS)).toHaveLength(15);
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
      'einsatzbereit',
      'im_einsatz',
      'defekt',
      'verbraucht',
      'desinfektion_noetig',
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
    expect(Object.fromEntries(Object.entries(sf.sichtung).map(([k, d]) => [k, d.farbe]))).toEqual({
      sk1: 'rot',
      sk2: 'gelb',
      sk3: 'gruen',
      sk4: 'blau',
      tot: 'schwarz',
      unverletzt: null,
    });
    expect(Object.values(sf.sichtung).every((d) => d.label.trim().length > 0)).toBe(true);
  });
  it('ordnet Schadensstatus und Schadensausmaß ihren Rollen zu', () => {
    expect(sf.schadenStatus).toEqual({
      offen: { label: 'offen', rolle: 'achtung' },
      uebergeben: { label: 'übergeben', rolle: 'bedien' },
      abgeschlossen: { label: 'abgeschlossen', rolle: 'neutral' },
    });
    expect(
      Object.fromEntries(Object.entries(sf.schadenAusmass).map(([k, d]) => [k, d.rolle])),
    ).toEqual({ gering: 'neutral', mittel: 'achtung', gross: 'achtung', katastrophal: 'alarm' });
  });
  it('kennzeichnet Bezüge als Beziehung mit expliziter Beschriftung', () => {
    expect(sf.bezugsDarstellung('UHS Nord')).toEqual({ label: 'UHS Nord', rolle: 'bedien' });
  });
});

/**
 * Übernommen aus dem gelöschten `einsatz/einsatzStatus.test.ts` (LFH-358). Die Zuordnung
 * selbst wird hier nicht erfunden, sondern zitiert (A0-Spec §6, Prüflistenzeile 7).
 * Geprüft wird deshalb NICHT „sieht plausibel aus", sondern die drei Eigenschaften, die
 * beim Umzug aus `EinsaetzePage` bzw. beim Heben in den Vertrag verlorengehen könnten.
 */
describe('einsatzStatus (LFH-345 · C10 Befund M14, LFH-358)', () => {
  it('deckt das Enum vollständig ab — eine dritte Variante bricht hier', () => {
    // Die Liste steht als LITERAL da, nicht aus `Object.keys(…)` abgeleitet: sonst prüfte
    // die Zusicherung die Map gegen sich selbst und wäre auch bei einer fehlenden Variante
    // grün. Der `EinsatzStatus[]`-Typ zieht die zweite Hälfte nach — kommt aus dem Codegen
    // ein dritter Wert, bricht schon der Typcheck.
    const alle: EinsatzStatus[] = ['aktiv', 'abgeschlossen'];
    expect(Object.keys(sf.einsatzStatus).sort()).toEqual([...alle].sort());
  });

  it('zeigt ein Wort, nicht den Wire-Wert — genau der gemeldete Mangel', () => {
    // DAS ist die Aussage des Befunds: in zehn Seitenköpfen stand `{einsatz.status}`, also
    // der rohe Enum-String klein geschrieben. Ein `label`, das gleich dem Schlüssel ist,
    // wäre die Rückkehr dorthin — mit dem Unterschied, dass sie dann wie eine gepflegte
    // Beschriftung aussähe.
    for (const [wire, d] of Object.entries(sf.einsatzStatus)) {
      expect(d.label).not.toBe(wire);
    }
    expect(sf.einsatzStatus.aktiv.label).toBe('Aktiv');
    expect(sf.einsatzStatus.abgeschlossen.label).toBe('Abgeschlossen');
  });

  it('trägt die zitierten Rollen — kein erfundener Farbwert', () => {
    expect(sf.einsatzStatus.aktiv.rolle).toBe('normal');
    expect(sf.einsatzStatus.abgeschlossen.rolle).toBe('neutral');
  });
});

describe('dringlichkeit (LFH-395, hierher mit LFH-358)', () => {
  it('bleibt über die drei stufbaren Rollen geschlüsselt, nicht über alle sechs', () => {
    // Die Verengung ist die Zusicherung: `LageDashboardPage` setzt den Schlüssel in einen
    // KLASSENNAMEN (`lfh-plakette--${stufe}`), und `theme/sprache.css` hat genau für diese
    // drei eine Regel. Ein vierter Schlüssel wäre still ungestylt.
    expect(Object.keys(sf.dringlichkeit).sort()).toEqual(['achtung', 'alarm', 'normal']);
  });

  it('trägt den zweiten UND dritten Kanal — Wort und Form, je Stufe verschieden', () => {
    const formen = Object.values(sf.dringlichkeit).map((d) => d.form);
    expect(new Set(formen).size).toBe(formen.length);
    expect(formen).not.toContain(undefined);
    expect(sf.dringlichkeit.alarm.label).toBe('dringend');
  });
});
