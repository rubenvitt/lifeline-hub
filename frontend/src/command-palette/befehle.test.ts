// frontend/src/command-palette/befehle.test.ts
import { describe, it, expect, vi } from 'vitest';
import { baueBefehle, kuerzelFuerTastaturAktion, tastaturAktionFuerEreignis } from './befehle';
import { GRUPPEN_REIHENFOLGE } from './typen';
import type { BefehlKontext } from './typen';
import type { BenutzerAnzeige, EinsatzAnzeige, ModulOverride, Koordinatenformat } from '../api/types';

const fuehrungskraft: BenutzerAnzeige = {
  id: 1, anzeigename: 'EL', benutzername: 'el', system_rolle: 'keiner',
  org_rolle: 'fuehrungskraft', aktiv: true, erstellt_at: '', totp_aktiviert: false,
};
const sichter: BenutzerAnzeige = { ...fuehrungskraft, id: 2, org_rolle: 'keine' };
const admin: BenutzerAnzeige = { ...fuehrungskraft, id: 3, system_rolle: 'admin' };

/** Vollständiges ModulOverride bauen (alle 6 Pflichtfelder), Default frei+sichtbar. */
function ueberschreibung(felder: Partial<ModulOverride>): ModulOverride {
  return { einsatz_id: 5, modul_key: 'etb', sichtbar: true, benoetigte_rolle: null, geaendert_at: null, geaendert_von: null, ...felder };
}

function kontext(over: Partial<BefehlKontext> = {}): BefehlKontext {
  return {
    einsatzId: 5, benutzer: fuehrungskraft, einsaetze: [], overrides: undefined,
    darfSchreibenImEinsatz: true,
    navigate: vi.fn(), setThemeModus: vi.fn(), setDichte: vi.fn(), setKoordinaten: vi.fn(), logout: vi.fn(),
    ...over,
  };
}

describe('baueBefehle — Module', () => {
  it('listet fertige Module im Einsatz-Kontext und navigiert', () => {
    const k = kontext();
    const b = baueBefehle(k);
    const etb = b.find((x) => x.id === 'modul:etb');
    expect(etb).toBeDefined();
    etb!.ausfuehren();
    expect(k.navigate).toHaveBeenCalledWith('/einsaetze/5/etb');
  });
  it('blendet Module ohne Einsatz-Kontext ganz aus', () => {
    const b = baueBefehle(kontext({ einsatzId: null }));
    expect(b.some((x) => x.gruppe === 'module')).toBe(false);
    expect(b.some((x) => x.gruppe === 'schnellaktionen')).toBe(false);
  });
  it('sperrt rollen-pflichtige Module für Nicht-Berechtigte aus (Override)', () => {
    const overrides = { etb: ueberschreibung({ benoetigte_rolle: 'fuehrungskraft' }) };
    expect(baueBefehle(kontext({ benutzer: fuehrungskraft, overrides })).some((x) => x.id === 'modul:etb')).toBe(true);
    expect(baueBefehle(kontext({ benutzer: sichter, overrides })).some((x) => x.id === 'modul:etb')).toBe(false);
  });
  it('versteckt unsichtbar geschaltete Module für alle (Override)', () => {
    const overrides = { etb: ueberschreibung({ sichtbar: false }) };
    expect(baueBefehle(kontext({ benutzer: fuehrungskraft, overrides })).some((x) => x.id === 'modul:etb')).toBe(false);
  });
});

describe('baueBefehle — Navigation/Berechtigung', () => {
  it('zeigt die Benutzerverwaltung nur für System-Admins', () => {
    expect(baueBefehle(kontext({ benutzer: admin })).some((x) => x.id === 'nav:benutzer')).toBe(true);
    expect(baueBefehle(kontext({ benutzer: fuehrungskraft })).some((x) => x.id === 'nav:benutzer')).toBe(false);
  });
  // LFH-328/M8: vorher hingen auch diese zwei an `system_rolle === 'admin'` allein — eine
  // Führungskraft sah „Verwaltung" in der Topbar und durfte die Route betreten, fand den
  // Eintrag hier aber nicht. Jetzt teilen sich Topbar, Route und Palette `darfVerwaltung`.
  it('zeigt Verwaltung und Stammdaten auch der Führungskraft', () => {
    const b = baueBefehle(kontext({ benutzer: fuehrungskraft }));
    expect(b.some((x) => x.id === 'nav:admin')).toBe(true);
    expect(b.some((x) => x.id === 'nav:stammdaten')).toBe(true);
  });
  it('verbirgt Verwaltung und Stammdaten vor Benutzern ohne Org-Rolle', () => {
    const b = baueBefehle(kontext({ benutzer: sichter }));
    expect(b.some((x) => x.id === 'nav:admin')).toBe(false);
    expect(b.some((x) => x.id === 'nav:stammdaten')).toBe(false);
  });
  it('bietet immer Abmelden + Alle Einsätze', () => {
    const b = baueBefehle(kontext({ einsatzId: null, benutzer: sichter }));
    expect(b.some((x) => x.id === 'nav:abmelden')).toBe(true);
    expect(b.some((x) => x.id === 'nav:einsaetze')).toBe(true);
  });
});

