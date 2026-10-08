import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';
import {
  alsSchadenAuswahl,
  alsSchadenMarker,
  ladeSchaden,
  passtZurSicht,
  SCHAEDEN_SEITE,
  vergleicheSchaeden,
  vergleicheSchaedenNach,
  type SchaedenFilter,
  type SchadenSortierung,
} from '../api/einsatzSchaden';
import {
  ladeMedienkontakt,
  MEDIENKONTAKTE_SEITE,
  vergleicheMedienkontakte,
  vergleicheNachEingang,
} from '../api/presse';
import { einsatzKeys, type ZeilenZiel } from '../api/queryKeys';
import type { Medienkontakt, Schaden, SchadenMarker } from '../api/types';
import { LIVE_SAMMELFENSTER_MS, type LiveSammler } from './liveInvalidierung';

/**
 * Mehr Kennungen je Liste und Fenster lädt der Zeilenabgleich nicht einzeln: nach einem Funkloch
 * ist ein Listenabruf billiger als vierzig Einzelabrufe (Spec `live-abgleich`).
 */
export const ZEILEN_GRENZE = 10;

/** `einsetzen` kann die Zeile nicht sicher einsetzen: der Eintrag geht an den Sammler. */
export const AN_SAMMLER = Symbol('an Sammler');

/** Eine Liste, in die eine nachgeladene Zeile einsortiert wird. */
interface ZeilenListe<Z> {
  /** Exakter Key, bei `praefix` der Prefix aller Einträge; der Sammler gleicht ihn ab. */
  key: (einsatzId: number) => QueryKey;
  /** Alle Einträge unter `key`: Seitenketten je Sicht, Einzelabrufe (LFH-1075). */
  praefix?: boolean;
  einsetzen: (alt: unknown, id: number, zeile: Z, cacheKey: QueryKey) => unknown;
}

/**
 * Flache Liste. `form` bringt die Zeile in die Form der Liste; `null` heißt, sie gehört nicht
 * (mehr) hinein (stornierter Schaden, erledigter Kontakt in der offenen Liste).
 */
function liste<Z, L extends { id: number }>(
  key: (einsatzId: number) => QueryKey,
  form: (zeile: Z) => L | null,
  vergleich: (a: L, b: L) => number,
): ZeilenListe<Z> {
  return {
    key,
    einsetzen: (alt, id, zeile) => einsortieren(alt as readonly L[], id, form(zeile), vergleich),
  };
}

/** Einzelabrufe unter einem Prefix, deren letztes Key-Glied die Kennung ist. */
function einzeln<Z>(key: (einsatzId: number) => QueryKey): ZeilenListe<Z> {
  return {
    key,
    praefix: true,
    einsetzen: (alt, id, zeile, cacheKey) => (cacheKey[cacheKey.length - 1] === id ? zeile : alt),
  };
}

/**
 * Seitenkette (`useInfiniteQuery`). `einordnen` sagt je Eintrag, wie die Zeile hineingehört:
 * mit Vergleich und Seitengröße, `null` (gehört nicht hinein) oder {@link AN_SAMMLER}.
 */
function fenster<Z, L extends { id: number }>(
  key: (einsatzId: number) => QueryKey,
  praefix: boolean,
  einordnen: (
    zeile: Z,
    cacheKey: QueryKey,
  ) => { zeile: L | null; vergleich: (a: L, b: L) => number; seite: number } | typeof AN_SAMMLER,
): ZeilenListe<Z> {
  return {
    key,
    praefix,
    einsetzen: (alt, id, zeile, cacheKey) => {
      const o = einordnen(zeile, cacheKey);
      if (o === AN_SAMMLER) return AN_SAMMLER;
      return fensterEinsortieren(alt as InfiniteData<L[]>, id, o.zeile, o.vergleich, o.seite);
    },
  };
}

interface Ziel {
  laden: (einsatzId: number, id: number) => Promise<unknown>;
  listen: readonly ZeilenListe<unknown>[];
  /** Die Prefixe, mit denen der Sammler alle Listen des Ziels auf einmal abgleicht. */
  sammeln: (einsatzId: number) => readonly QueryKey[];
}

function ziel<Z>(
  laden: (einsatzId: number, id: number) => Promise<Z>,
  sammeln: (einsatzId: number) => readonly QueryKey[],
  listen: readonly ZeilenListe<Z>[],
): Ziel {
  return { laden, sammeln, listen: listen as readonly ZeilenListe<unknown>[] };
}

// Die Schadenliste ohne Filter führt keine stornierten (Server-Vorgabe `inkl_storniert=false`),
// die Marker ebenso.
const ungestorniert = (s: Schaden): Schaden | null => (s.storniert_at == null ? s : null);

