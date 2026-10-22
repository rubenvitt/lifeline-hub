import {
  IconAbmelden,
  IconArzttasche,
  IconBericht,
  IconBesprechungstisch,
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
  IconPapierflieger,
  IconPosteingang,
  IconSprechblase,
  IconSprechblaseGefuellt,
  IconSprechblaseRund,
  IconFunkmast,
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
  | 'dokumente'
  | 'lagemeldungen'
  | 'nachforderungen';
/**
 * Module, deren Zähler der BROWSER aus der eigenen Modulliste rechnet: `abloesung` hängt an der
 * Uhr (Vorwarnzeit), `evakuierung` teilt sich die Übersicht mit Seite und Kennzahl, `betreuung`
 * mit der Seite, `wetter-pegel` zählt Unwetterwarnungen aus einer externen Quelle ohne
 * Live-Ereignis (LFH-663).
 */
export type ClientZaehlerQuelle = 'abloesung' | 'betreuung' | 'evakuierung' | 'wetter-pegel';
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
  /**
   * Kurzbeschreibung aus wenigen Fachwörtern, zweite Zeile im Modulmenü und in der Sprungpalette
   * (LFH-965, Spec `modul-benennung`). Kein Satz, keine Bedienung, keine Technik.
   */
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
    beschreibung: 'Kennzahlen, Fristen, Entscheidungen',
  },
  {
    key: 'einsatzdaten',
    kategorie: 'fuehrung',
    label: 'Einsatzdaten',
    icon: IconDokument,
    route: 'einsatzdaten',
    status: 'fertig',
    beschreibung: 'Bezeichnung, Stichwort, Zeiten, Leitung',
  },
  {
    key: 'einsatzabschnitte',
    kategorie: 'fuehrung',
    label: 'Einsatzabschnitte',
    icon: IconOrganigramm,
    route: 'einsatzabschnitte',
    status: 'fertig',
    beschreibung: 'Abschnitte und ihre Einheiten',
    zaehlerQuelle: 'einsatzabschnitte',
  },
  {
    key: 'auftraege',
    kategorie: 'fuehrung',
    label: 'Aufträge/Befehle',
    icon: IconKlemmbrettListe,
    route: 'auftraege',
    status: 'fertig',
    beschreibung: 'Aufträge, Befehle, Quittungen',
    zaehlerQuelle: 'auftraege',
  },
  // LLH-1111: eigenes Modul, unabhängig von der Stab-Freigabe (Führungsstufe B/C ohne Stab).
  {
    key: 'lagebesprechung',
    kategorie: 'fuehrung',
    label: 'Lagebesprechung',
    icon: IconBesprechungstisch,
    route: 'lagebesprechung',
    status: 'fertig',
    beschreibung: 'Termin, Vorbereitung, Entschluss',
  },
  {
    key: 'stab',
    kategorie: 'fuehrung',
    label: 'Stab',
    icon: IconGebaeudegruppe,
    route: 'stab',
    status: 'fertig',
    beschreibung: 'S1–S6, Besetzung',
  },
  {
    key: 'dokumente',
    kategorie: 'fuehrung',
    label: 'Dokumente',
    icon: IconDokumente,
    route: 'dokumente',
    status: 'fertig',
    beschreibung: 'Lagepläne, Formulare, Fotos',
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
    beschreibung: 'Status, Stärke, Gliederung',
  },
  {
    key: 'einheiten',
    kategorie: 'kraefte',
    label: 'Einheiten',
    icon: IconPersonengruppe,
    route: 'einheiten',
    status: 'fertig',
    beschreibung: 'Führer, Mannschaft, Fahrzeug',
    zaehlerQuelle: 'einheiten',
  },
  {
    key: 'personal',
    kategorie: 'kraefte',
    label: 'Personal',
    icon: IconPerson,
    route: 'personal',
    status: 'fertig',
    beschreibung: 'Einsatzkräfte, Ad-hoc-Kräfte',
  },
  {
    key: 'fahrzeuge',
    kategorie: 'kraefte',
    label: 'Fahrzeuge',
    icon: IconLkw,
    route: 'fahrzeuge',
    status: 'fertig',
    beschreibung: 'Disponierte Fahrzeuge',
  },
  {
    key: 'material',
    kategorie: 'kraefte',
    label: 'Material',
    icon: IconKistenstapel,
    route: 'material',
    status: 'fertig',
    beschreibung: 'Material, Verbrauchsgüter',
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
    beschreibung: 'Portionen, Sonderkost, Ausgabe',
  },
  {
    key: 'bereitstellungsraeume',
    kategorie: 'kraefte',
    label: 'Bereitstellungsräume',
    icon: IconLagerhalle,
    route: 'bereitstellungsraeume',
    status: 'fertig',
    beschreibung: 'Bereitgestellte Einheiten und Fahrzeuge',
  },
  {
    // LLH-1078: aus „Kommunikation“ hierher, dort sucht die Führung Kräfte. Schlüssel und Route
    // bleiben (Deeplinks, gespeicherte Standard-Module, Freigaben). Die Beschreibung trägt
    // „Anforderung“ vorn, damit die Sprungpalette das Modul auch darunter findet. Der Zähler nennt
    // die offenen (angefordert, zugesagt, unterwegs).
    key: 'nachforderungen',
    kategorie: 'kraefte',
    label: 'Nachforderungen',
    icon: IconKistenstapel,
    route: 'nachforderungen',
    status: 'fertig',
    beschreibung: 'Anforderung, Zusage, Eintreffen',
    zaehlerQuelle: 'nachforderungen',
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
    beschreibung: 'Schichten, fällige Ablösungen',
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
    beschreibung: 'Einsatztagebuch',
    zaehlerQuelle: 'etb',
  },
  {
    key: 'personen',
    kategorie: 'erfassung',
    label: 'Betroffene',
    icon: IconPersonen,
    route: 'personen',
    status: 'fertig',
    beschreibung: 'Vermisste, Betroffene, Patienten',
    zaehlerQuelle: 'personen',
  },
  {
    key: 'unfallhilfsstellen',
    kategorie: 'erfassung',
    label: 'Unfallhilfsstellen',
    icon: IconArzttasche,
    route: 'unfallhilfsstellen',
    status: 'fertig',
    beschreibung: 'Behandlungsplätze, Belegung, Material',
  },
  {
    // Räumung als MENGE mit Zeitbezug, seit LLH-1034 ein eigenes Modul neben der Betreuung. Der
    // Zähler nennt die aktiven Evakuierungsbezirke; dieselbe Übersicht speist die Kennzahl
    // „Evakuiert". Reihenfolge wie `MODUL_KEYS` im Backend.
    key: 'evakuierung',
    kategorie: 'erfassung',
    label: 'Evakuierung',
    icon: IconAbmelden,
    route: 'evakuierung',
    status: 'fertig',
    beschreibung: 'Räumungsbezirke, Stand evakuiert',
    zaehlerQuelle: 'evakuierung',
  },
  {
    // Unterbringung als MENGE mit Zeitbezug. Der Zähler nennt die Stellen in Betrieb.
    key: 'betreuung',
    kategorie: 'erfassung',
    label: 'Betreuung',
    icon: IconHausHerz,
    route: 'betreuung',
    status: 'fertig',
    beschreibung: 'Betreuungsstellen, Unterbringung',
    zaehlerQuelle: 'betreuung',
  },
  {
    key: 'tiere',
    kategorie: 'erfassung',
    label: 'Tiere',
    icon: IconPfote,
    route: 'tiere',
    status: 'fertig',
    beschreibung: 'Betroffene Tiere',
  },
  {
    key: 'schaeden',
    kategorie: 'erfassung',
    label: 'Schäden',
    icon: IconHaus,
    route: 'schaeden',
    status: 'fertig',
    beschreibung: 'Sach-, Infrastruktur-, Umweltschäden',
  },
  // Lage
  {
    key: 'lage-dashboard',
    kategorie: 'lage',
    label: 'Lagebild',
    icon: IconKachelraster,
    route: 'lage-dashboard',
    status: 'fertig',
    beschreibung: 'Lage in Zahlen, jüngste ETB-Einträge',
  },
  {
    key: 'lagekarte',
    kategorie: 'lage',
    label: 'Lagekarte',
    icon: IconKarte,
    route: 'lagekarte',
    status: 'fertig',
    beschreibung: 'Einsatzort, Objekte, Gefahrengebiete',
  },
  {
    key: 'lageberichte',
    kategorie: 'lage',
    label: 'Lageberichte',
    icon: IconBericht,
    route: 'lageberichte',
    status: 'fertig',
    beschreibung: 'Gegliederte Lageberichte',
  },
  {
    key: 'gefahrenzonen',
    kategorie: 'lage',
    label: 'Gefahren',
    icon: IconWarndreieck,
    route: 'gefahren',
    status: 'fertig',
    beschreibung: 'Gefahrenmatrix, Warnstufen',
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
    beschreibung: 'Pegel, DWD-Warnungen, Vorhersage',
  },
  {
    key: 'lagemeldungen',
    kategorie: 'lage',
    label: 'Lagemeldungen',
    icon: IconPapierflieger,
    route: 'lagemeldungen',
    status: 'fertig',
    // Neue, für alle gleich: noch von niemandem als gesehen gekennzeichnet (LLH-1206).
    zaehlerQuelle: 'lagemeldungen',
    beschreibung: 'Lagerelevante Meldungen',
  },
  // Kommunikation
  {
    key: 'chat',
    kategorie: 'kommunikation',
    label: 'Chat',
    icon: IconSprechblaseRund,
    route: 'chat',
    status: 'fertig',
    beschreibung: 'Nachrichten im Einsatz',
    zaehlerQuelle: 'chat',
  },
  {
    key: 'erinnerungen',
    kategorie: 'kommunikation',
    label: 'Erinnerungen',
    icon: IconGlocke,
    route: 'erinnerungen',
    status: 'fertig',
    beschreibung: 'Termine, Fristen',
    zaehlerQuelle: 'erinnerungen',
  },
  {
    key: 'meldungen',
    kategorie: 'kommunikation',
    label: 'Meldungen',
    icon: IconPosteingang,
    route: 'meldungen',
    status: 'fertig',
    beschreibung: 'Eingang, Ausgang, Bearbeitung',
    zaehlerQuelle: 'meldungen',
  },
  // LLH-1180: S6 als eigenes Modul, unabhängig von der Stab-Freigabe (ELW 1 ohne Stab). Die
  // Beschreibung trägt „Funkplan“ vorn, damit „Funk“ in der Palette trifft (40 Zeichen, D1).
  {
    key: 'fernmeldewesen',
    kategorie: 'kommunikation',
    label: 'Fernmeldewesen',
    icon: IconFunkmast,
    route: 'fernmeldewesen',
    status: 'fertig',
    beschreibung: 'Funkplan, Skizze, Kommunikationsplan',
  },
  // Einstellungen
  {
    key: 'einsatz-einstellungen',
    kategorie: 'einstellungen',
    label: 'Einstellungen',
    icon: IconZahnrad,
    route: 'einstellungen',
    status: 'fertig',
    beschreibung: 'Module, Darstellung, Einstieg',
  },
];

