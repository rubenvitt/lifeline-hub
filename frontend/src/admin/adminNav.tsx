import type { ReactElement } from 'react';
import StichworteTab from '../stammdaten/StichworteTab';
import FahrzeugeTab from '../stammdaten/FahrzeugeTab';
import MaterialTab from '../stammdaten/MaterialTab';
import StatusKatalogTab from '../stammdaten/StatusKatalogTab';
import PersonalTab from '../stammdaten/PersonalTab';
import QualifikationenTab from '../stammdaten/QualifikationenTab';
import PersonalStatusTab from '../stammdaten/PersonalStatusTab';
import EtbBausteineTab from '../stammdaten/EtbBausteineTab';
import EinheitTypenTab from '../stammdaten/EinheitTypenTab';
import OrganisationTab from '../stammdaten/OrganisationTab';
import SprechgruppenTab from '../stammdaten/SprechgruppenTab';
import AnzeigeEinstellungen from '../pages/einstellungen/AnzeigeEinstellungen';
import EinsatzDefaults from '../pages/einstellungen/EinsatzDefaults';
import Anmeldeverfahren from '../pages/einstellungen/Anmeldeverfahren';
import KartenOnlineSektion from '../karten/KartenOnlineSektion';
import KartenOfflineSektion from '../karten/KartenOfflineSektion';

/**
 * Admin-Nav-Registry: einzige Quelle für die Sidebar-Einträge UND die Routen unter `/admin`.
 * Sektions-Keys sind stabil, damit Deep-Links weiterfunktionieren.
 */

interface AdminSektion {
  key: string;
  label: string;
  /** Ein ELEMENT, nicht `ReactNode`, damit sich die Sektion im Test rendern lässt. */
  element: ReactElement;
}

interface AdminGruppe {
  key: string;
  label: string;
  sektionen: AdminSektion[];
}

export const adminGruppen: AdminGruppe[] = [
  {
    key: 'stammdaten',
    label: 'Stammdaten',
    sektionen: [
      /**
       * Jede Sektion bringt ihren `AdminPage`-Rahmen selbst mit: nur sie weiß, was ihre Primäraktion
       * ist und ob sie gesperrt gehört. Der Preis ist, dass der Titel doppelt steht (`label` hier,
       * `titel` in der Sektion); `adminNav.test.tsx` fängt Drift für die Stammdaten-Sektionen.
       */
      { key: 'stichworte', label: 'Einsatz-Stichworte', element: <StichworteTab /> },
      { key: 'fahrzeuge', label: 'Fahrzeuge', element: <FahrzeugeTab /> },
      { key: 'material', label: 'Material', element: <MaterialTab /> },
      { key: 'status', label: 'Fahrzeug-Status', element: <StatusKatalogTab /> },
      { key: 'personal', label: 'Personal', element: <PersonalTab /> },
      { key: 'qualifikationen', label: 'Qualifikationen', element: <QualifikationenTab /> },
      { key: 'personal-status', label: 'Personal-Status', element: <PersonalStatusTab /> },
      { key: 'etb-bausteine', label: 'ETB-Schnellbausteine', element: <EtbBausteineTab /> },
      { key: 'einheit-typen', label: 'Einheitstypen', element: <EinheitTypenTab /> },
      { key: 'organisation', label: 'Organisation', element: <OrganisationTab /> },
      { key: 'sprechgruppen', label: 'Sprechgruppen', element: <SprechgruppenTab /> },
    ],
  },
  {
    key: 'einstellungen',
    label: 'Einstellungen',
    sektionen: [
      { key: 'anzeige', label: 'Anzeige', element: <AnzeigeEinstellungen /> },
      { key: 'einsatz', label: 'Einsatz-Defaults', element: <EinsatzDefaults /> },
      { key: 'anmeldung', label: 'Anmeldeverfahren', element: <Anmeldeverfahren /> },
    ],
  },
  {
    key: 'karten',
    label: 'Karten',
    sektionen: [
      { key: 'online', label: 'Online-Quellen', element: <KartenOnlineSektion /> },
      { key: 'offline', label: 'Offline-Karten', element: <KartenOfflineSektion /> },
    ],
  },
];

/** Benutzer-Verwaltung: Sonder-Eintrag (eigene Route, strengeres system_rolle=admin-Gate). */
export const adminBenutzer = { key: 'benutzer', label: 'Benutzer' } as const;

/**
 * Demo-Daten: Sonder-Eintrag neben {@link adminBenutzer}, sichtbar nur für den System-Admin UND
 * bei 200 von `GET /api/demo-daten`. Kein Eintrag in {@link adminGruppen}, deren Sektionen jede
 * Person mit Verwaltungsrecht sieht. Die Seite schützt sich zusätzlich selbst.
 */
export const adminDemoDaten = { key: 'demo-daten', label: 'Demo-Daten' } as const;

/**
 * Aufbewahrung: Sonder-Eintrag nur für den System-Admin (die Führungskraft liest die
 * Verwaltung, dieses Archiv nicht). Die Pfad-Builder liegen hier, weil `routing/deeplinks.ts`
 * nur Einsatz-Pfade trägt.
 */
export const adminAufbewahrung = { key: 'aufbewahrung', label: 'Aufbewahrung' } as const;

/** `/admin/<gruppe>/<sektion>`. */
export function adminSektionPfad(gruppe: string, sektion: string): string {
  return `/admin/${gruppe}/${sektion}`;
}

/** `/admin/benutzer`. */
export function adminBenutzerPfad(): string {
  return `/admin/${adminBenutzer.key}`;
}

/** `/admin/demo-daten`. */
export function adminDemoDatenPfad(): string {
  return `/admin/${adminDemoDaten.key}`;
}

/** `/admin/aufbewahrung` — Übersicht der abgeschlossenen Einsätze. */
export function adminAufbewahrungPfad(): string {
  return `/admin/${adminAufbewahrung.key}`;
}

/** `/admin/aufbewahrung/<einsatzId>` — Archivakte; die stabile DB-`id`, nie die Anzeigenummer. */
export function adminAufbewahrungAktePfad(einsatzId: number): string {
  return `${adminAufbewahrungPfad()}/${einsatzId}`;
}

/** Erste Sektion einer Gruppe — Ziel des Gruppen-Redirects (`/admin/<gruppe>`). */
export function ersteSektionPfad(gruppe: string): string {
  const g = adminGruppen.find((x) => x.key === gruppe);
  return g ? adminSektionPfad(g.key, g.sektionen[0].key) : defaultAdminPfad();
}

/** Default-Ziel für `/admin` (erste Gruppe, erste Sektion). */
export function defaultAdminPfad(): string {
  const g = adminGruppen[0];
  return adminSektionPfad(g.key, g.sektionen[0].key);
}
