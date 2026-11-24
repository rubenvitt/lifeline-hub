import { expect, test, type Request } from '@playwright/test';
import { einsatzPerApi } from './einsatz-kern';
import { anmelden, FUEKW } from './trefflaeche-kern';

/**
 * Fehlergrenze je Rahmen (LLH-1822, Change `a12ms7g9-seitenzustaende` 2.3, Spec
 * `seiten-zustaende`, „Fehlergrenze je Rahmen“ und „Absturz wird dem Server gemeldet“; Regel
 * `frontend/AGENTS.md`, Rahmen, „Jede Rahmenebene hat eine Fehlergrenze“). Im Browser, weil nur
 * der echte Ablauf zeigt, dass ein Wurf unter dem echten Router im Rahmen bleibt und der Bericht
 * beim echten Server ankommt. Texte, Knöpfe je Rahmen und den Wächter am
 * Routenbaum prüft Vitest (`src/components/Fehlergrenze.test.tsx`, `src/App.fehlergrenze*.test.tsx`).
 *
 * Eingeschleust wird eine kaputte Antwort: Die offenen Erinnerungen kommen als Objekt statt als
 * Liste, die Seite ruft darauf `filter` auf und wirft beim Zeichnen.
 *
 * Mutationsprobe (17.11.2026, Chromium): das `errorElement` der pfadlosen Route unter
 * `EinsatzLayout` in `App.tsx` entfernt → rot (das letzte Netz an der Wurzel ersetzt den Rahmen,
 * der Satz über die anderen Module fehlt); zusätzlich das der Wurzel entfernt → die Seite zeigt
 * „Unexpected Application Error!“ samt Stack, rot.
 */

/** Nur die offenen Erinnerungen (ohne Parameter), nicht die abgeschlossenen. */
const offeneErinnerungen = (url: URL) =>
  /\/api\/einsaetze\/\d+\/erinnerungen$/.test(url.pathname) && url.search === '';

const istBericht = (r: Request) => r.method() === 'POST' && r.url().endsWith('/api/client-errors');

test('ein Modul stürzt ab: der Rahmen bleibt, deutscher Text, ein Bericht an den Server', async ({
  page,
}) => {
  await anmelden(page, { startseite: false });
  const einsatzId = await einsatzPerApi(page, `E2E Fehlergrenze ${Date.now()}`);
  await page.setViewportSize(FUEKW);

  await page.route(offeneErinnerungen, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { kaputt: true } })
      : route.fallback(),
  );
  const berichte: Request[] = [];
  page.on('request', (r) => {
    if (istBericht(r)) berichte.push(r);
  });
  const angenommen = page.waitForResponse((r) => istBericht(r.request()));

  await page.goto(`/einsaetze/${einsatzId}/erinnerungen`);

  const grenze = page.locator('[data-lfh="fehlergrenze"]');
  await expect(grenze.getByText('Diese Seite konnte nicht angezeigt werden')).toBeVisible();
  await expect(
    grenze.getByText('Der Fehler wurde gemeldet. Die anderen Module arbeiten weiter.'),
  ).toBeVisible();
  await expect(grenze.getByRole('button')).toHaveText(['Neu laden', 'Zum Überblick']);

  // Weder die Standardseite des Routers noch Meldung oder Stack des Wurfs.
  const text = await page.locator('body').innerText();
  expect(text).not.toContain('Unexpected Application Error');
  expect(text).not.toContain('is not a function');
  expect(text).not.toMatch(/TypeError|at \w+ \(/);

  // Der Bericht kommt beim Server an: Routenmuster, keine Kennung.
  const antwort = await angenommen;
  expect(antwort.status()).toBe(204);
  expect(antwort.request().postDataJSON()).toMatchObject({
    route: '/einsaetze/:id/erinnerungen',
  });

  // Der Rahmen steht und ist bedienbar: über die Rail in ein anderes Modul.
  await expect(page.locator('[data-lfh="rahmen-kopf"]')).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Kategorien' })
    .getByRole('link', { name: 'Betroffene & Schäden' })
    .click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/personen$`));
  await expect(page.getByRole('heading', { level: 1, name: /Betroffene/ })).toBeVisible();
  await expect(grenze).toHaveCount(0);

  // Genau ein Bericht, auch unter StrictMode im Entwicklungsbündel.
  expect(berichte).toHaveLength(1);
});
