import { vi } from 'vitest';
import type { BenutzerAnzeige, EinsatzAnzeige, ModulFreigabe, ModulFreigaben } from '../api/types';
import { modulRegistry } from '../einsatz/modulRegistry';
import type { useAuth } from '../auth/AuthContext';

/**
 * Geteilte Datenfabriken für Tests. Die Vorgaben sind ein neutraler, vollständiger
 * Serverzustand; was ein Test tatsächlich prüft, gehört als Override an den Aufruf.
 */

/** Ein aktiver Realeinsatz, in dem der Benutzer die Einsatzleitung hat. */
export function einsatzFixture(overrides: Partial<EinsatzAnzeige> = {}): EinsatzAnzeige {
  return {
    id: 1,
    bezeichnung: 'Hochwasser',
    stichwort: null,
    status: 'aktiv',
    begonnen_at: '2026-05-29 08:00:00',
    abgeschlossen_at: null,
    abgeschlossen_von: null,
    einsatzart: 'realeinsatz',
    einsatznummer_intern: null,
    angelegt_at: '2026-05-29 08:00:00',
    leitstellen_nr: null,
    einsatzort: null,
    einsatzort_lat: null,
    einsatzort_lon: null,
    meldende_stelle: null,
    sachverhalt: null,
    anzahl_betroffene_initial: null,
    meine_rolle: 'einsatzleitung',
    org_id: 1,
    org_name: 'Org',
    meine_sachgebiete: [],
    lagekennzahlen: [],
    ...overrides,
  };
}

/** Ein aktiver Benutzer ohne System- und Org-Rolle. */
export function benutzerFixture(overrides: Partial<BenutzerAnzeige> = {}): BenutzerAnzeige {
  return {
    id: 1,
    anzeigename: 'Nutzer',
    benutzername: 'nutzer',
    system_rolle: 'keiner',
    org_rolle: 'keine',
    aktiv: true,
    erstellt_at: '2026-05-23 10:00:00',
    totp_aktiviert: false,
    ...overrides,
  };
}

/** Ein System-Admin (admin-global schreibberechtigt). */
export function adminFixture(overrides: Partial<BenutzerAnzeige> = {}): BenutzerAnzeige {
  return benutzerFixture({
    anzeigename: 'Admin',
    benutzername: 'admin',
    system_rolle: 'admin',
    ...overrides,
  });
}

/** Rückgabe eines gemockten `useAuth` mit festem Benutzer und Stub-Aktionen. */
export function authWertFixture(benutzer: BenutzerAnzeige | null): ReturnType<typeof useAuth> {
  return {
    benutzer,
    laedt: false,
    login: vi.fn(),
    logout: vi.fn(),
    aktualisiere: vi.fn(),
    abmeldenLokal: vi.fn(),
    konflikt: null,
  };
}

/**
 * Modulfreigaben wie vom Server (LFH-669): jeder Registry-Key `{ sichtbar: true, zugriff: true }`,
 * einzelne Module per `abweichend` überschrieben — etwa `{ schaeden: { zugriff: false } }`.
 */
export function freigabenFixture(
  abweichend: Record<string, Partial<ModulFreigabe>> = {},
): ModulFreigaben {
  const freigaben: ModulFreigaben = {};
  for (const m of modulRegistry) freigaben[m.key] = { sichtbar: true, zugriff: true };
  for (const [key, teil] of Object.entries(abweichend)) {
    freigaben[key] = { sichtbar: true, zugriff: true, ...teil };
  }
  return freigaben;
}