/**
 * Der eine sichtbare Name eines Moduls (LFH-965, Spec `modul-benennung`): Menü, h1, letzter
 * Pfadeintrag, Sprungpalette und Tab. Seiten holen ihren Titel hier statt aus einem eigenen
 * String. Ein unbekannter Schlüssel ist ein Programmierfehler und wirft.
 */
export function modulName(key: string): string {
  const modul = modulRegistry.find((m) => m.key === key);
  if (!modul) throw new Error(`Unbekanntes Modul: ${key}`);
  return modul.label;
}

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
  const altpfad = ALTPFAD_MODUL[`${teile[2]}/${teile[3]}`];
  if (altpfad) return modulZuRoute(altpfad, register);
  return modulZuRoute(teile[2], register);
}

/**
 * Altpfade, die auf ein anderes Modul umleiten (LLH-1180, design.md D7): Sie gehören dem Ziel der
 * Weiterleitung, damit der Rahmen sie nach dessen Freigabe gatet. Sonst finge ein ausgeblendeter
 * Stab `stab/funkplan` ab, bevor die Weiterleitung ins Fernmeldewesen läuft. Spiegel von
 * `PFAD_KEY` im Backend (`src/einsatz/modul.rs`), wo dieselben Pfade per längstem Präfix
 * `fernmeldewesen` gehören.
 */
