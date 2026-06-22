// frontend/src/command-palette/befehle.test.ts
import { describe, it, expect, vi } from 'vitest';
import { baueBefehle } from './befehle';
import type { BefehlKontext } from './typen';
import type { BenutzerAnzeige, ModulOverride } from '../api/types';

const fuehrungskraft: BenutzerAnzeige = {
  id: 1, anzeigename: 'EL', benutzername: 'el', system_rolle: 'keiner',
  org_rolle: 'fuehrungskraft', aktiv: true, erstellt_at: '',
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
  it('zeigt Admin-Navigation nur für Admins', () => {
    expect(baueBefehle(kontext({ benutzer: admin })).some((x) => x.id === 'nav:benutzer')).toBe(true);
    expect(baueBefehle(kontext({ benutzer: fuehrungskraft })).some((x) => x.id === 'nav:benutzer')).toBe(false);
  });
  it('bietet immer Abmelden + Alle Einsätze', () => {
    const b = baueBefehle(kontext({ einsatzId: null, benutzer: sichter }));
    expect(b.some((x) => x.id === 'nav:abmelden')).toBe(true);
    expect(b.some((x) => x.id === 'nav:einsaetze')).toBe(true);
  });
});
