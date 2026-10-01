import {
  IkoneArzttasche,
  IkoneBericht,
  IkoneBesteck,
  IkoneDokument,
  IkoneDokumente,
  IkoneGebaeudegruppe,
  IkoneGewitterwolke,
  IkoneGlocke,
  IkoneHaus,
  IkoneHausHerz,
  IkoneHierarchie,
  IkoneHierarchieGefuellt,
  IkoneKacheln,
  IkoneKachelraster,
  IkoneKarte,
  IkoneKarteGefuellt,
  IkoneKistenstapel,
  IkoneKlemmbrett,
  IkoneKlemmbrettGefuellt,
  IkoneKlemmbrettListe,
  IkoneLagerhalle,
  IkoneListeDetails,
  IkoneLkw,
  IkoneLkwGefuellt,
  IkoneOrganigramm,
  IkonePerson,
  IkonePersonen,
  IkonePersonengruppe,
  IkonePfeileGegenlaeufig,
  IkonePfote,
  IkonePosteingang,
  IkoneSprechblase,
  IkoneSprechblaseGefuellt,
  IkoneSprechblaseRund,
  IkoneWarndreieck,
  IkoneZahnrad,
  IkoneZahnradGefuellt,
  type Ikone,
  type IkonenPaar,
} from '../ikonen';
import type { BenutzerAnzeige, ModulOverrides } from '../api/types';

export type ModulStatus = 'fertig' | 'geplant' | 'wip';
export type KategorieKey =
  'fuehrung' | 'kraefte' | 'erfassung' | 'lage' | 'kommunikation' | 'einstellungen';
export type BenoetigteRolle = 'admin' | 'fuehrungskraft';
/** Module mit Navigationszähler, die der SERVER zählt; die Bedeutung je Quelle legt
    `src/einsatz/zaehler.rs` fest. */
export type ServerZaehlerQuelle =
  | 'etb'
  | 'personen'
  | 'einheiten'
  | 'einsatzabschnitte'
  | 'meldungen'
  | 'auftraege'
  | 'erinnerungen'
  | 'chat'
  | 'dokumente';
/**
 * Module, deren Zähler der BROWSER aus der eigenen Modulliste rechnet: `abloesung` hängt an der
 * Uhr (Vorwarnzeit), `betreuung` teilt sich die Übersicht mit Seite und Kennzahl,
 * `wetter-pegel` zählt Unwetterwarnungen aus einer externen Quelle ohne Live-Ereignis (LFH-663).
 */
export type ClientZaehlerQuelle = 'abloesung' | 'betreuung' | 'wetter-pegel';
export type ModulZaehlerQuelle = ServerZaehlerQuelle | ClientZaehlerQuelle;

export interface Kategorie {
  key: KategorieKey;
  /** Voller Name — zugänglicher Name des Rail-Ziels, Kopf des Modulpanels, Drawer-Zeile. */
  label: string;
  /**
   * Sichtbares Kurzetikett unter der Rail-Ikone: 9 px Versalien in 60 px tragen „Kommunikation"
   * nicht. Der volle Name bleibt `aria-label` und `title`.
   */
  kurz: string;
  /** Umriss inaktiv, Füllung aktiv (LFH-595, Spec `ikonensatz`). */
  ikone: IkonenPaar;
  /**
   * Steht abgesetzt am FUSS der Rail. Ein Flag statt einer zweiten Liste: `kategorien` bleibt die
   * EINE Aufzählung für Rail, Drawer, Rahmen und Kommandopalette.
   */
  fuss?: true;
}

export interface ModulEintrag {
  key: string;
  kategorie: KategorieKey;
  label: string;
  icon: Ikone;
  /** Relativer Pfad-Abschnitt unter /einsaetze/:id (z. B. 'etb'). */
  route: string;
  status: ModulStatus;
  /** Kurztext für die WIP-/Platzhalter-Seite. */
  beschreibung?: string;
  /** Fehlt sie, ist das Modul für alle frei. */
  benoetigteRolle?: BenoetigteRolle;
  /**
   * Deep-Link: das Modul leitet auf die `route` eines anderen Moduls um. Heute von keinem Eintrag
   * genutzt, als Infrastruktur erhalten.
   */
  verweistAuf?: string;
  /** Optionale, berechtigungsgesteuerte Quelle für den neutralen Navigationszähler. */
  zaehlerQuelle?: ModulZaehlerQuelle;
}

