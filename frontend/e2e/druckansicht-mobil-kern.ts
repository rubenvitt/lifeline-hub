import { expect, type Browser, type Page } from '@playwright/test';
import { anmeldenAls, type Konto } from './rollen-kern';

/**
 * Druckansichten am Handy (LFH-956): Einsatzbericht und ETB-Druck dienen der Kontrolle vor dem
 * PDF und müssen bei 390 px ohne Seitenscrollen lesbar sein.
 *
 * Gemessen wird in einem MOBILEN Kontext (`isMobile`): dort weitet zu breiter Inhalt den
 * Layout-Viewport (`innerWidth` 418 statt 390), statt seitlich überzustehen. `setViewportSize`
 * auf einem Desktop-Kontext sieht das nicht; so blieb das alte 390-px-Gate des Einsatzberichts
 * trotz Überlauf grün. Firefox kennt `isMobile` nicht und misst denselben Viewport ohne; dort
 * zeigt sich der Überlauf an `scrollWidth`.
 *
 * Eigener Kontext je Konto, angemeldet über die Oberfläche: das Gate läuft für den Admin UND
 * nicht-privilegiert (`e2e/AGENTS.md`, LFH-435).
 */

export const HANDY = { width: 390, height: 844 } as const;

export interface MobilMessung {
  innerWidth: number;
  scrollWidth: number;
  innerHeight: number;
}

export async function mitHandy<T>(
  browser: Browser,
  browserName: string,
  konto: Pick<Konto, 'benutzername' | 'passwort'>,
  pfad: string,
  messen: (page: Page) => Promise<T>,
): Promise<{ viewport: MobilMessung; ergebnis: T }> {
  const kontext = await browser.newContext({
    viewport: HANDY,
    ...(browserName === 'firefox' ? {} : { isMobile: true, hasTouch: true }),
  });
  try {
    const page = await kontext.newPage();
    await anmeldenAls(page, konto.benutzername, konto.passwort);
    // Vorbedingung: die Sitzung ist wirklich das gemeinte Konto (sonst mäße der Fall still als
    // Admin weiter).
    const ich = (await (await page.request.get('/api/auth/me')).json()) as { benutzername: string };
    expect(ich.benutzername, 'Vorbedingung: angemeldet als das gemeinte Konto').toBe(
      konto.benutzername,
    );
    await page.goto(pfad);
    await expect(page.getByRole('button', { name: 'Drucken / als PDF' })).toBeEnabled({
      timeout: 60_000,
    });
    const ergebnis = await messen(page);
    const viewport = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      innerHeight: window.innerHeight,
    }));
    return { viewport, ergebnis };
  } finally {
    await kontext.close();
  }
}

/**
 * Der Layout-Viewport bleibt bei 390 px, und die Seite ist nicht breiter. Weich (`expect.soft`),
 * damit ein Überlauf für jedes Konto einzeln rot wird, nicht nur für das erste.
 */
export function erwarteHandyBreite(wer: string, m: MobilMessung) {
  expect.soft(m.innerWidth, `${wer}: Layout-Viewport bleibt bei 390 px`).toBe(HANDY.width);
  expect
    .soft(m.scrollWidth, `${wer}: Seite nicht breiter als 390 px`)
    .toBeLessThanOrEqual(HANDY.width);
}