const ZIELE: Record<ZeilenZiel, Ziel> = {
  // Alle Listen der Medienkontakte liegen unter `medienkontakte(e)`.
  medienkontakte: ziel<Medienkontakt>(ladeMedienkontakt, (e) => [einsatzKeys.medienkontakte(e)], [
    // Vollliste ohne Phase (Altbestand der Abrufer); die Presseseite liest die Phasen.
    liste(einsatzKeys.medienkontakte, (k: Medienkontakt) => k, vergleicheMedienkontakte),
    liste(
      einsatzKeys.medienkontakteOffen,
      (k: Medienkontakt) => (k.status === 'offen' ? k : null),
      vergleicheNachEingang,
    ),
    fenster(einsatzKeys.medienkontakteErledigt, false, (k: Medienkontakt) => ({
      zeile: k.status === 'offen' ? null : k,
      vergleich: vergleicheNachEingang,
      seite: MEDIENKONTAKTE_SEITE,
    })),
    einzeln<Medienkontakt>(einsatzKeys.medienkontaktEinzelnAlle),
  ]),
  // Auswahl, Seitenketten und Einzelabrufe liegen unter `schaeden(e)`, die Marker daneben.
  schaeden: ziel<Schaden>(
    ladeSchaden,
    (e) => [einsatzKeys.schaeden(e), einsatzKeys.schadenMarker(e)],
    [
      liste(einsatzKeys.schaeden, ungestorniert, vergleicheSchaeden),
      liste(
        einsatzKeys.schadenMarker,
        (s: Schaden): SchadenMarker | null => {
          const z = ungestorniert(s);
          return z && alsSchadenMarker(z);
        },
        vergleicheSchaeden,
      ),
      liste(einsatzKeys.schaedenAuswahl, alsSchadenAuswahl, vergleicheSchaeden),
      // Modulseite (LFH-1075): je Sicht und Sortierung eine Seitenkette. Ob ein Schaden zu einer
      // Sicht mit Suchbegriff gehört, weiß nur der Server.
      fenster(einsatzKeys.schaedenSeitenAlle, true, (s: Schaden, cacheKey) => {
        const { sicht, sortierung } = cacheKey[3] as {
          sicht: SchaedenFilter;
          sortierung: SchadenSortierung;
        };
        const passt = passtZurSicht(s, sicht);
        if (passt === null) return AN_SAMMLER;
        return {
          zeile: passt ? s : null,
          vergleich: vergleicheSchaedenNach(sortierung),
          seite: SCHAEDEN_SEITE,
        };
      }),
      einzeln<Schaden>(einsatzKeys.schaedenEinzelnAlle),
    ],
  ),
};

/** Ersetzt, ergänzt oder entfernt die Zeile `id` und sortiert wie der Server. */
export function einsortieren<T extends { id: number }>(
  liste: readonly T[],
  id: number,
  zeile: T | null,
  vergleich: (a: T, b: T) => number,
): T[] {
  const ohne = liste.filter((z) => z.id !== id);
  if (zeile === null) return ohne;
  return [...ohne, zeile].sort(vergleich);
}

/**
 * Ersetzt, ergänzt oder entfernt die Zeile `id` in einer Seitenkette (LFH-1075, Spec
 * `schaden-liste-blaettern`). Eine Zeile, die hinter die letzte geladene fiele, während der
 * Server noch weitere Seiten hätte, liegt außerhalb des Fensters und wird nicht einsortiert;
 * stand sie im Fenster, fällt sie heraus. Sonst kommt sie an ihren Platz in der Seite, in die sie
 * nach der Ordnung gehört. Die Seiten dürfen dabei länger oder kürzer werden; der Cursor der
 * nächsten Seite hängt nur an der letzten Zeile der letzten Seite.
 */
export function fensterEinsortieren<T extends { id: number }>(
  alt: InfiniteData<T[]>,
  id: number,
  zeile: T | null,
  vergleich: (a: T, b: T) => number,
  seitenGroesse: number,
): InfiniteData<T[]> {
  const seiten = alt.pages.map((p) => p.filter((z) => z.id !== id));
  const entfernt = seiten.some((p, i) => p.length !== alt.pages[i].length);
  if (zeile === null || seiten.length === 0) {
    return entfernt ? { ...alt, pages: seiten } : alt;
  }
  const letzteSeite = alt.pages[alt.pages.length - 1];
  const weitere = letzteSeite.length >= seitenGroesse;
  const letzte = letzteSeite[letzteSeite.length - 1] as T | undefined;
  if (weitere && letzte && letzte.id !== id && vergleich(zeile, letzte) > 0) {
    return entfernt ? { ...alt, pages: seiten } : alt;
  }
  let ziel = seiten.findIndex((p) => p.length > 0 && vergleich(zeile, p[p.length - 1]) < 0);
  if (ziel === -1) ziel = seiten.length - 1;
  seiten[ziel] = [...seiten[ziel], zeile].sort(vergleich);
  return { ...alt, pages: seiten };
}

export interface ZeilenSammler {
  /** Merkt die Zeile `id` von `ziel` für das laufende Fenster vor. */
  vormerken(ziel: ZeilenZiel, id: number): void;
  /** Effekt-Cleanup VOR `sammler.raeumen()`: offene Ziele gehen als Listen in den Sammler. */
  raeumen(): void;
}

