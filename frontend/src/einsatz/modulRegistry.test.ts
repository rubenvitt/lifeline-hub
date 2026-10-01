import { describe, expect, it } from 'vitest';
import {
  modulRegistry,
  kategorien,
  moduleNachKategorie,
  istModulGesperrt,
  istModulSichtbar,
  istModulAusblendbar,
  redirectZiel,
  modulZielRoute,
  aufloeseStandardModul,
  erstesFreigegebenesModul,
  modulZuRoute,
  modulAusPfad,
  istKeyFreigegeben,
  istModulFreigegeben,
  type ModulEintrag,
} from './modulRegistry';
import { freigabenFixture } from '../test/fixtures';

const offen: ModulEintrag = {
  key: 'x',
  kategorie: 'erfassung',
  label: 'X',
  icon: modulRegistry[0].icon,
  route: 'x',
  status: 'geplant',
};

describe('modulRegistry', () => {
  it('enthaelt das fertige ETB-Modul in der Kategorie Erfassung', () => {
    const etb = modulRegistry.find((m) => m.key === 'etb');
    expect(etb).toBeDefined();
    expect(etb?.status).toBe('fertig');
    expect(etb?.kategorie).toBe('erfassung');
    expect(etb?.route).toBe('etb');
  });

  it('führt Betreuung in der Erfassung direkt nach den Unfallhilfsstellen (LFH-639)', () => {
    // Reihenfolge-Pin: dieselbe Folge wie `MODUL_KEYS` im Backend (`src/einsatz/modul.rs`).
    expect(moduleNachKategorie('erfassung').map((m) => m.key)).toEqual([
      'etb',
      'personen',
      'unfallhilfsstellen',
      'betreuung',
      'tiere',
      'schaeden',
    ]);
    const betreuung = modulRegistry.find((m) => m.key === 'betreuung');
    expect(betreuung).toMatchObject({
      kategorie: 'erfassung',
      label: 'Betreuung',
      route: 'betreuung',
      status: 'fertig',
      // Ohne Zählerquelle fände `darfZaehlerZeigen('betreuung', …)` kein Modul, Zähler und Kennzahl
      // blieben aus.
      zaehlerQuelle: 'betreuung',
    });
    expect(typeof betreuung?.icon).toBe('function');
    expect(betreuung?.beschreibung?.trim()).toBeTruthy();
  });

  it('liefert jede Kategorie aus der Reihenfolge mit mindestens einem Modul', () => {
    for (const k of kategorien) {
      expect(moduleNachKategorie(k.key).length).toBeGreaterThan(0);
    }
  });

  it('moduleNachKategorie filtert nach Kategorie', () => {
    expect(moduleNachKategorie('erfassung').every((m) => m.kategorie === 'erfassung')).toBe(true);
  });

  it('istModulAusblendbar: Stammdaten + Einstellungen nicht ausblendbar', () => {
    expect(istModulAusblendbar('einsatzdaten')).toBe(false);
    expect(istModulAusblendbar('einsatz-einstellungen')).toBe(false);
    expect(istModulAusblendbar('etb')).toBe(true);
  });

  // --- Freigaben des Servers (LFH-669): der Client rechnet keine Rolle nach ---

  const fertig: ModulEintrag = { ...offen, status: 'fertig' };

  it('istModulGesperrt: folgt allein `zugriff` des Servers', () => {
    expect(istModulGesperrt(offen, freigabenFixture({ x: { zugriff: false } }))).toBe(true);
    expect(istModulGesperrt(offen, freigabenFixture({ x: { zugriff: true } }))).toBe(false);
  });

  it('istModulGesperrt: unbekannte Freigaben sperren die Navigation nicht (kein Flackern)', () => {
    expect(istModulGesperrt(offen, undefined)).toBe(false);
  });

  it('istModulSichtbar: folgt allein `sichtbar` des Servers', () => {
    expect(istModulSichtbar(offen, freigabenFixture({ x: { sichtbar: false } }))).toBe(false);
    expect(istModulSichtbar(offen, freigabenFixture({ x: { sichtbar: true } }))).toBe(true);
    expect(istModulSichtbar(offen, undefined)).toBe(true);
  });

  it('istModulFreigegeben: fertig, sichtbar und Zugriff', () => {
    expect(istModulFreigegeben(fertig, freigabenFixture({ x: {} }))).toBe(true);
    expect(istModulFreigegeben(fertig, freigabenFixture({ x: { zugriff: false } }))).toBe(false);
    expect(istModulFreigegeben(fertig, freigabenFixture({ x: { sichtbar: false } }))).toBe(false);
    // Nicht fertig bleibt zu, auch wenn der Server Zugriff gibt.
    expect(istModulFreigegeben(offen, freigabenFixture({ x: {} }))).toBe(false);
  });

  it('istModulFreigegeben: ausgeblendet bleibt zu, auch wenn der Server (Admin) Zugriff gibt', () => {
    expect(
      istModulFreigegeben(fertig, freigabenFixture({ x: { sichtbar: false, zugriff: true } })),
    ).toBe(false);
  });

  it('istModulFreigegeben: unbekannte Freigaben geben nichts frei — keine Anfrage auf Verdacht', () => {
    expect(istModulFreigegeben(fertig, undefined)).toBe(false);
    // Bekannte Freigaben ohne Eintrag für den Key: ebenso zu.
    expect(istModulFreigegeben(fertig, {})).toBe(false);
  });

  it('redirectZiel: der Führungsüberblick ist die Startseite (Neuentwurf, 21.09.2026)', () => {
    expect(redirectZiel(modulRegistry)).toBe('ueberblick');
  });

  it('redirectZiel: Fallback ETB solange der Überblick nicht fertig ist', () => {
    const ohneFertigenUeberblick = modulRegistry.map((m) =>
      m.key === 'ueberblick' ? { ...m, status: 'geplant' as const } : m,
    );
    expect(redirectZiel(ohneFertigenUeberblick)).toBe('etb');
  });

  /**
   * Modulstruktur: Führung trägt Überblick und Aufträge, das Meldebild steht vorn unter Kräfte &
   * Mittel, Lage führt keine Kräfteübersicht. Die Reihenfolge ist die Rangfolge von
   * `erstesFreigegebenesModul`.
   */
  it('Modulstruktur: Führung, Kräfte-Kopf, Lage ohne Meldebild', () => {
    expect(moduleNachKategorie('fuehrung').map((m) => m.key)).toEqual([
      'ueberblick',
      'einsatzdaten',
      'einsatzabschnitte',
      'auftraege',
      'stab',
      'dokumente',
    ]);
    const kraefte = moduleNachKategorie('kraefte');
    expect(kraefte[0].key).toBe('kraefteuebersicht');
    expect(kraefte[0].label).toBe('Meldebild');
    // Route bleibt — Deeplinks und gespeicherte Standard-Module tragen weiter.
    expect(kraefte[0].route).toBe('kraefteuebersicht');
    expect(moduleNachKategorie('lage').map((m) => m.key)).not.toContain('kraefteuebersicht');
    expect(moduleNachKategorie('kommunikation').map((m) => m.key)).not.toContain('auftraege');
  });

  it('Kategorien: Kurzetikett je Kategorie, nur Einstellungen steht am Rail-Fuß', () => {
    expect(kategorien.map((k) => k.kurz)).toEqual([
      'Führung',
      'Kräfte',
      'Erfassung',
      'Lage',
      'Komm.',
      'Einst.',
    ]);
    expect(kategorien.filter((k) => k.fuss).map((k) => k.key)).toEqual(['einstellungen']);
  });

  it('aufloeseStandardModul: liefert Route eines fertigen Standard-Moduls', () => {
    expect(aufloeseStandardModul('etb')).toBe('etb');
  });

  it('aufloeseStandardModul: Fallback auf redirectZiel bei null', () => {
    expect(aufloeseStandardModul(null)).toBe(redirectZiel());
  });

  it('aufloeseStandardModul: Fallback bei unbekanntem Modul-Key', () => {
    expect(aufloeseStandardModul('gibtsnicht')).toBe(redirectZiel());
  });

  /**
   * Die Statusachse wird gegen einen STUB-Register geprüft: `aufloeseStandardModul` nimmt ihn als
   * Argument, und im Bestand gibt es kein `wip`-Modul mehr, an dem ein Test hängen könnte.
   */
  it('aufloeseStandardModul: Fallback bei nicht-fertigem Modul (wip)', () => {
    const stub: ModulEintrag[] = [
      {
        key: 'fertig-modul',
        kategorie: 'lage',
        label: 'F',
        icon: () => null,
        route: 'f',
        status: 'fertig',
      },
      {
        key: 'wip-modul',
        kategorie: 'fuehrung',
        label: 'W',
        icon: () => null,
        route: 'w',
        status: 'wip',
      },
    ];
    expect(aufloeseStandardModul('wip-modul', stub)).toBe(redirectZiel(stub));
    // Gegenprobe: ein FERTIGES Modul wird auf seine Route aufgelöst — sonst wäre der Test auch grün,
    // wenn die Funktion pauschal auf `redirectZiel` fiele.
    expect(aufloeseStandardModul('fertig-modul', stub)).toBe('f');
  });

  it('aufloeseStandardModul: nutzt modulZielRoute (key!=route, z.B. gefahrenzonen)', () => {
    expect(aufloeseStandardModul('gefahrenzonen')).toBe('gefahren');
  });

  it('fahrzeuge ist fertig, abrollbehaelter ist entfernt', () => {
    const fahrzeuge = modulRegistry.find((m) => m.key === 'fahrzeuge');
    expect(fahrzeuge?.status).toBe('fertig');
    expect(fahrzeuge?.kategorie).toBe('kraefte');
    expect(modulRegistry.find((m) => m.key === 'abrollbehaelter')).toBeUndefined();
  });

  it('personal ist fertig in der Kategorie kraefte', () => {
    const personal = modulRegistry.find((m) => m.key === 'personal');
    expect(personal?.status).toBe('fertig');
    expect(personal?.kategorie).toBe('kraefte');
    expect(personal?.route).toBe('personal');
  });

  it('material ist fertig in der Kategorie kraefte', () => {
    const material = modulRegistry.find((m) => m.key === 'material');
    expect(material?.status).toBe('fertig');
    expect(material?.kategorie).toBe('kraefte');
    expect(material?.route).toBe('material');
  });

  it('einheiten und einsatzabschnitte sind fertig', () => {
    const einheiten = modulRegistry.find((m) => m.key === 'einheiten');
    const abschnitte = modulRegistry.find((m) => m.key === 'einsatzabschnitte');
    expect(einheiten?.status).toBe('fertig');
    expect(abschnitte?.status).toBe('fertig');
  });

  it('Lageberichte-Modul ist fertig (Kategorie lage)', () => {
    const lb = modulRegistry.find((m) => m.key === 'lageberichte');
    expect(lb).toBeDefined();
    expect(lb?.status).toBe('fertig');
    expect(lb?.kategorie).toBe('lage');
  });

  it('gefahrenzonen ist eine eigene Seite (kein Deep-Link mehr)', () => {
    const gz = modulRegistry.find((m) => m.key === 'gefahrenzonen');
    expect(gz).toBeDefined();
    expect(gz?.kategorie).toBe('lage');
    expect(gz?.status).toBe('fertig');
    // Der Gefahren-Button zeigt die Gefahrenmatrix selbst, nicht die Lagekarte.
    expect(gz?.verweistAuf).toBeUndefined();
    expect(gz?.route).toBe('gefahren');
    expect(modulZielRoute(gz!)).toBe('gefahren');
  });

  it('modulZielRoute: Deep-Link-Ziel hat Vorrang vor der eigenen Route', () => {
    expect(modulZielRoute({ ...offen, route: 'gefahrenzonen', verweistAuf: 'lagekarte' })).toBe(
      'lagekarte',
    );
  });

  it('modulZielRoute: ohne Deep-Link die eigene Route', () => {
    expect(modulZielRoute({ ...offen, route: 'etb' })).toBe('etb');
  });
});

