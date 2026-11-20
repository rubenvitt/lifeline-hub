import type { RuleObject } from 'antd/es/form';

/**
 * Pflichtfehler „‹Feld› fehlt“ (LLH-1766, Regel: `frontend/AGENTS.md`, „Erfassungs-Norm“).
 *
 * Jede Pflichtregel im Frontend nimmt diesen Helfer mit ausdrücklichem Feldnamen: antd setzt
 * `${label}` nur bei einem Text-Label, bei einem JSX-Label stünde sonst der technische Feldname im
 * Fehler. Der Name ist das kurze Hauptwort des sichtbaren Labels, ohne Artikel, ohne „Bitte“.
 * Wächter: `pflichtRegel.guard.test.ts`.
 */
export function pflicht(feld: string, optionen: { whitespace?: boolean } = {}): RuleObject {
  return {
    required: true,
    ...(optionen.whitespace ? { whitespace: true } : {}),
    message: `${feld} fehlt`,
  };
}

/** Rückfall für eine Pflichtregel ohne eigenen Text (`ConfigProvider` `form.validateMessages`). */
export const PFLICHT_STANDARD = '${label} fehlt';
