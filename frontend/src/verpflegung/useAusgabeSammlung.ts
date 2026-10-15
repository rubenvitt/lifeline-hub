/**
 * Zeitgeber, Abschlussereignisse und Senden der Sammelbuchung (LLH-1032, design.md D2/D5).
 *
 * Der Kern (`ausgabeSammlung.ts`) zählt; dieser Hook entscheidet, WANN und WIE eine Sammlung
 * hinausgeht:
 *
 * - **senden oder vormerken** (`erfasseVerpflegungsausgabeOfflineFaehig`, ohne `zeitpunkt_at`):
 *   nach Ruhe, nach der Höchstdauer, ab der Höchstmenge, über „Buchen“ und wenn das Zeitfenster
 *   vergangen wird. Die `client_id` setzt die Funktion beim Abschluss, nicht beim ersten Tipp.
 * - **sofort vormerken, ohne Sendeversuch und ohne Hinweis** (`merkeVerpflegungsausgabeVor`): beim
 *   Wechsel des Zeitfensters, beim Verlassen der Ansicht (Unmount), bei `visibilitychange=hidden`
 *   und `pagehide`. Dort gibt es keinen Ort mehr für Erfolg oder Ablehnung (Regel LFH-1077); die
 *   Warteschlange sendet und legt Ablehnungen in den Wiederherstellungsbereich.
 *
 * Der Abschluss leert die Sammlung im selben Schritt, in dem er sie herausgibt: zwei Auslöser im
 * selben Takt ergeben genau einen Schreibvorgang. Ein gesendetes, noch unbeantwortetes Bündel zählt
 * weiter in `menge`, bis die Antwort das Zeitfenster in den Cache geschrieben hat (wie der Sync,
 * `offline/useOfflineSync.ts`); sonst sänke die angezeigte Zahl für die Dauer einer Anfrage.
 *
 * Bewusst keine TanStack-Mutation: es gibt nichts zu pausieren, und jede Sammlung ist ein eigener,
 * unabhängiger Aufruf. Die Regel `networkMode: 'always'` (`offline/AGENTS.md`) greift deshalb nicht.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { einsatzKeys } from '../api/queryKeys';
import type { Kostform, Sonderkost, Verpflegung } from '../api/types';
import {
  erfasseVerpflegungsausgabeOfflineFaehig,
  merkeVerpflegungsausgabeVor,
} from '../offline/schreiben';
import { AusgabeSammlung, type Buendel } from './ausgabeSammlung';
import { KOSTFORMEN } from './verpflegungText';

interface ZeitfensterZiel {
  id: number;
  bezeichnung: string;
}

export interface AusgabeSammlungOptionen {
  benutzerId: number | undefined;
  einsatzId: number;
  /** Das gezählte Zeitfenster; `null`, solange es nicht geladen ist. */
  zeitfenster: ZeitfensterZiel | null;
  /** Vorbei: eine offene Sammlung wird gebucht, neue Tipps werden nicht angenommen (D7). */
  vergangen: boolean;
  /** Mit Netz gebucht; nur, solange die Ansicht dieses Zeitfensters steht. */
  onGebucht?: (ausgabeId: number, buendel: Buendel) => void;
  /** Ohne Netz an Ort und Stelle vorgemerkt; nur, solange die Ansicht dieses Zeitfensters steht. */
  onVorgemerkt?: (buendel: Buendel) => void;
}

/** Fachlich abgelehntes Bündel (409, 404/422, 403): gezählt ist nichts. */
export interface Ablehnung {
  fehler: unknown;
  buendel: Buendel;
}

