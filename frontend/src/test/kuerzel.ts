/**
 * Testhelfer für antippbar erklärte Kürzel (LLH-1825, `anzeige/KuerzelErklaerung.tsx`).
 *
 * Ein Etikett wie „Stärke (F/UF/M//Σ)“ steht seither über zwei Elemente verteilt (Text und der
 * Erklär-Knopf); `ganzerText` findet das innerste Element, das den ganzen Text trägt. Der
 * Erklär-Knopf ist keine Aktion: eine Leseansicht bleibt „ohne Knopf“, wenn sie nur ihn trägt
 * (`aktionsKnoepfe`).
 */
import { within } from '@testing-library/react';

/** Text-Matcher für einen Text, der über Kindelemente verteilt sein darf. */
export function ganzerText(text: string) {
  return (_inhalt: string, element: Element | null): boolean =>
    element?.textContent === text &&
    ![...element.children].some((kind) => kind.textContent === text);
}

/** Alle Knöpfe einer Fläche außer den Erklär-Knöpfen der Kürzel. */
export function aktionsKnoepfe(wurzel: HTMLElement = document.body): HTMLElement[] {
  return within(wurzel)
    .queryAllByRole('button')
    .filter((knopf) => !knopf.classList.contains('lfh-kuerzel'));
}
