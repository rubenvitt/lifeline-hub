import {
  MutationCache,
  QueryCache,
  QueryClient,
  type DefaultOptions,
  type Query,
} from '@tanstack/react-query';
import { ApiError, NetzFehler } from './client';
import { meldeSitzungAbgelaufen } from '../auth/sitzungsEvent';
import {
  EINSATZ_KEYS,
  LAGEBILD_OFFLINE,
  istFesteEtbAnsicht,
  istKeyDesEinsatzes,
} from './queryKeys';
import { HOECHSTLIEGEZEIT_MS } from '../offline/lagebildStart';
import { fetchErfolgeVerfolgen } from '../offline/lagebildBestaetigung';
import { lagebildEntsperren, lagebildSperren } from '../offline/lagebildFilter';
import { istVerbindungsfehler, meldeServerErreichbar } from '../offline/verbindung';
import { schwaerzungsWaechterStarten } from '../offline/schwaerzungsWaechter';

/** Produktionsdefaults an einem importierbaren Seam statt versteckt in `main.tsx`.
 *  Nur reine Query-Pfade dürfen einen Leitungsfehler zweimal wiederholen; fachliche
 *  Serverantworten und sämtliche Mutationen werden nie automatisch erneut gesendet. */
const queryClientDefaults = {
  queries: {
    retry: (fehlversuche: number, fehler: unknown) =>
      fehler instanceof NetzFehler && fehlversuche < 2,
    retryDelay: (fehlversuche: number) => Math.min(1_000 * 2 ** fehlversuche, 30_000),
    staleTime: 10_000,
  },
  mutations: { retry: 0 },
} satisfies DefaultOptions;

/** Globaler Fehler-Seam für Queries UND Mutationen.
 *
 *  Behandelt bewusst **nur 401**. In react-query v5 feuert `MutationCache.onError` ZUSÄTZLICH
 *  zum mutationseigenen `onError`, und `QueryCache.onError` bei jedem Query-Fehler inklusive
 *  stiller Hintergrund-Refetches; ein generischer Toast stünde neben jeder lokalen
 *  Fehlermeldung.
 *
 *  Ein `ApiError` ≠ 401 ist eine fachliche Ablehnung, die der lokale Handler mit Kontext meldet;
 *  ein `NetzFehler` ist ein erwarteter Betriebszustand. Nur sonstige Fehler (etwa
 *  Programmierfehler) werden protokolliert. */
function behandleFehler(fehler: unknown): void {
  if (fehler instanceof ApiError) {
    if (fehler.status === 401) meldeSitzungAbgelaufen();
    return;
  }
  if (fehler instanceof NetzFehler) return;
  console.error('Unerwarteter Fehler in einer Query/Mutation', fehler);
}

const EINSATZ_PREFIXE: ReadonlySet<unknown> = new Set<unknown>(Object.values(EINSATZ_KEYS));

/**
 * Rechteentzug räumt das Lagebild (LFH-723, design.md D6): 403/404 auf den Einsatzkopf räumt
 * alles dieses Einsatzes, 403 auf einen anderen einsatzbezogenen Key dessen Prefix in diesem
 * Einsatz — im Speicher, und über die Sperrmarke auch auf der Platte.
 *
 * Die Trennlinie ist BEOBACHTET gegen UNBEOBACHTET, nicht „scheiternd" gegen „Rest": ein
 * entfernter, aber beobachteter Key wird beim nächsten Render vom Observer neu gebaut und neu
 * abgerufen. Auf der ETB-Seite hängen Liste und Zähler am selben Prefix — das `onError` der
 * einen entfernte die andere, deren Neuabruf gäbe 403, und so fort. Beobachtete Queries
 * verlieren deshalb nur ihre Daten und stehen mit dem Fehler da; die Seite zeigt ihren
 * Fehlerzweig statt „Stand veraltet" mit dem entzogenen Stand. `resetQueries` scheidet aus
 * demselben Grund aus: es ruft aktive Queries neu ab.
 */
