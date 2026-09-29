import { expect, test, type Page } from '@playwright/test';

/**
 * „n neue Nachrichten"-Pille statt bedingungslosem Sprung. jsdom rechnet `scrollTop`,
 * `clientHeight` und `scrollHeight` als 0 und hält die Komponente immer für „am Boden".
 *
 * Gemessen wird `scrollTop` als ZAHL, nicht per `toBeVisible`: die neue Nachricht ist auch im
 * kaputten Zustand sichtbar. „‚Ältere laden' löst keinen Sprung aus" prüft
 * `src/chat/NachrichtenStrom.test.tsx` — das braucht kein Layout.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

// Handschirm-Maße: der Strom läuft schon nach einem Dutzend Nachrichten über.
const SCHMAL = { width: 390, height: 844 };

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

/** Liefert die id des Standardkanals „Allgemein". */
async function kanalId(page: Page, einsatzId: string): Promise<number> {
  const res = await page.request.get(`/api/einsaetze/${einsatzId}/chat/kanaele`);
  return (await res.json())[0].id;
}

/**
 * Speist eine Nachricht von AUSSEN ein — der Live-Fall, den die Pille bedient. Eine eigene
 * Absendung holt die Sicht absichtlich ans Ende zurück; der POST läuft am Frontend vorbei und
 * die Nachricht trifft über den Live-Strom ein.
 */
async function vonAussenSenden(page: Page, einsatzId: string, kanal: number, text: string) {
  const res = await page.request.post(
    `/api/einsaetze/${einsatzId}/chat/kanaele/${kanal}/nachrichten`,
    { data: { inhalt: text } },
  );
  expect(res.status()).toBe(201);
}

/** Füllt den Strom so weit, dass er über seinen Container hinauswächst. */
async function stromFuellen(page: Page, anzahl: number) {
  const eingabe = page.getByPlaceholder('Nachricht…');
  for (let i = 1; i <= anzahl; i += 1) {
    await eingabe.fill(
      `Probe ${i} — Deichabschnitt Nord meldet Lage unverändert, Kräfte im Einsatz.`,
    );
    await page.getByRole('button', { name: 'Senden' }).click();
    await expect(page.getByText(`Probe ${i} —`, { exact: false })).toBeVisible();
  }
}

test('Chat: oben im Verlauf bleibt die Sicht stehen und die Pille zählt', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Pille ${Date.now()}`);
  await page.setViewportSize(SCHMAL);
  await page.goto(`/einsaetze/${einsatzId}/chat`);
  await expect(page.getByPlaceholder('Nachricht…')).toBeVisible();

  await stromFuellen(page, 12);
  const strom = page.getByTestId('nachrichten-strom');
  // Ohne Überlauf gäbe es kein „oben im Verlauf", und die Pille dürfte zu Recht nie erscheinen.
  expect(await strom.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(100);

  // Nach oben blättern. Die Eingabe liegt AUSSERHALB des Scroll-Containers.
  await strom.evaluate((el) => el.scrollTo({ top: 0 }));
  await expect.poll(() => strom.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(page.getByRole('button', { name: /neue Nachricht/ })).toHaveCount(0);

  const kanal = await kanalId(page, einsatzId);
  await vonAussenSenden(page, einsatzId, kanal, 'Neu 1 — Lage hat sich geändert.');

  await expect(page.getByRole('button', { name: '1 neue Nachricht' })).toBeVisible();
  // Der Kern: die Sicht ist NICHT mitgesprungen.
  expect(await strom.evaluate((el) => el.scrollTop)).toBe(0);

  await vonAussenSenden(page, einsatzId, kanal, 'Neu 2 — zweite Meldung.');
  await expect(page.getByRole('button', { name: '2 neue Nachrichten' })).toBeVisible();
  expect(await strom.evaluate((el) => el.scrollTop)).toBe(0);

  // Klick springt ans Ende und räumt den Zähler.
  await page.getByRole('button', { name: '2 neue Nachrichten' }).click();
  await expect(page.getByRole('button', { name: /neue Nachricht/ })).toHaveCount(0);
  await expect
    .poll(() => strom.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
    .toBeLessThanOrEqual(24);
});

test('Chat: unten am Strom springt die Sicht weiter mit — ohne Pille', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Mitspringen ${Date.now()}`);
  await page.setViewportSize(SCHMAL);
  await page.goto(`/einsaetze/${einsatzId}/chat`);
  await expect(page.getByPlaceholder('Nachricht…')).toBeVisible();

  await stromFuellen(page, 12);
  const strom = page.getByTestId('nachrichten-strom');
  expect(await strom.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(100);

  const kanal = await kanalId(page, einsatzId);
  await vonAussenSenden(page, einsatzId, kanal, 'Neu am Boden — Lage unverändert.');
  await expect(page.getByText('Neu am Boden')).toBeVisible();

  await expect(page.getByRole('button', { name: /neue Nachricht/ })).toHaveCount(0);
  await expect
    .poll(() => strom.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
    .toBeLessThanOrEqual(24);
});

