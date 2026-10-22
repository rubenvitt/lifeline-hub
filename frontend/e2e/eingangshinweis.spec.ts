import { expect, request, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, benutzerAnlegen, mitgliedEintragen } from './rollen-kern';

/**
 * Eingangshinweis für neue Meldungen (Spec `benachrichtigungen`, „Eingang einer Meldung“,
 * „Eingangshinweis“, „Sichten räumt den Hinweis bei allen“, „Unbearbeitete Meldungen im
 * Tab-Titel“).
 *
 * GESÄT: ein zweites Konto (Führungspersonal) erfasst in seinem eigenen Kontext eine Lagemeldung
 * ohne Empfängerfunktion, während der Admin den Einsatz in zwei Tabs offen hat. Eigene Aktionen
 * melden nichts, ein zweiter Schirm ist deshalb Pflicht. Beide Tabs warten auf den Live-Strom,
 * BEVOR gemeldet wird (Muster `sofortmeldung-hinweis.spec.ts`).
 *
 * GEPRÜFT: beide Tabs zeigen den Eingangshinweis mit Absender und Wortlautanfang, der Tab-Titel
 * trägt die Zahl; „Sichten“ im ersten Tab räumt den Hinweis auch im zweiten.
 *
 * Mutationsprobe: `status_geaendert` aus der Route `status` entfernt → rot im zweiten Tab, der
 * Hinweis bleibt dort stehen.
 */

const ABSENDER = 'Abschnitt Deich Ost';
const WORTLAUT = 'Pegel am Deichtor 2,40 m, steigend; Sandsackverbau an der Nordseite läuft.';
const HINWEIS = '.ant-notification-notice:not(.ant-notification-fade-leave)';

async function oeffnenMitStrom(page: Page, pfad: string, einsatzId: number) {
  const strom = page.waitForResponse(
    (r) => r.url().endsWith(`/api/einsaetze/${einsatzId}/live`) && r.status() === 200,
  );
  await page.goto(pfad);
  await strom;
}

test('Lagemeldung von einem zweiten Schirm: Eingangshinweis in zwei Tabs, „Sichten“ räumt beide', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await anmeldenAlsAdmin(page);
  const angelegt = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Eingang ${Date.now()}` },
  });
  expect(angelegt.ok(), `POST /api/einsaetze: ${angelegt.status()}`).toBe(true);
  const einsatzId = ((await angelegt.json()) as { id: number }).id;

  const konto = await benutzerAnlegen(page, 'fuehrungspersonal', 'E2E Zweiter Schirm');
  await mitgliedEintragen(page, String(einsatzId), konto.id, 'fuehrungspersonal');

  const pfad = `/einsaetze/${einsatzId}/erinnerungen`;
  await oeffnenMitStrom(page, pfad, einsatzId);
  const zweiterTab = await page.context().newPage();
  await zweiterTab.setViewportSize({ width: 1366, height: 900 });
  await oeffnenMitStrom(zweiterTab, pfad, einsatzId);

  const zweiter = await request.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const login = await zweiter.post('/api/auth/login', {
      data: { benutzername: konto.benutzername, passwort: konto.passwort },
    });
    expect(login.ok(), `Anmelden zweiter Schirm: ${login.status()}`).toBe(true);
    const lage = await zweiter.post(`/api/einsaetze/${einsatzId}/meldungen`, {
      data: {
        absender: ABSENDER,
        meldeweg: 'funk',
        inhalt: WORTLAUT,
        meldungsart: 'lagemeldung',
        ereigniszeit: '2026-10-01 09:30:00',
      },
    });
    expect(lage.ok(), `Lagemeldung: ${lage.status()} ${await lage.text()}`).toBe(true);
  } finally {
    await zweiter.dispose();
  }

  const hinweis = page.locator(HINWEIS).filter({ hasText: ABSENDER });
  const hinweisZwei = zweiterTab.locator(HINWEIS).filter({ hasText: ABSENDER });
  await expect(hinweis).toBeVisible({ timeout: 20_000 });
  await expect(hinweisZwei).toBeVisible({ timeout: 20_000 });
  await expect(hinweis.getByText(WORTLAUT.slice(0, 20), { exact: false })).toBeVisible();
  await expect(page).toHaveTitle(/^\(1\) /);

  await hinweis.getByRole('button', { name: `Sichten: ${ABSENDER}`, exact: true }).click();

  await expect(hinweis).toHaveCount(0);
  await expect(hinweisZwei).toHaveCount(0, { timeout: 20_000 });
});
