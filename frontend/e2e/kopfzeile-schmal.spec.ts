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
async function anmeldenAls(page: Page, benutzer: string, passwort: string) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(benutzer);
  await page.getByLabel('Passwort').fill(passwort);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function anmelden(page: Page) {
  await anmeldenAls(page, ADMIN, PW);
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

/**
 * DERSELBE Nachweis für den GESPERRTEN Zweig der Topbar (LFH-337 · Fix-Welle, Befund B1).
 *
 * Der Test darüber meldet sich als Admin an; `darfVerwaltung(admin)` ist `true`, er läuft
 * also ausschließlich durch den freien `<Link>`-Zweig von `GlobalLink`
 * (`src/components/AppLayout.tsx`). Der gesperrte Zweig — gedämpfter Text plus
 * „Keine Berechtigung"-Tag — war nie gemessen, und genau er ist der breitere: er kann
 * weder kürzen (`flexShrink: 0`) noch umbrechen (antds `Tag` setzt `white-space: nowrap`).
 * Ein Guard, der nur den privilegiertesten Benutzer prüft, ist strukturell blind.
 *
 * NUR `/einsaetze`, KEINE Einsatzroute: `GlobalLink` wohnt in der Ebene-1-Schale
 * (`App.tsx:132-133`), der Einsatz-Workspace hat eine eigene Kopfzeile ohne diesen
 * Eintrag. Damit entfällt zugleich die Mitgliedschaftsfrage an einem vom Admin
 * angelegten Einsatz.
 *
 * Die VORBEDINGUNGEN sind tragend: ohne sie bliebe der Test auch dann grün, wenn
 * jemand den gesperrten Zweig ganz entfernte — dann liefe die Breitenmessung gegen
 * eine Kopfzeile ohne den Block, den sie messen soll.
 */
test('Kopfzeile: auf 390 px läuft sie auch für einen Benutzer OHNE Verwaltungsrecht nicht über', async ({
  page,
}) => {
  const LAUF = Date.now();
  const NUTZER = `e2e-kopf-ohne-${LAUF}`;
  const NUTZER_PW = 'e2e-kopf-ohne-pw-123';

  // Anlegen braucht den Admin. Ohne `system_rolle`/`org_rolle` im Body fällt das
  // Backend auf 'keiner'/'keine' zurück (`src/routes/benutzer.rs:99-103`) —
  // `darfVerwaltung` ist damit false. Präzedenz: `fokus-verdeckung.spec.ts:197-209`.
  await anmelden(page);
  const angelegt = await page.request.post('/api/benutzer', {
    data: { anzeigename: `E2E Ohne Recht ${LAUF}`, benutzername: NUTZER, passwort: NUTZER_PW },
  });
  expect(
    angelegt.ok(),
    `Seeding Benutzer: ${angelegt.status()} ${await angelegt.text()}`,
  ).toBeTruthy();

  // Sitzung wechseln. Der Cookie-Jar ist zwischen `page` und `page.request` geteilt,
  // ein Abmelden über die API genügt deshalb.
  const abgemeldet = await page.request.post('/api/auth/logout');
  expect(abgemeldet.ok(), `Abmelden: ${abgemeldet.status()}`).toBeTruthy();
  await anmeldenAls(page, NUTZER, NUTZER_PW);

  await page.setViewportSize(SCHMAL);
  await page.goto('/einsaetze');

  const kopf = page.locator('header');
  await expect(kopf).toHaveCount(1);
  // ── VORBEDINGUNGEN: der gesperrte Zweig muss überhaupt stehen.
  await expect(
    page.getByRole('link', { name: 'Verwaltung' }),
    'Vorbedingung: kein freier Verwaltungs-Link — sonst misst der Test den falschen Zweig',
  ).toHaveCount(0);
  await expect(
    kopf.getByText('Verwaltung', { exact: true }),
    'Vorbedingung: der gedämpfte Eintrag bleibt auf JEDER Breite stehen (gesperrt statt versteckt)',
  ).toBeVisible();
  // Der Tag selbst entfällt unter `lg` — das ist die Änderung, die den Überlauf behebt.
  await expect(
    kopf.getByText('Keine Berechtigung'),
    'unter lg trägt die Kopfzeile den Tag nicht',
  ).toHaveCount(0);

  const masse = await kopf.evaluate((el) => ({ scroll: el.scrollWidth, klient: el.clientWidth }));
  expect(masse.scroll, 'Kopfzeile läuft über (gesperrter Zweig)').toBeLessThanOrEqual(masse.klient);
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