const aktiverEinsatz: EinsatzAnzeige = {
  id: 7, bezeichnung: 'Hochwasser Nord', stichwort: 'THW', status: 'aktiv',
  begonnen_at: '', abgeschlossen_at: null, abgeschlossen_von: null, einsatzart: 'realeinsatz',
  einsatznummer_intern: null, angelegt_at: '', leitstellen_nr: null, einsatzort: null,
  einsatzort_lat: null, einsatzort_lon: null, meldende_stelle: null, sachverhalt: null,
  anzahl_betroffene_initial: null, meine_rolle: 'einsatzleitung', org_id: 1, org_name: 'KV',
};
const beendet: EinsatzAnzeige = { ...aktiverEinsatz, id: 8, bezeichnung: 'Altfall', status: 'abgeschlossen' };

describe('baueBefehle — Schnellaktionen', () => {
  it('verdrahtet die Top-4-Aktionen mit ?neu=1 für Berechtigte', () => {
    const k = kontext();
    const b = baueBefehle(k);
    const person = b.find((x) => x.id === 'aktion:personen');
    expect(person).toBeDefined();
    person!.ausfuehren();
    expect(k.navigate).toHaveBeenCalledWith('/einsaetze/5/personen?neu=1');
    expect(b.map((x) => x.id).filter((id) => id.startsWith('aktion:'))).toEqual(
      ['aktion:personen', 'aktion:etb', 'aktion:unfallhilfsstellen', 'aktion:schaeden'],
    );
  });
  /**
   * Die vier Ziele stammen aus `routing/deeplinks.ts` (LFH-331 · B3), nicht aus einem
   * Vorlagentext von Hand. Der Unterschied ist an EINER Zeile messbar und war ein
   * echter Fehler: die Unfallhilfsstellen liegen unter `/unfallhilfsstellen/liste`,
   * während `/unfallhilfsstellen` auf `UnfallhilfsstellenDefault` zeigt — eine Seite,
   * die `?neu=1` gar nicht liest. Die Schnellaktion lief also ins Leere.
   */
  it('baut die Schnellaktions-Ziele über die Deeplink-Registry (UHS auf die Listenroute)', () => {
    const k = kontext();
    const b = baueBefehle(k);
    for (const [id, ziel] of [
      ['aktion:personen', '/einsaetze/5/personen?neu=1'],
      ['aktion:etb', '/einsaetze/5/etb?neu=1'],
      ['aktion:unfallhilfsstellen', '/einsaetze/5/unfallhilfsstellen/liste?neu=1'],
      ['aktion:schaeden', '/einsaetze/5/schaeden?neu=1'],
    ] as const) {
      b.find((x) => x.id === id)!.ausfuehren();
      expect(k.navigate).toHaveBeenCalledWith(ziel);
    }
  });
  it('folgt dem Modulfilter: versteckte Trägermodule liefern keine Schnellaktion', () => {
    const overrides = { etb: ueberschreibung({ sichtbar: false }) };
    expect(baueBefehle(kontext({ overrides })).some((x) => x.id === 'aktion:etb')).toBe(false);
  });
  it('folgt dem Rollen-Lock: gesperrte Trägermodule liefern keine Schnellaktion', () => {
    const overrides = { etb: ueberschreibung({ benoetigte_rolle: 'fuehrungskraft' }) };
    expect(baueBefehle(kontext({ benutzer: sichter, overrides })).some((x) => x.id === 'aktion:etb')).toBe(false);
    expect(baueBefehle(kontext({ benutzer: fuehrungskraft, overrides })).some((x) => x.id === 'aktion:etb')).toBe(true);
  });
  it('versteckt ALLE Schnellaktionen wenn darfSchreibenImEinsatz=false (Beobachter/abgeschlossen)', () => {
    const b = baueBefehle(kontext({ darfSchreibenImEinsatz: false }));
    expect(b.some((x) => x.id.startsWith('aktion:'))).toBe(false);
    // Modul-Navigation bleibt trotzdem sichtbar
    expect(b.some((x) => x.id === 'modul:etb')).toBe(true);
  });
});

