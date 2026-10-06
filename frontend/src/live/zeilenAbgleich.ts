import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { alsSchadenMarker, ladeSchaden, vergleicheSchaeden } from '../api/einsatzSchaden';
import { ladeMedienkontakt, vergleicheMedienkontakte } from '../api/presse';
import { einsatzKeys, type ZeilenZiel } from '../api/queryKeys';
import type { Medienkontakt, Schaden, SchadenMarker } from '../api/types';
import { LIVE_SAMMELFENSTER_MS, type LiveSammler } from './liveInvalidierung';

/**
 * Mehr Kennungen je Liste und Fenster lädt der Zeilenabgleich nicht einzeln: nach einem Funkloch
 * ist ein Listenabruf billiger als vierzig Einzelabrufe (Spec `live-abgleich`).
 */
export const ZEILEN_GRENZE = 10;

/** Eine Liste, in die eine nachgeladene Zeile einsortiert wird. */
interface ZeilenListe<Z> {
  key: (einsatzId: number) => QueryKey;
  einsetzen: (alt: readonly unknown[], id: number, zeile: Z) => readonly unknown[];
}

/**
 * `form` bringt die Zeile in die Form der Liste; `null` heißt, sie gehört nicht (mehr) hinein
 * (stornierter Schaden).
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

interface Ziel {
  laden: (einsatzId: number, id: number) => Promise<unknown>;
  listen: readonly ZeilenListe<unknown>[];
}

function ziel<Z>(
  laden: (einsatzId: number, id: number) => Promise<Z>,
  listen: readonly ZeilenListe<Z>[],
): Ziel {
  return { laden, listen: listen as readonly ZeilenListe<unknown>[] };
}

// Die Schadenliste ohne Filter führt keine stornierten (Server-Vorgabe `inkl_storniert=false`),
// die Marker ebenso.
const ungestorniert = (s: Schaden): Schaden | null => (s.storniert_at == null ? s : null);

const ZIELE: Record<ZeilenZiel, Ziel> = {
  medienkontakte: ziel<Medienkontakt>(ladeMedienkontakt, [
    liste(einsatzKeys.medienkontakte, (k: Medienkontakt) => k, vergleicheMedienkontakte),
  ]),
  schaeden: ziel<Schaden>(ladeSchaden, [
    liste(einsatzKeys.schaeden, ungestorniert, vergleicheSchaeden),
    liste(
      einsatzKeys.schadenMarker,
      (s: Schaden): SchadenMarker | null => {
        const z = ungestorniert(s);
        return z && alsSchadenMarker(z);
      },
      vergleicheSchaeden,
    ),
  ]),
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

  const listenAnSammler = (ziel: ZeilenZiel) =>
    ZIELE[ziel].listen.forEach((l) => sammler.vormerken(l.key(einsatzId)));

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
        const key = l.key(einsatzId);
        if (qc.isFetching({ queryKey: key, exact: true }) > 0) {
          sammler.vormerken(key);
          continue;
        }
        qc.setQueryData<readonly unknown[]>(key, (alt) => {
          if (alt === undefined) return alt;
          let neu = alt;
          ergebnisse.forEach((e, i) => {
            if (e.status === 'fulfilled') neu = l.einsetzen(neu, ids[i], e.value);
          });
          return neu;
        });
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
      const listen = ZIELE[ziel].listen.map((l) => l.key(einsatzId));
      const geladen = listen.filter((key) => qc.getQueryData(key) !== undefined);
      if (verdeckt || geladen.length === 0 || ids.size > ZEILEN_GRENZE) {
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