const ALTPFAD_MODUL: Readonly<Record<string, string>> = {
  'stab/funkplan': 'fernmeldewesen',
  'stab/kommunikationsplan': 'fernmeldewesen',
};

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
 * Grund einer Sperre an einem Bedienelement (M16: erklären statt stumm wegschalten). EINE
 * Konstante für Navigation, Sprungstellen und Kartenebenen: eine abweichende Fassung fiele
 * niemandem auf, weil jede Stelle für sich plausibel aussieht.
 */
export const KEINE_BERECHTIGUNG = 'Keine Berechtigung';

/**
 * Ist ein Sprung in das Modul `key` gesperrt (LFH-888, Spec `modul-freigabe`)? Die Lesart der
 * Navigation ({@link istModulGesperrt}): gesperrt nur, wenn der Server `zugriff: false` meldet.
 * Solange die Freigaben unbekannt sind, steht der Sprung offen — ein Kopfknopf, der beim Laden
 * gesperrt aufblitzt, wäre falsch, und ein früher Klick landet im Modulwächter des Rahmens.
 * NICHT {@link istKeyFreigegeben}: dessen strenge Lesart ist für Datenabrufe gedacht.
 */
export function istSprungGesperrt(key: string, freigaben?: ModulFreigaben): boolean {
  return freigaben?.[key]?.zugriff === false;
}

