import { useEffect } from 'react';

/** Die Marke am Ende jedes Tab-Titels. */
const MARKE = 'lifeline-hub';

/**
 * Tab-Titel aus Teilen, vom engsten zum weitesten Ort: „ETB · Starkregen Nord · lifeline-hub“.
 * Leere Teile fallen weg (der Einsatz lädt noch) — rein und exportiert.
 */
export function dokumentTitel(teile: readonly (string | null | undefined)[]): string {
  return [...teile.map((t) => t?.trim()).filter((t): t is string => !!t), MARKE].join(' · ');
}

/**
 * Setzt den Tab-Titel (LFH-954, Spec `seiten-orientierung`; `frontend/AGENTS.md`, Seitenkopf).
 * Nur die Rahmen rufen ihn — Einsatzrahmen, Ebene 1, Anmeldung —, keine Seite: der Name kommt aus
 * derselben Quelle wie das Menü. Beim Abbau kehrt der vorige Titel zurück.
 */
export function useDokumentTitel(teile: readonly (string | null | undefined)[]): void {
  const titel = dokumentTitel(teile);
  useEffect(() => {
    const vorher = document.title;
    document.title = titel;
    return () => {
      document.title = vorher;
    };
  }, [titel]);
}
