/**
 * Zentrales Query-Key-Registry für den Einsatz-Live-Feed (LFH-122).
 *
 * `useEinsatzLiveStream` leitet Listener, Invalidierung UND den lagged-Vollabgleich
 * ausschließlich aus {@link EINSATZ_STREAM_EVENTS} ab — statt an drei Stellen (Handler,
 * add/removeEventListener, onLag) manuell nachgepflegt zu werden. Ein neues Live-Modul
 * ist damit EIN Eintrag hier, nicht drei verstreute Edits, die man vergessen kann.
 *
 * `EINSATZ_KEYS` ist das enumerierte Set der einsatz-scoped Query-Key-Prefixe (erstes
 * Array-Element). Der Guard-Test (`queryKeys.guard.test.ts`, LFH-122) verlangt, dass diese
 * Prefixe nur hier als Literal vorkommen — jede Query nutzt die Factory.
 */

/** Query-Key-Prefixe (erstes Element eines `[prefix, einsatzId, …]`-Keys). */
export const EINSATZ_KEYS = {
  uhs: 'einsatz-uhs',
  schaeden: 'einsatz-schaeden',
  fahrzeuge: 'einsatz-fahrzeuge',
  material: 'einsatz-material',
  tiere: 'einsatz-tiere',
  zonen: 'einsatz-zonen',
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
  // Nicht live über SSE getrieben (siehe NICHT_LIVE_KEYS + Guard-Test):
  einsatz: 'einsatz',
  einstellungen: 'einsatz-einstellungen',
  mitglieder: 'einsatz-mitglieder',
  sprechgruppen: 'einsatz-sprechgruppen',
  befehle: 'einsatz-befehle',
  befehl: 'einsatz-befehl',
  etb: 'etb',
  // Singular-Detail-Keys: der SSE-Fan-out invalidiert die Listen-Prefixe, nicht diese
  // (separates erstes Element → kein Prefix-Match). Vorbestehende Silent-Gaps, bewusst
  // NICHT_LIVE (Nachzug als eigener Task).
  uhsDetail: 'einsatz-uhs-detail',
  person: 'einsatz-person',
  personAudit: 'einsatz-person-audit',
  tier: 'einsatz-tier',
  schaden: 'einsatz-schaden',
} as const;

export type EinsatzKey = (typeof EINSATZ_KEYS)[keyof typeof EINSATZ_KEYS];

/**
 * Wire-Event-Name (SSE `type`) → die Query-Key-Prefixe, die das Event invalidiert.
 *
 * Reihenfolge und Fan-out entsprechen 1:1 dem bisherigen handgeschriebenen Verteiler.
 * NICHT enthalten:
 * - `sofortmeldung`: hat Seiteneffekte (Ton + window-CustomEvent) → im Hook als
 *   Escape-Hatch, invalidiert die `meldung`-Keys.
 * - `lagged`: rein abgeleitet (Union aller Keys hier, dedupliziert) → im Hook.
 */
export const EINSATZ_STREAM_EVENTS = {
  uhs: [EINSATZ_KEYS.uhs],
  schaden: [EINSATZ_KEYS.schaeden],
  fahrzeug: [EINSATZ_KEYS.fahrzeuge],
  material: [EINSATZ_KEYS.material],
  tier: [EINSATZ_KEYS.tiere],
  lage_zone: [EINSATZ_KEYS.zonen, EINSATZ_KEYS.gefahrengebiete],
  gefahr: [EINSATZ_KEYS.gefahrenmatrix, EINSATZ_KEYS.gefahrengebiete],
  einheit: [
    EINSATZ_KEYS.einheiten,
    EINSATZ_KEYS.fuehrungskraefte,
    // Mitglieder-Zuordnungen an Einheiten betreffen auch Personal-, Fahrzeug- und Material-Listen.
    EINSATZ_KEYS.personal,
    EINSATZ_KEYS.fahrzeuge,
    EINSATZ_KEYS.material,
  ],
  abschnitt: [EINSATZ_KEYS.abschnitte, EINSATZ_KEYS.fuehrungskraefte],
  // person berührt mehrere Sammlungen: Registrierung, Einheiten-/Abschnittsführung,
  // sowie disponiertes Personal im Meldebild.
  person: [
    EINSATZ_KEYS.personen,
    EINSATZ_KEYS.personal,
    EINSATZ_KEYS.einheiten,
    EINSATZ_KEYS.abschnitte,
    EINSATZ_KEYS.fuehrungskraefte,
  ],
  lagebericht: [EINSATZ_KEYS.lageberichte, EINSATZ_KEYS.lagebericht],
  chat: [EINSATZ_KEYS.chatKanaele, EINSATZ_KEYS.chatNachrichten],
  erinnerung: [EINSATZ_KEYS.erinnerungen],
  auftrag: [EINSATZ_KEYS.auftraege],
  nachforderung: [EINSATZ_KEYS.nachforderungen],
  meldung: [EINSATZ_KEYS.meldungen, EINSATZ_KEYS.lagemeldungen],
  // Liste + Detail (Prefix-Match: ['einsatz-br-detail', einsatzId] trifft alle brIds).
  bereitstellungsraum: [EINSATZ_KEYS.br, EINSATZ_KEYS.brDetail],
  karte_bild: [EINSATZ_KEYS.kartenbilder],
} as const satisfies Record<string, readonly EinsatzKey[]>;

