import type { FachebeneQuelle } from './fachebenen';
import type { EtbTyp } from './types';

/**
 * Query-Key-Registry (LFH-122/307) mit zwei Hälften: `einsatzKeys` für alles unter einer
 * `einsatzId` und `globalKeys` für alles darüber (Mandant, Stammdaten-Kataloge, Instanz,
 * externe Quellen).
 *
 * `useEinsatzLiveStream` leitet Listener, Invalidierung UND den lagged-Vollabgleich aus
 * {@link EINSATZ_STREAM_EVENTS} ab, die Org-Ereignisse und den Org-Abgleich aus
 * {@link ORG_STREAM_EVENTS}/{@link ORG_LIVE_KEYS} (`live/orgListener.ts`, LFH-734); ein neues
 * Live-Modul ist EIN Eintrag hier. `queryKeys.guard.test.ts` verlangt, dass Prefixe nur hier als Literal vorkommen und
 * kein Inline-String-Array als Query-Key dient.
 */

/** Query-Key-Prefixe (erstes Element eines `[prefix, einsatzId, …]`-Keys). */
export const EINSATZ_KEYS = {
  uhs: 'einsatz-uhs',
  schaeden: 'einsatz-schaeden',
  // Fotos und Dateien an einem Schaden: eigener Prefix neben der Schadensliste, live über das
  // `schaden`-Ereignis.
  schadenAnhaenge: 'einsatz-schaden-anhaenge',
  fahrzeuge: 'einsatz-fahrzeuge',
  material: 'einsatz-material',
  tiere: 'einsatz-tiere',
  zonen: 'einsatz-zonen',
  freieZeichen: 'einsatz-freie-zeichen',
  gefahrengebiete: 'gefahrengebiete',
  gefahrenmatrix: 'gefahrenmatrix',
  einheiten: 'einsatz-einheiten',
  fuehrungskraefte: 'einsatz-fuehrungskraefte',
  personal: 'einsatz-personal',
  abschnitte: 'einsatz-abschnitte',
  personen: 'einsatz-personen',
  lageberichte: 'einsatz-lageberichte',
  lagebericht: 'einsatz-lagebericht',
  chatKanaele: 'einsatz-chat-kanaele',
  chatNachrichten: 'einsatz-chat-nachrichten',
  erinnerungen: 'einsatz-erinnerungen',
  auftraege: 'einsatz-auftraege',
  nachforderungen: 'einsatz-nachforderungen',
  meldungen: 'einsatz-meldungen',
  lagemeldungen: 'einsatz-lagemeldungen',
  br: 'einsatz-br',
  brDetail: 'einsatz-br-detail',
  kartenbilder: 'einsatz-kartenbilder',
  etb: 'etb',
  befehle: 'einsatz-befehle',
  befehl: 'einsatz-befehl',
  kartenAnsicht: 'einsatz-karten-ansicht',
  lageSnapshot: 'einsatz-lage-snapshot',
  stab: 'einsatz-stab',
  // Modulzähler des Navigationsrahmens: hängt an jedem Ereignis, das die Liste eines gezählten
  // Moduls invalidiert (Vollständigkeit: `queryKeys.test.ts`).
  modulZaehler: 'einsatz-modul-zaehler',
  dokumente: 'einsatz-dokumente',
  abloesungen: 'einsatz-abloesungen',
  // Kräfte-Zeitachse (LFH-552): Perioden je Einheit/Person und Zeitachse einer Kraft unter EINEM
  // Prefix. Kein eigenes Live-Ereignis — jedes Ereignis entsteht in einer Transaktion, die
  // `einheit`, `personal`, `fahrzeug` oder `abloesung` ohnehin sendet.
  kraefteZeitachse: 'einsatz-kraefte-zeitachse',
  betreuung: 'einsatz-betreuung',
  verpflegung: 'einsatz-verpflegung',
  // Presse- und Medienarbeit S5 (LFH-554): Presse-Log und Pressemitteilungen unter EINEM Prefix,
  // das Informationstelefon unter einem eigenen. Beide NICHT im Lagebild offline (Personenbezug).
  presse: 'einsatz-presse',
  infotelefon: 'einsatz-infotelefon',
  // Einsatzkopf, live über das `einsatz`-Ereignis (LFH-555).
  einsatz: 'einsatz',
  // Nicht live über SSE getrieben (siehe NICHT_LIVE_KEYS + Guard-Test):
  einstellungen: 'einsatz-einstellungen',
  mitglieder: 'einsatz-mitglieder',
  sprechgruppen: 'einsatz-sprechgruppen',
  modulOverrides: 'einsatz-modul-overrides',
  // Effektive Modulfreigaben des angemeldeten Benutzers (LFH-669); daraus liest das Modul-Gate.
  modulFreigaben: 'einsatz-modul-freigaben',
  ortVorschau: 'ort-vorschau',
  // Auf dem Gerät dekodierte HEIC-Vorschau eines Anhangs (LFH-759): Object-URLs, die
  // `erzeugeQueryClient` beim Verlassen des Caches freigibt.
  anhangHeicVorschau: 'einsatz-anhang-heic-vorschau',
  // Adresssuche der Lagekarte (LFH-638): Suchtext → Treffer des Geocoders.
  ortSuche: 'ort-suche',
  // Singular-Detail-Keys: der SSE-Fan-out invalidiert die Listen-Prefixe, nicht diese (eigenes
  // erstes Element, kein Prefix-Match). Bewusst NICHT_LIVE.
  uhsDetail: 'einsatz-uhs-detail',
  person: 'einsatz-person',
  personAudit: 'einsatz-person-audit',
  tier: 'einsatz-tier',
  schaden: 'einsatz-schaden',
  // Snapshot-Dokument: eigener Prefix, damit die Listen-Invalidierung (`lage_snapshot`) die
  // unveränderlichen Dokumente nicht per Prefix mit-refetcht.
  lageSnapshotDokument: 'einsatz-lage-snapshot-dokument',
  // Maßgebliche Pegel mit Messung: kein Live-Event, 5-min-Nachfrage.
  pegel: 'einsatz-pegel',
  // Wetter am Einsatzort: DWD-Warnungen + Vorhersage, kein Live-Event.
  wetter: 'einsatz-wetter',
  // ETB-Druckansicht: Schnappschuss, eigener Prefix außerhalb von `etb`.
  etbDruck: 'einsatz-etb-druck',
  // Druck der Modul-Listen (LFH-727): Schnappschüsse, eigene Prefixe außerhalb der Listen.
  personenDruck: 'einsatz-personen-druck',
  tiereDruck: 'einsatz-tiere-druck',
  schaedenDruck: 'einsatz-schaeden-druck',
  // Einsatzbericht: ein Schnappschuss über alle Quellen (LFH-726).
  einsatzberichtDruck: 'einsatz-einsatzbericht-druck',
} as const;

export type EinsatzKey = (typeof EINSATZ_KEYS)[keyof typeof EINSATZ_KEYS];

/** Wessen Meldereihe ein Betreuungsverlauf trägt: Standmeldungen eines Bezirks oder
 *  Belegungsmeldungen einer Stelle. Getyptes Token als Sub-Key, kein Objekt. */
export type BetreuungVerlaufArt = 'bezirk' | 'stelle';

