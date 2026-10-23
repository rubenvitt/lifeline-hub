import { useCallback, useEffect, useMemo, useRef, useState, type Key } from 'react';
import { useSearchParams } from 'react-router';
import {
  hatListenZustand,
  listenZustandParams,
  ohneListenSuche,
  parseListenZustand,
  type ListenZustandAdresse,
} from '../routing/deeplinks';
import { sicherLesen, sicherSchreiben } from '../lib/sichererSpeicher';

/**
 * Das Gedächtnis einer Liste (LLH-1086, Spec `tabellen-sortieren-filtern`, `frontend/AGENTS.md`,
 * „Tabelle und Dichte“): Sortierung, Spaltenfilter und Suchbegriff stehen in der ADRESSE
 * (`?sort=ausmass:ab&f.typ=sturm&q=Deich`, Kodierung in `routing/deeplinks.ts`), damit Zurück,
 * Neuladen und ein geteilter Link dieselbe Sicht zeigen. Ohne Listenparameter in der Adresse gilt
 * der Stand der Sitzung (`sessionStorage`, je Seite und Einsatz), der Rückweg über das Modulmenü
 * kommt so in derselben Sicht an; er wird dann in die Adresse geschrieben. Die Spaltenwahl liegt je
 * Seite am Gerät (`localStorage` über `lib/sichererSpeicher`), einsatzübergreifend.
 *
 * Der Hook gehört der SEITE, nicht der Sicht: eine Seite im Servermodus stellt ihre erste Abfrage
 * schon mit `start`, und `Datensicht` braucht so keinen Router. Opt-in je Seite (`gedaechtnis`
 * an `Datensicht`/`KatalogTabelle`); der Rollout auf alle Listen ist LLH-1096.
 *
 * Geschrieben wird mit `replace`: ein Klick auf einen Filter ist kein Verlaufsschritt, Zurück führt
 * auf die vorige Seite. Mit `sucheInAdresse: false` (Betroffene, LLH-1096) bleibt der Suchbegriff
 * nur in der Sitzung: er kann einen Namen tragen, und die Adresse landet im Browserverlauf, in
 * Lesezeichen und in jedem geteilten Link; eine Suche in einer alten Adresse wird geräumt. Fremde Parameter (`?neu=1`, `?einheit=`) bleiben stehen. Beide Speicherorte
 * stehen in `GERAETESPEICHER` (`offline/geraetRaeumung.ts`).
 */

/** `null` = bewusst unsortiert (Reihenfolge wie geliefert). */
export type ListenSortierung<K extends string = string> = {
  spalte: K;
  richtung: 'auf' | 'ab';
} | null;

export interface ListenZustand<K extends string = string> {
  sortierung: ListenSortierung<K>;
  /** Nur Spalten mit gewähltem Wert. */
  filter: Readonly<Record<string, readonly string[]>>;
  suche: string;
}

export interface SpaltenWahl {
  /** Von Hand ausgeblendete Spalten. */
  aus: readonly string[];
  /** Per Breite weggefallene, von Hand zurückgeholte Spalten. */
  an: readonly string[];
}

export interface ListenGedaechtnis<K extends string = string> {
  /**
   * Der Stand, bei dem ein Träger beginnt: beim Aufbau der Seite der wiederhergestellte, gegen das
   * Spaltenregister geprüfte Stand, danach der zuletzt gemeldete. So beginnt eine Sicht, die die
   * Seite per `key` neu aufbaut (Reiterwechsel), dort, wo die vorige aufgehört hat.
   */
  readonly start: ListenZustand<K>;
  /**
   * Die Spaltenwahl, bei der ein Träger beginnt (gespeichert, danach zuletzt gemeldet). `null`, solange
   * das Gerät für diese Seite nichts gemerkt hat: dann gilt die Voreinstellung der Seite
   * (`spaltenAusVoreinstellung`), nicht „alle Spalten an“ (LLH-1096).
   */
  readonly spaltenStart: SpaltenWahl | null;
  melde: (zustand: ListenZustand<K>) => void;
  meldeSpalten: (wahl: SpaltenWahl) => void;
}

/**
 * Was das Gedächtnis von einer Spalte wissen muss, in beiden Formen: `Datensicht` (`sortWert`,
 * `filter.werte`) und `KatalogTabelle` (antds `sorter`, `filters`).
 */
export interface GedaechtnisSpalte {
  key?: Key;
  sortWert?: unknown;
  sorter?: unknown;
  filter?: { werte: readonly { value: string }[] };
  filters?: readonly { value: Key | boolean }[];
}

/**
 * Wartezeit nach der letzten Änderung, bevor ein Träger seinen Stand meldet: getippte Suche schreibt
 * nicht je Taste in die Adresse.
 */
export const GEDAECHTNIS_ENTPRELLUNG_MS = 300;