/**
 * Reihenfolge der Icon-Rail (eine Zeile je Kategorie; `fuss` unten abgesetzt). Ikonen aus dem
 * Satz (LFH-595): Hierarchie, Lkw, Klemmbrett, Karte, Sprechblase, Zahnrad — je als Paar.
 */
export const kategorien: Kategorie[] = [
  {
    key: 'fuehrung',
    label: 'Führung',
    kurz: 'Führung',
    ikone: { umriss: IkoneHierarchie, gefuellt: IkoneHierarchieGefuellt },
  },
  {
    key: 'kraefte',
    label: 'Kräfte & Mittel',
    kurz: 'Kräfte',
    ikone: { umriss: IkoneLkw, gefuellt: IkoneLkwGefuellt },
  },
  {
    key: 'erfassung',
    label: 'Erfassung',
    // Kurzform wie „Komm.“/„Einst.“: „ERFASSUNG“ ist in 9 px Versalien breiter als die 60-px-Rail
    // (LFH-644). Die Sperrung bleibt Token, keine Ausnahme je Etikett.
    kurz: 'Erfass.',
    ikone: { umriss: IkoneKlemmbrett, gefuellt: IkoneKlemmbrettGefuellt },
  },
  {
    key: 'lage',
    label: 'Lage',
    kurz: 'Lage',
    ikone: { umriss: IkoneKarte, gefuellt: IkoneKarteGefuellt },
  },
  {
    key: 'kommunikation',
    label: 'Kommunikation',
    kurz: 'Komm.',
    ikone: { umriss: IkoneSprechblase, gefuellt: IkoneSprechblaseGefuellt },
  },
  {
    key: 'einstellungen',
    label: 'Einstellungen',
    kurz: 'Einst.',
    ikone: { umriss: IkoneZahnrad, gefuellt: IkoneZahnradGefuellt },
    fuss: true,
  },
];