/**
 * Wire-Event-Name (SSE `type`) → die Query-Key-Prefixe, die das Event invalidiert.
 * NICHT enthalten:
 * - `sofortmeldung`: hat Seiteneffekte (Ton + window-CustomEvent) → im Hook als Escape-Hatch,
 *   invalidiert die `meldung`-Keys.
 * - `lagged`: rein abgeleitet (Union aller Keys hier, dedupliziert) → im Hook.
 */
export const EINSATZ_STREAM_EVENTS = {
  uhs: [EINSATZ_KEYS.uhs],
  // Ablegen und Entfernen einer Datei verteilen `schaden`; die Anhangliste der Detailseite hängt
  // deshalb mit daran.
  schaden: [EINSATZ_KEYS.schaeden, EINSATZ_KEYS.schadenAnhaenge],
  // Der Status einer Einheit ist aus ihren Fahrzeugen abgeleitet.
  // Ein markierter Fahrzeugstatus schreibt die Zeitachse seiner Einheit (LFH-552).
  fahrzeug: [
    EINSATZ_KEYS.fahrzeuge,
    EINSATZ_KEYS.einheiten,
    EINSATZ_KEYS.modulZaehler,
    EINSATZ_KEYS.kraefteZeitachse,
  ],
  material: [EINSATZ_KEYS.material],
  tier: [EINSATZ_KEYS.tiere],
  lage_zone: [EINSATZ_KEYS.zonen, EINSATZ_KEYS.gefahrengebiete],
  freies_zeichen: [EINSATZ_KEYS.freieZeichen],
  gefahr: [EINSATZ_KEYS.gefahrenmatrix, EINSATZ_KEYS.gefahrengebiete],
  einheit: [
    EINSATZ_KEYS.einheiten,
    EINSATZ_KEYS.fuehrungskraefte,
    // Mitglieder-Zuordnungen an Einheiten betreffen auch Personal-, Fahrzeug- und Material-Listen.
    EINSATZ_KEYS.personal,
    EINSATZ_KEYS.fahrzeuge,
    EINSATZ_KEYS.material,
    EINSATZ_KEYS.modulZaehler,
    // Ablösungsschichten tragen den Einheitsnamen per Join, und das Auflösen einer Einheit entfernt
    // ihre Schichten; beides feuert nur `einheit`.
    EINSATZ_KEYS.abloesungen,
    // Handstatus, Nachtrag und Streichung an einer Einheit (LFH-552).
    EINSATZ_KEYS.kraefteZeitachse,
  ],
  // Abschnittsname und -liste speisen die Rhythmus-Vorgaben der Ablösung; Bezirke und
  // Betreuungsstellen tragen den Abschnittsnamen per Join. Umbenennen oder Löschen eines
  // Abschnitts feuert nur dieses Ereignis.
  abschnitt: [
    EINSATZ_KEYS.abschnitte,
    EINSATZ_KEYS.fuehrungskraefte,
    EINSATZ_KEYS.modulZaehler,
    EINSATZ_KEYS.abloesungen,
    EINSATZ_KEYS.betreuung,
  ],
  // Betroffene Personen (Modul `personen`); `personal` ist ein eigenes Ereignis. Die
  // Betreuungsübersicht trägt „davon namentlich n“ je Stelle, das sich mit jedem Verbleib ändert.
  // Kein zweites Server-Ereignis: `person` erreicht nur Leser mit Personenrecht, und nur die sehen
  // die Zahl.
  person: [EINSATZ_KEYS.personen, EINSATZ_KEYS.modulZaehler, EINSATZ_KEYS.betreuung],
  // Disponiertes Personal (Modul `personal`) — die Zuordnung wirkt zugleich auf
  // Einheiten-/Abschnittsführung und die Führungskräfte-Sicht der Lagekarte.
  personal: [
    EINSATZ_KEYS.personal,
    EINSATZ_KEYS.einheiten,
    EINSATZ_KEYS.abschnitte,
    EINSATZ_KEYS.fuehrungskraefte,
    EINSATZ_KEYS.modulZaehler,
    // Statuswechsel, Nachtrag, Streichung und Fan-out an einer Person (LFH-552).
    EINSATZ_KEYS.kraefteZeitachse,
  ],
  lagebericht: [EINSATZ_KEYS.lageberichte, EINSATZ_KEYS.lagebericht],
  chat: [EINSATZ_KEYS.chatKanaele, EINSATZ_KEYS.chatNachrichten, EINSATZ_KEYS.modulZaehler],
  erinnerung: [EINSATZ_KEYS.erinnerungen, EINSATZ_KEYS.modulZaehler],
  auftrag: [EINSATZ_KEYS.auftraege, EINSATZ_KEYS.modulZaehler],
  nachforderung: [EINSATZ_KEYS.nachforderungen],
  meldung: [EINSATZ_KEYS.meldungen, EINSATZ_KEYS.lagemeldungen, EINSATZ_KEYS.modulZaehler],
  // Liste + Detail (Prefix-Match: ['einsatz-br-detail', einsatzId] trifft alle brIds).
  bereitstellungsraum: [EINSATZ_KEYS.br, EINSATZ_KEYS.brDetail],
  karte_bild: [EINSATZ_KEYS.kartenbilder],
  // Prefix-Match deckt ['etb', einsatzId, filter] mit ab.
  etb: [EINSATZ_KEYS.etb, EINSATZ_KEYS.modulZaehler],
  // Invalidiert Befehls-Liste UND -Detail (Prefix-Match trifft alle befehlIds).
  befehl: [EINSATZ_KEYS.befehle, EINSATZ_KEYS.befehl],
  // „Für den Einsatz speichern“ aktualisiert den Ansichts-Switcher aller Betrachter.
  karten_ansicht: [EINSATZ_KEYS.kartenAnsicht],
  lage_snapshot: [EINSATZ_KEYS.lageSnapshot],
  // Führungsorganisation (Besetzung S1–S6, Lagebesprechungen). Die Lagebesprechungs-Historie hängt
  // als Sub-Key unter DEMSELBEN Prefix, sonst entstünde die Lücke der Detail-Keys oben.
  // Aufträge und Erinnerungen an ein Sachgebiet lösen zur Lesezeit auf die Besetzung auf
  // (LFH-549): ein Besetzungswechsel ändert ihre Anzeige. Beide sind gezählte Listen, deshalb geht
  // der Modulzähler mit (Regel aus `queryKeys.test.ts`), auch wenn sich die Zahl hier nicht ändert.
  stab: [
    EINSATZ_KEYS.stab,
    EINSATZ_KEYS.auftraege,
    EINSATZ_KEYS.erinnerungen,
    EINSATZ_KEYS.modulZaehler,
  ],
  // Der ETB-Nachweis kommt über das eigene `etb`-Ereignis.
  dokument: [EINSATZ_KEYS.dokumente, EINSATZ_KEYS.modulZaehler],
  // Schichten und Rhythmus-Vorgaben hängen unter EINEM Prefix (Sub-Keys 'liste'/'vorgaben'). Trägt
  // das Ereignis `art`, stammt es vom Scheduler und alarmiert zusätzlich (Escape-Hatch im Hook).
  // Der Vollzug beendet die Einsatzperiode der abgelösten Einheit (LFH-552).
  abloesung: [EINSATZ_KEYS.abloesungen, EINSATZ_KEYS.kraefteZeitachse],
  // Bezirke, Stellen und ihre Meldereihen unter EINEM Prefix, damit ein Ereignis Übersicht und
  // Kopfzahl trifft. Nutzlast nur Kennungen.
  betreuung: [EINSATZ_KEYS.betreuung],
  // Zeitfenster samt Deckung und Ausgaben unter EINEM Prefix. Kein Fan-out von `nachforderung`:
  // das DTO trägt nur die Kennung.
  verpflegung: [EINSATZ_KEYS.verpflegung],
  // Einsatzkopf (LFH-555). Der Stab-GET liefert den Termin der nächsten Lagebesprechung aus
  // derselben Spalte mit (LFH-46, Entscheidung 11), deshalb hängt er hier mit dran: eine
  // Terminwahrheit, zwei Caches. Die benutzerbezogenen Kopffelder (`meine_*`) und
  // `lagekennzahlen` lösen das Ereignis nicht aus; sie werden beim nächsten Abruf frisch.
  einsatz: [EINSATZ_KEYS.einsatz, EINSATZ_KEYS.stab],
  // Medienkontakte, Pressemitteilungen und ihre Details unter EINEM Prefix. Die Freigabe schreibt
  // den ETB-Snapshot; der kommt über das eigene `etb`-Ereignis.
  presse: [EINSATZ_KEYS.presse],
  infotelefon: [EINSATZ_KEYS.infotelefon],
} as const satisfies Record<string, readonly EinsatzKey[]>;