/**
 * {@link istSprungGesperrt} über einen fertigen Zielpfad (`/einsaetze/:id/<route>/…?…`): für Stellen,
 * deren Ziel erst aus Daten entsteht (Kennzahlen des Lagebilds). Ein Pfad außerhalb eines Moduls
 * ist nie gesperrt.
 */
export function istPfadGesperrt(pfad: string, freigaben?: ModulFreigaben): boolean {
  const modul = modulAusPfad(pfad.split(/[?#]/)[0]);
  return modul != null && istSprungGesperrt(modul.key, freigaben);
}

/**
 * Rückweg aus einer Sackgasse (Modulwächter, Platzhalter, Stab ohne Freigabe; LFH-888): das
 * Standardmodul des Einsatzes, wenn es frei ist, sonst der Überblick, sonst das erste freie Modul
 * in Registry-Reihenfolge, zuletzt die Einsatzdaten (nie gesperrt). „Frei" in der strengen Lesart
 * ({@link istModulFreigegeben}), damit der Rückweg nie selbst in den Wächter führt. Den Pfad baut
 * der Aufrufer über {@link modulZielRoute}.
 */
export function freiesRueckwegModul(
  freigaben: ModulFreigaben | undefined,
  standardModul?: string | null,
  register: ModulEintrag[] = modulRegistry,
): ModulEintrag {
  const frei = (key: string | null | undefined) => {
    const modul = register.find((m) => m.key === key);
    return modul && istModulFreigegeben(modul, freigaben) ? modul : undefined;
  };
  return (
    frei(standardModul) ??
    frei('ueberblick') ??
    register.find((m) => istModulFreigegeben(m, freigaben)) ??
    register.find((m) => m.key === 'einsatzdaten')!
  );
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