/**
 * Zeilenabgleich einer Live-Verbindung (LFH-931, Spec `live-abgleich`, design.md D3): Ereignisse
 * zu einem Medienkontakt oder Schaden laden nur diese Zeile und sortieren sie in die geladenen
 * Listen ein, statt den Gesamtbestand neu abzurufen.
 *
 * Wo sich das nicht lohnt oder nicht sicher ist, gehen die Listen an den Sammler der Verbindung
 * (Prefix-Abgleich wie bisher): verdeckter Tab, keine Liste im Cache, mehr als
 * {@link ZEILEN_GRENZE} Kennungen, ein gescheiterter Zeilenabruf. Läuft für eine Liste ein Abruf
 * oder für das Ziel noch ein Zeilenabruf, wandert die Kennung ins nächste Fenster; ein laufender
 * Listenabruf könnte vor der Änderung gelesen haben und die eingesetzte Zeile überschreiben.
 */
export function erzeugeZeilenSammler(
  qc: QueryClient,
  sammler: LiveSammler,
  einsatzId: number,
): ZeilenSammler {
  const vorgemerkt = new Map<ZeilenZiel, Set<number>>();
  const laufend = new Set<ZeilenZiel>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let beendet = false;

  // Eine als veraltet markierte Liste (verdeckter Tab, Grenze, inaktive Seite) bekommt keine
  // Zeile: `setQueryData` nähme die Markierung weg, und die Liste gälte ohne die früheren
  // Änderungen als frisch. Sie bleibt beim Sammler, der sie beim nächsten Beobachter abruft.
  const aktuell = (key: QueryKey) => qc.getQueryState(key)?.isInvalidated === false;

  const listenAnSammler = (ziel: ZeilenZiel) =>
    ZIELE[ziel].sammeln(einsatzId).forEach((key) => sammler.vormerken(key));

  // Die Einträge einer Liste im Cache: der exakte Key, oder bei einem Prefix jeder geladene
  // Eintrag darunter.
  const eintraege = (l: ZeilenListe<unknown>): QueryKey[] =>
    l.praefix
      ? qc
          .getQueryCache()
          .findAll({ queryKey: l.key(einsatzId) })
          .filter((q) => q.state.data !== undefined)
          .map((q) => q.queryKey)
      : [l.key(einsatzId)];

  const planen = () => {
    if (!beendet && vorgemerkt.size > 0) timer ??= setTimeout(abgleichen, LIVE_SAMMELFENSTER_MS);
  };

  const zurueckstellen = (ziel: ZeilenZiel, ids: Iterable<number>) => {
    const set = vorgemerkt.get(ziel) ?? new Set<number>();
    for (const id of ids) set.add(id);
    vorgemerkt.set(ziel, set);
  };

  const zeilenLaden = async (ziel: ZeilenZiel, ids: number[]) => {
    const def = ZIELE[ziel];
    laufend.add(ziel);
    const ergebnisse = await Promise.allSettled(ids.map((id) => def.laden(einsatzId, id)));
    laufend.delete(ziel);
    if (beendet) return; // `raeumen` hat die Listen schon als veraltet markiert.
    if (ergebnisse.some((e) => e.status === 'rejected')) {
      listenAnSammler(ziel);
    } else {
      for (const l of def.listen) {
        for (const key of eintraege(l)) {
          if (qc.isFetching({ queryKey: key, exact: true }) > 0 || !aktuell(key)) {
            if (qc.getQueryData(key) !== undefined) sammler.vormerken(key);
            continue;
          }
          const alt = qc.getQueryData(key);
          if (alt === undefined) continue;
          let neu: unknown = alt;
          for (const [i, e] of ergebnisse.entries()) {
            if (e.status !== 'fulfilled') continue;
            neu = l.einsetzen(neu, ids[i], e.value, key);
            if (neu === AN_SAMMLER) break;
          }
          if (neu === AN_SAMMLER) sammler.vormerken(key);
          else if (neu !== alt) qc.setQueryData(key, neu);
        }
      }
    }
    planen();
  };

  const abgleichen = () => {
    timer = null;
    const faellig = [...vorgemerkt];
    vorgemerkt.clear();
    const verdeckt = document.visibilityState === 'hidden';
    for (const [ziel, ids] of faellig) {
      const listen = ZIELE[ziel].listen.flatMap(eintraege);
      const geladen = listen.filter((key) => qc.getQueryData(key) !== undefined);
      if (verdeckt || !geladen.some(aktuell) || ids.size > ZEILEN_GRENZE) {
        listenAnSammler(ziel);
      } else if (
        laufend.has(ziel) ||
        listen.some((key) => qc.isFetching({ queryKey: key, exact: true }) > 0)
      ) {
        zurueckstellen(ziel, ids);
      } else {
        void zeilenLaden(ziel, [...ids]);
      }
    }
    planen();
  };

  return {
    vormerken(ziel, id) {
      if (beendet) return;
      zurueckstellen(ziel, [id]);
      planen();
    },
    raeumen() {
      beendet = true;
      if (timer) clearTimeout(timer);
      timer = null;
      const offen = new Set<ZeilenZiel>([...vorgemerkt.keys(), ...laufend]);
      vorgemerkt.clear();
      offen.forEach(listenAnSammler);
    },
  };
}
