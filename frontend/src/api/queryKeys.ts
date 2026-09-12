import type { FachebeneQuelle } from './fachebenen';

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
 *
 * Seit LFH-307 deckt diese Datei BEIDE Hälften ab: `einsatzKeys` für alles unter einer
 * `einsatzId` (inkl. SSE-Fan-out über {@link EINSATZ_STREAM_EVENTS}) und `globalKeys` für
 * alles darüber (Mandant, Stammdaten-Kataloge, Instanz, externe Quellen). Der Guard erlaubt
 * seither KEIN Inline-String-Array mehr als Query-Key, egal welcher Hälfte es angehört.
 */

/** Query-Key-Prefixe (erstes Element eines `[prefix, einsatzId, …]`-Keys). */
export const EINSATZ_KEYS = {
  uhs: 'einsatz-uhs',
  schaeden: 'einsatz-schaeden',
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
  // Nicht live über SSE getrieben (siehe NICHT_LIVE_KEYS + Guard-Test):
  einsatz: 'einsatz',
  einstellungen: 'einsatz-einstellungen',
  mitglieder: 'einsatz-mitglieder',
  sprechgruppen: 'einsatz-sprechgruppen',
  modulOverrides: 'einsatz-modul-overrides',
  ortVorschau: 'ort-vorschau',
  // Singular-Detail-Keys: der SSE-Fan-out invalidiert die Listen-Prefixe, nicht diese
  // (separates erstes Element → kein Prefix-Match). Vorbestehende Silent-Gaps, bewusst
  // NICHT_LIVE (Nachzug als eigener Task).
  uhsDetail: 'einsatz-uhs-detail',
  person: 'einsatz-person',
  personAudit: 'einsatz-person-audit',
  tier: 'einsatz-tier',
  schaden: 'einsatz-schaden',
  // Snapshot-Dokument (LFH-321): eigener Prefix, damit die Listen-Invalidierung
  // (`lage_snapshot`-SSE) die per Design UNVERÄNDERLICHEN Dokumente nicht per Prefix mit-refetcht.
  lageSnapshotDokument: 'einsatz-lage-snapshot-dokument',
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
  freies_zeichen: [EINSATZ_KEYS.freieZeichen],
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
  // F01/LFH-227: `person` und `personal` sind getrennte Wire-Events. Vorher trug EIN
  // `person`-Tag beide ID-Räume (betroffene Person vs. einsatz_personal-Disposition),
  // weshalb hier beide Sammlungen hängen mussten — und weshalb das Backend die zwei
  // Module nicht getrennt gaten konnte. Jetzt: betroffene Personen (Modul `personen`).
  person: [EINSATZ_KEYS.personen],
  // Disponiertes Personal (Modul `personal`) — die Zuordnung wirkt zugleich auf
  // Einheiten-/Abschnittsführung und die Führungskräfte-Sicht der Lagekarte.
  personal: [
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
  // LFH-207-C: ETB-Zeitachse live halten — ersetzt den dedizierten useEtbStream (2. EventSource
  // auf denselben Live-Endpoint). Prefix-Match deckt ['etb', einsatzId, filter] mit ab.
  etb: [EINSATZ_KEYS.etb],
  // Befehle live (LFH-262/F13): Backend publiziert seit LFH-64 ein `befehl`-Wire-Event bei
  // Anlegen/Ändern/Freigeben/Fortschreiben. Invalidiert Befehls-Liste UND -Detail
  // (Prefix-Match: ['einsatz-befehl', einsatzId, befehlId] trifft alle befehlIds).
  befehl: [EINSATZ_KEYS.befehle, EINSATZ_KEYS.befehl],
  // Kartenansichten live (LFH-319): PATCH („Für den Einsatz speichern") publiziert
  // `karten_ansicht` → der Ansichts-Switcher aller Betrachter aktualisiert sich.
  karten_ansicht: [EINSATZ_KEYS.kartenAnsicht],
  // Lage-Snapshots live (LFH-321): Anlegen/Ändern/Löschen eines Standes publiziert
  // `lage_snapshot` → die Snapshot-Liste/Zeitleiste aller Betrachter aktualisiert sich.
  lage_snapshot: [EINSATZ_KEYS.lageSnapshot],
} as const satisfies Record<string, readonly EinsatzKey[]>;

export type EinsatzStreamEvent = keyof typeof EINSATZ_STREAM_EVENTS;

/**
 * Managed einsatz-scoped Keys, die BEWUSST nicht über den SSE-Live-Feed invalidiert werden.
 * Der Guard-Test (`queryKeys.guard.test.ts`) verlangt, dass jeder Key aus {@link EINSATZ_KEYS}
 * entweder in {@link EINSATZ_STREAM_EVENTS} auftaucht ODER hier steht — ein neuer Key zwingt
 * damit zur bewussten Entscheidung „live vs. nicht live" statt still durchzurutschen.
 *
 * - `einsatz`/`einstellungen`/`mitglieder`/`sprechgruppen`: ändern sich selten / kein Live-Event.
 * - `uhsDetail`/`person`/`personAudit`/`tier`/`schaden`: Singular-Detail-Keys, die der
 *   Listen-Prefix-Match nicht erreicht (vorbestehende Silent-Gaps, Nachzug als eigener Task).
 * - `modulOverrides` (F27/LFH-269): kein LiveEvent im Backend — `src/live/mod.rs`
 *   (`LiveEvent::ALLE`) kennt keine Modul-Override-Variante. Ein Override eines anderen
 *   Nutzers propagiert also nicht live; das ist der dokumentierte Ist-Zustand, kein Versehen.
 * - `ortVorschau` (F27/LFH-269): abgeleiteter Geo-Lookup mit Debounce + Client-Cache, kein
 *   Einsatz-Datenobjekt. Hier live zu invalidieren wäre schädlich (Nominatim-ToS), nicht bloß
 *   überflüssig.
 */
export const NICHT_LIVE_KEYS = [
  EINSATZ_KEYS.einsatz,
  EINSATZ_KEYS.einstellungen,
  EINSATZ_KEYS.mitglieder,
  EINSATZ_KEYS.sprechgruppen,
  EINSATZ_KEYS.modulOverrides,
  EINSATZ_KEYS.ortVorschau,
  EINSATZ_KEYS.uhsDetail,
  EINSATZ_KEYS.person,
  EINSATZ_KEYS.personAudit,
  EINSATZ_KEYS.tier,
  EINSATZ_KEYS.schaden,
  EINSATZ_KEYS.lageSnapshotDokument,
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
  // einsatzId nullbar aus demselben Grund wie bei `einsatz`: das Command-Palette zieht sie
  // aus dem Pfad und lädt nur im Einsatzkontext (enabled-Guard).
  modulOverrides: (einsatzId: number | null) => [EINSATZ_KEYS.modulOverrides, einsatzId] as const,

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
  uhsDetail: (einsatzId: number, uhsId: number) =>
    [EINSATZ_KEYS.uhsDetail, einsatzId, uhsId] as const,

  // Schäden / Tiere (inkl. personenbezogener Kontext-Filter)
  schaeden: (einsatzId: number) => [EINSATZ_KEYS.schaeden, einsatzId] as const,
  schaedenGeschaedigt: (einsatzId: number, personId: number) =>
    [EINSATZ_KEYS.schaeden, einsatzId, 'geschaedigt', personId] as const,
  schaden: (einsatzId: number, schadenId: number) =>
    [EINSATZ_KEYS.schaden, einsatzId, schadenId] as const,
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
  lagemeldungen: (einsatzId: number) => [EINSATZ_KEYS.lagemeldungen, einsatzId] as const,
  auftraege: (einsatzId: number) => [EINSATZ_KEYS.auftraege, einsatzId] as const,
  auftraegeListe: (einsatzId: number, richtung: string, empfaenger: string) =>
    [EINSATZ_KEYS.auftraege, einsatzId, richtung, empfaenger] as const,
  nachforderungen: (einsatzId: number) => [EINSATZ_KEYS.nachforderungen, einsatzId] as const,

  // ETB
  etb: (einsatzId: number) => [EINSATZ_KEYS.etb, einsatzId] as const,
  etbListe: <F>(einsatzId: number, filter: F) => [EINSATZ_KEYS.etb, einsatzId, filter] as const,

  // Abgeleitetes
  // Die gerundeten Koordinaten sind Teil des Keys (Cache-Trefferquote + serverseitiger
  // Cache-Share hängen daran) — die Rundung passiert im Aufrufer, nicht hier.
  ortVorschau: (
    einsatzId: number,
    lat: number | null,
    lon: number | null,
    exclude: string | null,
  ) => [EINSATZ_KEYS.ortVorschau, einsatzId, lat, lon, exclude] as const,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Nicht-einsatz-scoped Query-Keys (LFH-307)
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * Query-Key-Prefixe für alles, was NICHT unter einer `einsatzId` hängt.
 *
 * Name bewusst `GLOBAL_KEYS` und nicht `ORG_KEYS`: drei der 23 Prefixe sind gar nicht
 * mandantenbezogen — `admin-karte` und `karte-config` sind instanzweit (eine Kartenkonfiguration
 * pro Installation), `fachebene` bezeichnet externe Fremdquellen (NINA/DWD/PEGELONLINE/KRITIS).
 * `ORG_KEYS` wäre dort ein Fehlname, und ein Fehlname in einer Registry, die genau deshalb
 * existiert, damit man Keys nicht mehr raten muss, ist teuer.
 *
 * Die Gliederung unten ist DOKUMENTATION, kein Typ und keine maschinell erzwungene Partition.
 * Gemessen: es gibt im Produktionscode kein `qc.clear()`, `removeQueries` oder `resetQueries`,
 * also heute keinen Konsumenten, der „alle Org-Keys" als Menge bräuchte. Käme einer dazu, ist
 * die Gliederung in eine echte XOR-Partition nach dem Muster von {@link NICHT_LIVE_KEYS} zu
 * heben — als Kommentar-Überschrift trägt sie das nicht.
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
  // Präferenzen des ANGEMELDETEN Benutzers (LFH-391 · Etappe D).
  benutzerEinstellungen: 'benutzer-einstellungen',

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

  // Instanz / Betrieb — NICHT mandantenbezogen
  adminKarte: 'admin-karte',
  karteConfig: 'karte-config',

  // Externe Quellen
  fachebene: 'fachebene',
} as const;

export type GlobalKey = (typeof GLOBAL_KEYS)[keyof typeof GLOBAL_KEYS];

/**
 * Dienstfilter der Stammdaten-Listen (`personal` / `fahrzeuge` / `material`).
 *
 * String-Union statt boolean, weil der Wert als Key-Element auf der Wire liegt und die beiden
 * Fächer im Cache getrennt halten muss — `['personal', true]` wäre weder lesbar noch
 * byte-identisch zum Bestand. Die Konvention ist EINGEFROREN (LFH-307): ein Umbau auf ein
 * Filter-Objekt wäre sauberer, änderte aber JEDEN Cache-Key dieser drei Listen und damit das
 * Invalidierungsverhalten der `stammdaten/*`-Mutationen — bei 90 migrierten Call-Sites ist das
 * zu viel Risiko auf einmal. Eigener Task, wenn überhaupt.
 */
export type Dienstfilter = 'alle' | 'im-dienst';

/** Die sieben Bereiche unter dem `admin-karte`-Prefix. */
export type AdminKarteBereich =
  | 'katalog'
  | 'bau-status'
  | 'offline-karten'
  | 'baubare-regionen'
  | 'offline-katalog'
  | 'offline-vorhandene'
  | 'online-quellen';

/**
 * Typisierte Key-Factory für alle nicht-einsatz-scoped Queries (LFH-307).
 *
 * Konvention wie bei {@link einsatzKeys}: der ARGUMENTLOSE Accessor ist zugleich der
 * Invalidierungs-Prefix (TanStack matcht per Prefix), Filter-Varianten hängen ein weiteres
 * Element an. Deshalb gibt es bei den Filter-Listen bewusst ZWEI Accessoren statt eines
 * optionalen Arguments — `personal()` invalidiert beide Fächer, `personalListe('alle')`
 * adressiert genau eines.
 */
export const globalKeys = {
  // Mandant / Organisation — alle einelementig
  einsaetze: () => [GLOBAL_KEYS.einsaetze] as const,
  benutzer: () => [GLOBAL_KEYS.benutzer] as const,
  organisation: () => [GLOBAL_KEYS.organisation] as const,
  orgEinstellungen: () => [GLOBAL_KEYS.orgEinstellungen] as const,
  orgModulEinstellungen: () => [GLOBAL_KEYS.orgModulEinstellungen] as const,
  authProvider: () => [GLOBAL_KEYS.authProvider] as const,

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

  // Dienstfilter-Listen: barer Prefix (= Invalidierung beider Fächer) + adressiertes Fach
  personal: () => [GLOBAL_KEYS.personal] as const,
  personalListe: (filter: Dienstfilter) => [GLOBAL_KEYS.personal, filter] as const,
  fahrzeuge: () => [GLOBAL_KEYS.fahrzeuge] as const,
  fahrzeugeListe: (filter: Dienstfilter) => [GLOBAL_KEYS.fahrzeuge, filter] as const,
  material: () => [GLOBAL_KEYS.material] as const,
  materialListe: (filter: Dienstfilter) => [GLOBAL_KEYS.material, filter] as const,
  // sprechgruppen kennt im Bestand nur den Filterwert 'alle' und KEIN bare-Invalidate —
  // deshalb bewusst nur dieser eine Accessor (siehe queryKeys.prefixmatch.test.ts).
  sprechgruppenAlle: () => [GLOBAL_KEYS.sprechgruppen, 'alle'] as const,

  /**
   * Präferenzen EINES Benutzers (LFH-391 · Etappe D, korrigiert im Review).
   *
   * DER SERVER-SLOT IST PRO BENUTZER, sein Cache-Fach muss es auch sein. Die frühere
   * Begründung „der Endpunkt kennt nur das eigene Fach, also gibt es keinen zweiten
   * adressierbaren Zustand" verwechselte die ADRESSIERUNG auf der Wire mit dem, was im
   * Prozess nebeneinander liegen kann: `main.tsx` hält EINEN QueryClient für die Lebensdauer
   * des Tabs, `LoginPage` navigiert nach der Anmeldung bloss. Am gemeinsamen Fükw-Rechner
   * teilen sich zwei Schichten damit dasselbe Fach — die zweite sah das Gedächtnis der
   * ersten und schrieb es beim ersten Griff in ihr eigenes Serverfach zurück.
   *
   * Das Muster ist NICHT erfunden: `offline/queue.ts` trennt seine benutzerabhängigen Daten
   * seit jeher über `benutzer.id` („datenbankweit eindeutig; dadurch genügt diese eine
   * Identität zur sicheren Trennung auch über Organisationsgrenzen hinweg"). Die Alternative
   * — beim Abmelden räumen — scheidet aus, weil es dafür GAR KEINEN Mechanismus gibt
   * (gemessen: kein `qc.clear`/`removeQueries`/`resetQueries` im Produktivcode, `logout()`
   * setzt allein `benutzer` auf `null`); einen einzuführen wäre eine querschnittliche
   * Entscheidung über alle 23 Prefixe und griffe ausserdem nicht, wenn die Sitzung ohne
   * Abmeldung endet (401 → Sitzungswache → jemand anders meldet sich an).
   *
   * `null` steht für „niemand angemeldet" und ist ein zulässiges Key-Element wie die `bbox`
   * bei {@link globalKeys.fachebeneKritis}; das Fach bleibt leer, weil die Abfrage dann
   * abgeschaltet ist. KEIN barer Prefix-Accessor daneben — es gibt kein Invalidate über alle
   * Benutzerfächer und wird keins geben, dieselbe Lage wie bei `sprechgruppenAlle`.
   */
  benutzerEinstellungenVon: (benutzerId: number | null) =>
    [GLOBAL_KEYS.benutzerEinstellungen, benutzerId] as const,

  // Karte: barer Prefix (invalidiereKarte trifft per Prefix-Match alle sieben Bereiche)
  // + adressierter Bereich. Zwei Funktionen statt optionalem Argument.
  adminKarte: () => [GLOBAL_KEYS.adminKarte] as const,
  adminKarteBereich: (bereich: AdminKarteBereich) => [GLOBAL_KEYS.adminKarte, bereich] as const,
  karteConfig: () => [GLOBAL_KEYS.karteConfig] as const,

  // Externe Fachebenen. `kritis` ist ausgenommen, weil es als einziges eine BBox im Key trägt —
  // der einzige Weg dorthin ist `fachebeneKritis`, sonst entstünden zwei Cache-Fächer für
  // denselben Zustand. `bbox` ist `string | null` (useFachebenen.ts), NICHT `undefined`.
  fachebene: (quelle: Exclude<FachebeneQuelle, 'kritis'>) =>
    [GLOBAL_KEYS.fachebene, quelle] as const,
  fachebeneKritis: (bbox: string | null) => [GLOBAL_KEYS.fachebene, 'kritis', bbox] as const,
} as const;