describe('erstesFreigegebenesModul (LFH-337)', () => {
  it('liefert das erste fertige Modul der Kategorie in Registry-Reihenfolge', () => {
    const m = erstesFreigegebenesModul('fuehrung', freigabenFixture());
    expect(m?.kategorie).toBe('fuehrung');
    expect(m?.status).toBe('fertig');
  });

  it('überspringt ausgeblendete Module', () => {
    const m = erstesFreigegebenesModul(
      'kraefte',
      freigabenFixture({ kraefteuebersicht: { sichtbar: false, zugriff: false } }),
    );
    // Konkretes Folgemodul statt bloßer Ungleichheit: ein Resolver, der fälschlich `null`
    // liefert, bestünde `not.toBe(...)` trivial.
    expect(erstesFreigegebenesModul('kraefte', freigabenFixture())?.key).toBe('kraefteuebersicht');
    expect(m?.key).toBe('einheiten');
  });

  it('überspringt gesperrte Module', () => {
    const m = erstesFreigegebenesModul(
      'kraefte',
      freigabenFixture({ kraefteuebersicht: { zugriff: false } }),
    );
    expect(m?.key).toBe('einheiten');
  });

  it('liefert null, solange die Freigaben unbekannt sind', () => {
    expect(erstesFreigegebenesModul('kraefte', undefined)).toBeNull();
  });

  it('liefert null, wenn die Kategorie kein freigegebenes Modul hat', () => {
    // Gegenaussage: der Resolver KANN ablehnen — sonst navigierte der Aufrufer auf `undefined`.
    const nurGeplant: ModulEintrag[] = [
      { key: 'x', kategorie: 'lage', label: 'X', icon: () => null, route: 'x', status: 'geplant' },
    ];
    expect(erstesFreigegebenesModul('lage', freigabenFixture({ x: {} }), nurGeplant)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/** Die Umkehrung Route → Eintrag. */
describe('modulZuRoute / modulAusPfad', () => {
  it('findet den Eintrag zu einem Routen-Segment', () => {
    expect(modulZuRoute('etb')?.key).toBe('etb');
    // Schlüssel und Route fallen NICHT überall zusammen — 'gefahren' ist der Bestandsfall.
    expect(modulZuRoute('gefahren')?.key).toBe('gefahrenzonen');
    expect(modulZuRoute('gefahrenzonen')).toBeNull();
  });

  it('liefert null für Unbekanntes und für nichts', () => {
    expect(modulZuRoute('gibtsnicht')).toBeNull();
    expect(modulZuRoute(undefined)).toBeNull();
    expect(modulZuRoute('')).toBeNull();
  });

  it('liest das Modul-Segment aus dem Pfad, auch auf einer Sub-Route', () => {
    expect(modulAusPfad('/einsaetze/7/etb')?.key).toBe('etb');
    // Die Unterroute des Funkplans markiert den Stab (LFH-548), sie ist kein eigenes Modul.
    expect(modulAusPfad('/einsaetze/7/stab/funkplan')?.key).toBe('stab');
    // Das Segment NACH der Einsatz-ID, nicht das letzte: sonst verlöre eine Unterseite ihr Modul.
    expect(modulAusPfad('/einsaetze/7/unfallhilfsstellen/liste')?.key).toBe('unfallhilfsstellen');
    expect(modulAusPfad('/einsaetze/7/personen/12')?.key).toBe('personen');
  });

  it('liefert null ausserhalb eines Einsatz-Moduls', () => {
    expect(modulAusPfad('/einsaetze/7')).toBeNull();
    expect(modulAusPfad('/einsaetze')).toBeNull();
    expect(modulAusPfad('/profil')).toBeNull();
    // Kein Einsatz-Bereich: sonst gälte `/admin/stammdaten/personal` als Modul „Personal".
    expect(modulAusPfad('/admin/stammdaten/personal')).toBeNull();
  });
});

describe('istKeyFreigegeben (LFH-633)', () => {
  it('Paar: sichtbares Modul ist frei, ausgeblendetes nicht', () => {
    expect(istKeyFreigegeben('wetter-pegel', freigabenFixture())).toBe(true);
    expect(
      istKeyFreigegeben('wetter-pegel', freigabenFixture({ 'wetter-pegel': { sichtbar: false } })),
    ).toBe(false);
  });

  it('Paar: gesperrtes Modul ist nicht frei (Org-Vorgabe, LFH-669)', () => {
    expect(
      istKeyFreigegeben('wetter-pegel', freigabenFixture({ 'wetter-pegel': { zugriff: false } })),
    ).toBe(false);
  });

  it('ein unbekannter Key ist nie frei — kein Link auf ein Modul, das es nicht gibt', () => {
    expect(istKeyFreigegeben('gibt-es-nicht', freigabenFixture({ 'gibt-es-nicht': {} }))).toBe(
      false,
    );
  });
});
