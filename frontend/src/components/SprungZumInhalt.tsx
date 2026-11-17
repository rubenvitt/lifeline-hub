import { useRollen } from './instrument';
import { RAHMEN_EBENE } from './rahmenOben';

/**
 * Sprunglink „Zum Inhalt springen“ (WCAG 2.4.1, nufmon70, Spec `einsatztauglichkeit-layout`, „Ein
 * Sprunglink führt zum Inhalt“; Regel `frontend/AGENTS.md`, Rahmen, „Sprunglink zum Inhalt“).
 * Herleitung: `openspec/changes/archive/2026-11-17-nufmon70-sprunglink-zum-inhalt/design.md`.
 *
 * EINMAL in `BetriebsLayout` (`App.tsx`) als allererster Tab-Halt, vor der Betriebszeile (D1); die
 * Hilfe liegt außerhalb und bindet ihn selbst ein. Jeder Rahmen markiert sein Inhaltsgebiet mit
 * {@link sprungzielInhalt}; der Link nimmt das LETZTE Ziel in DOM-Reihenfolge, bei Verschachtelung
 * also das innere (Verwaltung: der Inhalt neben dem Menü, D2).
 *
 * Ohne Fokus aus dem Bild genommen, mit Fokus fest oben links über dem Rahmen
 * (`.lfh-sprung-inhalt` in `theme/sprache.css`, D4): `fixed` nimmt keinen Platz im Fluss, also
 * springt nichts. Vorbild ist „Zum Detail“ in `components/ListeDetail.tsx`.
 */

/** Greifer des Sprungziels; je Rahmen genau eins, die Verwaltung schachtelt ihres in das der Ebene 1. */
export const SPRUNGZIEL_INHALT = 'sprungziel-inhalt';

/**
 * Die Marke eines Sprungziels zum Ausbreiten am Inhaltsgebiet. `tabIndex -1`: per Skript
 * fokussierbar, aber nicht in der Tab-Folge; den Ring nimmt `sprache.css` weg.
 */
export const sprungzielInhalt = { 'data-lfh': SPRUNGZIEL_INHALT, tabIndex: -1 } as const;

/**
 * Stil des Links mit aufgelösten Tokens (Handgebautes Bedienziel, `frontend/AGENTS.md`, LFH-365:
 * ein `<a>` erbt keine Steuerhöhe). Die Stapelebene liegt über dem klebenden Rahmen, damit der
 * fokussierte Link nie verdeckt ist. Rein und exportiert, damit die Böden ohne Render prüfbar sind.
 */
export function sprungZumInhaltStil(token: { controlHeight: number; padding: number }) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: token.controlHeight,
    padding: `0 ${token.padding}px`,
    zIndex: RAHMEN_EBENE + 1,
  } as const;
}

export default function SprungZumInhalt() {
  const { token } = useRollen();
  return (
    <a
      // Rückfall ohne Skript (D2); mit Skript schriebe der Router sonst einen Hash in die Adresse.
      href="#inhalt"
      className="lfh-sprung-inhalt"
      data-lfh="sprung-zum-inhalt"
      onClick={(ev) => {
        ev.preventDefault();
        const ziele = document.querySelectorAll<HTMLElement>(`[data-lfh="${SPRUNGZIEL_INHALT}"]`);
        ziele[ziele.length - 1]?.focus({ preventScroll: false });
      }}
      style={sprungZumInhaltStil(token)}
    >
      Zum Inhalt springen
    </a>
  );
}
