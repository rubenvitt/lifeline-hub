import type { Page } from '@playwright/test';

/**
 * Navigation innerhalb der App, ohne Dokument-Abruf: der Data Router hört auf `popstate`.
 * Ohne Netz geht es nicht anders (die Offline-Specs), und wer viele Seiten hintereinander
 * prüft, lädt so nicht bei jedem Schritt die ganze App neu (LLH-1914, `orientierung.spec.ts`).
 */
export async function navigateInApp(page: Page, pfad: string): Promise<void> {
  await page.evaluate((ziel) => {
    window.history.pushState({}, '', ziel);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, pfad);
}
