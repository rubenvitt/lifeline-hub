import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType, type Location } from 'react-router';
import {
  leseHerkunft,
  merkeHerkunft,
  uebertrageHerkunft,
  type VorigeAdresse,
} from './verlaufGedaechtnis';

/**
 * Merkt bei jedem Seitenwechsel, woher man kam (LLH-1997, `verlaufGedaechtnis.ts`). Sitzt genau
 * einmal im `BetriebsLayout` (`App.tsx`) und deckt damit Einsatz und Verwaltung ab.
 *
 * - PUSH: der neue Eintrag bekommt die vorige Adresse als Herkunft.
 * - REPLACE: die Herkunft wandert vom ersetzten auf den neuen Eintrag (eine Detailseite, die ihren
 *   Reiter per `replace` in die Adresse schreibt, behält sie).
 * - POP: nichts, der Eintrag trägt seine Herkunft schon.
 *
 * Geschrieben wird im Render, nicht im Effekt: das Layout zeichnet vor der Seite, und die Seite
 * liest die Herkunft schon in ihrem ersten Bild (`useVorigeAdresse`). Die zuletzt gezeigte Adresse
 * zieht dagegen erst der Layout-Effekt nach, also nur für ein Bild, das wirklich auf dem Schirm
 * steht: der Router navigiert in einer Transition, und ein verworfenes Rendern darf der noch
 * sichtbaren Seite keine Herkunft unterschieben (Review LLH-1997). So ist jedes Schreiben
 * idempotent, auch das doppelte Rendern unter StrictMode.
 */
export function VerlaufMerken(): null {
  const location = useLocation();
  const art = useNavigationType();
  const zuletzt = useRef<Location | null>(null);
  const vorige = zuletzt.current;
  if (vorige && vorige.key !== location.key) {
    if (art === 'PUSH') {
      merkeHerkunft(location.key, { pathname: vorige.pathname, search: vorige.search });
    } else if (art === 'REPLACE') {
      uebertrageHerkunft(vorige.key, location.key);
    }
  }
  useLayoutEffect(() => {
    zuletzt.current = location;
  }, [location]);
  return null;
}

/** Die Adresse, von der aus die aktuelle Seite betreten wurde, oder `null`. */
export function useVorigeAdresse(): VorigeAdresse | null {
  return leseHerkunft(useLocation().key);
}