describe('baueBefehle — Einsatz-Wechsel', () => {
  it('listet nur aktive Einsätze', () => {
    const k = kontext({ einsaetze: [aktiverEinsatz, beendet] });
    const b = baueBefehle(k);
    expect(b.some((x) => x.id === 'einsatz:7')).toBe(true);
    expect(b.some((x) => x.id === 'einsatz:8')).toBe(false);
    b.find((x) => x.id === 'einsatz:7')!.ausfuehren();
    expect(k.navigate).toHaveBeenCalledWith('/einsaetze/7');
  });
});

describe('baueBefehle — Schnelleinstellungen', () => {
  it('schaltet Theme und Koordinatensystem', () => {
    const k = kontext();
    const b = baueBefehle(k);
    b.find((x) => x.id === 'theme:dark')!.ausfuehren();
    expect(k.setThemeModus).toHaveBeenCalledWith('dark');
    b.find((x) => x.id === 'koord:mgrs')!.ausfuehren();
    expect(k.setKoordinaten).toHaveBeenCalledWith('mgrs' as Koordinatenformat);
  });

  it('Schnelleinstellung Bediendichte ruft setDichte mit der Stufe', () => {
    // Der zweite Bedienweg neben dem Kopfzeilen-Umschalter (LFH-329 · B1). Er
    // trägt alle drei Stufen: die Kopfzeile legt ihre Umschalter auf schmalem
    // Schirm ab, und ohne diesen Weg wäre die Stufe dann unerreichbar.
    const k = kontext();
    const b = baueBefehle(k);
    for (const id of ['dichte:kompakt', 'dichte:komfortabel', 'dichte:handschuh']) {
      const treffer = b.find((x) => x.id === id);
      expect(treffer, id).toBeDefined();
      expect(treffer!.gruppe, id).toBe('einstellungen');
    }
    b.find((x) => x.id === 'dichte:handschuh')!.ausfuehren();
    expect(k.setDichte).toHaveBeenCalledWith('handschuh');
    // Die Achsen bleiben getrennt: ein Dichte-Befehl rührt das Farbschema nicht an.
    expect(k.setThemeModus).not.toHaveBeenCalled();
  });
});