export const modulRegistry: ModulEintrag[] = [
  // Führung — der Überblick ist die Startseite eines Einsatzes; Aufträge/Befehle stehen hier,
  // weil Anordnungen ein Führungsmittel sind, kein Nachrichtenkanal.
  {
    key: 'ueberblick',
    kategorie: 'fuehrung',
    label: 'Überblick',
    icon: IkoneKacheln,
    route: 'ueberblick',
    status: 'fertig',
    beschreibung: 'Führungsüberblick des Einsatzes — Startseite des Einsatz-Workspace.',
  },
  {
    key: 'einsatzdaten',
    kategorie: 'fuehrung',
    label: 'Einsatzdaten',
    icon: IkoneDokument,
    route: 'einsatzdaten',
    status: 'fertig',
    beschreibung: 'Stammdaten des Einsatzes: Bezeichnung, Stichwort, Zeiten, Leitung.',
  },
  {
    key: 'einsatzabschnitte',
    kategorie: 'fuehrung',
    label: 'Einsatzabschnitte',
    icon: IkoneOrganigramm,
    route: 'einsatzabschnitte',
    status: 'fertig',
    beschreibung: 'Gliederung des Einsatzes in Abschnitte und Zuordnung von Einheiten.',
    zaehlerQuelle: 'einsatzabschnitte',
  },
  {
    key: 'auftraege',
    kategorie: 'fuehrung',
    label: 'Aufträge/Befehle',
    icon: IkoneKlemmbrettListe,
    route: 'auftraege',
    status: 'fertig',
    beschreibung: 'Aufträge und Befehle mit Quittierung.',
    zaehlerQuelle: 'auftraege',
  },
  {
    key: 'stab',
    kategorie: 'fuehrung',
    label: 'Stab',
    icon: IkoneGebaeudegruppe,
    route: 'stab',
    status: 'fertig',
    beschreibung: 'Führungsorganisation (S1–S6) und Lagebesprechungen der Einsatzleitung',
  },
  {
    key: 'dokumente',
    kategorie: 'fuehrung',
    label: 'Dokumente',
    icon: IkoneDokumente,
    route: 'dokumente',
    status: 'fertig',
    beschreibung: 'Abgelegte Dateien des Einsatzes: Lagepläne, Befehle, Formulare, Fotos.',
    zaehlerQuelle: 'dokumente',
  },
  // Kräfte & Mittel — das Meldebild steht vorn als Verdichtung der Kategorie. Route und Schlüssel
  // `kraefteuebersicht` bleiben, damit Deeplinks und gespeicherte Standard-Module nicht brechen.
  {
    key: 'kraefteuebersicht',
    kategorie: 'kraefte',
    label: 'Meldebild',
    icon: IkoneListeDetails,
    route: 'kraefteuebersicht',
    status: 'fertig',
    beschreibung: 'Meldebild der eingesetzten Kräfte: Status, Stärke und Gliederung.',
  },
  {
    key: 'einheiten',
    kategorie: 'kraefte',
    label: 'Einheiten',
    icon: IkonePersonengruppe,
    route: 'einheiten',
    status: 'fertig',
    beschreibung: 'Taktische Einheiten: Führer, Mannschaft, Fahrzeug, Abschnittszuordnung.',
    zaehlerQuelle: 'einheiten',
  },
  {
    key: 'personal',
    kategorie: 'kraefte',
    label: 'Personal',
    icon: IkonePerson,
    route: 'personal',
    status: 'fertig',
    beschreibung: 'Im Einsatz aktive Personen aus dem Stammdaten-Pool plus Ad-hoc-Kräfte.',
  },
  {
    key: 'fahrzeuge',
    kategorie: 'kraefte',
    label: 'Fahrzeuge',
    icon: IkoneLkw,
    route: 'fahrzeuge',
    status: 'fertig',
    beschreibung: 'Disponierte Fahrzeuge des Einsatzes.',
  },
  {
    key: 'material',
    kategorie: 'kraefte',
    label: 'Material',
    icon: IkoneKistenstapel,
    route: 'material',
    status: 'fertig',
    beschreibung: 'Material und Verbrauchsgüter im Einsatz.',
  },
  {
    // Essensportionen je Zeitfenster. Bewusst KEIN Zähler: Unterdeckung ist kein Alarmereignis.
    // Reihenfolge wie `MODUL_KEYS` im Backend.
    key: 'verpflegung',
    kategorie: 'kraefte',
    label: 'Verpflegung',
    icon: IkoneBesteck,
    route: 'verpflegung',
    status: 'fertig',
    beschreibung:
      'Zeitfenster mit Bedarf und Ausgabe von Essensportionen, Sonderkost, Unterdeckung.',
  },
  {
    key: 'bereitstellungsraeume',
    kategorie: 'kraefte',
    label: 'Bereitstellungsräume',
    icon: IkoneLagerhalle,
    route: 'bereitstellungsraeume',
    status: 'fertig',
    beschreibung: 'Bereitstellungsräume: bereitgestellte Einheiten und Fahrzeuge.',
  },
  {
    // Schichten und fällige Ablösungen. Der Zähler nennt die Schichten in der Vorwarnzeit oder
    // überfällig — was Handlung braucht.
    key: 'abloesung',
    kategorie: 'kraefte',
    label: 'Ablösung',
    icon: IkonePfeileGegenlaeufig,
    route: 'abloesung',
    status: 'fertig',
    beschreibung: 'Schichten der Einheiten: Rhythmus, fällige Ablösungen, Vollzug.',
    zaehlerQuelle: 'abloesung',
  },
  // Erfassung
  {
    key: 'etb',
    kategorie: 'erfassung',
    label: 'ETB',
    icon: IkoneKlemmbrett,
    route: 'etb',
    status: 'fertig',
    beschreibung: 'Einsatztagebuch.',
    zaehlerQuelle: 'etb',
  },
  {
    key: 'personen',
    kategorie: 'erfassung',
    label: 'Personen',
    icon: IkonePersonen,
    route: 'personen',
    status: 'fertig',
    beschreibung:
      'Ein Personenstamm mit Status-Lebenszyklus (vermisst → betroffen → Patient → verstorben).',
    zaehlerQuelle: 'personen',
  },
  {
    key: 'unfallhilfsstellen',
    kategorie: 'erfassung',
    label: 'Unfallhilfsstellen',
    icon: IkoneArzttasche,
    route: 'unfallhilfsstellen',
    status: 'fertig',
    beschreibung:
      'Behandlungs-/Sammelstellen als Örtlichkeiten mit Plätzen, Belegung und Material.',
  },
  {
    // Evakuierung und Unterbringung als MENGEN mit Zeitbezug. Der Zähler nennt die aktiven
    // Evakuierungsbezirke; dieselbe Übersicht speist die Kennzahl „Evakuiert".
    // Reihenfolge wie `MODUL_KEYS` im Backend.
    key: 'betreuung',
    kategorie: 'erfassung',
    label: 'Betreuung',
    icon: IkoneHausHerz,
    route: 'betreuung',
    status: 'fertig',
    beschreibung: 'Evakuierungsbezirke mit Stand „evakuiert" und Betreuungsstellen mit Belegung.',
    zaehlerQuelle: 'betreuung',
  },
  {
    key: 'tiere',
    kategorie: 'erfassung',
    label: 'Tiere',
    icon: IkonePfote,
    route: 'tiere',
    status: 'fertig',
    beschreibung: 'Betroffene Tiere, getrennt vom Personenstamm.',
  },
  {
    key: 'schaeden',
    kategorie: 'erfassung',
    label: 'Schäden',
    icon: IkoneHaus,
    route: 'schaeden',
    status: 'fertig',
    beschreibung: 'Sach-/Infrastruktur-/Umweltschäden mit Bearbeitungs-Workflow.',
  },
  // Lage
  {
    key: 'lage-dashboard',
    kategorie: 'lage',
    label: 'Dashboard',
    icon: IkoneKachelraster,
    route: 'lage-dashboard',
    status: 'fertig',
    beschreibung: 'Verdichtete Lageübersicht des Einsatzes.',
  },
  {
    key: 'lagekarte',
    kategorie: 'lage',
    label: 'Lagekarte',
    icon: IkoneKarte,
    route: 'lagekarte',
    status: 'fertig',
    beschreibung:
      'Karte der verortbaren Objekte: Einsatzort, Unfallhilfsstellen, Schäden — verorten per Klick.',
  },
  {
    key: 'lageberichte',
    kategorie: 'lage',
    label: 'Lageberichte',
    icon: IkoneBericht,
    route: 'lageberichte',
    status: 'fertig',
    beschreibung: 'Strukturierte Lageberichte.',
  },
  {
    key: 'gefahrenzonen',
    kategorie: 'lage',
    label: 'Gefahren',
    icon: IkoneWarndreieck,
    route: 'gefahren',
    status: 'fertig',
    beschreibung:
      'Gefahrenmatrix (Gefahrentyp × Schutzobjekt → Warnstufe) und Verknüpfung der Gefahrengebiete.',
  },
  {
    key: 'wetter-pegel',
    kategorie: 'lage',
    label: 'Wetter & Pegel',
    icon: IkoneGewitterwolke,
    route: 'wetter-pegel',
    status: 'fertig',
    // Gültige Unwetterwarnungen (schwer/extrem) am Einsatzort, neutral (LFH-663).
    zaehlerQuelle: 'wetter-pegel',
    beschreibung:
      'Maßgebliche Pegel mit 24-h-Verlauf, DWD-Warnungen und Vorhersage für den Einsatzort.',
  },
  {
    key: 'lagemeldungen',
    kategorie: 'lage',
    label: 'Lagemeldungen',
    icon: IkonePosteingang,
    route: 'lagemeldungen',
    status: 'fertig',
    beschreibung: 'Lagerelevante Meldungen, die an die Lage übergeben wurden.',
  },
  // Kommunikation
  {
    key: 'chat',
    kategorie: 'kommunikation',
    label: 'Chat',
    icon: IkoneSprechblaseRund,
    route: 'chat',
    status: 'fertig',
    beschreibung: 'Einsatzinterner Chat (pro Einsatz, nicht einsatzübergreifend).',
    zaehlerQuelle: 'chat',
  },
  {
    key: 'erinnerungen',
    kategorie: 'kommunikation',
    label: 'Erinnerungen',
    icon: IkoneGlocke,
    route: 'erinnerungen',
    status: 'fertig',
    beschreibung: 'Terminierte Erinnerungen.',
    zaehlerQuelle: 'erinnerungen',
  },
  {
    key: 'meldungen',
    kategorie: 'kommunikation',
    label: 'Meldungen (eingehend)',
    icon: IkonePosteingang,
    route: 'meldungen',
    status: 'fertig',
    beschreibung: 'Eingehende Meldungen zur Bearbeitung.',
    zaehlerQuelle: 'meldungen',
  },
  {
    key: 'nachforderungen',
    kategorie: 'kommunikation',
    label: 'Nachforderung',
    icon: IkoneKistenstapel,
    route: 'nachforderungen',
    status: 'fertig',
    beschreibung:
      'Nachforderung von Kräften/Mitteln bei Leitstelle/Nachbar-EA/übergeordneter Führung mit Status-Workflow.',
  },
  // Einstellungen
  {
    key: 'einsatz-einstellungen',
    kategorie: 'einstellungen',
    label: 'Einstellungen',
    icon: IkoneZahnrad,
    route: 'einstellungen',
    status: 'fertig',
    beschreibung: 'Einsatzbezogene Einstellungen.',
  },
];