test('Chat: der Kanalwechsel räumt Merker und Zähler', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Kanalwechsel ${Date.now()}`);
  await page.setViewportSize(SCHMAL);
  await page.goto(`/einsaetze/${einsatzId}/chat`);
  await expect(page.getByPlaceholder('Nachricht…')).toBeVisible();

  // Zweiter Kanal per API — der Anlege-Weg der Oberfläche ist nicht die Aussage.
  await page.request.post(`/api/einsaetze/${einsatzId}/chat/kanaele`, {
    data: { name: 'Zweiter' },
  });
  await page.reload();
  const leiste = page.getByTestId('kanal-leiste');
  await expect(leiste.getByText('Zweiter')).toBeVisible();

  // „Allgemein" ZUERST füllen, damit der zweite Kanal die HÖHEREN ids trägt — sonst zählte eine
  // mitgeschleppte Marke dort null Treffer, und der Test wäre auch ohne Remount-Schlüssel grün.
  await stromFuellen(page, 12);

  await leiste.getByText('Zweiter').click();
  await expect(page.getByText('Probe 1 —', { exact: false })).toHaveCount(0);
  await stromFuellen(page, 12);

  await leiste.getByText('Allgemein').click();
  await expect(page.getByText('Probe 12 —', { exact: false }).first()).toBeVisible();

  const strom = page.getByTestId('nachrichten-strom');
  await strom.evaluate((el) => el.scrollTo({ top: 0 }));
  await expect.poll(() => strom.evaluate((el) => el.scrollTop)).toBe(0);

  // Der Merker gehört zu EINEM Kanal (`key={kanalId}` an `<NachrichtenStrom>`): nach dem
  // Wechsel steht die Sicht unten, und es gibt keine Pille.
  await leiste.getByText('Zweiter').click();
  // Erst auf die Nachrichten des zweiten Kanals warten — direkt nach dem Klick ist die Liste
  // leer und die Aussage in beiden Welten grün.
  await expect(page.getByText('Probe 12 —', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /neue Nachricht/ })).toHaveCount(0);
  await expect
    .poll(() =>
      page
        .getByTestId('nachrichten-strom')
        .evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
    )
    .toBeLessThanOrEqual(24);
});

test('Chat: die eigene Absendung holt die Sicht ans Ende zurück', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Eigene Sendung ${Date.now()}`);
  await page.setViewportSize(SCHMAL);
  await page.goto(`/einsaetze/${einsatzId}/chat`);
  await expect(page.getByPlaceholder('Nachricht…')).toBeVisible();

  await stromFuellen(page, 12);
  const strom = page.getByTestId('nachrichten-strom');

  // Erst hochblättern und die Pille wirklich erzeugen.
  await strom.evaluate((el) => el.scrollTo({ top: 0 }));
  await expect.poll(() => strom.evaluate((el) => el.scrollTop)).toBe(0);
  const kanal = await kanalId(page, einsatzId);
  await vonAussenSenden(page, einsatzId, kanal, 'Fremd — Lage hat sich geändert.');
  await expect(page.getByRole('button', { name: '1 neue Nachricht' })).toBeVisible();

  // Wer selbst absendet, will seinen Satz sehen.
  await page.getByPlaceholder('Nachricht…').fill('Eigene — Kräfte rücken ab.');
  await page.getByRole('button', { name: 'Senden' }).click();
  await expect(page.getByText('Eigene — Kräfte rücken ab.')).toBeVisible();

  await expect(page.getByRole('button', { name: /neue Nachricht/ })).toHaveCount(0);
  await expect
    .poll(() => strom.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
    .toBeLessThanOrEqual(24);
});
