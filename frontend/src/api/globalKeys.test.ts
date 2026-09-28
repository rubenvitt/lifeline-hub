import { describe, expect, it } from 'vitest';
import { GLOBAL_KEYS, globalKeys } from './queryKeys';

/**
 * BYTE-PIN: jeder Accessor der `globalKeys`-Factory liefert BYTE-IDENTISCH sein Literal. Ein
 * geänderter Query-Key bricht nichts, er trifft still ein anderes Cache-Fach. Deshalb wird gegen
 * HANDGESCHRIEBENE Literale geprüft, nie gegen `GLOBAL_KEYS.x`.
 */

describe('globalKeys: Byte-Pin gegen die ersetzten Literale (LFH-307)', () => {
  it('Mandant/Organisation', () => {
    expect(globalKeys.einsaetze()).toEqual(['einsaetze']);
    expect(globalKeys.benutzer()).toEqual(['benutzer']);
    expect(globalKeys.organisation()).toEqual(['organisation']);
    expect(globalKeys.orgEinstellungen()).toEqual(['org-einstellungen']);
    expect(globalKeys.orgModulEinstellungen()).toEqual(['org-modul-einstellungen']);
    expect(globalKeys.authProvider()).toEqual(['auth-provider']);
    // Verwaltung, Menü und Einsatzliste lesen denselben Status; ein still umbenanntes Fach ließe
    // sie nach dem Import auf dem alten Stand stehen.
    expect(globalKeys.demoDaten()).toEqual(['demo-daten']);
    // Übersicht, Akte und Archiv-ETB hängen unter EINEM Prefix, damit Wiederherstellen und
    // Friständerung sie mit einem Invalidate treffen.
    expect(globalKeys.aufbewahrung()).toEqual(['aufbewahrung']);
    expect(globalKeys.aufbewahrungAkte(7)).toEqual(['aufbewahrung', 'akte', 7]);
    expect(globalKeys.aufbewahrungEtb(7, undefined)).toEqual(['aufbewahrung', 'etb', 7, 'alle']);
    expect(globalKeys.aufbewahrungEtb(7, 'system')).toEqual(['aufbewahrung', 'etb', 7, 'system']);
    // Der Stand liegt serverseitig unter einem festen Schlüssel; ein anderer Query-Key träfe ein
    // leeres Cache-Fach.
    expect(globalKeys.benutzerEinstellungenVon(7)).toEqual(['benutzer-einstellungen', 7]);
    // Ohne Sitzung ist das Fach adressierbar, aber leer; die Abfrage ist dann abgeschaltet.
    expect(globalKeys.benutzerEinstellungenVon(null)).toEqual(['benutzer-einstellungen', null]);
    // ZWEI Benutzer, ZWEI Fächer: ein prozessweiter QueryClient überlebt den Schichtwechsel ohne
    // Neuladen.
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
    // `null` MUSS im Key erhalten bleiben: auf `undefined` normalisiert entstünde ein zweites
    // Cache-Fach, und der `enabled`-Guard lüde gegen einen anderen Key als die Invalidierung.
    expect(globalKeys.fachebeneKritis(null)).toEqual(['fachebene', 'kritis', null]);
    expect(globalKeys.fachebeneKritis('1,2,3,4')).toEqual(['fachebene', 'kritis', '1,2,3,4']);
    // Dieselbe Form wie KRITIS, eigenes Fach je Quelle, kein neuer Prefix.
    expect(globalKeys.fachebeneEnergie(null)).toEqual(['fachebene', 'energie', null]);
    expect(globalKeys.fachebeneEnergie('1,2,3,4')).toEqual(['fachebene', 'energie', '1,2,3,4']);
    // Der bbox-lose Accessor ist für bbox-Quellen gesperrt, sonst entstünden zwei Fächer für
    // denselben Zustand. Die Sperre ist ein Typ, der Test hält sie über `tsc` fest.
    // @ts-expect-error — 'energie' ist aus `fachebene` ausgenommen (nur `fachebeneEnergie`)
    expect(globalKeys.fachebene('energie')).toEqual(['fachebene', 'energie']);
  });

  it('LEERLAUF-SCHUTZ: die Registry hat die gemessenen 25 Prefixe und keine Dubletten', () => {
    const werte = Object.values(GLOBAL_KEYS);
    expect(werte).toHaveLength(25);
    expect(new Set(werte).size, 'zwei Properties tragen denselben Wire-String').toBe(25);
  });

  it('kollidiert nicht mit den einsatz-scoped Prefixen', async () => {
    // Die gleichnamigen Properties beider Registries sind im Wert-Raum getrennt
    // (`einsatz-personal` vs. `personal`); die Trennung liegt im WERT, nicht bloß in Konvention.
    const { EINSATZ_KEYS } = await import('./queryKeys');
    const doppelt = Object.values(GLOBAL_KEYS).filter((g) =>
      (Object.values(EINSATZ_KEYS) as string[]).includes(g),
    );
    expect(doppelt).toEqual([]);
  });
});