describe('Tastaturaktionen', () => {
  it.each([
    [{ key: 's', ctrlKey: true, metaKey: false }, 'speichern'],
    [{ key: 'S', ctrlKey: false, metaKey: true }, 'speichern'],
    [{ key: 'Enter', ctrlKey: true, metaKey: false }, 'speichern'],
    [{ key: 'Backspace', ctrlKey: false, metaKey: true }, 'filter-zuruecksetzen'],
    [{ key: 'Escape', ctrlKey: false, metaKey: false }, 'verwerfen'],
    [{ key: 'Enter', ctrlKey: false, metaKey: false }, null],
    [{ key: 'Backspace', ctrlKey: false, metaKey: false }, null],
  ] as const)('ordnet %o der Aktion %s zu', (taste, erwartet) => {
    expect(tastaturAktionFuerEreignis({
      ...taste,
      defaultPrevented: false,
      repeat: false,
    })).toBe(erwartet);
  });

  it('ignoriert bereits behandelte und wiederholte Mutationsereignisse', () => {
    expect(tastaturAktionFuerEreignis({
      key: 's', ctrlKey: true, metaKey: false, defaultPrevented: true, repeat: false,
    })).toBeNull();
    expect(tastaturAktionFuerEreignis({
      key: 's', ctrlKey: true, metaKey: false, defaultPrevented: false, repeat: true,
    })).toBeNull();
  });

  it.each([
    { key: 's', ctrlKey: true, metaKey: false, shiftKey: true },
    { key: 'Enter', ctrlKey: false, metaKey: true, altKey: true },
    { key: 'Backspace', ctrlKey: true, metaKey: false, altKey: true },
    { key: 'Escape', ctrlKey: false, metaKey: false, shiftKey: true },
  ])('ignoriert zusätzliche Shift-/Alt-Modifier: %o', (taste) => {
    expect(tastaturAktionFuerEreignis({
      ...taste,
      defaultPrevented: false,
      repeat: false,
    })).toBeNull();
  });

  it('ignoriert Mutationsereignisse während einer IME-Komposition', () => {
    const ereignis = {
      key: 'Enter', ctrlKey: true, metaKey: false,
      defaultPrevented: false, repeat: false, isComposing: true,
    };
    expect(tastaturAktionFuerEreignis(ereignis)).toBeNull();
  });

  it('liefert plattformgerechte sichtbare Kürzel', () => {
    expect(kuerzelFuerTastaturAktion('speichern', 'Mozilla/5.0 (Macintosh; Intel Mac OS X)'))
      .toBe('⌘ S / ⌘ ↵');
    expect(kuerzelFuerTastaturAktion('speichern', 'Mozilla/5.0 (X11; Linux x86_64)'))
      .toBe('Strg + S / Strg + ↵');
    expect(kuerzelFuerTastaturAktion('verwerfen', 'Mozilla/5.0 (X11; Linux x86_64)'))
      .toBe('Esc');
    expect(kuerzelFuerTastaturAktion('filter-zuruecksetzen', 'Mozilla/5.0 (Macintosh)'))
      .toBe('⌘ ⌫');
  });

  it('erzeugt nur für registrierte Callbacks sichtbare Aktionsbefehle', () => {
    const speichern = vi.fn();
    const filterZuruecksetzen = vi.fn();
    const b = baueBefehle(kontext({
      tastaturAktionen: {
        speichern,
        'filter-zuruecksetzen': filterZuruecksetzen,
      },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
    }));

    const aktionsbefehle = b.filter((x) => x.gruppe === 'aktionen');
    expect(aktionsbefehle.map(({ id, label, kuerzel }) => ({ id, label, kuerzel }))).toEqual([
      { id: 'tastatur:speichern', label: 'Speichern', kuerzel: 'Strg + S / Strg + ↵' },
      { id: 'tastatur:filter-zuruecksetzen', label: 'Filter zurücksetzen', kuerzel: 'Strg + Rücktaste' },
    ]);
    expect(aktionsbefehle.some((x) => x.id === 'tastatur:verwerfen')).toBe(false);

    aktionsbefehle[0].ausfuehren();
    aktionsbefehle[1].ausfuehren();
    expect(speichern).toHaveBeenCalledTimes(1);
    expect(filterZuruecksetzen).toHaveBeenCalledTimes(1);
  });
});