export type EinsatzStreamEvent = keyof typeof EINSATZ_STREAM_EVENTS;

/**
 * Managed einsatz-scoped Keys, die BEWUSST nicht über den SSE-Live-Feed invalidiert werden.
 * `queryKeys.guard.test.ts` verlangt, dass jeder Key aus {@link EINSATZ_KEYS} entweder in
 * {@link EINSATZ_STREAM_EVENTS} auftaucht ODER hier steht.
 *
 * - `einstellungen`/`mitglieder`/`sprechgruppen`: selten geändert, kein Live-Event. Der
 *   Einsatzkopf `einsatz` ist seit LFH-555 live.
 * - `uhsDetail`/`person`/`personAudit`/`tier`/`schaden`: Singular-Detail-Keys, die der
 *   Listen-Prefix-Match nicht erreicht.
 * - `modulOverrides`: das Backend kennt kein LiveEvent dafür (`LiveEvent::ALLE`); ein Override
 *   eines anderen Nutzers propagiert nicht live.
 * - `modulFreigaben`: abgeleitet aus Overrides und Org-Vorgaben, beide ohne LiveEvent (LFH-669).
 *   Die eigene Änderung invalidiert die Mutation; die eines anderen wirkt beim nächsten Abruf,
 *   das 403 der Server-Gates bleibt das Netz.
 * - `ortVorschau`: abgeleiteter Geo-Lookup mit Debounce + Client-Cache; live zu invalidieren
 *   wäre schädlich (Nominatim-ToS).
 * - `ortSuche`: Adresssuche auf Enter (LFH-638), aus demselben Grund nie live; bewusst auch
 *   nicht im Lagebild offline (der Suchtext kann eine Personenadresse sein).
 * - `pegel`: kein Live-Ereignis; die Abfrage fragt alle 5 min nach (`PEGEL_ABRUF_MS`), die
 *   Mutationen setzen die Antwort per `setQueryData`.
 * - `wetter`: externe Quelle (Bright Sky), 5-min-Nachfrage.
 * - `etbDruck`: ein Druckbeleg ist ein Schnappschuss; ein neuer Eintrag darf ihn nicht still
 *   ergänzen („Neu laden“ ist eine ausdrückliche Handlung). Deshalb der eigene Prefix: unter
 *   `etb` zöge ihn das `etb`-Ereignis per Präfix mit.
 * - `personenDruck`/`tiereDruck`/`schaedenDruck` (LFH-727): dieselbe Begründung wie `etbDruck`
 *   für die Druckansichten der Modul-Listen. Beim Personendruck kommt hinzu: jeder Abruf ist ein
 *   Eintrag im Zugriffsprotokoll, ein Live-Refetch schriebe also Protokollzeilen ohne Handlung.
 * - `einsatzberichtDruck`: derselbe Schnappschuss-Grundsatz für den Einsatzbericht (LFH-726): EIN
 *   Stand über alle Quellen; ein Modul-Ereignis darf den geöffneten Bericht nicht still ändern.
 * - `anhangHeicVorschau` (LFH-759): ein Anhang ändert sich nie, die Schwärzung löscht ihn nur;
 *   ein Live-Refetch dekodierte dasselbe HEIC noch einmal.
 */
export const NICHT_LIVE_KEYS = [
  EINSATZ_KEYS.einstellungen,
  EINSATZ_KEYS.mitglieder,
  EINSATZ_KEYS.sprechgruppen,
  EINSATZ_KEYS.modulOverrides,
  EINSATZ_KEYS.modulFreigaben,
  EINSATZ_KEYS.ortVorschau,
  EINSATZ_KEYS.ortSuche,
  EINSATZ_KEYS.anhangHeicVorschau,
  EINSATZ_KEYS.uhsDetail,
  EINSATZ_KEYS.person,
  EINSATZ_KEYS.personAudit,
  EINSATZ_KEYS.tier,
  EINSATZ_KEYS.schaden,
  EINSATZ_KEYS.lageSnapshotDokument,
  EINSATZ_KEYS.pegel,
  EINSATZ_KEYS.wetter,
  EINSATZ_KEYS.etbDruck,
  EINSATZ_KEYS.personenDruck,
  EINSATZ_KEYS.tiereDruck,
  EINSATZ_KEYS.schaedenDruck,
  EINSATZ_KEYS.einsatzberichtDruck,
] as const satisfies readonly EinsatzKey[];

/**
 * Typisierte Key-Factory für alle einsatz-scoped Queries. Konvention: 2-elementige Funktionen
 * `[prefix, einsatzId]` sind zugleich der Invalidierungs-Prefix (TanStack matcht per Prefix);
 * Detail-/Filter-Varianten hängen weitere Elemente an.
 */
/** Sub-Key der Rückmeldungen unter dem `meldungen`-Prefix. */
const RUECKMELDUNGEN_SUBKEY = 'rueckmeldungen';

/**
 * Trifft die Rückmeldungen ALLER Einsätze. Die Fälligkeit rechnet der Server aus der
 * Rückmeldefrist; ändert eine Org-Vorgabe sie, meldet das kein Live-Ereignis.
 */
export function istRueckmeldungenKey(key: readonly unknown[]): boolean {
  return key[0] === EINSATZ_KEYS.meldungen && key[2] === RUECKMELDUNGEN_SUBKEY;
}

/** Alle einsatz-scoped Prefixe als Menge — Grundlage von {@link istKeyDesEinsatzes}. */
const EINSATZ_PREFIXE: ReadonlySet<unknown> = new Set<unknown>(Object.values(EINSATZ_KEYS));