export function moduleNachKategorie(kategorie: KategorieKey): ModulEintrag[] {
  return modulRegistry.filter((m) => m.kategorie === kategorie);
}

/** Ziel-Route beim Anwählen eines Moduls: Deep-Link-Ziel, sonst die eigene Route. */
export function modulZielRoute(modul: ModulEintrag): string {
  return modul.verweistAuf ?? modul.route;
}

/**
 * Die Umkehrung von {@link ModulEintrag.route} — Registry-Eintrag zu einem Routen-Segment, eine
 * Stelle für Rahmen, `ModulStub` und Kommandopalette.
 * Gesucht wird über `route`, NICHT über `key` (bei 'gefahren' weichen sie ab), und nicht über
 * {@link modulZielRoute} — ein `verweistAuf`-Eintrag lieferte sonst zwei Einträge für dieselbe
 * Adresse.
 */
export function modulZuRoute(
  route: string | null | undefined,
  register: ModulEintrag[] = modulRegistry,
): ModulEintrag | null {
  if (!route) return null;
  return register.find((m) => m.route === route) ?? null;
}

/**
 * Das Modul, in dem ein Pfad liegt — `/einsaetze/:id/<route>/…`, sonst `null`. Das Segment NACH
 * der Einsatz-ID, nicht das letzte, sonst verlöre jede Sub-Route ihr Modul.
 * Eine Zeichenketten-Zerlegung statt eines Imports, damit die Registry frei von
 * `routing/deeplinks.ts` bleibt.
 */