describe('baueBefehle · Gruppenordnung und Zuletzt (LFH-337 · M11/H12)', () => {
  it('ordnet Schnellaktionen VOR Module', () => {
    // Die Aussage hängt an GRUPPEN_REIHENFOLGE, nicht an der Einfügereihenfolge in
    // baueBefehle — geprüft wird deshalb die Konstante.
    const s = GRUPPEN_REIHENFOLGE.indexOf('schnellaktionen');
    const m = GRUPPEN_REIHENFOLGE.indexOf('module');
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(m);
  });

  it('ordnet Zuletzt zwischen Schnellaktionen und Module', () => {
    const s = GRUPPEN_REIHENFOLGE.indexOf('schnellaktionen');
    const z = GRUPPEN_REIHENFOLGE.indexOf('zuletzt');
    const m = GRUPPEN_REIHENFOLGE.indexOf('module');
    expect(s).toBeLessThan(z);
    expect(z).toBeLessThan(m);
  });

  it('baut aus den gemerkten Schlüsseln Zuletzt-Befehle', () => {
    const befehle = baueBefehle({ ...kontext(), einsatzId: 1, zuletztModulKeys: ['etb'] });
    const zuletzt = befehle.filter((b) => b.gruppe === 'zuletzt');
    expect(zuletzt).toHaveLength(1);
    // modulRegistry führt 'etb' unter dem Kürzel-Label 'ETB' (nicht der Beschreibung
    // 'Einsatztagebuch.') — baueBefehle übernimmt `m.label` unverändert.
    expect(zuletzt[0].label).toBe('ETB');
  });

  it('nimmt ein ausgeblendetes Modul NICHT in Zuletzt auf', () => {
    // Die Gegenaussage: ohne sie bliebe die Filterung unbewiesen, und ein entzogenes
    // Modul stünde weiter als Abkürzung in der Palette.
    const befehle = baueBefehle({
      ...kontext(),
      einsatzId: 1,
      zuletztModulKeys: ['etb'],
      overrides: { etb: ueberschreibung({ sichtbar: false }) },
    });
    expect(befehle.filter((b) => b.gruppe === 'zuletzt')).toEqual([]);
  });

  it('nimmt ein rollen-gesperrtes Modul NICHT in Zuletzt auf', () => {
    // Zweiter Freigabe-Filter, unabhängig vom ersten: `istModulSichtbar` und
    // `istModulGesperrt` sind zwei getrennte Prüfungen in `baueBefehle` — ohne diesen
    // Test bliebe unbewiesen, dass die Zuletzt-Schleife BEIDE anwendet.
    const overrides = { etb: ueberschreibung({ benoetigte_rolle: 'fuehrungskraft' }) };
    const befehle = baueBefehle({
      ...kontext(),
      benutzer: sichter,
      einsatzId: 1,
      zuletztModulKeys: ['etb'],
      overrides,
    });
    expect(befehle.filter((b) => b.gruppe === 'zuletzt')).toEqual([]);
  });

  /**
   * Die Palette ist ein Weg der BEWUSSTEN Modulwahl und zeichnet deshalb auf
   * (LFH-337 · Fix-Welle, Befund B4). `baueBefehle` bleibt dabei rein: es ruft nur den
   * injizierten Callback, die `einsatzId`-Bindung und der Speicherzugriff liegen in
   * `useBefehle`.
   */
  it('meldet beim Ausführen eines Modul-Befehls den Besuch, bevor es navigiert', () => {
    const reihenfolge: string[] = [];
    const merkeModulBesuch = vi.fn((key: string) => reihenfolge.push(`merke:${key}`));
    const navigate = vi.fn((p: string) => reihenfolge.push(`nav:${p}`));
    const befehle = baueBefehle({ ...kontext({ navigate }), merkeModulBesuch });

    befehle.find((b) => b.id === 'modul:etb')!.ausfuehren();

    expect(merkeModulBesuch).toHaveBeenCalledWith('etb');
    // Die REIHENFOLGE ist tragend: erst merken, dann navigieren — der Routenwechsel löst
    // den Render aus, der den Speicher wieder liest.
    expect(reihenfolge).toEqual(['merke:etb', 'nav:/einsaetze/5/etb']);
  });

  it('meldet den Besuch auch beim Ausführen eines Zuletzt-Befehls', () => {
    // Zweiter Weg, eigene Schleife — ohne diese Zeile bliebe unbewiesen, dass sie
    // dasselbe tut wie die Modul-Schleife.
    const merkeModulBesuch = vi.fn();
    const befehle = baueBefehle({ ...kontext(), zuletztModulKeys: ['etb'], merkeModulBesuch });

    befehle.find((b) => b.id === 'zuletzt:etb')!.ausfuehren();

    expect(merkeModulBesuch).toHaveBeenCalledWith('etb');
  });

  it('lässt eine Schnellaktion den Besuch NICHT melden', () => {
    // Gegenaussage: eine Schnellaktion („Neue Person erfassen") ist keine Modulwahl,
    // sondern ein Erfassungssprung. Ohne sie wäre „nur Modul- und Zuletzt-Befehle
    // zeichnen auf" unbewiesen.
    const merkeModulBesuch = vi.fn();
    const befehle = baueBefehle({ ...kontext(), merkeModulBesuch });

    befehle.find((b) => b.id === 'aktion:personen')!.ausfuehren();

    expect(merkeModulBesuch).not.toHaveBeenCalled();
  });

  it('vergibt Zuletzt-Befehlen eigene ids, die nicht mit den Modul-Befehlen kollidieren', () => {
    // Dieselbe id zweimal im Baum macht `aria-activedescendant` mehrdeutig und die
    // React-Keys instabil — die Palette rendert dasselbe Modul in ZWEI Gruppen.
    const befehle = baueBefehle({ ...kontext(), einsatzId: 1, zuletztModulKeys: ['etb'] });
    const ids = befehle.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
