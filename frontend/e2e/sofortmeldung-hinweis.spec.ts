import { expect, request, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, benutzerAnlegen, mitgliedEintragen } from './rollen-kern';

/**
 * Der Sofortalarm nennt die Meldung und springt zu ihr (LLH-1052, Spec `benachrichtigungen`,
 * „Der Sofortalarm nennt die Meldung und springt zu ihr“, „Bestätigen sichtet die
 * Sofortmeldung“).
 *
 * GESÄT: ein zweites Konto (Führungspersonal im Einsatz) erfasst in seinem eigenen Kontext eine
 * Sofortmeldung, während der Admin den Einsatz offen hat. Eigene Aktionen alarmieren nicht, ein
 * zweiter Schirm ist deshalb Pflicht. Der Admin wartet auf den Live-Strom, BEVOR gemeldet wird
 * (Muster `einsatzkopf-live.spec.ts`).
 *
 * GEPRÜFT: der Alarm nennt Absender und Wortlaut; „Öffnen“ landet auf `?meldung=<id>`, die Karte
 * ist hervorgehoben und steht im Bild. „Bestätigen“ setzt sie auf „Gesichtet“.
 *
 * Mutationsproben: Inhalt in `useBenachrichtigungen.ts` nicht übergeben → rot am Titel
 * „Sofortmeldung · …“; `status`-Zeile in `bestaetige_tx` entfernt → rot an „Gesichtet“.
 */

const ABSENDER = 'Rettungsstaffel Süd';
const WORTLAUT =
  'Kellerabgang Mühlbachweg 34: eine schwer verletzte Person geborgen, Transport in die UHS Turnhalle.';
const ALARM = '.ant-notification-notice:not(.ant-notification-fade-leave)';

async function oeffnenMitStrom(page: Page, pfad: string, einsatzId: number) {
  const strom = page.waitForResponse(
    (r) => r.url().endsWith(`/api/einsaetze/${einsatzId}/live`) && r.status() === 200,
  );
  await page.goto(pfad);
  await strom;
}

test('Sofortmeldung von einem zweiten Schirm: Alarm mit Inhalt, „Öffnen“ zeigt die Karte', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await anmeldenAlsAdmin(page);
  const angelegt = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Sofortmeldung ${Date.now()}` },
  });
  expect(angelegt.ok(), `POST /api/einsaetze: ${angelegt.status()}`).toBe(true);
  const einsatzId = ((await angelegt.json()) as { id: number }).id;
  // Ein paar gewöhnliche Meldungen davor: die Karte muss gesucht und ins Bild gerollt werden.
  for (let i = 1; i <= 8; i += 1) {
    const m = await page.request.post(`/api/einsaetze/${einsatzId}/meldungen`, {
      data: {
        absender: `Florian ${i}`,
        meldeweg: 'funk',
        inhalt: `Lage unverändert ${i}`,
        ereigniszeit: '2026-10-01 09:00:00',
      },
    });
    expect(m.ok(), `Meldung ${i}: ${m.status()}`).toBe(true);
  }

  const konto = await benutzerAnlegen(page, 'fuehrungspersonal', 'E2E Zweiter Schirm');
  await mitgliedEintragen(page, String(einsatzId), konto.id, 'fuehrungspersonal');

  await oeffnenMitStrom(page, `/einsaetze/${einsatzId}/erinnerungen`, einsatzId);

  // Der zweite Schirm: eigene Sitzung, eigenes Konto.
  const zweiter = await request.newContext({ baseURL: test.info().project.use.baseURL });
  let meldungId: number;
  try {
    const login = await zweiter.post('/api/auth/login', {
      data: { benutzername: konto.benutzername, passwort: konto.passwort },
    });
    expect(login.ok(), `Anmelden zweiter Schirm: ${login.status()}`).toBe(true);
    const sofort = await zweiter.post(`/api/einsaetze/${einsatzId}/meldungen`, {
      data: {
        absender: ABSENDER,
        meldeweg: 'funk',
        inhalt: WORTLAUT,
        meldungsart: 'sofortmeldung',
        prioritaet: 'sofort',
        ereigniszeit: '2026-10-01 09:30:00',
      },
    });
    expect(sofort.ok(), `Sofortmeldung: ${sofort.status()} ${await sofort.text()}`).toBe(true);
    meldungId = ((await sofort.json()) as { id: number }).id;
  } finally {
    await zweiter.dispose();
  }

  const alarm = page.locator(ALARM).filter({ hasText: `Sofortmeldung · ${ABSENDER}` });
  await expect(alarm).toBeVisible({ timeout: 20_000 });
  await expect(alarm.getByText(WORTLAUT)).toBeVisible();
  await alarm.getByRole('button', { name: 'Öffnen', exact: true }).click();

  await expect(page).toHaveURL(
    new RegExp(`/einsaetze/${einsatzId}/meldungen\\?meldung=${meldungId}$`),
  );
  const karte = page.locator(`[data-meldung-id="${meldungId}"]`);
  await expect(karte).toHaveAttribute('data-hervorgehoben', 'true');
  await expect(karte).toBeInViewport();
  // „Öffnen“ quittiert den Alarm.
  await expect(alarm).toHaveCount(0);

  // Bestätigen sichtet: die Karte steht danach auf „Gesichtet“, „Sichten“ entfällt.
  await karte.getByRole('button', { name: 'Bestätigen', exact: true }).click();
  await page
    .locator('.ant-popover:not(.ant-popover-hidden)')
    .getByRole('button', { name: 'Bestätigen', exact: true })
    .click();
  await expect(karte.getByText('Gesichtet', { exact: true })).toBeVisible();
  await expect(karte.getByRole('button', { name: 'Sichten', exact: true })).toHaveCount(0);
});