export function modulAusPfad(
  pathname: string,
  register: ModulEintrag[] = modulRegistry,
): ModulEintrag | null {
  const teile = pathname.split('/').filter(Boolean); // z. B. ['einsaetze','5','etb']
  // Der Präfix wird mitgeprüft: sonst gälte `/admin/stammdaten/personal` als Modul „Personal".
  if (teile[0] !== 'einsaetze') return null;
  return modulZuRoute(teile[2], register);
}

/** Module, die nicht ausgeblendet werden dürfen (Spiegel von `NICHT_AUSBLENDBAR` im Backend). */
const NICHT_AUSBLENDBARE_MODULE = ['einsatzdaten', 'einsatz-einstellungen'] as const;

/** Ob ein Modul ausgeblendet werden darf (alle außer den nicht-ausblendbaren). */
export function istModulAusblendbar(key: string): boolean {
  return !(NICHT_AUSBLENDBARE_MODULE as readonly string[]).includes(key);
}

/**
 * „Disabled statt versteckt": ist das Modul für den Benutzer rollen-gesperrt? Die effektive
 * Rolle ist die des Overrides, sonst der Registry-Default. Admin ist nie gesperrt.
 */
export function istModulGesperrt(
  modul: ModulEintrag,
  benutzer: BenutzerAnzeige | null,
  overrides?: ModulOverrides,
): boolean {
  if (benutzer?.system_rolle === 'admin') return false;
  // Nicht-ausblendbare Module sind nie sperrbar (Selbst-Aussperr-Schutz, wie
  // `fordere_modul_zugriff` im Backend).
  if (!istModulAusblendbar(modul.key)) return false;
  const benoetigt = overrides?.[modul.key]?.benoetigte_rolle ?? modul.benoetigteRolle ?? null;
  if (!benoetigt) return false;
  if (benoetigt === 'admin') return true; // Admin ist oben bereits frei.
  return benutzer?.org_rolle !== 'fuehrungskraft';
}

