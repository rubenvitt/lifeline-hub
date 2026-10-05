import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import FahrzeugeTab from '../stammdaten/FahrzeugeTab';
import {
  adminGruppen,
  adminBenutzer,
  adminDemoDaten,
  adminAufbewahrung,
  adminAufbewahrungPfad,
  adminAufbewahrungAktePfad,
  adminSektionPfad,
  adminBenutzerPfad,
  adminDemoDatenPfad,
  defaultAdminPfad,
  ersteSektionPfad,
} from './adminNav';
import { adminFixture } from '../test/fixtures';

describe('adminNav — Pfad-Builder', () => {
  it('baut Sektions- und Benutzer-Pfade', () => {
    expect(adminSektionPfad('stammdaten', 'fahrzeuge')).toBe('/admin/stammdaten/fahrzeuge');
    expect(adminSektionPfad('karten', 'offline')).toBe('/admin/karten/offline');
    expect(adminBenutzerPfad()).toBe('/admin/benutzer');
    expect(adminDemoDatenPfad()).toBe('/admin/demo-daten');
    // Übersicht und Akte mit eigener, neuladefester Adresse.
    expect(adminAufbewahrungPfad()).toBe('/admin/aufbewahrung');
    expect(adminAufbewahrungAktePfad(42)).toBe('/admin/aufbewahrung/42');
  });

  it('Default- und Gruppen-Erst-Pfade', () => {
    expect(defaultAdminPfad()).toBe('/admin/stammdaten/stichworte');
    expect(ersteSektionPfad('einstellungen')).toBe('/admin/einstellungen/anzeige');
    expect(ersteSektionPfad('karten')).toBe('/admin/karten/online');
  });
});

describe('adminNav — Registry', () => {
  /**
   * „Demo-Daten“ und „Aufbewahrung“ sind Sonder-Einträge neben „Benutzer“, NICHT in
   * `adminGruppen`: die Gruppen kennen kein Rollenprädikat, eine Sektion dort sähe jede
   * Führungskraft. Die Zahl 16 ist deshalb eine Aussage. Die Sonder-Einträge sind einzeln
   * gepinnt, samt Eindeutigkeit gegenüber den Gruppen-Keys (gleiche Ebene `/admin/<key>`).
   */
  it('drei Gruppen mit 17 Sektionen gesamt (Stammdaten 12), dazu drei Sonder-Einträge', () => {
    expect(adminGruppen.map((g) => g.key)).toEqual(['stammdaten', 'einstellungen', 'karten']);
    expect(adminGruppen.flatMap((g) => g.sektionen).length).toBe(17);
    expect(adminGruppen.find((g) => g.key === 'stammdaten')!.sektionen.length).toBe(12);
    expect(adminBenutzer.key).toBe('benutzer');
    expect(adminDemoDaten).toEqual({ key: 'demo-daten', label: 'Demo-Daten' });
    // Nur für den System-Admin (die Führungskraft liest die Verwaltung, dieses Archiv nicht).
    expect(adminAufbewahrung).toEqual({ key: 'aufbewahrung', label: 'Aufbewahrung' });
    const ersteEbene = [
      ...adminGruppen.map((g) => g.key),
      adminBenutzer.key,
      adminDemoDaten.key,
      adminAufbewahrung.key,
    ];
    expect(new Set(ersteEbene).size).toBe(ersteEbene.length);
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
 * Titel-Drift: der Titel steht als `label` in der Registry (Menü) UND als `titel` in der
 * Sektion (Seitenkopf). Driftet einer, zeigt die Sidebar einen anderen Namen als die Seite.
 * Gescopt auf die zwölf Stammdaten-Sektionen; alle sechzehn zögen die Queries der Karten- und
 * Einstellungssektionen herein und färbten den Test aus Mock-Gründen rot.
 */
const admin = adminFixture();

/**
 * Alle Abrufe der zwölf Tabs — Pflicht, weil `onUnhandledRequest: 'error'` eine fehlende Route
 * zum Fehler macht. Leere Kataloge reichen: geprüft wird der Seitenkopf.
 */
function stammdatenHandler() {
  server.use(
    meHandler(admin),
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
    http.get('/api/fuehrungsfunktionen', () => HttpResponse.json([])),
    http.get('/api/organisation', () =>
      HttpResponse.json({ id: 1, name: 'Muster', tz_organisation: 'feuerwehr' }),
    ),
  );
}

const STAMMDATEN = adminGruppen.find((g) => g.key === 'stammdaten')!.sektionen;

describe('adminNav — Seitenkopf trägt den Registry-Titel', () => {
  it('deckt alle zwölf Stammdaten-Sektionen ab', () => {
    // Ohne diese Zahl wäre die Schleife darunter auch bei leerer Menge grün.
    expect(STAMMDATEN).toHaveLength(12);
  });

  it.each(STAMMDATEN.map((s) => [s.label, s.element] as const))(
    'Sektion %s trägt ihren Registry-Titel im Seitenkopf',
    async (label, element) => {
      stammdatenHandler();
      // Data Router: Formularseiten tragen den Verlassen-Schutz (`useBlocker`, LFH-979).
      renderMitProviders(element, { datenRouter: true });
      // Der Kopf von `AdminPage` ist ein h1.
      expect(await screen.findByRole('heading', { level: 1, name: label })).toBeInTheDocument();
    },
  );

  it('legt die Primäraktion einer Katalog-Sektion in den Kopf-Slot', async () => {
    stammdatenHandler();
    renderMitProviders(<FahrzeugeTab />);
    const knopf = await screen.findByRole('button', { name: 'Fahrzeug anlegen' });
    /** Nur diese Aussage diskriminiert: „Knopf vor Tabelle" wäre auch ohne Kopf-Slot grün. */
    expect(knopf.closest('[data-lfh="adminpage-aktionen"]')).not.toBeNull();
  });
});
