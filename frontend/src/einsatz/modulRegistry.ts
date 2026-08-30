import type { IconType } from 'react-icons';
import {
  TbHierarchy, TbFileDescription, TbSitemap, TbUsers, TbBuildingCommunity,
  TbUsersGroup, TbUser, TbTruck, TbPackages,
  TbClipboardText, TbFirstAidKit, TbPaw, TbHome,
  TbMap2, TbLayoutDashboard, TbReport, TbListDetails, TbAlertTriangle,
  TbMessage, TbMessageCircle, TbBell, TbClipboardList, TbInbox,
  TbSettings, TbBuildingWarehouse,
} from 'react-icons/tb';
import type { BenutzerAnzeige, ModulOverrides } from '../api/types';

export type ModulStatus = 'fertig' | 'geplant' | 'wip';
export type KategorieKey =
  | 'fuehrung' | 'kraefte' | 'erfassung' | 'lage' | 'kommunikation' | 'einstellungen';
export type BenoetigteRolle = 'admin' | 'fuehrungskraft';
export type ModulZaehlerQuelle = 'meldungen' | 'auftraege' | 'erinnerungen' | 'chat';

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
  /**
   * Deep-Link: Statt einer eigenen Seite leitet das Modul auf die `route` eines
   * anderen Moduls um (Eintrag bleibt zur Auffindbarkeit in der Navigation).
   * Aktuell von keinem Eintrag genutzt — als generische Infrastruktur für
   * künftige Module erhalten (vgl. LFH-74).
   */
  verweistAuf?: string;
  /** Optionale, berechtigungsgesteuerte Quelle für den neutralen Navigationszähler. */
  zaehlerQuelle?: ModulZaehlerQuelle;
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
  { key: 'bereitstellungsraeume', kategorie: 'kraefte', label: 'Bereitstellungsräume', icon: TbBuildingWarehouse, route: 'bereitstellungsraeume', status: 'fertig', beschreibung: 'Bereitstellungsräume: bereitgestellte Einheiten und Fahrzeuge.' },
  // Erfassung
  { key: 'etb', kategorie: 'erfassung', label: 'ETB', icon: TbClipboardText, route: 'etb', status: 'fertig', beschreibung: 'Einsatztagebuch.' },
  { key: 'personen', kategorie: 'erfassung', label: 'Personen', icon: TbUsers, route: 'personen', status: 'fertig', beschreibung: 'Ein Personenstamm mit Status-Lebenszyklus (vermisst → betroffen → Patient → verstorben).' },
  { key: 'unfallhilfsstellen', kategorie: 'erfassung', label: 'Unfallhilfsstellen', icon: TbFirstAidKit, route: 'unfallhilfsstellen', status: 'fertig', beschreibung: 'Behandlungs-/Sammelstellen als Örtlichkeiten mit Plätzen, Belegung und Material.' },
  { key: 'tiere', kategorie: 'erfassung', label: 'Tiere', icon: TbPaw, route: 'tiere', status: 'fertig', beschreibung: 'Betroffene Tiere, getrennt vom Personenstamm.' },
  { key: 'schaeden', kategorie: 'erfassung', label: 'Schäden', icon: TbHome, route: 'schaeden', status: 'fertig', beschreibung: 'Sach-/Infrastruktur-/Umweltschäden mit Bearbeitungs-Workflow.' },
  // Lage
  { key: 'lage-dashboard', kategorie: 'lage', label: 'Dashboard', icon: TbLayoutDashboard, route: 'lage-dashboard', status: 'fertig', beschreibung: 'Verdichtete Lageübersicht des Einsatzes.' },
  { key: 'lagekarte', kategorie: 'lage', label: 'Lagekarte', icon: TbMap2, route: 'lagekarte', status: 'fertig', beschreibung: 'Karte der verortbaren Objekte: Einsatzort, Unfallhilfsstellen, Schäden — verorten per Klick.' },
  { key: 'lageberichte', kategorie: 'lage', label: 'Lageberichte', icon: TbReport, route: 'lageberichte', status: 'fertig', beschreibung: 'Strukturierte Lageberichte.' },
  { key: 'kraefteuebersicht', kategorie: 'lage', label: 'Kräfteübersicht', icon: TbListDetails, route: 'kraefteuebersicht', status: 'fertig', beschreibung: 'Meldebild der eingesetzten Kräfte.' },
  { key: 'gefahrenzonen', kategorie: 'lage', label: 'Gefahren', icon: TbAlertTriangle, route: 'gefahren', status: 'fertig', beschreibung: 'Gefahrenmatrix (Gefahrentyp × Schutzobjekt → Warnstufe) und Verknüpfung der Gefahrengebiete.' },
  { key: 'lagemeldungen', kategorie: 'lage', label: 'Lagemeldungen', icon: TbInbox, route: 'lagemeldungen', status: 'fertig', beschreibung: 'Lagerelevante Meldungen, die an die Lage übergeben wurden.' },
  // Kommunikation
  { key: 'chat', kategorie: 'kommunikation', label: 'Chat', icon: TbMessageCircle, route: 'chat', status: 'fertig', beschreibung: 'Einsatzinterner Chat (pro Einsatz, nicht einsatzübergreifend).', zaehlerQuelle: 'chat' },
  { key: 'erinnerungen', kategorie: 'kommunikation', label: 'Erinnerungen', icon: TbBell, route: 'erinnerungen', status: 'fertig', beschreibung: 'Terminierte Erinnerungen.', zaehlerQuelle: 'erinnerungen' },
  { key: 'auftraege', kategorie: 'kommunikation', label: 'Aufträge/Befehle', icon: TbClipboardList, route: 'auftraege', status: 'fertig', beschreibung: 'Aufträge und Befehle mit Quittierung.', zaehlerQuelle: 'auftraege' },
  { key: 'meldungen', kategorie: 'kommunikation', label: 'Meldungen (eingehend)', icon: TbInbox, route: 'meldungen', status: 'fertig', beschreibung: 'Eingehende Meldungen zur Bearbeitung.', zaehlerQuelle: 'meldungen' },
  { key: 'nachforderungen', kategorie: 'kommunikation', label: 'Nachforderung', icon: TbPackages, route: 'nachforderungen', status: 'fertig', beschreibung: 'Nachforderung von Kräften/Mitteln bei Leitstelle/Nachbar-EA/übergeordneter Führung mit Status-Workflow.' },
  // Einstellungen
  { key: 'einsatz-einstellungen', kategorie: 'einstellungen', label: 'Einstellungen', icon: TbSettings, route: 'einstellungen', status: 'fertig', beschreibung: 'Einsatzbezogene Einstellungen.' },
];

