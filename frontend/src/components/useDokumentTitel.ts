import { useEffect } from 'react';

/** Die Marke am Ende jedes Tab-Titels. */
const MARKE = 'lifeline-hub';

/**
 * Tab-Titel aus Teilen, vom engsten zum weitesten Ort: „ETB · Starkregen Nord · lifeline-hub“.
 * Leere Teile fallen weg (der Einsatz lädt noch) — rein und exportiert. `zahl` steht vorn in
 * Klammern, „(3) ETB · …“: die ungelesenen Eingänge (LLH-1062, LLH-1143), sichtbar auch im
 * Hintergrund-Tab. 0 und nichts lassen sie weg.
 */
export function dokumentTitel(
  teile: readonly (string | null | undefined)[],
  zahl?: number,
): string {
  const titel = [...teile.map((t) => t?.trim()).filter((t): t is string => !!t), MARKE].join(' · ');
  return zahl && zahl > 0 ? `(${zahl}) ${titel}` : titel;
}

/**
 * Setzt den Tab-Titel (LFH-954, Spec `seiten-orientierung`; `frontend/AGENTS.md`, Seitenkopf).
 * Nur die Rahmen rufen ihn — Einsatzrahmen, Ebene 1, Anmeldung —, keine Seite: der Name kommt aus
 * derselben Quelle wie das Menü. Beim Abbau kehrt der vorige Titel zurück.
 */
export function useDokumentTitel(
  teile: readonly (string | null | undefined)[],
  zahl?: number,
): void {
  const titel = dokumentTitel(teile, zahl);
  useEffect(() => {
    const vorher = document.title;
    document.title = titel;
    return () => {
      document.title = vorher;
    };
  }, [titel]);
}