/**
 * Sichtbarkeit eines Moduls im Einsatz: nicht-ausblendbare immer; sonst versteckt, wenn der
 * Override `sichtbar=false` setzt. Unabhängig vom Benutzer.
 */
export function istModulSichtbar(modul: ModulEintrag, overrides?: ModulOverrides): boolean {
  if (!istModulAusblendbar(modul.key)) return true;
  return overrides?.[modul.key]?.sichtbar !== false;
}

/**
 * „Ist dieses Modul bedienbar?" — die EINE Freigabe-Frage (fertig · sichtbar · nicht gesperrt),
 * genutzt hier und in der Kommandopalette, damit die Bedingung nicht an mehreren Stellen driftet.
 * Bewusst NICHT genutzt von `darfZaehlerZeigen` (`useModulZaehler.ts`), das ohne
 * `status === 'fertig'` prüft. Heute unbeobachtbar (alle Module mit Zähler sind fertig); ob ein
 * Zähler an einem unfertigen Modul stehen darf, ist eine offene fachliche Entscheidung.
 */
export function istModulFreigegeben(
  modul: ModulEintrag,
  benutzer: BenutzerAnzeige | null,
  overrides?: ModulOverrides,
): boolean {
  return (
    modul.status === 'fertig' &&
    istModulSichtbar(modul, overrides) &&
    !istModulGesperrt(modul, benutzer, overrides)
  );
}

/**
 * {@link istModulFreigegeben} über den Modul-Key — für Verweise aus anderen Seiten. Ein
 * unbekannter Key ist nie frei. Bewusst nicht `darfZaehlerZeigen`: das sagte für jedes Modul
 * ohne Zähler still `false`.
 */
export function istKeyFreigegeben(
  key: string,
  benutzer: BenutzerAnzeige | null,
  overrides?: ModulOverrides,
): boolean {
  const modul = modulRegistry.find((m) => m.key === key);
  return !!modul && istModulFreigegeben(modul, benutzer, overrides);
}

/**
 * Ziel der Default-Route /einsaetze/:id: der Führungsüberblick, solange er fertig ist, sonst
 * der ETB-Fallback.
 */
export function redirectZiel(register: ModulEintrag[] = modulRegistry): string {
  const start = register.find((m) => m.key === 'ueberblick');
  return start && start.status === 'fertig' ? start.route : 'etb';
}

/**
 * Auflösung des Einsatz-Default-Moduls: die Ziel-Route, wenn `standardModul` auf einen
 * existierenden, fertigen Eintrag zeigt — sonst `redirectZiel()`. Kein Sprung auf geplante oder
 * unbekannte Module.
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
 * Erstes bedienbares Modul einer Kategorie — oder `null`. Anders als `aufloeseStandardModul`
 * ohne Fallback: der führte beim Klick auf „Lage" in eine andere Kategorie; der Aufrufer öffnet
 * dann nur das Panel. Die Registry-Reihenfolge ist die Rangfolge (`// Führung` u. a.).
 */
export function erstesFreigegebenesModul(
  kategorie: KategorieKey,
  benutzer: BenutzerAnzeige | null,
  overrides?: ModulOverrides,
  register: ModulEintrag[] = modulRegistry,
): ModulEintrag | null {
  return (
    register.find(
      (m) => m.kategorie === kategorie && istModulFreigegeben(m, benutzer, overrides),
    ) ?? null
  );
}
