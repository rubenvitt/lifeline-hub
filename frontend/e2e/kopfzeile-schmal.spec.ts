import { expect, test, type Page } from '@playwright/test';

/**
 * Die Kopfzeile auf dem Handschirm (LFH-329 · B1/M12).
 *
 * WARUM HIER UND NICHT IN VITEST: `vite.config.ts` fährt Vitest mit `css: false`,
 * und jsdom rechnet kein Layout. Die eine Frage, die dieses Paket wirklich
 * beantworten muss — schlägt das Inline-`paddingInline` antds Klassenregel
 * (`padding: 0 46.875px` bei der kompakten Steuerhöhe), auch logisch gegen
 * physisch? — ist ausschließlich im Browser messbar. Die Quelltext-Verdrahtung
 * bewacht `src/theme/kopfpolsterung.guard.test.ts`.
 *
 * Bewusst KEIN zweites Playwright-Projekt und kein Device-Descriptor: ein
 * `devices['iPhone …']` zöge webkit nach, und ein Browser-Download ist im Repo
 * nirgends abgesichert. Der Viewport wird im bestehenden chromium-Projekt
 * umgestellt.
 *
 * NICHT geprüft: `document.body.scrollWidth <= window.innerWidth` über das ganze
 * Dokument. Der Überlauf auf 390 px hat auf einer Modulseite mehrere Quellen
 * (Tabellen, Karten) — dieses Paket kann nur seinen eigenen Beitrag belegen und
 * misst deshalb punktgenau das `header`-Element. Wer das zur dokumentweiten
 * Form „repariert", macht die Spec zur Sammelstelle fremder Befunde.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

const SCHMAL = { width: 390, height: 844 };
const BREIT = { width: 1366, height: 768 };

// Login-/Anlege-Helfer aus `kernfluss.spec.ts` kopiert — es gibt (noch) kein
// geteiltes e2e-Hilfsmodul.
async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzAnlegen(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  return page.url().match(/\/einsaetze\/(\d+)/)![1];
}

test('Kopf-Polsterung: 24 px am Fükw-Schirm, 12 px auf 390 px', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Kopf ${Date.now()}`);

  // BEIDE Layouts: `/einsaetze` hängt an der Ebene-1-Shell, die Modulseite am
  // Einsatz-Workspace. Es sind Geschwister — wer nur eines umstellt, lässt den
  // Handschirm auf der halben App auf dem antd-Maß stehen.
  for (const route of ['/einsaetze', `/einsaetze/${einsatzId}/etb`]) {
    await page.setViewportSize(BREIT);
    await page.goto(route);
    const kopf = page.locator('header');
    // Beweist, dass der Selektor genau eine Kopfzeile trifft — sonst wäre eine
    // grüne Zusicherung grün durch Nichtstun.
    await expect(kopf, route).toHaveCount(1);
    await expect(kopf, route).toHaveCSS('padding-left', '24px');
    await expect(kopf, route).toHaveCSS('padding-right', '24px');

    await page.setViewportSize(SCHMAL);
    await expect(kopf, route).toHaveCSS('padding-left', '12px');
    await expect(kopf, route).toHaveCSS('padding-right', '12px');
  }
});

test('Kopfzeile: auf 390 px läuft sie nicht über', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(
    page,
    // Absichtlich lang: genau daran zeigt sich, ob der Name kürzt oder schiebt.
    `E2E Hochwasser Nord — Deichverteidigung Abschnitt West ${Date.now()}`,
  );

  await page.setViewportSize(SCHMAL);
  for (const route of ['/einsaetze', `/einsaetze/${einsatzId}/etb`]) {
    await page.goto(route);
    const kopf = page.locator('header');
    await expect(kopf, route).toBeVisible();
    const masse = await kopf.evaluate((el) => ({
      scroll: el.scrollWidth,
      klient: el.clientWidth,
    }));
    expect(masse.scroll, `${route}: Kopfzeile läuft über`).toBeLessThanOrEqual(masse.klient);
  }
});

test('Such-Trigger bleibt auf 390 px in beiden Kopfzeilen eine 48-px-Trefffläche', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Suche ${Date.now()}`);

  await page.setViewportSize(SCHMAL);
  for (const route of ['/einsaetze', `/einsaetze/${einsatzId}/etb`]) {
    await page.goto(route);
    const trigger = page.getByRole('button', { name: 'Suchen' });
    await expect(trigger, route).toBeVisible();
    const kasten = (await trigger.boundingBox())!;
    expect(Math.min(kasten.width, kasten.height), `${route}: Such-Trefffläche`).toBeGreaterThanOrEqual(48);
  }
});

test('Bediendichte bleibt auf 390 px bedienbar — über das Benutzermenü', async ({ page }) => {
  // DIE EIGENTLICHE ZUSICHERUNG DIESES PAKETS. Die Kopfzeile legt ihre
  // Umschalter unter lg ab; A1 weist dem Führungs-Tablet und dem mobilen
  // Kontext aber gerade `komfortabel` und `handschuh` zu. Die Kommandopalette
  // trägt beide Achsen zwar, hat heute aber keinen sichtbaren Auslöser (nur
  // Cmd/Ctrl+K — auf einem Touchgerät kein Bedienweg). Bliebe also nichts.
  await anmelden(page);
  await page.setViewportSize(SCHMAL);
  await page.goto('/einsaetze');

  await expect(page.getByLabel('Farbschema wählen')).toHaveCount(0);
  await expect(page.getByLabel('Bediendichte wählen')).toHaveCount(0);

  const trigger = page.getByRole('button', { name: 'Benutzermenü' });
  const kasten = (await trigger.boundingBox())!;
  // A1 Gate 3: fokussierbare Elemente ≥ 24 px in der kurzen Achse.
  expect(Math.min(kasten.width, kasten.height), 'Trefffläche des Triggers').toBeGreaterThanOrEqual(
    24,
  );

  await trigger.click();
  await page.getByRole('menuitem', { name: /Handschuh/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-dichte', 'handschuh');

  await trigger.click();
  await page.getByRole('menuitem', { name: /Dunkel/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('ab lg stehen die Umschalter wieder in der Kopfzeile', async ({ page }) => {
  // Gegenprobe. Ohne sie belegte der Test oben nur, dass irgendetwas fehlt —
  // nicht, dass die BREITE es entfernt.
  await anmelden(page);
  await page.setViewportSize(BREIT);
  await page.goto('/einsaetze');

  await expect(page.getByLabel('Farbschema wählen')).toBeVisible();
  await expect(page.getByLabel('Bediendichte wählen')).toBeVisible();
});