export type EinsatzStreamEvent = keyof typeof EINSATZ_STREAM_EVENTS;

/**
 * Managed einsatz-scoped Keys, die BEWUSST nicht über den SSE-Live-Feed invalidiert werden.
 * Der Guard-Test (`queryKeys.guard.test.ts`) verlangt, dass jeder Key aus {@link EINSATZ_KEYS}
 * entweder in {@link EINSATZ_STREAM_EVENTS} auftaucht ODER hier steht — ein neuer Key zwingt
 * damit zur bewussten Entscheidung „live vs. nicht live" statt still durchzurutschen.
 *
 * - `einsatz`/`einstellungen`/`mitglieder`/`sprechgruppen`: ändern sich selten / kein Live-Event.
 * - `befehle`/`befehl`: (noch) kein `befehl`-Wire-Event im Backend (vorbestehende Gap).
 * - `etb`: bekommt seinen Listener in LFH-207-C; bis dahin hält `useEtbStream` den Key live.
 * - `uhsDetail`/`person`/`personAudit`/`tier`/`schaden`: Singular-Detail-Keys, die der
 *   Listen-Prefix-Match nicht erreicht (vorbestehende Silent-Gaps, Nachzug als eigener Task).
 */
export const NICHT_LIVE_KEYS = [
  EINSATZ_KEYS.einsatz,
  EINSATZ_KEYS.einstellungen,
  EINSATZ_KEYS.mitglieder,
  EINSATZ_KEYS.sprechgruppen,
  EINSATZ_KEYS.befehle,
  EINSATZ_KEYS.befehl,
  EINSATZ_KEYS.etb,
  EINSATZ_KEYS.uhsDetail,
  EINSATZ_KEYS.person,
  EINSATZ_KEYS.personAudit,
  EINSATZ_KEYS.tier,
  EINSATZ_KEYS.schaden,
] as const satisfies readonly EinsatzKey[];

/**
 * Typisierte Key-Factory für alle einsatz-scoped Queries (LFH-122). Jede Query/Invalidierung
 * baut ihren Key über diese Factory statt über Inline-String-Arrays — der Guard-Test erzwingt
 * das. So sind Key-Shape und (über {@link EINSATZ_STREAM_EVENTS}) die SSE-Anbindung an EINER
 * Stelle sichtbar; ein falscher Shape bricht die Factory-Output-Tests statt still eine tote
 * Invalidierung zu erzeugen.
 *
 * Konvention: 2-elementige Funktionen `[prefix, einsatzId]` sind zugleich der Invalidierungs-
 * Prefix (TanStack matcht per Prefix); Detail-/Filter-Varianten hängen weitere Elemente an.
 */
