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
    // LFH-690: NEU, ohne Vorbestand. Das Literal ist trotzdem handgeschrieben: Verwaltung,
    // Menü und Einsatzliste lesen denselben Status, und die Invalidierung nach Import und
    // Entfernen trifft ihn über diesen Key. Ein still umbenanntes Fach ließe Menü und
    // Hinweis nach dem Import auf dem alten Stand stehen, ohne dass etwas rot wird.
    expect(globalKeys.demoDaten()).toEqual(['demo-daten']);
    // LFH-23: NEU, ohne Vorbestand. Übersicht, Akte und Archiv-ETB hängen unter EINEM
    // Prefix, damit Wiederherstellen und Friständerung sie mit einem Invalidate treffen. Ein
    // still umbenanntes Fach ließe die Übersicht nach dem Wiederherstellen auf „vorgemerkt“
    // stehen, ohne dass etwas rot wird.
    expect(globalKeys.aufbewahrung()).toEqual(['aufbewahrung']);
    expect(globalKeys.aufbewahrungAkte(7)).toEqual(['aufbewahrung', 'akte', 7]);
    expect(globalKeys.aufbewahrungEtb(7, undefined)).toEqual(['aufbewahrung', 'etb', 7, 'alle']);
    expect(globalKeys.aufbewahrungEtb(7, 'system')).toEqual(['aufbewahrung', 'etb', 7, 'system']);
    // LFH-391 · Etappe D: NEU, deshalb ohne Vorbestand — das Literal ist trotzdem
    // handgeschrieben und nicht aus `GLOBAL_KEYS` gelesen. Der Pin schuetzt hier nicht vor
    // einer Umbenennung des Bestands, sondern vor der stillen Umbenennung DIESES Fachs:
    // der Stand liegt serverseitig unter einem festen Schluessel, ein anderer Query-Key
    // traefe ein leeres Cache-Fach, und das Gedaechtnis waere nach dem Neuladen leer, ohne
    // dass irgendetwas rot wird.
    expect(globalKeys.benutzerEinstellungenVon(7)).toEqual(['benutzer-einstellungen', 7]);
    // Ohne Sitzung ist das Fach adressierbar, aber leer — die Abfrage ist dann abgeschaltet.
    expect(globalKeys.benutzerEinstellungenVon(null)).toEqual(['benutzer-einstellungen', null]);
    // ZWEI Benutzer, ZWEI Fächer. Das ist der Befund, gegen den der Key parametrisiert wurde:
    // ein prozessweiter QueryClient überlebt den Schichtwechsel ohne Neuladen.
    expect(globalKeys.benutzerEinstellungenVon(1)).not.toEqual(
      globalKeys.benutzerEinstellungenVon(2),
    );
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

  it('Fachebenen: einfache Quellen + kritis und energie mit BBox', () => {
    expect(globalKeys.fachebene('nina')).toEqual(['fachebene', 'nina']);
    expect(globalKeys.fachebene('dwd')).toEqual(['fachebene', 'dwd']);
    expect(globalKeys.fachebene('pegelonline')).toEqual(['fachebene', 'pegelonline']);
    expect(globalKeys.fachebene('hochwasser')).toEqual(['fachebene', 'hochwasser']);
    expect(globalKeys.fachebene('odl')).toEqual(['fachebene', 'odl']);
    // `null` ist der Ist-Zustand (useState<string | null>(null)) und MUSS im Key erhalten
    // bleiben — auf `undefined` normalisiert entstünde ein zweites Cache-Fach für denselben
    // Zustand, und der `enabled`-Guard lädt dann gegen einen anderen Key als die Invalidierung.
    expect(globalKeys.fachebeneKritis(null)).toEqual(['fachebene', 'kritis', null]);
    expect(globalKeys.fachebeneKritis('1,2,3,4')).toEqual(['fachebene', 'kritis', '1,2,3,4']);
    // LFH-81: dieselbe Form wie KRITIS, eigenes Fach je Quelle. Kein neuer Prefix — die
    // Zählung im Leerlauf-Schutz unten blieb deshalb bei 23 (heute 24, s. u.).
    expect(globalKeys.fachebeneEnergie(null)).toEqual(['fachebene', 'energie', null]);
    expect(globalKeys.fachebeneEnergie('1,2,3,4')).toEqual(['fachebene', 'energie', '1,2,3,4']);
    // Der bbox-lose Accessor ist für bbox-Quellen gesperrt, sonst entstünden zwei Fächer
    // für denselben Zustand. Die Sperre ist ein Typ, der Test hält sie über `tsc` fest.
    // @ts-expect-error — 'energie' ist aus `fachebene` ausgenommen (nur `fachebeneEnergie`)
    expect(globalKeys.fachebene('energie')).toEqual(['fachebene', 'energie']);
  });

  // 23 → 24 mit `demo-daten` (LFH-690, Status der Demo-Daten je Organisation),
  // 24 → 25 mit `aufbewahrung` (LFH-23, Archiv des Org-Admins).
  it('LEERLAUF-SCHUTZ: die Registry hat die gemessenen 25 Prefixe und keine Dubletten', () => {
    const werte = Object.values(GLOBAL_KEYS);
    expect(werte).toHaveLength(25);
    expect(new Set(werte).size, 'zwei Properties tragen denselben Wire-String').toBe(25);
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
