// frontend/src/command-palette/befehle.test.ts
import { describe, it, expect, vi } from 'vitest';
import { baueBefehle } from './befehle';
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
    navigate: vi.fn(), setThemeModus: vi.fn(), setKoordinaten: vi.fn(), logout: vi.fn(),
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
});