export const einsatzKeys = {
  // Einsatz-Stammdaten
  // einsatzId nullbar: das Command-Palette lädt den Einsatz nur wenn im Einsatzkontext
  // (enabled-Guard); der Key trug den null-Wert schon als Inline-Literal.
  einsatz: (einsatzId: number | null) => [EINSATZ_KEYS.einsatz, einsatzId] as const,
  einstellungen: (einsatzId: number) => [EINSATZ_KEYS.einstellungen, einsatzId] as const,
  mitglieder: (einsatzId: number) => [EINSATZ_KEYS.mitglieder, einsatzId] as const,
  sprechgruppen: (einsatzId: number) => [EINSATZ_KEYS.sprechgruppen, einsatzId] as const,

  // Personen / Personal
  personen: (einsatzId: number) => [EINSATZ_KEYS.personen, einsatzId] as const,
  // personId nullbar: der Person-Detail-Drawer rendert ohne Auswahl (enabled-Guard);
  // der Key trug null schon als Inline-Literal.
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
  uhsDetail: (einsatzId: number, uhsId: number) => [EINSATZ_KEYS.uhsDetail, einsatzId, uhsId] as const,

  // Schäden / Tiere (inkl. personenbezogener Kontext-Filter)
  schaeden: (einsatzId: number) => [EINSATZ_KEYS.schaeden, einsatzId] as const,
  schaedenGeschaedigt: (einsatzId: number, personId: number) =>
    [EINSATZ_KEYS.schaeden, einsatzId, 'geschaedigt', personId] as const,
  schaden: (einsatzId: number, schadenId: number) => [EINSATZ_KEYS.schaden, einsatzId, schadenId] as const,
  tiere: (einsatzId: number) => [EINSATZ_KEYS.tiere, einsatzId] as const,
  tiereHalter: (einsatzId: number, personId: number) =>
    [EINSATZ_KEYS.tiere, einsatzId, 'halter', personId] as const,
  tier: (einsatzId: number, tierId: number) => [EINSATZ_KEYS.tier, einsatzId, tierId] as const,

  // Lage
  zonen: (einsatzId: number) => [EINSATZ_KEYS.zonen, einsatzId] as const,
  gefahrengebiete: (einsatzId: number) => [EINSATZ_KEYS.gefahrengebiete, einsatzId] as const,
  gefahrenmatrix: (einsatzId: number, gewaehlt: number | null) =>
    [EINSATZ_KEYS.gefahrenmatrix, einsatzId, gewaehlt] as const,
  lageberichte: (einsatzId: number) => [EINSATZ_KEYS.lageberichte, einsatzId] as const,
  lagebericht: (einsatzId: number, berichtId: number) =>
    [EINSATZ_KEYS.lagebericht, einsatzId, berichtId] as const,
  kartenbilder: (einsatzId: number) => [EINSATZ_KEYS.kartenbilder, einsatzId] as const,

  // Bereitstellungsraum
  br: (einsatzId: number) => [EINSATZ_KEYS.br, einsatzId] as const,
  brDetail: (einsatzId: number, brId: number) => [EINSATZ_KEYS.brDetail, einsatzId, brId] as const,

  // Befehle
  befehle: (einsatzId: number) => [EINSATZ_KEYS.befehle, einsatzId] as const,
  befehl: (einsatzId: number, befehlId: number) => [EINSATZ_KEYS.befehl, einsatzId, befehlId] as const,

  // Kommunikation
  chatKanaele: (einsatzId: number) => [EINSATZ_KEYS.chatKanaele, einsatzId] as const,
  chatNachrichten: (einsatzId: number) => [EINSATZ_KEYS.chatNachrichten, einsatzId] as const,
  chatNachrichtenKanal: (einsatzId: number, kanalId: number | null) =>
    [EINSATZ_KEYS.chatNachrichten, einsatzId, kanalId] as const,
  erinnerungen: (einsatzId: number) => [EINSATZ_KEYS.erinnerungen, einsatzId] as const,
  meldungen: (einsatzId: number) => [EINSATZ_KEYS.meldungen, einsatzId] as const,
  meldungenListe: (einsatzId: number, richtung: string) =>
    [EINSATZ_KEYS.meldungen, einsatzId, richtung] as const,
  lagemeldungen: (einsatzId: number) => [EINSATZ_KEYS.lagemeldungen, einsatzId] as const,
  auftraege: (einsatzId: number) => [EINSATZ_KEYS.auftraege, einsatzId] as const,
  auftraegeListe: (einsatzId: number, richtung: string, empfaenger: string) =>
    [EINSATZ_KEYS.auftraege, einsatzId, richtung, empfaenger] as const,
  nachforderungen: (einsatzId: number) => [EINSATZ_KEYS.nachforderungen, einsatzId] as const,

  // ETB
  etb: (einsatzId: number) => [EINSATZ_KEYS.etb, einsatzId] as const,
  etbListe: <F>(einsatzId: number, filter: F) => [EINSATZ_KEYS.etb, einsatzId, filter] as const,
} as const;
