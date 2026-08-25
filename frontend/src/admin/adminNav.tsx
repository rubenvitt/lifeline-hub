import type { ReactElement } from 'react';
// Alle Sektionen bringen ihren `AdminPage`-Rahmen selbst mit (LFH-346 · A3).
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
 * Admin-Nav-Registry (LFH-284): einzige Quelle für die Sidebar-`Menu`-Einträge UND die Routen
 * unter `/admin`. Sektions-Keys sind bewusst stabil (= alte Tab-/Segmented-Keys), damit
 * Bestands-Deep-Links weiterfunktionieren. Pfad-Builder statt inline-Template-Literals.
 */

export interface AdminSektion {
  key: string;
  label: string;
  /**
   * Ein ELEMENT, nicht `ReactNode`: jeder Eintrag hier ist eins, und nur so lässt sich die
   * Sektion in einem Test rendern, ohne den Typ von Hand aufzuweiten (LFH-346 · A3).
   * `ReactElement` ist Teilmenge von `ReactNode` — für `App.tsx` ändert sich nichts.
   */
  element: ReactElement;
}

export interface AdminGruppe {
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
       * Die Stammdaten-Tabs wurden bis LFH-346 · A3 hier von `stammdatenSektion()` in
       * `<AdminPage titel={label}>` gewickelt — und konnten deshalb weder den `aktionen`-
       * noch den `hinweis`-Slot erreichen (Befund M46). Nur die Sektion weiß, WAS ihre
       * Primäraktion ist und OB sie gerade gesperrt gehört; ein Wrapper von außen kann den
       * Slot nicht füllen, und ein durchgereichter Context wäre ein neuer Mechanismus für
       * einen Fall, den die Karten- und Einstellungssektionen daneben längst lösen.
       *
       * Der Preis ist eine Dopplung: der Titel steht in der Registry (`label`, fürs Menü)
       * UND in der Sektion (`titel`, für den Kopf). Sie war bei den fünf selbstwickelnden
       * Sektionen schon da, unbemerkt und ungeprüft — `adminNav.test.tsx` schließt sie jetzt
       * für die elf Stammdaten-Sektionen mit einem Drift-Test.
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