export function moduleNachKategorie(kategorie: KategorieKey): ModulEintrag[] {
  return modulRegistry.filter((m) => m.kategorie === kategorie);
}

/** Ziel-Route beim Anwählen eines Moduls: Deep-Link-Ziel, sonst die eigene Route. */
export function modulZielRoute(modul: ModulEintrag): string {
  return modul.verweistAuf ?? modul.route;
}

/**
 * Module, die nicht ausgeblendet werden dürfen (Spiegel des Backends
 * `src/einsatz/modul.rs::NICHT_AUSBLENDBAR`): Stammdaten + Einstellungen selbst.
 */
export const NICHT_AUSBLENDBARE_MODULE = ['einsatzdaten', 'einsatz-einstellungen'] as const;

/** Ob ein Modul ausgeblendet werden darf (alle außer den nicht-ausblendbaren). */
export function istModulAusblendbar(key: string): boolean {
  return !(NICHT_AUSBLENDBARE_MODULE as readonly string[]).includes(key);
}

/**
 * Grundsatz „disabled statt versteckt" (Rollen-Schranke): liefert, ob das Modul für
 * den Benutzer rollen-gesperrt ist. Berücksichtigt den Override-Kontext (LFH-132):
 * die effektive benötigte Rolle ist die des Overrides, sonst der Registry-Default.
 * Admin ist nie gesperrt (Admin-Mindest-Guard).
 */
export function istModulGesperrt(
  modul: ModulEintrag,
  benutzer: BenutzerAnzeige | null,
  overrides?: ModulOverrides,
): boolean {
  if (benutzer?.system_rolle === 'admin') return false;
  // Nicht-ausblendbare Module sind nie sperrbar (Selbst-Aussperr-Schutz, beide
  // Dimensionen) — spiegelt das Backend fordere_modul_zugriff.
  if (!istModulAusblendbar(modul.key)) return false;
  const benoetigt = overrides?.[modul.key]?.benoetigte_rolle ?? modul.benoetigteRolle ?? null;
  if (!benoetigt) return false;
  if (benoetigt === 'admin') return true; // Admin ist oben bereits frei.
  return benutzer?.org_rolle !== 'fuehrungskraft';
}

/**
 * Sichtbarkeit eines Moduls im Einsatz (Override-Kontext, LFH-132): nicht-ausblendbare
 * Module sind immer sichtbar; sonst ist ein Modul versteckt, wenn sein Override
 * `sichtbar=false` setzt. Steuert das Rendern in der Navigation (versteckt = nicht
 * gerendert) — unabhängig vom Benutzer (Einsatz-Konfiguration).
 */
export function istModulSichtbar(modul: ModulEintrag, overrides?: ModulOverrides): boolean {
  if (!istModulAusblendbar(modul.key)) return true;
  return overrides?.[modul.key]?.sichtbar !== false;
}