function raeumeNachRechteentzug(
  client: QueryClient,
  fehler: ApiError,
  query: Query<unknown, unknown, unknown>,
): void {
  const key = query.queryKey;
  const einsatzId = key[1];
  if (typeof einsatzId !== 'number' || !EINSATZ_PREFIXE.has(key[0])) return;
  const ganzerEinsatz =
    key[0] === EINSATZ_KEYS.einsatz && (fehler.status === 403 || fehler.status === 404);
  if (!ganzerEinsatz && fehler.status !== 403) return;

  const imBereich = (k: readonly unknown[]) =>
    ganzerEinsatz ? istKeyDesEinsatzes(k, einsatzId) : k[0] === key[0] && k[1] === einsatzId;
  lagebildSperren(client, key, ganzerEinsatz ? 'einsatz' : 'prefix');
  for (const q of client.getQueryCache().findAll({ predicate: (q) => imBereich(q.queryKey) })) {
    if (q.getObserversCount() > 0) {
      q.setState({ data: undefined, dataUpdatedAt: 0, status: 'error', error: fehler });
    }
  }
  client.removeQueries({
    predicate: (q) => imBereich(q.queryKey) && q.getObserversCount() === 0,
  });
}

/** Object-URLs, die eine Query dieses Prefix in ihren Daten trägt (leer: keine). */
const OBJECT_URLS: Partial<Record<string, (daten: unknown) => string[]>> = {
  [EINSATZ_KEYS.anhangHeicVorschau]: (daten) => {
    const d = daten as { klein?: string; gross?: string } | undefined;
    return d?.klein && d.gross ? [d.klein, d.gross] : [];
  },
  // Planbild einer UHS (LFH-999): die Daten sind die URL selbst.
  [EINSATZ_KEYS.uhsPlanBild]: (daten) => (typeof daten === 'string' ? [daten] : []),
};

/**
 * HEIC-Vorschau (LFH-759) und Planbild (LFH-999) halten Object-URLs im Cache. Sie werden
 * freigegeben, sobald die Query den Cache verlässt (gcTime, Abmelden) oder ihre Daten wechseln
 * (Rechteentzug setzt sie auf `undefined`, ein Neuversuch ersetzt sie). Gemerkt wird je Query,
 * welche URLs sie zuletzt trug.
 */
function objectUrlsFreigeben(client: QueryClient): void {
  const gehalten = new Map<string, string[]>();
  const freigeben = (hash: string) => {
    const alt = gehalten.get(hash);
    if (!alt) return;
    for (const url of alt) URL.revokeObjectURL(url);
    gehalten.delete(hash);
  };
  client.getQueryCache().subscribe((ereignis) => {
    const { query } = ereignis;
    const urls = OBJECT_URLS[query.queryKey[0] as string];
    if (!urls) return;
    if (ereignis.type === 'removed') {
      freigeben(query.queryHash);
      return;
    }
    const jetzt = urls(query.state.data);
    if ((gehalten.get(query.queryHash)?.[0] ?? null) === (jetzt[0] ?? null)) return;
    freigeben(query.queryHash);
    if (jetzt.length > 0) gehalten.set(query.queryHash, jetzt);
  });
}

/** Einziger Bauplan für den QueryClient, von `main.tsx` UND `test/utils.tsx` genutzt, damit der
 *  globale Handler auch in Tests wirkt. */
