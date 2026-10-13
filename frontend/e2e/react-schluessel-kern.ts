import { expect, test } from '@playwright/test';

/**
 * Wächter gegen doppelte React-Schlüssel (LLH-1167): React meldet „Encountered two children with
 * the same key“ nur als `console.error`, die Seite läuft weiter. Doppelte Schlüssel können Zeilen
 * doppelt zeigen oder verschlucken, deshalb macht der Wächter den Test rot, in dem die Meldung
 * fällt. Aufruf einmal auf Dateiebene einer Spec; er hängt sich an jede Seite, die der Test über
 * die `page`-Fixture öffnet.
 */
const DOPPELTER_SCHLUESSEL = /Encountered two children with the same key/;

export function doppelteSchluesselVerbieten(): void {
  const funde: string[] = [];
  test.beforeEach(({ page }) => {
    funde.length = 0;
    page.on('console', (m) => {
      if (m.type() === 'error' && DOPPELTER_SCHLUESSEL.test(m.text())) funde.push(m.text());
    });
  });
  test.afterEach(() => {
    expect(funde, 'React meldet doppelte Schlüssel').toEqual([]);
  });
}
