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