export function erzeugeQueryClient(
  defaultOptions: DefaultOptions = queryClientDefaults,
): QueryClient {
  const client: QueryClient = new QueryClient({
    defaultOptions,
    queryCache: new QueryCache({
      onError: (fehler, query) => {
        behandleFehler(fehler);
        if (fehler instanceof ApiError) raeumeNachRechteentzug(client, fehler, query);
      },
    }),
    mutationCache: new MutationCache({
      onError: (fehler) => {
        behandleFehler(fehler);
        if (istVerbindungsfehler(fehler)) meldeServerErreichbar(false);
      },
    }),
  });
  // Ein Fetch-Erfolg hebt die Sperrmarke seines Bereichs wieder auf (design.md D6) und belegt,
  // dass der Server antwortet (design.md D7).
  fetchErfolgeVerfolgen(client, (key) => {
    lagebildEntsperren(client, key);
    meldeServerErreichbar(true);
  });
  // Ein Abruf, der an der LEITUNG scheitert, meldet „Server nicht erreichbar" — schon beim
  // ersten Fehlversuch (`failed`), nicht erst nach den Wiederholungen (`error`, bis ~3 s).
  client.getQueryCache().subscribe((ereignis) => {
    if (ereignis.type !== 'updated') return;
    const { action } = ereignis;
    if (
      (action.type === 'failed' || action.type === 'error') &&
      istVerbindungsfehler(action.error)
    ) {
      meldeServerErreichbar(false);
    }
  });
  objectUrlsFreigeben(client);
  // Ein höherer Schwärzungsstand in Kopf oder Liste räumt den Einsatz, ein aus der Liste
  // verschwundener Einsatz wird geräumt wie beim 404 (LFH-996, `offline/schwaerzungsWaechter.ts`).
  schwaerzungsWaechterStarten(client);
  if (defaultOptions === queryClientDefaults) lagebildLiegezeitSetzen(client);
  return client;
}

/**
 * Die Keys der Lagebild-Allowlist bleiben so lange im Speicher, wie sie auf der Platte liegen
 * dürfen (LFH-723, design.md D8). Beim Vorgabewert von 5 min räumte der Speicher eine
 * wiederhergestellte, gerade nicht beobachtete Query ab, und die nächste Speicherung nähme sie
 * auch von der Platte — wer die Lagekarte offen hat, verlöre den ETB-Stand.
 *
 * Die Rückmeldungen sind ein Sub-Key: `setQueryDefaults` matcht per Prefix, die Einsatz-ID
 * steht an Stelle 1, also trägt der ganze Meldungs-Prefix die lange Liegezeit — im Speicher,
 * nicht auf der Platte (das entscheidet der Dehydrier-Filter).
 *
 * Nur mit den Produktionsdefaults: ein Testclient (`test/utils.tsx`, `gcTime: 0`) bleibt
 * unberührt, sonst hielte er Einträge zwischen Tests fest.
 */
function lagebildLiegezeitSetzen(client: QueryClient): void {
  const prefixe = [
    ...LAGEBILD_OFFLINE.einsatz,
    ...LAGEBILD_OFFLINE.global,
    ...LAGEBILD_OFFLINE.einsatzUnterKeys.map(([prefix]) => prefix),
  ];
  for (const prefix of prefixe) {
    client.setQueryDefaults([prefix], { gcTime: HOECHSTLIEGEZEIT_MS });
  }
  // Unter dem ETB-Prefix gilt die lange Liegezeit nur für die festen Ansichten (LFH-939,
  // design.md D4). `setQueryDefaults` matcht allein per Prefix, deshalb ergänzt der Client die
  // Vorgaben selbst: Ergebnisse freier Eingaben gehen nie auf die Platte und sollen den Tab nicht
  // 24 h lang belegen (jede Tipp-Pause der Volltextsuche ist ein eigener Key). Ein eigenes
  // `gcTime` des Aufrufers (Palette, 30 s) gewinnt.
  const vorgaben = client.defaultQueryOptions.bind(client);
  client.defaultQueryOptions = ((optionen) => {
    const ergebnis = vorgaben(optionen);
    if (
      optionen?.gcTime === undefined &&
      ergebnis.queryKey?.[0] === EINSATZ_KEYS.etb &&
      !istFesteEtbAnsicht(ergebnis.queryKey)
    ) {
      ergebnis.gcTime = ETB_FREI_GC_MS;
    }
    return ergebnis;
  }) as typeof client.defaultQueryOptions;
}

/** Liegezeit eines ETB-Ergebnisses aus freier Eingabe im Speicher (LFH-939, design.md D4). */
export const ETB_FREI_GC_MS = 5 * 60 * 1000;
