import type { IconType } from 'react-icons';
import {
  TbHierarchy, TbFileDescription, TbSitemap, TbUsers, TbBuildingCommunity,
  TbUsersGroup, TbUser, TbTruck, TbPackages,
  TbClipboardText, TbFirstAidKit, TbPaw, TbHome,
  TbMap2, TbLayoutDashboard, TbReport, TbListDetails, TbAlertTriangle,
  TbMessage, TbMessageCircle, TbBell, TbClipboardList, TbInbox,
  TbSettings,
} from 'react-icons/tb';
import type { BenutzerAnzeige } from '../api/types';

export type ModulStatus = 'fertig' | 'geplant' | 'wip';
export type KategorieKey =
  | 'fuehrung' | 'kraefte' | 'erfassung' | 'lage' | 'kommunikation' | 'einstellungen';
export type BenoetigteRolle = 'admin' | 'fuehrungskraft';

export interface Kategorie {
  key: KategorieKey;
  label: string;
  icon: IconType;
}

export interface ModulEintrag {
  key: string;
  kategorie: KategorieKey;
  label: string;
  icon: IconType;
  /** Relativer Pfad-Abschnitt unter /einsaetze/:id (z. B. 'etb'). */
  route: string;
  status: ModulStatus;
  /** Kurztext für die WIP-/Platzhalter-Seite. */
  beschreibung?: string;
  /** Fehlt sie, ist das Modul für alle frei. */
  benoetigteRolle?: BenoetigteRolle;
}

/** Reihenfolge der Icon-Rail (eine Zeile je Kategorie). */
export const kategorien: Kategorie[] = [
  { key: 'fuehrung', label: 'Führung', icon: TbHierarchy },
  { key: 'kraefte', label: 'Kräfte & Mittel', icon: TbTruck },
  { key: 'erfassung', label: 'Erfassung', icon: TbClipboardText },
  { key: 'lage', label: 'Lage', icon: TbMap2 },
  { key: 'kommunikation', label: 'Kommunikation', icon: TbMessage },
  { key: 'einstellungen', label: 'Einstellungen', icon: TbSettings },
];

