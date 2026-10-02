import {
  IconArzttasche,
  IconBericht,
  IconBesteck,
  IconDokument,
  IconDokumente,
  IconGebaeudegruppe,
  IconGewitterwolke,
  IconGlocke,
  IconHaus,
  IconHausHerz,
  IconHierarchie,
  IconHierarchieGefuellt,
  IconKacheln,
  IconKachelraster,
  IconKarte,
  IconKarteGefuellt,
  IconKistenstapel,
  IconKlemmbrett,
  IconKlemmbrettGefuellt,
  IconKlemmbrettListe,
  IconLagerhalle,
  IconListeDetails,
  IconLkw,
  IconLkwGefuellt,
  IconOrganigramm,
  IconPerson,
  IconPersonen,
  IconPersonengruppe,
  IconPfeileGegenlaeufig,
  IconPfote,
  IconPosteingang,
  IconSprechblase,
  IconSprechblaseGefuellt,
  IconSprechblaseRund,
  IconWarndreieck,
  IconZahnrad,
  IconZahnradGefuellt,
  type Icon,
  type IconPaar,
} from '../icons';
import type { ModulFreigaben } from '../api/types';

export type ModulStatus = 'fertig' | 'geplant' | 'wip';
export type KategorieKey =
  'fuehrung' | 'kraefte' | 'erfassung' | 'lage' | 'kommunikation' | 'einstellungen';
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
   * Sichtbares Kurzetikett unter dem Rail-Icon: 9 px Versalien in 60 px tragen „Kommunikation"
   * nicht. Der volle Name bleibt `aria-label` und `title`.
   */
  kurz: string;
  /** Umriss inaktiv, Füllung aktiv (LFH-595, Spec `iconsatz`). */
  icon: IconPaar;
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
  icon: Icon;
  /** Relativer Pfad-Abschnitt unter /einsaetze/:id (z. B. 'etb'). */
  route: string;
  status: ModulStatus;
  /** Kurztext für die WIP-/Platzhalter-Seite. */
  beschreibung?: string;
  /**
   * Deep-Link: das Modul leitet auf die `route` eines anderen Moduls um. Heute von keinem Eintrag
   * genutzt, als Infrastruktur erhalten.
   */
  verweistAuf?: string;
  /** Optionale, berechtigungsgesteuerte Quelle für den neutralen Navigationszähler. */
  zaehlerQuelle?: ModulZaehlerQuelle;
}

/**
 * Reihenfolge der Icon-Rail (eine Zeile je Kategorie; `fuss` unten abgesetzt). Icons aus dem
 * Satz (LFH-595): Hierarchie, Lkw, Klemmbrett, Karte, Sprechblase, Zahnrad — je als Paar.
 */
