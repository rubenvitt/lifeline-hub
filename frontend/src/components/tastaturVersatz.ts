import { useEffect, useState, type RefObject } from 'react';

/**
 * Versatz eines am unteren Rand klebenden Fußes über der Bildschirmtastatur (LLH-1761, Entwurf
 * `docs/superpowers/specs/2026-11-20-j45fvu8l-handy-hauptaktion-kleben-design.md`).
 *
 * Die Tastatur schiebt sich auf Android (Chrome ab 108) und iOS über das LAYOUT-Viewport, nicht
 * darunter: `sticky; bottom: 0` klebt dann hinter ihr. Was sie verdeckt, ist die Differenz zwischen
 * Layout-Viewport (`innerHeight`) und dem sichtbaren Ausschnitt (`visualViewport`). Diese Höhe
 * liefert der Hook, solange der Fokus in `wurzel` steht. Ohne Fokus im Formular gehört die Tastatur
 * einem anderen Feld, und der Fuß bleibt am Rand. Fehlt das VisualViewport (alte Browser, jsdom),
 * bleibt er 0.
 *
 * Bewusst nicht über `interactive-widget=resizes-content` im Viewport-Meta: das wäre global und
 * wirkte auf iOS nicht (Entscheidung am Checkpoint, 20.11.2026).
 */
export function useTastaturVersatz(wurzel: RefObject<HTMLElement | null>): number {
  const [versatz, setVersatz] = useState(0);

  useEffect(() => {
    const el = wurzel.current;
    const vv = typeof window === 'undefined' ? undefined : window.visualViewport;
    if (!el || !vv) return undefined;

    const messe = () => {
      if (!el.contains(document.activeElement)) {
        setVersatz(0);
        return;
      }
      setVersatz(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    };
    const fokusRaus = (e: FocusEvent) => {
      const ziel = e.relatedTarget as Node | null;
      if (!ziel || !el.contains(ziel)) setVersatz(0);
    };

    messe();
    el.addEventListener('focusin', messe);
    el.addEventListener('focusout', fokusRaus);
    vv.addEventListener('resize', messe);
    vv.addEventListener('scroll', messe);
    return () => {
      el.removeEventListener('focusin', messe);
      el.removeEventListener('focusout', fokusRaus);
      vv.removeEventListener('resize', messe);
      vv.removeEventListener('scroll', messe);
    };
  }, [wurzel]);

  return versatz;
}