export interface AusgabeSammlungStand {
  /** Offene Sammlung samt gesendeten, noch unbeantworteten Bündeln („Sammlung n“). */
  menge: number;
  /** Sonderkost derselben Menge. */
  sonderkost: Sonderkost;
  /** Eine Sammlung ist offen: „−1“ und „Buchen“ sind möglich. */
  offen: boolean;
  /** Wie viel „Menge …“ noch annimmt (bis `VERPFLEGUNG_EP_MAX`). */
  platz: number;
  ablehnung: Ablehnung | null;
  tippe: (n: number, kostform?: Kostform) => void;
  nimmZurueck: () => void;
  buchen: () => void;
}

interface Unterwegs {
  schluessel: number;
  buendel: Buendel;
}

function addiere(ziel: Sonderkost, b: Buendel): void {
  for (const k of KOSTFORMEN) ziel[k] += b.sonderkost?.[k] ?? 0;
}

export function useAusgabeSammlung({
  benutzerId,
  einsatzId,
  zeitfenster,
  vergangen,
  onGebucht,
  onVorgemerkt,
}: AusgabeSammlungOptionen): AusgabeSammlungStand {
  const qc = useQueryClient();
  const sammlung = useRef(new AusgabeSammlung()).current;
  const [, setTakt] = useState(0);
  const neuZeichnen = useCallback(() => setTakt((n) => n + 1), []);
  const [unterwegs, setUnterwegs] = useState<Unterwegs[]>([]);
  const [ablehnung, setAblehnung] = useState<Ablehnung | null>(null);
  const zaehler = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Die jüngsten Werte für Zeitgeber, Ereignisse und Antworten, die nach dem Render laufen.
  const aktuell = useRef({ benutzerId, einsatzId, zeitfenster, onGebucht, onVorgemerkt });
  aktuell.current = { benutzerId, einsatzId, zeitfenster, onGebucht, onVorgemerkt };
  const montiert = useRef(true);

  const stoppeZeitgeber = useCallback(() => {
    if (timer.current != null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  /** Gibt die Sammlung heraus (einmalig) und schickt sie auf den gewählten Weg. */
  const abschliessen = useCallback(
    (weg: 'senden' | 'vormerken', ziel: ZeitfensterZiel | null) => {
      stoppeZeitgeber();
      const buendel = sammlung.abschluss();
      if (!buendel) return;
      neuZeichnen();
      const { benutzerId: bid, einsatzId: eid } = aktuell.current;
      if (bid == null || ziel == null) return;
      if (weg === 'vormerken') {
        // Ohne Hinweis: die Ansicht ist weg oder verborgen (D5). Ein Fehler des lokalen
        // Speichers hat keinen Ort; die Zählung ist dann verloren wie bei einem Absturz.
        void merkeVerpflegungsausgabeVor(bid, eid, ziel, buendel).catch(() => {});
        return;
      }
      setAblehnung(null);
      const schluessel = ++zaehler.current;
      setUnterwegs((u) => [...u, { schluessel, buendel }]);
      const entferne = () => setUnterwegs((u) => u.filter((x) => x.schluessel !== schluessel));
      // Rückmeldung nur am Ort der Handlung: dasselbe Zeitfenster, Ansicht noch da (LFH-1077).
      const amOrt = () => montiert.current && aktuell.current.zeitfenster?.id === ziel.id;
      erfasseVerpflegungsausgabeOfflineFaehig(bid, eid, ziel, buendel).then(
        (ergebnis) => {
          if (ergebnis.zustand === 'vorgemerkt') {
            entferne();
            if (amOrt()) aktuell.current.onVorgemerkt?.(buendel);
            return;
          }
          // Erst das bestätigte Zeitfenster in den Cache, dann das Bündel aus „Sammlung“: beides
          // im selben Takt, ohne Zwischenstand mit kleinerer Summe (wie der Sync, LFH-688 D7).
          const key = einsatzKeys.verpflegung(eid);
          const zf = ergebnis.daten.zeitfenster;
          qc.setQueryData<Verpflegung>(key, (alt) =>
            alt
              ? { ...alt, zeitfenster: alt.zeitfenster.map((z) => (z.id === zf.id ? zf : z)) }
              : alt,
          );
          entferne();
          void qc.invalidateQueries({ queryKey: key });
          if (amOrt()) aktuell.current.onGebucht?.(ergebnis.daten.ausgabe_id, buendel);
        },
        (fehler: unknown) => {
          entferne();
          if (amOrt()) setAblehnung({ fehler, buendel });
        },
      );
    },
    [neuZeichnen, qc, sammlung, stoppeZeitgeber],
  );

  /** Stellt den Zeitgeber auf Ruhe bzw. Höchstdauer, oder schließt sofort ab. */
  const planeAbschluss = useCallback(() => {
    stoppeZeitgeber();
    const jetzt = Date.now();
    if (sammlung.mussAbschliessen(jetzt)) {
      abschliessen('senden', aktuell.current.zeitfenster);
      return;
    }
    const faellig = sammlung.naechsterAbschluss();
    if (faellig == null) return;
    timer.current = setTimeout(planeAbschluss, Math.max(0, faellig - jetzt));
  }, [abschliessen, sammlung, stoppeZeitgeber]);

  const tippe = useCallback(
    (n: number, kostform?: Kostform) => {
      if (vergangen || aktuell.current.zeitfenster == null) return;
      if (!sammlung.tippe(n, Date.now(), kostform)) return;
      neuZeichnen();
      planeAbschluss();
    },
    [neuZeichnen, planeAbschluss, sammlung, vergangen],
  );

  const nimmZurueck = useCallback(() => {
    sammlung.nimmZurueck();
    neuZeichnen();
    if (sammlung.istLeer) stoppeZeitgeber();
  }, [neuZeichnen, sammlung, stoppeZeitgeber]);

  const buchen = useCallback(
    () => abschliessen('senden', aktuell.current.zeitfenster),
    [abschliessen],
  );

  // Wechsel des Zeitfensters und Unmount: das alte Ziel bekommt seine Sammlung vorgemerkt.
  const zfId = zeitfenster?.id ?? null;
  useEffect(() => {
    montiert.current = true;
    const ziel = aktuell.current.zeitfenster;
    return () => {
      montiert.current = false;
      if (zfId != null && ziel != null) abschliessen('vormerken', ziel);
      setAblehnung(null);
    };
  }, [zfId, abschliessen]);

  // Wird das Zeitfenster während einer Sammlung vergangen, wird sie gebucht (D7).
  useEffect(() => {
    if (vergangen) abschliessen('senden', aktuell.current.zeitfenster);
  }, [vergangen, abschliessen]);

  // Verbergen und Beenden der Seite: sofort vormerken, ein `fetch` aus einer verborgenen Seite
  // friert der Browser oft vor der Antwort ein (D5).
  useEffect(() => {
    const beiSicht = () => {
      if (document.visibilityState === 'hidden') {
        abschliessen('vormerken', aktuell.current.zeitfenster);
      }
    };
    const beiPagehide = () => abschliessen('vormerken', aktuell.current.zeitfenster);
    document.addEventListener('visibilitychange', beiSicht);
    window.addEventListener('pagehide', beiPagehide);
    return () => {
      document.removeEventListener('visibilitychange', beiSicht);
      window.removeEventListener('pagehide', beiPagehide);
    };
  }, [abschliessen]);

  useEffect(() => stoppeZeitgeber, [stoppeZeitgeber]);

  // Offene Sammlung plus gesendete, unbeantwortete Bündel; je Render neu, die Mengen sind klein.
  const summe = { menge: sammlung.menge, sonderkost: sammlung.sonderkost };
  for (const u of unterwegs) {
    summe.menge += u.buendel.menge;
    addiere(summe.sonderkost, u.buendel);
  }

  return {
    menge: summe.menge,
    sonderkost: summe.sonderkost,
    offen: !sammlung.istLeer,
    platz: sammlung.platz,
    ablehnung,
    tippe,
    nimmZurueck,
    buchen,
  };
}
