import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import FahrzeugeTab from '../stammdaten/FahrzeugeTab';
import {
  adminGruppen,
  adminBenutzer,
  adminSektionPfad,
  adminBenutzerPfad,
  defaultAdminPfad,
  ersteSektionPfad,
} from './adminNav';

describe('adminNav — Pfad-Builder', () => {
  it('baut Sektions- und Benutzer-Pfade', () => {
    expect(adminSektionPfad('stammdaten', 'fahrzeuge')).toBe('/admin/stammdaten/fahrzeuge');
    expect(adminSektionPfad('karten', 'offline')).toBe('/admin/karten/offline');
    expect(adminBenutzerPfad()).toBe('/admin/benutzer');
  });

  it('Default- und Gruppen-Erst-Pfade', () => {
    expect(defaultAdminPfad()).toBe('/admin/stammdaten/stichworte');
    expect(ersteSektionPfad('einstellungen')).toBe('/admin/einstellungen/anzeige');
    expect(ersteSektionPfad('karten')).toBe('/admin/karten/online');
  });
});

describe('adminNav — Registry', () => {
  it('drei Gruppen mit 16 Sektionen gesamt (Stammdaten 11)', () => {
    expect(adminGruppen.map((g) => g.key)).toEqual(['stammdaten', 'einstellungen', 'karten']);
    expect(adminGruppen.flatMap((g) => g.sektionen).length).toBe(16);
    expect(adminGruppen.find((g) => g.key === 'stammdaten')!.sektionen.length).toBe(11);
    expect(adminBenutzer.key).toBe('benutzer');
  });

  it('Sektions-Keys je Gruppe eindeutig; jede Sektion trägt ein Element', () => {
    for (const g of adminGruppen) {
      const keys = g.sektionen.map((s) => s.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const s of g.sektionen) {
        expect(s.element).toBeTruthy();
        expect(typeof s.label).toBe('string');
      }
    }
  });
});

/**
 * Titel-Drift (LFH-346 · A3). Seit `stammdatenSektion()` entfallen ist, steht der Titel
 * ZWEIMAL: als `label` in dieser Registry (fürs Sidebar-Menü) und als `titel` in der
 * Sektion (für den Seitenkopf). Diese Dopplung trugen die fünf selbstwickelnden Sektionen
 * (Karten, Einstellungen) schon vorher — unbemerkt und ungeprüft. Der Guard schließt sie,
 * statt sie um elf Fälle zu vergrößern: driftet der Sektionstitel gegen das Menü-Label,
 * zeigt die Sidebar auf einen anderen Namen als die Seite, ohne dass irgendetwas bricht.
 *
 * GESCOPT auf die elf Stammdaten-Sektionen. Über alle sechzehn zu iterieren zöge die
 * Queries der Karten- und Einstellungssektionen in diese Datei und färbte sie aus
 * Mock-Gründen rot, die mit Titel-Drift nichts zu tun haben.
 */
const admin = {
  id: 1,
  anzeigename: 'Admin',
  benutzername: 'admin',
  system_rolle: 'admin',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-05-26 10:00:00',
};

/**
 * Alle Abrufe der elf Tabs. `onUnhandledRequest: 'error'` (test/setup.ts) macht eine
 * fehlende Route zu einem Fehler statt zu einem stillen Leerlauf — die Liste ist deshalb
 * Pflicht, nicht Bequemlichkeit. Leere Kataloge reichen: geprüft wird der Seitenkopf, den
 * `AdminPage` unabhängig vom Ladezustand rendert.
 */
function stammdatenHandler() {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/fahrzeuge', () => HttpResponse.json([])),
    http.get('/api/fahrzeug-vorschlaege', () =>
      HttpResponse.json({ fahrzeugtyp: [], traegerorganisation: [], standort: [] }),
    ),
    http.get('/api/material', () => HttpResponse.json([])),
    http.get('/api/material-kategorien', () => HttpResponse.json([])),
    http.get('/api/personal', () => HttpResponse.json([])),
    http.get('/api/personal-vorschlaege', () => HttpResponse.json({ traegerorganisation: [] })),
    http.get('/api/personal-status', () => HttpResponse.json([])),
    http.get('/api/qualifikationen', () => HttpResponse.json([])),
    http.get('/api/fahrzeug-status', () => HttpResponse.json([])),
    http.get('/api/etb-bausteine', () => HttpResponse.json([])),
    http.get('/api/einheit-typen', () => HttpResponse.json([])),
    http.get('/api/stichwort-vorschlaege', () => HttpResponse.json([])),
    http.get('/api/sprechgruppen', () => HttpResponse.json([])),
    http.get('/api/organisation', () =>
      HttpResponse.json({ id: 1, name: 'Muster', tz_organisation: 'feuerwehr' }),
    ),
  );
}

const STAMMDATEN = adminGruppen.find((g) => g.key === 'stammdaten')!.sektionen;

describe('adminNav — Seitenkopf trägt den Registry-Titel', () => {
  it('deckt alle elf Stammdaten-Sektionen ab', () => {
    // Ohne diese Zahl wäre die Schleife darunter auch bei leerer Menge grün.
    expect(STAMMDATEN).toHaveLength(11);
  });

  it.each(STAMMDATEN.map((s) => [s.label, s.element] as const))(
    'Sektion %s trägt ihren Registry-Titel im Seitenkopf',
    async (label, element) => {
      stammdatenHandler();
      renderMitProviders(element);
      // Der Kopf von `AdminPage` ist ein level-4-Heading (Dateikopf dort).
      expect(await screen.findByRole('heading', { level: 4, name: label })).toBeInTheDocument();
    },
  );

  it('legt die Primäraktion einer Katalog-Sektion in den Kopf-Slot', async () => {
    stammdatenHandler();
    renderMitProviders(<FahrzeugeTab />);
    const knopf = await screen.findByRole('button', { name: 'Fahrzeug anlegen' });
    /**
     * NUR diese Aussage diskriminiert. Eine Positionsprüfung „Knopf vor Tabelle" wäre eine
     * Attrappe: der Knopf stand VORHER schon über der Tabelle, und der `aktionen`-Slot von
     * `AdminPage` steht ohnehin vor `children` — sie wäre in beiden Bäumen grün.
     */
    expect(knopf.closest('[data-lfh="adminpage-aktionen"]')).not.toBeNull();
  });
});
