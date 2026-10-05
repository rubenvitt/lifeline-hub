import { useRef, useState } from 'react';
import { AusgangUnbekannt, NetzFehler, fehlerText, type UploadFortschritt } from '../api/client';

/**
 * Fortschritt nur vorwärts (Spec `dokumentenablage`, „Fortschritt beim Ablegen“): nach der
 * Prüfphase zählt kein spätes `progress` mehr, und ein kleinerer Anteil senkt die Zahl nicht.
 */
export function weiter(alt: UploadFortschritt | null, neu: UploadFortschritt): UploadFortschritt {
  if (alt?.phase === 'pruefen') return alt;
  if (neu.phase === 'senden' && alt?.phase === 'senden' && alt.anteil != null) {
    return { phase: 'senden', anteil: Math.max(alt.anteil, neu.anteil ?? alt.anteil) };
  }
  return neu;
}

/**
 * Überschrift und Text eines Ablage-Fehlers nach der Phase des Abbruchs (LFH-654): ohne Antwort
 * VOR dem letzten Byte ist nichts abgelegt, DANACH ist der Ausgang unbekannt. Eine Ablehnung des
 * Servers trägt dessen Meldung (`SpeicherFehler`).
 */
export function ablageFehlerKopf(fehler: unknown): { titel: string; fallback?: string } {
  if (fehler instanceof AusgangUnbekannt)
    return { titel: 'Ablage unklar', fallback: fehlerText(fehler) };
  if (fehler instanceof NetzFehler)
    return { titel: 'Nicht abgelegt', fallback: fehlerText(fehler) };
  return { titel: 'Nicht abgelegt' };
}

/**
 * Stand der Übertragung EINES Ablage-Dialogs (LFH-654, LFH-878), angezeigt über
 * `UploadFortschrittAnzeige`.
 *
 * `begleite` setzt sofort einen Balken ohne Zahl — bis zum ersten Byte-Ereignis (Verbindungsaufbau
 * über Mobilfunk) vergeht Zeit, und ≤ 100 ms soll etwas zu sehen sein (MIL 5.4.6.4) — und räumt
 * ihn am Ende des Laufs. „Abbrechen“ lässt eine Übertragung serverseitig weiterlaufen; ihre späten
 * Meldungen und ihr Ende dürfen nicht in die Anzeige eines neuen Laufs schreiben. Deshalb zählt
 * ein Lauf-Zähler, nicht `onSettled` (der läuft auch für einen abgebrochenen Lauf nach `reset()`).
 * Angezeigt wird der Stand nur, solange die Mutation läuft (`isPending`).
 */
export function useUploadFortschritt() {
  const [stand, setStand] = useState<UploadFortschritt | null>(null);
  const lauf = useRef(0);

  async function begleite<T>(
    upload: (onFortschritt: (stand: UploadFortschritt) => void) => Promise<T>,
  ): Promise<T> {
    const dieser = ++lauf.current;
    setStand({ phase: 'senden', anteil: null });
    try {
      return await upload((neu) => {
        if (dieser === lauf.current) setStand((alt) => weiter(alt, neu));
      });
    } finally {
      if (dieser === lauf.current) setStand(null);
    }
  }

  return { stand, begleite };
}
