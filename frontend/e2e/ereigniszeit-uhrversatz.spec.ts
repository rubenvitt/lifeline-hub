import { expect, test, type Page } from '@playwright/test';

/**
 * LFH-895: Ein ETB-Eintrag und eine Meldung von einem Gerät, dessen Uhr 5 min vorgeht, tragen
 * ohne Handeingabe die Ereigniszeit nach der Serveruhr. Vorher kam „jetzt“ aus der Geräteuhr:
 * Der Eintrag stand 5 min zu spät, die Zeitachse markierte ihn als nachgetragen, und die
 * Bestätigungsfrist einer Meldung verschob sich mit
 * (`openspec/changes/lfh-895-ereigniszeit-serveruhr/design.md`).
 *
 * Der Test braucht den echten Server: Der Versatz kommt aus dem `Date`-Header seiner Antworten.
 */

const VORLAUF_MS = 5 * 60_000;
const TOLERANZ_MS = 60_000;

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/** UTC-SQLite-String 'YYYY-MM-DD HH:MM:SS' → Millisekunden seit Epoch. */
function alsMillis(zeit: string): number {
  return Date.parse(`${zeit.replace(' ', 'T')}Z`);
}

test.beforeEach(async ({ page }) => {
  // Die Geräteuhr geht 5 min vor und läuft von da an normal weiter. Vor der ersten Navigation
  // installiert, damit jede Zeitnahme der Seite sie sieht.
  await page.clock.install({ time: new Date(Date.now() + VORLAUF_MS) });
  await anmelden(page);
  // Vorbedingung: Die Geräteuhr geht wirklich vor.
  const geraetVorlauf = (await page.evaluate(() => Date.now())) - Date.now();
  expect(geraetVorlauf).toBeGreaterThan(VORLAUF_MS - 30_000);
});

async function neuerEinsatz(page: Page, name: string): Promise<number> {
  const r = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E ${name} ${Date.now()}` },
  });
  expect(r.ok(), `POST /api/einsaetze: ${r.status()} ${await r.text()}`).toBeTruthy();
  return ((await r.json()) as { id: number }).id;
}

test('ETB-Eintrag eines vorgehenden Geräts trägt die Serverzeit und ist nicht nachgetragen', async ({
  page,
}) => {
  const einsatzId = await neuerEinsatz(page, 'ETB-Uhrversatz');
  // Die Seite lädt online und misst dabei die Serveruhr an den echten Antworten.
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  const inhalt = `Pumpe läuft ${Date.now()}`;
  const feld = page.getByPlaceholder('Inhalt …');
  await feld.fill(inhalt);
  const erfasstMs = Date.now();
  await feld.press('Enter');
  await expect(feld).toHaveValue('');

  const r = await page.request.get(`/api/einsaetze/${einsatzId}/etb`);
  const eintraege = (await r.json()) as {
    inhalt: string;
    ereigniszeit: string;
    received_at: string;
  }[];
  const eintrag = eintraege.find((e) => e.inhalt === inhalt);
  expect(eintrag, 'Eintrag gespeichert').toBeTruthy();
  expect(Math.abs(alsMillis(eintrag!.ereigniszeit) - erfasstMs)).toBeLessThan(TOLERANZ_MS);
  expect(Math.abs(alsMillis(eintrag!.ereigniszeit) - alsMillis(eintrag!.received_at))).toBeLessThan(
    TOLERANZ_MS,
  );

  // In der Zeitachse steht der Eintrag ohne „nachgetragen“.
  const zeile = page.getByTestId('etb-ereigniszeile').filter({ hasText: inhalt });
  await expect(zeile).toBeVisible();
  await expect(zeile).not.toContainText('nachgetragen');
});

test('Meldung eines vorgehenden Geräts trägt die Serverzeit, die Frist läuft ab ihr', async ({
  page,
}) => {
  const einsatzId = await neuerEinsatz(page, 'Meldung-Uhrversatz');
  await page.goto(`/einsaetze/${einsatzId}/meldungen`);
  await page.getByRole('button', { name: 'Meldung erfassen' }).click();
  const formular = page.getByRole('region', { name: 'Neue Meldung erfassen' });
  await expect(formular).toBeVisible();
  const inhalt = `MANV ${Date.now()}`;
  await formular.getByLabel('Absender').fill('RTW 2');
  await formular.getByLabel('Inhalt / Wortlaut').fill(inhalt);
  await formular.getByRole('switch', { name: 'Bestätigung erforderlich' }).click();
  const erfasstMs = Date.now();
  await formular.getByRole('button', { name: 'Meldung erfassen' }).click();

  await expect
    .poll(
      async () => {
        const r = await page.request.get(`/api/einsaetze/${einsatzId}/meldungen`);
        const liste = (await r.json()) as { inhalt: string }[];
        return liste.some((m) => m.inhalt === inhalt);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  const r = await page.request.get(`/api/einsaetze/${einsatzId}/meldungen`);
  const meldung = (
    (await r.json()) as {
      inhalt: string;
      ereigniszeit: string;
      faellig_at: string | null;
    }[]
  ).find((m) => m.inhalt === inhalt)!;
  expect(Math.abs(alsMillis(meldung.ereigniszeit) - erfasstMs)).toBeLessThan(TOLERANZ_MS);
  // Die Frist (Vorgabe 5 min) läuft ab der Ereigniszeit nach der Serveruhr.
  expect(meldung.faellig_at).not.toBeNull();
  expect(Math.abs(alsMillis(meldung.faellig_at!) - (erfasstMs + 5 * 60_000))).toBeLessThan(
    TOLERANZ_MS,
  );
});
