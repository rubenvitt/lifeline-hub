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
 * weiter in `menge` seines Zeitfensters, bis die Antwort das Zeitfenster in den Cache geschrieben
 * hat (wie der Sync, `offline/useOfflineSync.ts`); sonst sänke die angezeigte Zahl für die Dauer
 * einer Anfrage. Nach einem Wechsel des Zeitfensters zählt es dort nicht mit.
 *
 * Stelle und Empfänger (LLH-1040, design.md D13 Punkt 7; LLH-1055 Teil II, Entscheidung LLH-1024
 * F1): Ein Bündel trägt die Stelle und den Empfänger, die beim ersten Tipp gewählt waren, auf jedem
 * Weg hinaus. Ein Wechsel der Stelle oder des Empfängers bucht das offene Bündel sofort („senden“,
 * Ansicht steht noch, die Rückmeldung hat ihren Ort); das nächste Bündel zählt beim neuen.
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
import { empfaengerFelder, empfaengerSchluessel, type EmpfaengerWahl } from './empfaengerKern';
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
  /** Gewählte Verpflegungsstelle (LLH-1040); `null` oder fehlt: ohne Stelle. */
  stelleId?: number | null;
  /** Gewählter Empfänger (LLH-1055); `null` oder fehlt: ohne Empfänger. */
  empfaenger?: EmpfaengerWahl | null;
  /** Mit Netz gebucht; nur, solange die Ansicht dieses Zeitfensters steht. Läuft, bevor das
   *  bestätigte Zeitfenster im Cache steht. */
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
  /** Zeitfenster, für das das Bündel gesendet wurde; es zählt nur in dessen „Sammlung“. */
  zeitfensterId: number;
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
  stelleId = null,
  empfaenger = null,
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
  const aktuell = useRef({
    benutzerId,
    einsatzId,
    zeitfenster,
    stelleId,
    empfaenger,
    onGebucht,
    onVorgemerkt,
  });
  aktuell.current = {
    benutzerId,
    einsatzId,
    zeitfenster,
    stelleId,
    empfaenger,
    onGebucht,
    onVorgemerkt,
  };
  /** Stelle und Empfänger des offenen Bündels: gesetzt beim ersten Tipp, nicht bei einem Wechsel. */
  const buendelZiel = useRef<{ stelle: number | null; empfaenger: EmpfaengerWahl | null }>({
    stelle: null,
    empfaenger: null,
  });
  const montiert = useRef(true);

  const stoppeZeitgeber = useCallback(() => {
    if (timer.current != null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  /** Gibt die Sammlung heraus (einmalig) und schickt sie auf den gewählten Weg. */
  const abschliessen = useCallback(
    (weg: 'senden' | 'vormerken', ziel: ZeitfensterZiel | null) => {
      stoppeZeitgeber();
      const roh = sammlung.abschluss();
      if (!roh) return;
      const { stelle, empfaenger: an } = buendelZiel.current;
      buendelZiel.current = { stelle: null, empfaenger: null };
      const buendel: Buendel = {
        ...roh,
        ...(stelle != null ? { verpflegungsstelle_id: stelle } : {}),
        ...empfaengerFelder(an),
      };
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
      setUnterwegs((u) => [...u, { schluessel, zeitfensterId: ziel.id, buendel }]);
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
          // `onGebucht` VOR dem Cache: die Ansicht merkt die Ausgabe als eigene vor, sonst stünde
          // sie bei gehaltener Liste einen Takt lang hinter dem Sammelbanner (LLH-1292).
          if (amOrt()) aktuell.current.onGebucht?.(ergebnis.daten.ausgabe_id, buendel);
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
      const wasEmpty = sammlung.istLeer;
      if (!sammlung.tippe(n, Date.now(), kostform)) return;
      if (wasEmpty) {
        buendelZiel.current = {
          stelle: aktuell.current.stelleId,
          empfaenger: aktuell.current.empfaenger,
        };
      }
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

  // Ein Wechsel der Stelle (LLH-1040) oder des Empfängers (LLH-1055) schließt das offene Bündel
  // beim alten Ziel. Verglichen wird der Schlüssel, nicht das Objekt des Empfängers.
  const zielSchluessel = `${stelleId ?? ''}|${empfaengerSchluessel(empfaenger)}`;
  const vorigesZiel = useRef(zielSchluessel);
  useEffect(() => {
    if (vorigesZiel.current === zielSchluessel) return;
    vorigesZiel.current = zielSchluessel;
    abschliessen('senden', aktuell.current.zeitfenster);
  }, [zielSchluessel, abschliessen]);

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

  // Offene Sammlung plus gesendete, unbeantwortete Bündel DIESES Zeitfensters (nach einem Wechsel
  // gehört ein noch laufendes Bündel zum alten); je Render neu, die Mengen sind klein.
  const summe = { menge: sammlung.menge, sonderkost: sammlung.sonderkost };
  for (const u of unterwegs) {
    if (u.zeitfensterId !== zfId) continue;
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
