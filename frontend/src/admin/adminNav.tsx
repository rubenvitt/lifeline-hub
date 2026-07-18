import type { ReactNode } from 'react';
import AdminPage from '../components/AdminPage';
// Stammdaten-Sektionen (die Tab-Komponenten wrappen sich NICHT selbst in AdminPage).
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
// Einstellungs- + Karten-Sektionen bringen ihren AdminPage-Rahmen selbst mit.
import AnzeigeEinstellungen from '../pages/einstellungen/AnzeigeEinstellungen';
import EinsatzDefaults from '../pages/einstellungen/EinsatzDefaults';
import Anmeldeverfahren from '../pages/einstellungen/Anmeldeverfahren';
import KartenOnlineSektion from '../karten/KartenOnlineSektion';
import KartenOfflineSektion from '../karten/KartenOfflineSektion';

/**
 * Admin-Nav-Registry (LFH-284): einzige Quelle für die Sidebar-`Menu`-Einträge UND die Routen
 * unter `/admin`. Sektions-Keys sind bewusst stabil (= alte Tab-/Segmented-Keys), damit
 * Bestands-Deep-Links weiterfunktionieren. Pfad-Builder statt inline-Template-Literals.
 */

export interface AdminSektion {
  key: string;
  label: string;
  element: ReactNode;
}

export interface AdminGruppe {
  key: string;
  label: string;
  sektionen: AdminSektion[];
}

/** Stammdaten-Tab in den geteilten Seiten-Rahmen wickeln (die Tabs bringen keinen mit). */
function stammdatenSektion(key: string, label: string, tab: ReactNode): AdminSektion {
  return { key, label, element: <AdminPage titel={label}>{tab}</AdminPage> };
}

export const adminGruppen: AdminGruppe[] = [
  {
    key: 'stammdaten',
    label: 'Stammdaten',
    sektionen: [
      stammdatenSektion('stichworte', 'Einsatz-Stichworte', <StichworteTab />),
      stammdatenSektion('fahrzeuge', 'Fahrzeuge', <FahrzeugeTab />),
      stammdatenSektion('material', 'Material', <MaterialTab />),
      stammdatenSektion('status', 'Fahrzeug-Status', <StatusKatalogTab />),
      stammdatenSektion('personal', 'Personal', <PersonalTab />),
      stammdatenSektion('qualifikationen', 'Qualifikationen', <QualifikationenTab />),
      stammdatenSektion('personal-status', 'Personal-Status', <PersonalStatusTab />),
      stammdatenSektion('etb-bausteine', 'ETB-Schnellbausteine', <EtbBausteineTab />),
      stammdatenSektion('einheit-typen', 'Einheitstypen', <EinheitTypenTab />),
      stammdatenSektion('organisation', 'Organisation', <OrganisationTab />),
      stammdatenSektion('sprechgruppen', 'Sprechgruppen', <SprechgruppenTab />),
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

/** `/admin/<gruppe>/<sektion>`. */
export function adminSektionPfad(gruppe: string, sektion: string): string {
  return `/admin/${gruppe}/${sektion}`;
}

/** `/admin/benutzer`. */
export function adminBenutzerPfad(): string {
  return `/admin/${adminBenutzer.key}`;
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