/**
 * Trifft JEDEN einsatz-scoped Key eines Einsatzes, Listen wie Detail- und Sub-Keys (nach Import
 * oder Entfernen der Demo-Daten). Ein Prefix-Match reicht nicht, die Einsatz-ID steht an Stelle
 * 1 hinter vielen verschiedenen Prefixen; alle Accessoren von {@link einsatzKeys} tragen sie
 * dort.
 *
 * Seit LFH-723 auch für `removeQueries`: der Rechteentzug räumt damit alle Keys eines
 * Einsatzes (`api/queryClient.ts`). Die XOR-Auflage aus dem Kopf von {@link GLOBAL_KEYS}
 * löst das NICHT aus — die Räumung wählt nur einsatzbezogene Keys, deren Partition
 * live/nicht-live ohnehin maschinell erzwungen ist; eine Menge „alle Org-Keys" braucht sie
 * nicht.
 */
export function istKeyDesEinsatzes(key: readonly unknown[], einsatzId: number): boolean {
  return EINSATZ_PREFIXE.has(key[0]) && key[1] === einsatzId;
}

export const einsatzKeys = {
  // Einsatz-Stammdaten. einsatzId nullbar: die Kommandopalette lädt den Einsatz nur im
  // Einsatzkontext (enabled-Guard).
  einsatz: (einsatzId: number | null) => [EINSATZ_KEYS.einsatz, einsatzId] as const,
  einstellungen: (einsatzId: number) => [EINSATZ_KEYS.einstellungen, einsatzId] as const,
  mitglieder: (einsatzId: number) => [EINSATZ_KEYS.mitglieder, einsatzId] as const,
  sprechgruppen: (einsatzId: number) => [EINSATZ_KEYS.sprechgruppen, einsatzId] as const,
  // einsatzId nullbar aus demselben Grund wie bei `einsatz`.
  modulOverrides: (einsatzId: number | null) => [EINSATZ_KEYS.modulOverrides, einsatzId] as const,
  // einsatzId nullbar aus demselben Grund wie bei `einsatz`.
  modulFreigaben: (einsatzId: number | null) => [EINSATZ_KEYS.modulFreigaben, einsatzId] as const,
  // Invalidierungs-Prefix über ALLE Einsätze: eine Org-Vorgabe wirkt auf jeden Einsatz der Org.
  modulFreigabenAlle: () => [EINSATZ_KEYS.modulFreigaben] as const,

  // Personen / Personal
  personen: (einsatzId: number) => [EINSATZ_KEYS.personen, einsatzId] as const,
  // personId nullbar: der Person-Detail-Drawer rendert ohne Auswahl (enabled-Guard).
  person: (einsatzId: number, personId: number | null) =>
    [EINSATZ_KEYS.person, einsatzId, personId] as const,
  personAudit: (einsatzId: number, personId: number) =>
    [EINSATZ_KEYS.personAudit, einsatzId, personId] as const,
  personal: (einsatzId: number) => [EINSATZ_KEYS.personal, einsatzId] as const,
  fuehrungskraefte: (einsatzId: number) => [EINSATZ_KEYS.fuehrungskraefte, einsatzId] as const,

  // Struktur
  einheiten: (einsatzId: number) => [EINSATZ_KEYS.einheiten, einsatzId] as const,
  abschnitte: (einsatzId: number) => [EINSATZ_KEYS.abschnitte, einsatzId] as const,
  fahrzeuge: (einsatzId: number) => [EINSATZ_KEYS.fahrzeuge, einsatzId] as const,
  material: (einsatzId: number) => [EINSATZ_KEYS.material, einsatzId] as const,

  // UHS
  uhs: (einsatzId: number) => [EINSATZ_KEYS.uhs, einsatzId] as const,
  uhsDetail: (einsatzId: number, uhsId: number) =>
    [EINSATZ_KEYS.uhsDetail, einsatzId, uhsId] as const,

  // Schäden / Tiere (inkl. personenbezogener Kontext-Filter)
  schaeden: (einsatzId: number) => [EINSATZ_KEYS.schaeden, einsatzId] as const,
  schaedenGeschaedigt: (einsatzId: number, personId: number) =>
    [EINSATZ_KEYS.schaeden, einsatzId, 'geschaedigt', personId] as const,
  schaden: (einsatzId: number, schadenId: number) =>
    [EINSATZ_KEYS.schaden, einsatzId, schadenId] as const,
  schadenAnhaenge: (einsatzId: number, schadenId: number) =>
    [EINSATZ_KEYS.schadenAnhaenge, einsatzId, schadenId] as const,
  tiere: (einsatzId: number) => [EINSATZ_KEYS.tiere, einsatzId] as const,
  tiereHalter: (einsatzId: number, personId: number) =>
    [EINSATZ_KEYS.tiere, einsatzId, 'halter', personId] as const,
  tier: (einsatzId: number, tierId: number) => [EINSATZ_KEYS.tier, einsatzId, tierId] as const,

  // Lage
  zonen: (einsatzId: number) => [EINSATZ_KEYS.zonen, einsatzId] as const,
  freieZeichen: (einsatzId: number) => [EINSATZ_KEYS.freieZeichen, einsatzId] as const,
  kartenAnsicht: (einsatzId: number) => [EINSATZ_KEYS.kartenAnsicht, einsatzId] as const,
  lageSnapshot: (einsatzId: number) => [EINSATZ_KEYS.lageSnapshot, einsatzId] as const,
  lageSnapshotDokument: (einsatzId: number, snapshotId: number) =>
    [EINSATZ_KEYS.lageSnapshotDokument, einsatzId, snapshotId] as const,
  gefahrengebiete: (einsatzId: number) => [EINSATZ_KEYS.gefahrengebiete, einsatzId] as const,
  gefahrenmatrix: (einsatzId: number, gewaehlt: number | null) =>
    [EINSATZ_KEYS.gefahrenmatrix, einsatzId, gewaehlt] as const,
  lageberichte: (einsatzId: number) => [EINSATZ_KEYS.lageberichte, einsatzId] as const,
  lagebericht: (einsatzId: number, berichtId: number) =>
    [EINSATZ_KEYS.lagebericht, einsatzId, berichtId] as const,
  kartenbilder: (einsatzId: number) => [EINSATZ_KEYS.kartenbilder, einsatzId] as const,
  // Maßgebliche Pegel, NICHT live (siehe NICHT_LIVE_KEYS).
  pegel: (einsatzId: number) => [EINSATZ_KEYS.pegel, einsatzId] as const,
  /** Vorschlag aus der Vorhersage-Reihe `WV` je Pegel, Sub-Key unter demselben Prefix. */
  pegelVorhersage: (einsatzId: number, pegelId: number) =>
    [EINSATZ_KEYS.pegel, einsatzId, 'vorhersage', pegelId] as const,
  /** 24-h-Verlauf aller Pegel, Sub-Key unter demselben, nicht-live Prefix. */
  pegelVerlauf: (einsatzId: number) => [EINSATZ_KEYS.pegel, einsatzId, 'verlauf'] as const,
  /** Wetter am Einsatzort, NICHT live (siehe NICHT_LIVE_KEYS). */
  wetter: (einsatzId: number) => [EINSATZ_KEYS.wetter, einsatzId] as const,
  // ETB-Druckansicht: Vollabruf einer Auswahl, nicht live (siehe NICHT_LIVE_KEYS).
  etbDruck: <F>(einsatzId: number, filter: F) =>
    [EINSATZ_KEYS.etbDruck, einsatzId, filter] as const,
  // Druck der Modul-Listen (LFH-727): Vollabruf ohne Filter im Key, nicht live (siehe
  // NICHT_LIVE_KEYS). Der Filter wählt im Client aus der geladenen Menge.
  personenDruck: (einsatzId: number) => [EINSATZ_KEYS.personenDruck, einsatzId] as const,
  tiereDruck: (einsatzId: number) => [EINSATZ_KEYS.tiereDruck, einsatzId] as const,
  schaedenDruck: (einsatzId: number) => [EINSATZ_KEYS.schaedenDruck, einsatzId] as const,
  // Einsatzbericht: alle Quellen in einem Abruf, nicht live (siehe NICHT_LIVE_KEYS).
  einsatzberichtDruck: (einsatzId: number) =>
    [EINSATZ_KEYS.einsatzberichtDruck, einsatzId] as const,

  // Stab: Führungsorganisation S1–S6.
  stab: (einsatzId: number) => [EINSATZ_KEYS.stab, einsatzId] as const,
  // Ablösung: argumentlos = Invalidierungs-Prefix; Liste je Statusfilter und Rhythmus-Vorgaben
  // hängen als Sub-Keys darunter.
  abloesungen: (einsatzId: number) => [EINSATZ_KEYS.abloesungen, einsatzId] as const,
  abloesungListe: (einsatzId: number, status: 'laufend' | 'abgeloest') =>
    [EINSATZ_KEYS.abloesungen, einsatzId, 'liste', status] as const,
  abloesungVorgaben: (einsatzId: number) =>
    [EINSATZ_KEYS.abloesungen, einsatzId, 'vorgaben'] as const,
  // Kräfte-Zeitachse (LFH-552): argumentlos = Invalidierungs-Prefix; Perioden-Listen je Kraftart
  // und die Zeitachse einer Kraft hängen als Sub-Keys darunter.
  kraefteZeitachse: (einsatzId: number) => [EINSATZ_KEYS.kraefteZeitachse, einsatzId] as const,
  kraefteZeitachseEinheiten: (einsatzId: number) =>
    [EINSATZ_KEYS.kraefteZeitachse, einsatzId, 'einheiten'] as const,
  kraefteZeitachsePersonal: (einsatzId: number) =>
    [EINSATZ_KEYS.kraefteZeitachse, einsatzId, 'personal'] as const,
  kraefteZeitachseEinheit: (einsatzId: number, einheitId: number) =>
    [EINSATZ_KEYS.kraefteZeitachse, einsatzId, 'einheit', einheitId] as const,
  kraefteZeitachsePerson: (einsatzId: number, epId: number) =>
    [EINSATZ_KEYS.kraefteZeitachse, einsatzId, 'person', epId] as const,
  // Betreuung: argumentlos = Invalidierungs-Prefix (Übersicht, Modulzähler und Kennzahl teilen
  // ihn). Die Kopfzahl hängt als Sub-Key darunter, der Stichtag als Wire-String (UTC ohne
  // Zonenkennung), ohne Stichtag der feste Platzhalter 'jetzt'. Nie „jetzt“ als Zeitstempel: der
  // wäre bei jedem Rendern ein neues Cache-Fach samt Abruf.
  betreuung: (einsatzId: number) => [EINSATZ_KEYS.betreuung, einsatzId] as const,
  betreuungKopfzahl: (einsatzId: number, zeitpunkt?: string) =>
    [EINSATZ_KEYS.betreuung, einsatzId, 'kopfzahl', zeitpunkt ?? 'jetzt'] as const,
  /** Meldereihe eines Bezirks bzw. einer Stelle, Sub-Key unter dem Betreuungs-Prefix: das
   *  `betreuung`-Ereignis und jede eigene Mutation treffen den offenen Verlauf mit. */
  betreuungVerlauf: (einsatzId: number, art: BetreuungVerlaufArt, id: number) =>
    [EINSATZ_KEYS.betreuung, einsatzId, 'verlauf', art, id] as const,
  // Verpflegung: ein Abruf trägt alle Zeitfenster samt Deckung und Ausgaben.
  verpflegung: (einsatzId: number) => [EINSATZ_KEYS.verpflegung, einsatzId] as const,
  // Presse S5 (LFH-554): argumentlos = Invalidierungs-Prefix; Listen und Detail als Sub-Keys.
  presse: (einsatzId: number) => [EINSATZ_KEYS.presse, einsatzId] as const,
  medienkontakte: (einsatzId: number) =>
    [EINSATZ_KEYS.presse, einsatzId, 'medienkontakte'] as const,
  pressemitteilungen: (einsatzId: number) =>
    [EINSATZ_KEYS.presse, einsatzId, 'mitteilungen'] as const,
  pressemitteilung: (einsatzId: number, mitteilungId: number) =>
    [EINSATZ_KEYS.presse, einsatzId, 'mitteilung', mitteilungId] as const,
  infotelefon: (einsatzId: number) => [EINSATZ_KEYS.infotelefon, einsatzId] as const,
  /** Historie der Lagebesprechungen als Sub-Key unter DEMSELBEN Prefix (Spec 9.3). */
  stabLagebesprechungen: (einsatzId: number) =>
    [EINSATZ_KEYS.stab, einsatzId, 'lagebesprechungen'] as const,
  /** Checkliste Arbeitsaufnahme (LFH-551), ebenfalls unter dem Stab-Prefix: kein eigenes Ereignis. */
  stabCheckliste: (einsatzId: number) => [EINSATZ_KEYS.stab, einsatzId, 'checkliste'] as const,

  // Dokumentenablage.
  dokumente: (einsatzId: number) => [EINSATZ_KEYS.dokumente, einsatzId] as const,

  // Bereitstellungsraum
  br: (einsatzId: number) => [EINSATZ_KEYS.br, einsatzId] as const,
  brDetail: (einsatzId: number, brId: number) => [EINSATZ_KEYS.brDetail, einsatzId, brId] as const,

  // Befehle
  befehle: (einsatzId: number) => [EINSATZ_KEYS.befehle, einsatzId] as const,
  befehl: (einsatzId: number, befehlId: number) =>
    [EINSATZ_KEYS.befehl, einsatzId, befehlId] as const,

  // Kommunikation
  chatKanaele: (einsatzId: number) => [EINSATZ_KEYS.chatKanaele, einsatzId] as const,
  chatNachrichten: (einsatzId: number) => [EINSATZ_KEYS.chatNachrichten, einsatzId] as const,
  chatNachrichtenKanal: (einsatzId: number, kanalId: number | null) =>
    [EINSATZ_KEYS.chatNachrichten, einsatzId, kanalId] as const,
  erinnerungen: (einsatzId: number) => [EINSATZ_KEYS.erinnerungen, einsatzId] as const,
  meldungen: (einsatzId: number) => [EINSATZ_KEYS.meldungen, einsatzId] as const,
  meldungenListe: (einsatzId: number, richtung: string) =>
    [EINSATZ_KEYS.meldungen, einsatzId, richtung] as const,
  /** Letzte Rückmeldung je Einheit/Abschnitt, unter dem `meldungen`-Prefix: jede
   *  Meldungs-Invalidierung trifft sie mit. */
  meldungenRueckmeldungen: (einsatzId: number) =>
    [EINSATZ_KEYS.meldungen, einsatzId, RUECKMELDUNGEN_SUBKEY] as const,
  lagemeldungen: (einsatzId: number) => [EINSATZ_KEYS.lagemeldungen, einsatzId] as const,
  auftraege: (einsatzId: number) => [EINSATZ_KEYS.auftraege, einsatzId] as const,
  auftraegeListe: (einsatzId: number, richtung: string, empfaenger: string) =>
    [EINSATZ_KEYS.auftraege, einsatzId, richtung, empfaenger] as const,
  nachforderungen: (einsatzId: number) => [EINSATZ_KEYS.nachforderungen, einsatzId] as const,

  // ETB
  etb: (einsatzId: number) => [EINSATZ_KEYS.etb, einsatzId] as const,
  etbListe: <F>(einsatzId: number, filter: F) => [EINSATZ_KEYS.etb, einsatzId, filter] as const,
  // Eigene Lesemarke als Sub-Key unter DEMSELBEN Prefix wie die Liste: jedes `etb`-Ereignis zieht
  // die Zahl „neu seit Ihrer letzten Sichtung“ mit.
  etbLesemarke: (einsatzId: number) => [EINSATZ_KEYS.etb, einsatzId, 'lesemarke'] as const,
  // Exakte Zählung unter demselben Prefix. Der Filter ist Teil des Keys: Kopf und Bilanz zählen
  // genau, was die Liste zeigt.
  etbZaehler: <F>(einsatzId: number, filter: F) =>
    [EINSATZ_KEYS.etb, einsatzId, 'zaehler', filter] as const,

  // Modulzähler des Navigationsrahmens
  modulZaehler: (einsatzId: number) => [EINSATZ_KEYS.modulZaehler, einsatzId] as const,

  // Abgeleitetes
  // Die gerundeten Koordinaten sind Teil des Keys (Cache-Trefferquote + serverseitiger
  // Cache-Share hängen daran) — die Rundung passiert im Aufrufer, nicht hier.
  ortVorschau: (
    einsatzId: number,
    lat: number | null,
    lon: number | null,
    exclude: string | null,
  ) => [EINSATZ_KEYS.ortVorschau, einsatzId, lat, lon, exclude] as const,
  // Der getrimmte Suchtext ist der Key: gleiche Begriffe treffen den Client-Cache (LFH-638).
  ortSuche: (einsatzId: number, begriff: string) =>
    [EINSATZ_KEYS.ortSuche, einsatzId, begriff] as const,
  // Download-Adresse der bereinigten Fassung ist der Key: ein Anhang ändert sich nie (LFH-759).
  anhangHeicVorschau: (einsatzId: number, href: string) =>
    [EINSATZ_KEYS.anhangHeicVorschau, einsatzId, href] as const,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Nicht-einsatz-scoped Query-Keys
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * Query-Key-Prefixe für alles, was NICHT unter einer `einsatzId` hängt. Bewusst nicht
 * `ORG_KEYS`: `admin-karte`/`karte-config` sind instanzweit, `fachebene` bezeichnet externe
 * Fremdquellen.
 *
 * Die Gliederung unten ist DOKUMENTATION. Erzwungen ist seit LFH-734 eine andere Partition:
 * jeder Key ist live über {@link ORG_STREAM_EVENTS} ODER steht in {@link NICHT_LIVE_GLOBAL_KEYS}
 * (`queryKeys.guard.test.ts`, Guard (g)).
 *
 * Die Wire-Strings sind EINGEFROREN und byte-gepinnt (`queryKeys.test.ts`): ein geänderter Key
 * bricht nichts, er trifft still ein anderes Cache-Fach.
 */
export const GLOBAL_KEYS = {
  // Mandant / Organisation
  einsaetze: 'einsaetze',
  benutzer: 'benutzer',
  organisation: 'organisation',
  orgEinstellungen: 'org-einstellungen',
  orgModulEinstellungen: 'org-modul-einstellungen',
  authProvider: 'auth-provider',
  // Präferenzen des ANGEMELDETEN Benutzers.
  benutzerEinstellungen: 'benutzer-einstellungen',
  // Stand der Demo-Daten der eigenen Organisation, nur für den System-Admin; 404 heißt „nicht
  // freigeschaltet“.
  demoDaten: 'demo-daten',
  // Aufbewahrung abgeschlossener Einsätze der eigenen Organisation (Übersicht, Archivakte,
  // Archiv-ETB), nur für den System-Admin.
  aufbewahrung: 'aufbewahrung',

  // Stammdaten-Kataloge
  personal: 'personal',
  personalStatus: 'personal-status',
  personalVorschlaege: 'personal-vorschlaege',
  fahrzeuge: 'fahrzeuge',
  fahrzeugStatus: 'fahrzeug-status',
  fahrzeugVorschlaege: 'fahrzeug-vorschlaege',
  material: 'material',
  materialKategorien: 'material-kategorien',
  sprechgruppen: 'sprechgruppen',
  qualifikationen: 'qualifikationen',
  einheitTypen: 'einheit-typen',
  etbBausteine: 'etb-bausteine',
  stichwortVorschlaege: 'stichwort-vorschlaege',
  // Katalog der Führungsfunktionen mit Mandantenlabels (LFH-549). Nicht im Lagebild: gelesen
  // werden Snapshot und Auflösung, die im Auftrag stecken.
  fuehrungsfunktionen: 'fuehrungsfunktionen',

  // Instanz / Betrieb — NICHT mandantenbezogen
  adminKarte: 'admin-karte',
  karteConfig: 'karte-config',

  // Externe Quellen
  fachebene: 'fachebene',
} as const;

/** Ein globaler Key; nur die Lagebild-Allowlist unten braucht den Typ (LFH-723). */
type GlobalKey = (typeof GLOBAL_KEYS)[keyof typeof GLOBAL_KEYS];

/**
 * Dienstfilter der Stammdaten-Listen (`personal` / `fahrzeuge` / `material`). String-Union
 * statt boolean, weil der Wert als Key-Element auf der Wire liegt. Eingefroren: ein Umbau auf
 * ein Filter-Objekt änderte jeden Cache-Key dieser drei Listen.
 */
type Dienstfilter = 'alle' | 'im-dienst';

/** Die zwei adressierten Bereiche unter dem `aufbewahrung`-Prefix. */
type AufbewahrungBereich = 'akte' | 'etb';

/** Die sieben Bereiche unter dem `admin-karte`-Prefix. */
type AdminKarteBereich =
  | 'katalog'
  | 'bau-status'
  | 'offline-karten'
  | 'baubare-regionen'
  | 'offline-katalog'
  | 'offline-vorhandene'
  | 'online-quellen'
  // LFH-993: Status der automatischen Aktualisierung der Offline-Karten.
  | 'aktualisierung';

/**
 * Typisierte Key-Factory für alle nicht-einsatz-scoped Queries. Wie bei {@link einsatzKeys} ist
 * der ARGUMENTLOSE Accessor zugleich der Invalidierungs-Prefix; Filter-Varianten hängen ein
 * Element an. Deshalb ZWEI Accessoren statt eines optionalen Arguments: `personal()`
 * invalidiert beide Fächer, `personalListe('alle')` adressiert genau eines.
 */
export const globalKeys = {
  // Mandant / Organisation — alle einelementig
  einsaetze: () => [GLOBAL_KEYS.einsaetze] as const,
  benutzer: () => [GLOBAL_KEYS.benutzer] as const,
  organisation: () => [GLOBAL_KEYS.organisation] as const,
  orgEinstellungen: () => [GLOBAL_KEYS.orgEinstellungen] as const,
  orgModulEinstellungen: () => [GLOBAL_KEYS.orgModulEinstellungen] as const,
  authProvider: () => [GLOBAL_KEYS.authProvider] as const,
  demoDaten: () => [GLOBAL_KEYS.demoDaten] as const,
  /**
   * Aufbewahrung: der ARGUMENTLOSE Accessor ist Übersicht UND Invalidierungs-Prefix für Akte und
   * Archiv-ETB. Der ETB-Typfilter hängt als Token an (`'alle'` ohne Filter), nie als Objekt.
   */
  aufbewahrung: () => [GLOBAL_KEYS.aufbewahrung] as const,
  aufbewahrungAkte: (einsatzId: number) =>
    [GLOBAL_KEYS.aufbewahrung, 'akte' satisfies AufbewahrungBereich, einsatzId] as const,
  aufbewahrungEtb: (einsatzId: number, typ: EtbTyp | undefined) =>
    [
      GLOBAL_KEYS.aufbewahrung,
      'etb' satisfies AufbewahrungBereich,
      einsatzId,
      typ ?? 'alle',
    ] as const,

  // Stammdaten-Kataloge ohne Filter
  qualifikationen: () => [GLOBAL_KEYS.qualifikationen] as const,
  personalStatus: () => [GLOBAL_KEYS.personalStatus] as const,
  personalVorschlaege: () => [GLOBAL_KEYS.personalVorschlaege] as const,
  fahrzeugStatus: () => [GLOBAL_KEYS.fahrzeugStatus] as const,
  fahrzeugVorschlaege: () => [GLOBAL_KEYS.fahrzeugVorschlaege] as const,
  materialKategorien: () => [GLOBAL_KEYS.materialKategorien] as const,
  einheitTypen: () => [GLOBAL_KEYS.einheitTypen] as const,
  etbBausteine: () => [GLOBAL_KEYS.etbBausteine] as const,
  stichwortVorschlaege: () => [GLOBAL_KEYS.stichwortVorschlaege] as const,
  fuehrungsfunktionen: () => [GLOBAL_KEYS.fuehrungsfunktionen] as const,

  // Dienstfilter-Listen: barer Prefix (= Invalidierung beider Fächer) + adressiertes Fach
  personal: () => [GLOBAL_KEYS.personal] as const,
  personalListe: (filter: Dienstfilter) => [GLOBAL_KEYS.personal, filter] as const,
  fahrzeuge: () => [GLOBAL_KEYS.fahrzeuge] as const,
  fahrzeugeListe: (filter: Dienstfilter) => [GLOBAL_KEYS.fahrzeuge, filter] as const,
  material: () => [GLOBAL_KEYS.material] as const,
  materialListe: (filter: Dienstfilter) => [GLOBAL_KEYS.material, filter] as const,
  // sprechgruppen kennt nur den Filterwert 'alle', deshalb nur dieser eine Accessor (siehe
  // queryKeys.prefixmatch.test.ts). Den baren Prefix invalidiert `stammdaten` (LFH-734).
  sprechgruppenAlle: () => [GLOBAL_KEYS.sprechgruppen, 'alle'] as const,

  /**
   * Präferenzen EINES Benutzers. Der Server-Slot ist pro Benutzer, sein Cache-Fach muss es auch
   * sein: `main.tsx` hält EINEN QueryClient für die Lebensdauer des Tabs, und am gemeinsamen
   * Fükw-Rechner sähe sonst die zweite Schicht das Gedächtnis der ersten und schriebe es in ihr
   * eigenes Serverfach zurück. Beim Abmelden zu räumen geht nicht: es gibt keinen solchen
   * Mechanismus, und eine Sitzung kann ohne Abmeldung enden (401).
   *
   * `null` heißt „niemand angemeldet“; das Fach bleibt leer, weil die Abfrage dann abgeschaltet
   * ist. KEIN barer Prefix-Accessor daneben. Die Bindung an die Id bleibt, obwohl `logout()`
   * seit LFH-723 den Cache räumt: sie hängt nicht daran, dass jeder Weg hinaus dort durchläuft.
   */
  benutzerEinstellungenVon: (benutzerId: number | null) =>
    [GLOBAL_KEYS.benutzerEinstellungen, benutzerId] as const,

  // Karte: barer Prefix (invalidiereKarte trifft alle sieben Bereiche) + adressierter Bereich.
  adminKarte: () => [GLOBAL_KEYS.adminKarte] as const,
  adminKarteBereich: (bereich: AdminKarteBereich) => [GLOBAL_KEYS.adminKarte, bereich] as const,
  karteConfig: () => [GLOBAL_KEYS.karteConfig] as const,

  // Externe Fachebenen. `kritis` und `energie` tragen eine BBox im Key und haben einen eigenen
  // Accessor, sonst entstünden zwei Cache-Fächer für denselben Zustand. `bbox` ist
  // `string | null`, NICHT `undefined`.
  fachebene: (quelle: Exclude<FachebeneQuelle, 'kritis' | 'energie'>) =>
    [GLOBAL_KEYS.fachebene, quelle] as const,
  fachebeneKritis: (bbox: string | null) => [GLOBAL_KEYS.fachebene, 'kritis', bbox] as const,
  fachebeneEnergie: (bbox: string | null) => [GLOBAL_KEYS.fachebene, 'energie', bbox] as const,
} as const;

/**
 * Org-Ereignis (SSE `type`, LFH-734) → die globalen Prefixe, die es invalidiert. Wie bei
 * {@link EINSATZ_STREAM_EVENTS} beantwortet die Liste „welcher Cache könnte stale sein", nicht
 * „wer darf es erfahren" (das entscheidet der Server). Invalidiert wird der EINSTELLIGE Prefix
 * `[key]`, er trifft auch die Filter-Fächer (`personalListe('alle')`). Ohne aktiven Beobachter
 * wird nur markiert, nicht abgerufen; die Admin-Listen kosten Nicht-Admins deshalb nichts.
 *
 * Beide Ereignisse kommen über den Einsatz-Strom oder, außerhalb eines Einsatzes, über den
 * Org-Strom `/api/live` (`live/orgListener.ts`). Kontrakt gegen das Rust-`OrgLiveEvent`:
 * `orgLiveEvent.contract.test.ts`.
 */
export const ORG_STREAM_EVENTS = {
  // Die Liste samt Switcher und Sprungpalette, dazu die Admin-Listen, deren Zeilen an Einsätzen
  // hängen (Demo-Stand, Aufbewahrung).
  einsatzliste: [GLOBAL_KEYS.einsaetze, GLOBAL_KEYS.demoDaten, GLOBAL_KEYS.aufbewahrung],
  stammdaten: [
    GLOBAL_KEYS.personal,
    GLOBAL_KEYS.personalStatus,
    GLOBAL_KEYS.personalVorschlaege,
    GLOBAL_KEYS.fahrzeuge,
    GLOBAL_KEYS.fahrzeugStatus,
    GLOBAL_KEYS.fahrzeugVorschlaege,
    GLOBAL_KEYS.material,
    GLOBAL_KEYS.materialKategorien,
    GLOBAL_KEYS.sprechgruppen,
    GLOBAL_KEYS.qualifikationen,
    GLOBAL_KEYS.einheitTypen,
    GLOBAL_KEYS.etbBausteine,
    GLOBAL_KEYS.stichwortVorschlaege,
    GLOBAL_KEYS.fuehrungsfunktionen,
    GLOBAL_KEYS.organisation,
    // Die Liste zeigt den Namen der Organisation und Labels der Führungsfunktionen.
    GLOBAL_KEYS.einsaetze,
  ],
} as const satisfies Record<string, readonly GlobalKey[]>;

export type OrgStreamEvent = keyof typeof ORG_STREAM_EVENTS;

/** Alle live geführten globalen Prefixe, dedupliziert — der Vollabgleich nach `lagged` und
 *  nach jedem Wiederaufbau einer Live-Verbindung. */
export const ORG_LIVE_KEYS: readonly GlobalKey[] = [
  ...new Set(Object.values(ORG_STREAM_EVENTS).flat()),
];

/**
 * Globale Keys, die BEWUSST kein Org-Ereignis auffrischt (Spec `org-live`, „Bewusst nicht
 * live"). `queryKeys.guard.test.ts` verlangt, dass jeder Key aus {@link GLOBAL_KEYS} entweder in
 * {@link ORG_STREAM_EVENTS} auftaucht ODER hier steht.
 *
 * - `benutzer`, `authProvider`: Benutzerverwaltung und Anmeldewege, nur für den Admin.
 * - `orgEinstellungen`, `orgModulEinstellungen`: enger Lesekreis; ein Modulwechsel wirkt auf den
 *   Rechte-Schnappschuss der Einsatz-Ströme und ist ein eigenes Thema.
 * - `benutzerEinstellungen`: Präferenzen des angemeldeten Benutzers, nur er schreibt sie.
 * - `adminKarte`, `karteConfig`: instanzweit, nicht mandantenbezogen.
 * - `fachebene`: externe Quellen mit eigener Nachfrage.
 */
export const NICHT_LIVE_GLOBAL_KEYS = [
  GLOBAL_KEYS.benutzer,
  GLOBAL_KEYS.authProvider,
  GLOBAL_KEYS.orgEinstellungen,
  GLOBAL_KEYS.orgModulEinstellungen,
  GLOBAL_KEYS.benutzerEinstellungen,
  GLOBAL_KEYS.adminKarte,
  GLOBAL_KEYS.karteConfig,
  GLOBAL_KEYS.fachebene,
] as const satisfies readonly GlobalKey[];

/**
 * Was vom Lagebild ohne Netz lesbar bleibt (LFH-723, design.md D3) — die EINE Quelle für
 * „was darf auf die Platte".
 *
 * Sie steht hier und nicht im Persister, damit Invalidierung, SSE-Fan-out und Vorhaltung über
 * dieselben Keys sprechen: ein URL-Cache daneben wäre eine zweite Wahrheit ohne Invalidierung
 * und ohne Benutzerbindung. Gelistet sind die fünf Ansichten ETB, Meldebild, Betroffene,
 * Aufträge und Lagekarte sowie die Rahmendaten, ohne die sie nicht rendern (Einsatzkopf,
 * Freigaben, Einstellungen, Zähler, Einsatzliste, Kartenkonfiguration, Organisation,
 * Fahrzeugstatus-Katalog). Von den Meldungen nur die Rückmeldungen, nicht die Liste.
 *
 * Bewusst draußen: Druck (ein Schnappschuss), Personen-Audit, Chat, Dokumente, die
 * HEIC-Vorschau (Object-URLs, nur im Speicher, LFH-759),
 * Snapshot-Dokumente, Pegel, Wetter, Fremdquellen, Einstellungs- und Admin-Keys, der
 * Funktionskatalog (LFH-549: Aufträge tragen Snapshot und Auflösung selbst), dazu S5
 * (Presse-Log, Pressemitteilungen, Informationstelefon: Kontaktdaten und Rückrufnummern,
 * LFH-554 design.md D8, offen mit LFH-767).
 * `lagebildOffline.guard.test.ts` vergleicht die Liste mit JEDEM verwalteten Prefix.
 */
export const LAGEBILD_OFFLINE = {
  einsatz: [
    // Rahmen. Freigaben statt Overrides (LFH-669): ohne sie lädt keine Seite die Daten eines
    // fremden Moduls; die Overrides liest nur noch der Editor (Einstellungs-Key, draußen).
    EINSATZ_KEYS.einsatz,
    EINSATZ_KEYS.modulFreigaben,
    EINSATZ_KEYS.einstellungen,
    EINSATZ_KEYS.modulZaehler,
    // ETB — samt der Nummern-Abfragen der Palette unter demselben Prefix: dieselbe
    // Datenklasse, dieselben Rechte, und ihr kurzes `gcTime` räumt sie ohnehin schnell.
    EINSATZ_KEYS.etb,
    // Meldebild
    EINSATZ_KEYS.einheiten,
    EINSATZ_KEYS.personal,
    EINSATZ_KEYS.fahrzeuge,
    EINSATZ_KEYS.material,
    EINSATZ_KEYS.abschnitte,
    EINSATZ_KEYS.auftraege,
    // Spalte „Im Einsatz" (LFH-552)
    EINSATZ_KEYS.kraefteZeitachse,
    // Aufträge
    EINSATZ_KEYS.befehle,
    // Betroffene
    EINSATZ_KEYS.personen,
    EINSATZ_KEYS.uhs,
    // Lagekarte
    EINSATZ_KEYS.zonen,
    EINSATZ_KEYS.freieZeichen,
    EINSATZ_KEYS.gefahrengebiete,
    EINSATZ_KEYS.schaeden,
    EINSATZ_KEYS.lagemeldungen,
    EINSATZ_KEYS.fuehrungskraefte,
    EINSATZ_KEYS.betreuung,
    EINSATZ_KEYS.kartenAnsicht,
    EINSATZ_KEYS.kartenbilder,
    EINSATZ_KEYS.lageSnapshot,
  ],
  /** Einzelne Sub-Keys eines sonst ungelisteten Prefix: `[prefix, einsatzId, sub]`. */
  einsatzUnterKeys: [[EINSATZ_KEYS.meldungen, 'rueckmeldungen']],
  global: [
    GLOBAL_KEYS.einsaetze,
    GLOBAL_KEYS.karteConfig,
    GLOBAL_KEYS.organisation,
    GLOBAL_KEYS.fahrzeugStatus,
  ],
} as const satisfies {
  einsatz: readonly EinsatzKey[];
  einsatzUnterKeys: readonly (readonly [EinsatzKey, string])[];
  global: readonly GlobalKey[];
};

const LAGEBILD_EINSATZ: ReadonlySet<unknown> = new Set<unknown>(LAGEBILD_OFFLINE.einsatz);
const LAGEBILD_GLOBAL: ReadonlySet<unknown> = new Set<unknown>(LAGEBILD_OFFLINE.global);

/** Gehört der Key zur Allowlist {@link LAGEBILD_OFFLINE}? Einsatz-Keys verlangen an Stelle 1
 *  eine Einsatz-ID, wie jeder Accessor von {@link einsatzKeys} sie setzt. */
export function istLagebildOfflineKey(key: readonly unknown[]): boolean {
  if (LAGEBILD_GLOBAL.has(key[0])) return true;
  if (typeof key[1] !== 'number') return false;
  if (LAGEBILD_EINSATZ.has(key[0])) return true;
  return LAGEBILD_OFFLINE.einsatzUnterKeys.some(
    ([prefix, unter]) => key[0] === prefix && key[2] === unter,
  );
}
