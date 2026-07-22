import { describe, expect, it } from 'vitest';
import { GLOBAL_KEYS, globalKeys } from './queryKeys';

/**
 * BYTE-PIN (LFH-307): jeder Accessor der `globalKeys`-Factory muss BYTE-IDENTISCH das Literal
 * liefern, das er im Bestand ersetzt.
 *
 * Das ist der Kern der Sicherheitsarchitektur dieser Migration. Ein Query-Key, der sich ändert,
 * BRICHT NICHTS — er trifft still ein anderes Cache-Fach. Es gibt keinen Fehler, keinen roten
 * Test, keinen auffälligen Request; die Komponente lädt einfach neu und eine Invalidierung
 * anderswo läuft ins Leere. Genau deshalb wird hier gegen HANDGESCHRIEBENE Literale geprüft und
 * nicht gegen `GLOBAL_KEYS.x` — sonst prüfte der Test die Konstante gegen sich selbst und wäre
 * gegen eine Umbenennung blind.
 *
 * Die Erwartungswerte unten sind exakt die Strings, die vor der Migration im Code standen
 * (gemessen: 22 Prefixe, 90 Call-Sites).
 */

describe('globalKeys: Byte-Pin gegen die ersetzten Literale (LFH-307)', () => {
  it('Mandant/Organisation', () => {
    expect(globalKeys.einsaetze()).toEqual(['einsaetze']);
    expect(globalKeys.benutzer()).toEqual(['benutzer']);
    expect(globalKeys.organisation()).toEqual(['organisation']);
    expect(globalKeys.orgEinstellungen()).toEqual(['org-einstellungen']);
    expect(globalKeys.orgModulEinstellungen()).toEqual(['org-modul-einstellungen']);
    expect(globalKeys.authProvider()).toEqual(['auth-provider']);
  });

  it('Stammdaten-Kataloge ohne Filter', () => {
    expect(globalKeys.qualifikationen()).toEqual(['qualifikationen']);
    expect(globalKeys.personalStatus()).toEqual(['personal-status']);
    expect(globalKeys.personalVorschlaege()).toEqual(['personal-vorschlaege']);
    expect(globalKeys.fahrzeugStatus()).toEqual(['fahrzeug-status']);
    expect(globalKeys.fahrzeugVorschlaege()).toEqual(['fahrzeug-vorschlaege']);
    expect(globalKeys.materialKategorien()).toEqual(['material-kategorien']);
    expect(globalKeys.einheitTypen()).toEqual(['einheit-typen']);
    expect(globalKeys.etbBausteine()).toEqual(['etb-bausteine']);
    expect(globalKeys.stichwortVorschlaege()).toEqual(['stichwort-vorschlaege']);
  });

  it('Dienstfilter-Listen: barer Prefix UND beide Filter-Fächer', () => {
    expect(globalKeys.personal()).toEqual(['personal']);
    expect(globalKeys.personalListe('alle')).toEqual(['personal', 'alle']);
    expect(globalKeys.personalListe('im-dienst')).toEqual(['personal', 'im-dienst']);
    expect(globalKeys.fahrzeuge()).toEqual(['fahrzeuge']);
    expect(globalKeys.fahrzeugeListe('alle')).toEqual(['fahrzeuge', 'alle']);
    expect(globalKeys.fahrzeugeListe('im-dienst')).toEqual(['fahrzeuge', 'im-dienst']);
    expect(globalKeys.material()).toEqual(['material']);
    expect(globalKeys.materialListe('alle')).toEqual(['material', 'alle']);
    expect(globalKeys.materialListe('im-dienst')).toEqual(['material', 'im-dienst']);
    expect(globalKeys.sprechgruppenAlle()).toEqual(['sprechgruppen', 'alle']);
  });

  it('Karte: barer Prefix und alle sieben Bereiche', () => {
    expect(globalKeys.adminKarte()).toEqual(['admin-karte']);
    expect(globalKeys.karteConfig()).toEqual(['karte-config']);
    for (const b of [
      'katalog',
      'bau-status',
      'offline-karten',
      'baubare-regionen',
      'offline-katalog',
      'offline-vorhandene',
      'online-quellen',
    ] as const) {
      expect(globalKeys.adminKarteBereich(b)).toEqual(['admin-karte', b]);
    }
  });

  it('Fachebenen: drei einfache Quellen + kritis mit BBox', () => {
    expect(globalKeys.fachebene('nina')).toEqual(['fachebene', 'nina']);
    expect(globalKeys.fachebene('dwd')).toEqual(['fachebene', 'dwd']);
    expect(globalKeys.fachebene('pegelonline')).toEqual(['fachebene', 'pegelonline']);
    // `null` ist der Ist-Zustand (useState<string | null>(null)) und MUSS im Key erhalten
    // bleiben — auf `undefined` normalisiert entstünde ein zweites Cache-Fach für denselben
    // Zustand, und der `enabled`-Guard lädt dann gegen einen anderen Key als die Invalidierung.
    expect(globalKeys.fachebeneKritis(null)).toEqual(['fachebene', 'kritis', null]);
    expect(globalKeys.fachebeneKritis('1,2,3,4')).toEqual(['fachebene', 'kritis', '1,2,3,4']);
  });

  it('LEERLAUF-SCHUTZ: die Registry hat die gemessenen 22 Prefixe und keine Dubletten', () => {
    const werte = Object.values(GLOBAL_KEYS);
    expect(werte).toHaveLength(22);
    expect(new Set(werte).size, 'zwei Properties tragen denselben Wire-String').toBe(22);
  });

  it('kollidiert nicht mit den einsatz-scoped Prefixen', async () => {
    // `personal`/`fahrzeuge`/`material`/`sprechgruppen` existieren in BEIDEN Registries als
    // Property-Name — im Wert-Raum aber getrennt (`einsatz-personal` vs. `personal`). Dieser
    // Test hält fest, dass die Trennung im WERT liegt und nicht bloß Konvention ist.
    const { EINSATZ_KEYS } = await import('./queryKeys');
    const doppelt = Object.values(GLOBAL_KEYS).filter((g) =>
      (Object.values(EINSATZ_KEYS) as string[]).includes(g),
    );
    expect(doppelt).toEqual([]);
  });
});