const LISTE_PRAEFIX = 'lfh:liste:';
const SPALTEN_PRAEFIX = 'lfh:spalten:';

function gleicheSortierung(a: ListenSortierung, b: ListenSortierung): boolean {
  if (a === null || b === null) return a === b;
  return a.spalte === b.spalte && a.richtung === b.richtung;
}

/**
 * Prüft einen Stand aus Adresse oder Speicher gegen das Spaltenregister: unbekannte Spalten und
 * Werte fallen weg (ein Query-Key, den der Server mit 400 quittiert, wäre schlimmer als kein
 * Filter), eine fehlende oder unbekannte Sortierung wird zur Vorgabe. Rein und exportiert.
 *
 * `ausDaten` (LLH-1096): Spalten, die beim Aufbau der Seite noch nicht feststehen, weil ihre
 * Filterwerte aus den geladenen Zeilen kommen (Träger, Typ) oder die Spalte hinter einer
 * Modulfreigabe steht (Einheit, Abschnitt). Ihr Filter und ihre Sortierung bleiben ungeprüft stehen;
 * nur im Clientmodus, wo ein Wert ohne Treffer als Chip mit leerer Menge dasteht, statt am Server
 * zu scheitern.
 */
export function bereinigeListenZustand<K extends string>(
  roh: ListenZustandAdresse,
  spalten: readonly GedaechtnisSpalte[],
  vorgabe: ListenSortierung<K>,
  ausDaten: ReadonlySet<string> = new Set(),
): ListenZustand<K> {
  const sortierbar = new Set<string>(ausDaten);
  const erlaubt = new Map<string, Set<string> | null>();
  for (const k of ausDaten) erlaubt.set(k, null);
  for (const s of spalten) {
    if (typeof s.key !== 'string') continue;
    if (s.sortWert != null || (s.sorter != null && s.sorter !== false)) sortierbar.add(s.key);
    if (ausDaten.has(s.key)) continue;
    const werte = s.filter?.werte.map((w) => w.value) ?? s.filters?.map((w) => String(w.value));
    if (werte) erlaubt.set(s.key, new Set(werte));
  }
  let sortierung: ListenSortierung<K> = vorgabe;
  if (roh.sortierung === null) sortierung = null;
  else if (roh.sortierung && sortierbar.has(roh.sortierung.spalte)) {
    sortierung = roh.sortierung as { spalte: K; richtung: 'auf' | 'ab' };
  }
  const filter: Record<string, readonly string[]> = {};
  for (const [spalte, werte] of Object.entries(roh.filter)) {
    const menge = erlaubt.get(spalte);
    if (menge === undefined) continue;
    const gueltig = werte.filter((w) => (menge === null ? w !== '' : menge.has(w)));
    if (gueltig.length > 0) filter[spalte] = gueltig;
  }
  return { sortierung, filter, suche: roh.suche };
}

/** Für die Adresse: die Vorgabe steht dort nicht. */
function zurAdresse(zustand: ListenZustand, vorgabe: ListenSortierung): ListenZustandAdresse {
  return {
    sortierung: gleicheSortierung(zustand.sortierung, vorgabe) ? undefined : zustand.sortierung,
    filter: zustand.filter,
    suche: zustand.suche,
  };
}

function sitzungLesen(schluessel: string): string | null {
  try {
    return globalThis.sessionStorage?.getItem(schluessel) ?? null;
  } catch {
    return null;
  }
}

function sitzungSchreiben(schluessel: string, wert: string): void {
  try {
    if (wert === '') globalThis.sessionStorage?.removeItem(schluessel);
    else globalThis.sessionStorage?.setItem(schluessel, wert);
  } catch {
    /* sessionStorage gesperrt: die Adresse trägt den Stand trotzdem */
  }
}

/**
 * Jeder Ausgang (LFH-767): ein Suchbegriff kann einen Namen tragen, und die nächste Person im
 * selben Tab bekäme ihn sonst vorbelegt. Fremde Sitzungswerte bleiben.
 */
export function listenGedaechtnisRaeumen(): void {
  try {
    const speicher = globalThis.sessionStorage;
    if (!speicher) return;
    const weg: string[] = [];
    for (let i = 0; i < speicher.length; i++) {
      const k = speicher.key(i);
      if (k?.startsWith(LISTE_PRAEFIX)) weg.push(k);
    }
    for (const k of weg) speicher.removeItem(k);
  } catch {
    /* sessionStorage gesperrt — dann liegt dort auch nichts */
  }
}

