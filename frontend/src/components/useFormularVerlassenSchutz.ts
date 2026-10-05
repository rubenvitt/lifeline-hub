import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Merker des Verlassen-Schutzes einer Formularseite mit Speichern-Leiste (LFH-979,
 * `frontend/AGENTS.md` „Formularseiten“). Speist `components/VerlassenRueckfrage.tsx` und warnt
 * selbst beim Schließen oder Neuladen des Tabs (`beforeunload`).
 *
 * ```tsx
 * const schutz = useFormularVerlassenSchutz({ aktiv: darfBearbeiten });
 * <Form onValuesChange={schutz.geaendert} onFinish={(w) => {
 *   const fassung = schutz.fassung();
 *   speichern.mutate(w, { onSuccess: () => schutz.gespeichert(fassung) });
 * }}>
 * <VerlassenRueckfrage ungespeichert={schutz.ungespeichert} />
 * ```
 *
 * - **Eigener Zustand, nicht `isFieldsTouched`:** antd setzt `touched` nach dem Speichern nie
 *   zurück, die Rückfrage käme sonst für den ganzen Besuch.
 * - **Fassungszähler statt Boolean:** jede Änderung zählt hoch; `gespeichert(f)` deckt nur ab, was
 *   bis `fassung()` (beim Absenden) dazukam. Wer während des Speicherns weitertippt, bleibt
 *   geschützt.
 * - `gespeichert` nur bei Erfolg rufen: ein gescheitertes Speichern lässt den Schutz stehen.
 * - `aktiv: false` (kein Schreibrecht, Formular `disabled`): nie ungespeichert.
 * - `schluessel` (Datensatz-ID): bleibt die Seite beim Wechsel auf einen anderen Datensatz
 *   montiert (gleiche Route, anderer Parameter, Formular per `key` neu), gilt die verworfene
 *   Eingabe des vorigen nicht als offene Änderung des neuen.
 */
export function useFormularVerlassenSchutz({
  aktiv,
  schluessel,
}: {
  aktiv: boolean;
  schluessel?: string | number | null;
}) {
  const zaehlerRef = useRef(0);
  const aktivRef = useRef(aktiv);
  const [stand, setStand] = useState({ geaendert: 0, gesichert: 0 });
  const [letzterSchluessel, setLetzterSchluessel] = useState(schluessel);
  if (schluessel !== letzterSchluessel) {
    // Zustand beim Rendern anpassen statt per Effekt: sonst stünde ein Frame lang die alte
    // Änderung am neuen Datensatz.
    setLetzterSchluessel(schluessel);
    setStand((s) => ({ ...s, gesichert: s.geaendert }));
  }

  useEffect(() => {
    aktivRef.current = aktiv;
  }, [aktiv]);

  const geaendert = useCallback(() => {
    if (!aktivRef.current) return;
    zaehlerRef.current += 1;
    const zaehler = zaehlerRef.current;
    setStand((s) => ({ ...s, geaendert: zaehler }));
  }, []);

  /** Stand beim Absenden — an `gespeichert` zurückgeben, wenn das Speichern gelingt. */
  const fassung = useCallback(() => zaehlerRef.current, []);

  const gespeichert = useCallback((bis: number) => {
    setStand((s) => (bis > s.gesichert ? { ...s, gesichert: bis } : s));
  }, []);

  const ungespeichert = aktiv && stand.geaendert > stand.gesichert;

  useEffect(() => {
    if (!ungespeichert) return;
    // `preventDefault()` allein ist der heutige Weg — `returnValue` ist abgekündigt.
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [ungespeichert]);

  return { ungespeichert, geaendert, fassung, gespeichert };
}