/**
 * „Ist dieses Modul bedienbar?" — die EINE fachliche Frage hinter dem dreiteiligen
 * Freigabe-Filter (LFH-337 · Fix-Welle, Befund B3).
 *
 * `status === 'fertig' && istModulSichtbar(...) && !istModulGesperrt(...)` stand vorher
 * viermal wörtlich da: in `erstesFreigegebenesModul` hier, in der „Zuletzt"-Ableitung des
 * Rahmens und zweimal in `command-palette/befehle.ts`. Vier Kopien einer Bedingung driften
 * genau an der Stelle auseinander, die niemand testet.
 *
 * SEIT LFH-391 · A1b sind es DREI Stellen in `command-palette/befehle.ts`: der
 * Schnellaktions-Filter führte als einziger noch die ZWEITEILIGE Fassung ohne
 * `status === 'fertig'` — genau die vorhergesagte Drift, nur in der anderen Richtung. Sie
 * war im Bestand unbeobachtbar (alle vier Trägermodule sind `fertig`) und ist über einen
 * Registry-Stub in `command-palette/befehle.modulstatus.test.ts` beobachtbar gemacht.
 *
 * BEWUSST NICHT MIT UMGESTELLT: `useModulZaehler.ts` (`darfZaehlerLaden`) führt die
 * ZWEITEILIGE Variante ohne `status === 'fertig'`. Das ist heute unbeobachtbar — alle vier
 * Module mit `zaehlerQuelle` (chat, erinnerungen, auftraege, meldungen) sind `fertig`,
 * beide Fassungen liefern also dasselbe. Ob ein Zähler auch für ein UNFERTIGES Modul laden
 * darf, ist eine fachliche Entscheidung und keine Aufräumarbeit; sie steht offen. Wer sie
 * trifft, zieht die Stelle nach oder schreibt hier hin, warum sie eigenständig bleibt.
 */
export function istModulFreigegeben(
  modul: ModulEintrag,
  benutzer: BenutzerAnzeige | null,
  overrides?: ModulOverrides,
): boolean {
  return modul.status === 'fertig'
    && istModulSichtbar(modul, overrides)
    && !istModulGesperrt(modul, benutzer, overrides);
}

/** Ziel der Default-Route /einsaetze/:id: Lage-Dashboard sobald fertig, sonst ETB-Fallback. */
export function redirectZiel(register: ModulEintrag[] = modulRegistry): string {
  const dashboard = register.find((m) => m.key === 'lage-dashboard');
  return dashboard && dashboard.status === 'fertig' ? dashboard.route : 'etb';
}

/**
 * Auflösung des Einsatz-Default-Moduls (LFH-131): liefert die Ziel-Route, wenn
 * `standardModul` auf einen existierenden Eintrag mit Status 'fertig' zeigt —
 * sonst den globalen `redirectZiel()`-Fallback. Pre-Mortem: kein Sprung auf
 * geplante/unbekannte Module (das würde ins Leere/auf einen Platzhalter führen).
 */
export function aufloeseStandardModul(
  standardModul: string | null | undefined,
  register: ModulEintrag[] = modulRegistry,
): string {
  const modul = register.find((m) => m.key === standardModul);
  if (modul && modul.status === 'fertig') return modulZielRoute(modul);
  return redirectZiel(register);
}

/**
 * Erstes bedienbares Modul einer Kategorie (LFH-337 · H12) — oder `null`.
 *
 * ABGRENZUNG ZU `aufloeseStandardModul`: das dort löst das EINSATZ-Default-Modul auf
 * (LFH-131) und fällt auf `redirectZiel()` zurück. Hier geht es um eine einzelne
 * Kategorie, und ein Fallback wäre falsch: er führte beim Klick auf „Lage" in ein Modul
 * einer anderen Kategorie. Die Verweigerung ist die richtige Antwort, der Aufrufer
 * entscheidet dann, nur das Panel zu öffnen.
 *
 * Freigabe fragt {@link istModulFreigegeben} — dieselbe Funktion wie die Kommandopalette
 * und die „Zuletzt"-Auflösung. Registry-Reihenfolge ist die Rangfolge — sie ist im Bestand
 * bewusst gepflegt (Kommentar `// Führung` u. a.).
 */
export function erstesFreigegebenesModul(
  kategorie: KategorieKey,
  benutzer: BenutzerAnzeige | null,
  overrides?: ModulOverrides,
  register: ModulEintrag[] = modulRegistry,
): ModulEintrag | null {
  return register.find(
    (m) => m.kategorie === kategorie && istModulFreigegeben(m, benutzer, overrides),
  ) ?? null;
}