export const modulRegistry: ModulEintrag[] = [
  // Führung
  { key: 'einsatzdaten', kategorie: 'fuehrung', label: 'Einsatzdaten', icon: TbFileDescription, route: 'einsatzdaten', status: 'fertig', beschreibung: 'Stammdaten des Einsatzes: Bezeichnung, Stichwort, Zeiten, Leitung.' },
  { key: 'einsatzabschnitte', kategorie: 'fuehrung', label: 'Einsatzabschnitte', icon: TbSitemap, route: 'einsatzabschnitte', status: 'fertig', beschreibung: 'Gliederung des Einsatzes in Abschnitte und Zuordnung von Einheiten.' },
  { key: 'stab', kategorie: 'fuehrung', label: 'Stab', icon: TbBuildingCommunity, route: 'stab', status: 'wip', beschreibung: 'Stabsarbeit (S1–S6). Wird später ausgearbeitet.' },
  // Kräfte & Mittel
  { key: 'einheiten', kategorie: 'kraefte', label: 'Einheiten', icon: TbUsersGroup, route: 'einheiten', status: 'fertig', beschreibung: 'Taktische Einheiten: Führer, Mannschaft, Fahrzeug, Abschnittszuordnung.' },
  { key: 'personal', kategorie: 'kraefte', label: 'Personal', icon: TbUser, route: 'personal', status: 'fertig', beschreibung: 'Im Einsatz aktive Personen aus dem Stammdaten-Pool plus Ad-hoc-Kräfte.' },
  { key: 'fahrzeuge', kategorie: 'kraefte', label: 'Fahrzeuge', icon: TbTruck, route: 'fahrzeuge', status: 'fertig', beschreibung: 'Disponierte Fahrzeuge des Einsatzes.' },
  { key: 'material', kategorie: 'kraefte', label: 'Material', icon: TbPackages, route: 'material', status: 'fertig', beschreibung: 'Material und Verbrauchsgüter im Einsatz.' },
  // Erfassung
  { key: 'etb', kategorie: 'erfassung', label: 'ETB', icon: TbClipboardText, route: 'etb', status: 'fertig', beschreibung: 'Einsatztagebuch.' },
  { key: 'personen', kategorie: 'erfassung', label: 'Personen', icon: TbUsers, route: 'personen', status: 'fertig', beschreibung: 'Ein Personenstamm mit Status-Lebenszyklus (vermisst → betroffen → Patient → verstorben).' },
  { key: 'unfallhilfsstellen', kategorie: 'erfassung', label: 'Unfallhilfsstellen', icon: TbFirstAidKit, route: 'unfallhilfsstellen', status: 'fertig', beschreibung: 'Behandlungs-/Sammelstellen als Örtlichkeiten mit Plätzen, Belegung und Material.' },
  { key: 'tiere', kategorie: 'erfassung', label: 'Tiere', icon: TbPaw, route: 'tiere', status: 'fertig', beschreibung: 'Betroffene Tiere, getrennt vom Personenstamm.' },
  { key: 'sachschaeden', kategorie: 'erfassung', label: 'Sachschäden', icon: TbHome, route: 'sachschaeden', status: 'wip', beschreibung: 'Erfassung von Sachschäden (optional). Wird später ausgearbeitet.' },
  // Lage
  { key: 'lage-dashboard', kategorie: 'lage', label: 'Dashboard', icon: TbLayoutDashboard, route: 'lage-dashboard', status: 'geplant', beschreibung: 'Verdichtete Lageübersicht des Einsatzes.' },
  { key: 'lagekarte', kategorie: 'lage', label: 'Lagekarte', icon: TbMap2, route: 'lagekarte', status: 'geplant', beschreibung: 'Taktische Karte mit Zeichen, Einheiten und Zonen.' },
  { key: 'lageberichte', kategorie: 'lage', label: 'Lageberichte', icon: TbReport, route: 'lageberichte', status: 'geplant', beschreibung: 'Strukturierte Lageberichte.' },
  { key: 'kraefteuebersicht', kategorie: 'lage', label: 'Kräfteübersicht', icon: TbListDetails, route: 'kraefteuebersicht', status: 'geplant', beschreibung: 'Meldebild der eingesetzten Kräfte.' },
  { key: 'gefahrenzonen', kategorie: 'lage', label: 'Gefahren-/Absperrzonen', icon: TbAlertTriangle, route: 'gefahrenzonen', status: 'geplant', beschreibung: 'Gefahren- und Absperrbereiche.' },
  // Kommunikation
  { key: 'chat', kategorie: 'kommunikation', label: 'Chat', icon: TbMessageCircle, route: 'chat', status: 'geplant', beschreibung: 'Einsatzinterner Chat (pro Einsatz, nicht einsatzübergreifend).' },
  { key: 'erinnerungen', kategorie: 'kommunikation', label: 'Erinnerungen', icon: TbBell, route: 'erinnerungen', status: 'geplant', beschreibung: 'Terminierte Erinnerungen.' },
  { key: 'auftraege', kategorie: 'kommunikation', label: 'Aufträge/Befehle', icon: TbClipboardList, route: 'auftraege', status: 'geplant', beschreibung: 'Aufträge und Befehle mit Quittierung.' },
  { key: 'meldungen', kategorie: 'kommunikation', label: 'Meldungen (eingehend)', icon: TbInbox, route: 'meldungen', status: 'geplant', beschreibung: 'Eingehende Meldungen zur Bearbeitung.' },
  // Einstellungen
  { key: 'einsatz-einstellungen', kategorie: 'einstellungen', label: 'Einstellungen', icon: TbSettings, route: 'einstellungen', status: 'geplant', beschreibung: 'Einsatzbezogene Einstellungen.' },
];

export function moduleNachKategorie(kategorie: KategorieKey): ModulEintrag[] {
  return modulRegistry.filter((m) => m.kategorie === kategorie);
}

/** Grundsatz „disabled statt versteckt": liefert, ob das Modul für den Benutzer gesperrt ist. */
export function istModulGesperrt(modul: ModulEintrag, benutzer: BenutzerAnzeige | null): boolean {
  if (!modul.benoetigteRolle) return false;
  const istAdmin = benutzer?.system_rolle === 'admin';
  if (modul.benoetigteRolle === 'admin') return !istAdmin;
  return !(istAdmin || benutzer?.org_rolle === 'fuehrungskraft');
}

/** Ziel der Default-Route /einsaetze/:id: Lage-Dashboard sobald fertig, sonst ETB-Fallback. */
export function redirectZiel(register: ModulEintrag[] = modulRegistry): string {
  const dashboard = register.find((m) => m.key === 'lage-dashboard');
  return dashboard && dashboard.status === 'fertig' ? dashboard.route : 'etb';
}