function spaltenWahlLesen(schluessel: string, bekannt: ReadonlySet<string>): SpaltenWahl | null {
  const roh = sicherLesen(schluessel);
  if (roh == null) return null;
  try {
    const wert = JSON.parse(roh) as Partial<Record<keyof SpaltenWahl, unknown>>;
    const liste = (x: unknown) =>
      Array.isArray(x) ? x.filter((k): k is string => typeof k === 'string' && bekannt.has(k)) : [];
    return { aus: liste(wert.aus), an: liste(wert.an) };
  } catch {
    // Kaputt gilt als nicht gemerkt: die Voreinstellung der Seite greift.
    return null;
  }
}

export function useListenGedaechtnis<K extends string = string>(
  seite: string,
  spalten: readonly GedaechtnisSpalte[],
  optionen: {
    vorgabe?: ListenSortierung<NoInfer<K>>;
    einsatzId?: number;
    /** Siehe {@link bereinigeListenZustand}: Spalten, die erst mit den Daten feststehen. */
    ausDaten?: readonly NoInfer<K>[];
    /** `false`: der Suchbegriff steht nur in der Sitzung, nie in der Adresse (Personendaten). */
    sucheInAdresse?: boolean;
  } = {},
): ListenGedaechtnis<K> {
  const [searchParams, setSearchParams] = useSearchParams();
  const vorgabe = optionen.vorgabe ?? null;
  const listenSchluessel = `${LISTE_PRAEFIX}${seite}${
    optionen.einsatzId != null ? `:${optionen.einsatzId}` : ''
  }`;
  const spaltenSchluessel = `${SPALTEN_PRAEFIX}${seite}`;
  const sucheInAdresse = optionen.sucheInAdresse ?? true;

  // Beim Aufbau EINMAL gelesen: danach schreibt nur noch der Hook selbst in die Adresse.
  const [anfang] = useState(() => {
    const adresse = sucheInAdresse ? searchParams : ohneListenSuche(searchParams);
    const ausAdresse = hatListenZustand(adresse);
    const quelle = ausAdresse ? adresse : new URLSearchParams(sitzungLesen(listenSchluessel) ?? '');
    return {
      zustand: bereinigeListenZustand<K>(
        parseListenZustand(quelle),
        spalten,
        vorgabe,
        new Set(optionen.ausDaten ?? []),
      ),
      ausSpeicher: !ausAdresse && hatListenZustand(quelle),
      // Eine Suche in der Adresse, die dort nicht stehen soll: beim Aufbau wegschreiben.
      sucheRaeumen: !sucheInAdresse && adresse.toString() !== searchParams.toString(),
    };
  });
  const [spaltenStart] = useState(() =>
    spaltenWahlLesen(
      spaltenSchluessel,
      new Set([
        ...spalten.flatMap((s) => (typeof s.key === 'string' ? [s.key] : [])),
        ...(optionen.ausDaten ?? []),
      ]),
    ),
  );

  // Die jüngste Adresse für den Vergleich in `melde`, ohne `melde` bei jeder Navigation neu zu bauen.
  const aktuelleParams = useRef(searchParams);
  aktuelleParams.current = searchParams;
  const vorgabeRef = useRef(vorgabe);
  vorgabeRef.current = vorgabe;
  const sucheInAdresseRef = useRef(sucheInAdresse);
  sucheInAdresseRef.current = sucheInAdresse;

  const aktuell = useRef(anfang.zustand);
  const melde = useCallback(
    (zustand: ListenZustand<K>) => {
      aktuell.current = zustand;
      const adresse = zurAdresse(zustand, vorgabeRef.current);
      sitzungSchreiben(
        listenSchluessel,
        listenZustandParams(new URLSearchParams(), adresse).toString(),
      );
      const neu = listenZustandParams(
        aktuelleParams.current,
        sucheInAdresseRef.current ? adresse : { ...adresse, suche: '' },
      );
      if (neu.toString() === aktuelleParams.current.toString()) return;
      setSearchParams(neu, { replace: true });
    },
    [listenSchluessel, setSearchParams],
  );

  // Der Rückweg ohne Parameter: der gemerkte Stand gehört in die Adresse, damit Neuladen und Teilen
  // ihn tragen.
  useEffect(() => {
    if (anfang.ausSpeicher || anfang.sucheRaeumen) melde(anfang.zustand);
    // Nur beim Aufbau.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- einmalig, `anfang` steht fest
  }, []);

  const aktuelleSpalten = useRef<SpaltenWahl | null>(spaltenStart);
  const meldeSpalten = useCallback(
    (wahl: SpaltenWahl) => {
      aktuelleSpalten.current = wahl;
      sicherSchreiben(spaltenSchluessel, JSON.stringify({ aus: wahl.aus, an: wahl.an }));
    },
    [spaltenSchluessel],
  );

  return useMemo(
    () => ({
      get start() {
        return aktuell.current;
      },
      get spaltenStart() {
        return aktuelleSpalten.current;
      },
      melde,
      meldeSpalten,
    }),
    [melde, meldeSpalten],
  );
}