export const kategorien: Kategorie[] = [
  {
    key: 'fuehrung',
    label: 'Führung',
    kurz: 'Führung',
    icon: { umriss: IconHierarchie, gefuellt: IconHierarchieGefuellt },
  },
  {
    key: 'kraefte',
    label: 'Kräfte & Mittel',
    kurz: 'Kräfte',
    icon: { umriss: IconLkw, gefuellt: IconLkwGefuellt },
  },
  {
    key: 'erfassung',
    label: 'Erfassung',
    // Kurzform wie „Komm.“/„Einst.“: „ERFASSUNG“ ist in 9 px Versalien breiter als die 60-px-Rail
    // (LFH-644). Die Sperrung bleibt Token, keine Ausnahme je Etikett.
    kurz: 'Erfass.',
    icon: { umriss: IconKlemmbrett, gefuellt: IconKlemmbrettGefuellt },
  },
  {
    key: 'lage',
    label: 'Lage',
    kurz: 'Lage',
    icon: { umriss: IconKarte, gefuellt: IconKarteGefuellt },
  },
  {
    key: 'kommunikation',
    label: 'Kommunikation',
    kurz: 'Komm.',
    icon: { umriss: IconSprechblase, gefuellt: IconSprechblaseGefuellt },
  },
  {
    key: 'einstellungen',
    label: 'Einstellungen',
    kurz: 'Einst.',
    icon: { umriss: IconZahnrad, gefuellt: IconZahnradGefuellt },
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
    icon: IconKacheln,
    route: 'ueberblick',
    status: 'fertig',
    beschreibung: 'Führungsüberblick des Einsatzes — Startseite des Einsatz-Workspace.',
  },
  {
    key: 'einsatzdaten',
    kategorie: 'fuehrung',
    label: 'Einsatzdaten',
    icon: IconDokument,
    route: 'einsatzdaten',
    status: 'fertig',
    beschreibung: 'Stammdaten des Einsatzes: Bezeichnung, Stichwort, Zeiten, Leitung.',
  },
  {
    key: 'einsatzabschnitte',
    kategorie: 'fuehrung',
    label: 'Einsatzabschnitte',
    icon: IconOrganigramm,
    route: 'einsatzabschnitte',
    status: 'fertig',
    beschreibung: 'Gliederung des Einsatzes in Abschnitte und Zuordnung von Einheiten.',
    zaehlerQuelle: 'einsatzabschnitte',
  },
  {
    key: 'auftraege',
    kategorie: 'fuehrung',
    label: 'Aufträge/Befehle',
    icon: IconKlemmbrettListe,
    route: 'auftraege',
    status: 'fertig',
    beschreibung: 'Aufträge und Befehle mit Quittierung.',
    zaehlerQuelle: 'auftraege',
  },
  {
    key: 'stab',
    kategorie: 'fuehrung',
    label: 'Stab',
    icon: IconGebaeudegruppe,
    route: 'stab',
    status: 'fertig',
    beschreibung: 'Führungsorganisation (S1–S6) und Lagebesprechungen der Einsatzleitung',
  },
  {
    key: 'dokumente',
    kategorie: 'fuehrung',
    label: 'Dokumente',
    icon: IconDokumente,
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
    icon: IconListeDetails,
    route: 'kraefteuebersicht',
    status: 'fertig',
    beschreibung: 'Meldebild der eingesetzten Kräfte: Status, Stärke und Gliederung.',
  },
  {
    key: 'einheiten',
    kategorie: 'kraefte',
    label: 'Einheiten',
    icon: IconPersonengruppe,
    route: 'einheiten',
    status: 'fertig',
    beschreibung: 'Taktische Einheiten: Führer, Mannschaft, Fahrzeug, Abschnittszuordnung.',
    zaehlerQuelle: 'einheiten',
  },
  {
    key: 'personal',
    kategorie: 'kraefte',
    label: 'Personal',
    icon: IconPerson,
    route: 'personal',
    status: 'fertig',
    beschreibung: 'Im Einsatz aktive Personen aus dem Stammdaten-Pool plus Ad-hoc-Kräfte.',
  },
  {
    key: 'fahrzeuge',
    kategorie: 'kraefte',
    label: 'Fahrzeuge',
    icon: IconLkw,
    route: 'fahrzeuge',
    status: 'fertig',
    beschreibung: 'Disponierte Fahrzeuge des Einsatzes.',
  },
  {
    key: 'material',
    kategorie: 'kraefte',
    label: 'Material',
    icon: IconKistenstapel,
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
    icon: IconBesteck,
    route: 'verpflegung',
    status: 'fertig',
    beschreibung:
      'Zeitfenster mit Bedarf und Ausgabe von Essensportionen, Sonderkost, Unterdeckung.',
  },
  {
    key: 'bereitstellungsraeume',
    kategorie: 'kraefte',
    label: 'Bereitstellungsräume',
    icon: IconLagerhalle,
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
    icon: IconPfeileGegenlaeufig,
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
    icon: IconKlemmbrett,
    route: 'etb',
    status: 'fertig',
    beschreibung: 'Einsatztagebuch.',
    zaehlerQuelle: 'etb',
  },
  {
    key: 'personen',
    kategorie: 'erfassung',
    label: 'Personen',
    icon: IconPersonen,
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
    icon: IconArzttasche,
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
    icon: IconHausHerz,
    route: 'betreuung',
    status: 'fertig',
    beschreibung: 'Evakuierungsbezirke mit Stand „evakuiert" und Betreuungsstellen mit Belegung.',
    zaehlerQuelle: 'betreuung',
  },
  {
    key: 'tiere',
    kategorie: 'erfassung',
    label: 'Tiere',
    icon: IconPfote,
    route: 'tiere',
    status: 'fertig',
    beschreibung: 'Betroffene Tiere, getrennt vom Personenstamm.',
  },
  {
    key: 'schaeden',
    kategorie: 'erfassung',
    label: 'Schäden',
    icon: IconHaus,
    route: 'schaeden',
    status: 'fertig',
    beschreibung: 'Sach-/Infrastruktur-/Umweltschäden mit Bearbeitungs-Workflow.',
  },
  // Lage
  {
    key: 'lage-dashboard',
    kategorie: 'lage',
    label: 'Dashboard',
    icon: IconKachelraster,
    route: 'lage-dashboard',
    status: 'fertig',
    beschreibung: 'Verdichtete Lageübersicht des Einsatzes.',
  },
  {
    key: 'lagekarte',
    kategorie: 'lage',
    label: 'Lagekarte',
    icon: IconKarte,
    route: 'lagekarte',
    status: 'fertig',
    beschreibung:
      'Karte der verortbaren Objekte: Einsatzort, Unfallhilfsstellen, Schäden — verorten per Klick.',
  },
  {
    key: 'lageberichte',
    kategorie: 'lage',
    label: 'Lageberichte',
    icon: IconBericht,
    route: 'lageberichte',
    status: 'fertig',
    beschreibung: 'Strukturierte Lageberichte.',
  },
  {
    key: 'gefahrenzonen',
    kategorie: 'lage',
    label: 'Gefahren',
    icon: IconWarndreieck,
    route: 'gefahren',
    status: 'fertig',
    beschreibung:
      'Gefahrenmatrix (Gefahrentyp × Schutzobjekt → Warnstufe) und Verknüpfung der Gefahrengebiete.',
  },
  {
    key: 'wetter-pegel',
    kategorie: 'lage',
    label: 'Wetter & Pegel',
    icon: IconGewitterwolke,
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
    icon: IconPosteingang,
    route: 'lagemeldungen',
    status: 'fertig',
    beschreibung: 'Lagerelevante Meldungen, die an die Lage übergeben wurden.',
  },
  // Kommunikation
  {
    key: 'chat',
    kategorie: 'kommunikation',
    label: 'Chat',
    icon: IconSprechblaseRund,
    route: 'chat',
    status: 'fertig',
    beschreibung: 'Einsatzinterner Chat (pro Einsatz, nicht einsatzübergreifend).',
    zaehlerQuelle: 'chat',
  },
  {
    key: 'erinnerungen',
    kategorie: 'kommunikation',
    label: 'Erinnerungen',
    icon: IconGlocke,
    route: 'erinnerungen',
    status: 'fertig',
    beschreibung: 'Terminierte Erinnerungen.',
    zaehlerQuelle: 'erinnerungen',
  },
  {
    key: 'meldungen',
    kategorie: 'kommunikation',
    label: 'Meldungen (eingehend)',
    icon: IconPosteingang,
    route: 'meldungen',
    status: 'fertig',
    beschreibung: 'Eingehende Meldungen zur Bearbeitung.',
    zaehlerQuelle: 'meldungen',
  },
  {
    key: 'nachforderungen',
    kategorie: 'kommunikation',
    label: 'Nachforderung',
    icon: IconKistenstapel,
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
    icon: IconZahnrad,
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

/*
 * Modul-Gate des Clients (LFH-669). Die Regel (Ausblenden, Rolle aus Einsatz-Override, sonst
 * Org-Vorgabe, Admin-Ausnahme, nicht ausblendbare Module) wertet NUR der Server aus
 * (`src/einsatz/berechtigung.rs`, `modul_freigabe`); der Client liest das Ergebnis aus
 * `GET /api/einsaetze/{id}/modul-freigaben` (`einsatzKeys.modulFreigaben`). Eine Kopie der Regel
 * hier kannte die Org-Vorgaben nicht und hielt gesperrte Module für frei.
 */

/**
 * „Disabled statt versteckt": verweigert der Server dem Benutzer das Modul? Solange die Freigaben
 * unbekannt sind, nicht — die Navigation flackerte sonst beim Öffnen jedes Einsatzes; für
 * Datenabrufe gilt {@link istModulFreigegeben}, das bei Unbekanntem zu bleibt.
 */
export function istModulGesperrt(modul: ModulEintrag, freigaben?: ModulFreigaben): boolean {
  return freigaben?.[modul.key]?.zugriff === false;
}

/**
 * Sichtbarkeit eines Moduls in der Navigation, wie der Server sie meldet (`sichtbar` hängt nicht
 * am Admin: ein ausgeblendetes Modul steht für niemanden in der Navigation). Unbekannt → sichtbar.
 */
export function istModulSichtbar(modul: ModulEintrag, freigaben?: ModulFreigaben): boolean {
  return freigaben?.[modul.key]?.sichtbar !== false;
}

/**
 * „Ist dieses Modul bedienbar?" — die EINE Freigabe-Frage (fertig · sichtbar · Zugriff), genutzt
 * hier, in der Kommandopalette und vor jedem Abruf der Daten eines fremden Moduls. **Unbekannte
 * Freigaben geben nichts frei** (Laden, Fehler, fehlender Key): sonst ginge eine Anfrage auf
 * Verdacht an eine Liste, die mit 403 antwortet (Spec `modul-freigabe`).
 * Bewusst NICHT genutzt von `darfZaehlerZeigen` (`useModulZaehler.ts`), das ohne
 * `status === 'fertig'` prüft. Heute unbeobachtbar (alle Module mit Zähler sind fertig); ob ein
 * Zähler an einem unfertigen Modul stehen darf, ist eine offene fachliche Entscheidung.
 */
export function istModulFreigegeben(modul: ModulEintrag, freigaben?: ModulFreigaben): boolean {
  const freigabe = freigaben?.[modul.key];
  return modul.status === 'fertig' && !!freigabe && freigabe.sichtbar && freigabe.zugriff;
}

/**
 * {@link istModulFreigegeben} über den Modul-Key — für Verweise aus anderen Seiten. Ein
 * unbekannter Key ist nie frei. Bewusst nicht `darfZaehlerZeigen`: das sagte für jedes Modul
 * ohne Zähler still `false`.
 */
export function istKeyFreigegeben(key: string, freigaben?: ModulFreigaben): boolean {
  const modul = modulRegistry.find((m) => m.key === key);
  return !!modul && istModulFreigegeben(modul, freigaben);
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
  freigaben: ModulFreigaben | undefined,
  register: ModulEintrag[] = modulRegistry,
): ModulEintrag | null {
  return (
    register.find((m) => m.kategorie === kategorie && istModulFreigegeben(m, freigaben)) ?? null
  );
}
