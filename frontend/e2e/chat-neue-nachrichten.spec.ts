import { expect, test, type Page } from '@playwright/test';

/**
 * „n neue Nachrichten"-Pille statt bedingungslosem Sprung (LFH-466, Nachzug LFH-343 · C8).
 *
 * WARUM HIER UND NICHT IN VITEST: die Entscheidung hängt an drei Werten, die jsdom
 * nicht rechnet — `scrollTop`, `clientHeight`, `scrollHeight` sind dort konstant 0,
 * womit `0 + 0 >= 0 - TOLERANZ` immer wahr ist und die Komponente sich in jedem
 * Vitest-Lauf für „am Boden" hält. Die Vitest-Fassung stellt die drei Werte deshalb
 * per `defineProperty`; die Aussage über das echte Layout kann nur der Browser
 * führen.
 *
 * Gemessen wird `scrollTop` als ZAHL, nicht per `toBeVisible`: die neue Nachricht ist
 * auch im kaputten Zustand sichtbar (der Strom ist dann eben mitgesprungen) — dieselbe
 * Falle, die `chat-layout.spec.ts` mit `toBeInViewport` umgeht.
 *
 * NICHT hier, sondern in `src/chat/NachrichtenStrom.test.tsx`: die Gegenaussage
 * „‚Ältere laden' löst keinen Sprung aus". Sie hängt allein daran, dass die jüngste id
 * beim Anbau vorne gleich bleibt — das ist ohne Layout prüfbar, und im Browser kostete
 * sie 101 Nachrichten (`CHAT_SEITENGROESSE`), bevor der Knopf überhaupt erscheint.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

// Handschirm-Maße wie in `chat-layout.spec.ts`: damit läuft der Strom schon nach
// einem Dutzend Nachrichten sicher über seinen Container, ohne dass der Test
// hundert Nachrichten tippen muss.
const SCHMAL = { width: 390, height: 844 };

// Login-/Anlege-Helfer aus `chat-layout.spec.ts` kopiert — es gibt (noch) kein
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

/** Füllt den Strom so weit, dass er über seinen Container hinauswächst. */
async function stromFuellen(page: Page, anzahl: number) {
  const eingabe = page.getByPlaceholder('Nachricht…');
  for (let i = 1; i <= anzahl; i += 1) {
    await eingabe.fill(`Probe ${i} — Deichabschnitt Nord meldet Lage unverändert, Kräfte im Einsatz.`);
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
  // Ohne Überlauf wäre jede folgende Aussage bedeutungslos: dann gäbe es kein
  // „oben im Verlauf", und die Pille dürfte zu Recht nie erscheinen.
  expect(await strom.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(100);

  // Nach oben blättern. Die Eingabe liegt AUSSERHALB des Scroll-Containers — das
  // Absenden bewegt die Sicht also nicht von selbst zurück.
  await strom.evaluate((el) => el.scrollTo({ top: 0 }));
  await expect.poll(() => strom.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(page.getByRole('button', { name: /neue Nachricht/ })).toHaveCount(0);

  await page.getByPlaceholder('Nachricht…').fill('Neu 1 — Lage hat sich geändert.');
  await page.getByRole('button', { name: 'Senden' }).click();

  const pille = page.getByRole('button', { name: '1 neue Nachricht' });
  await expect(pille).toBeVisible();
  // Der Kern: die Sicht ist NICHT mitgesprungen.
  expect(await strom.evaluate((el) => el.scrollTop)).toBe(0);

  await page.getByPlaceholder('Nachricht…').fill('Neu 2 — zweite Meldung.');
  await page.getByRole('button', { name: 'Senden' }).click();
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

  await page.getByPlaceholder('Nachricht…').fill('Neu am Boden — Lage unverändert.');
  await page.getByRole('button', { name: 'Senden' }).click();
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

  // Zweiter Kanal per API — der Anlege-Weg der Oberfläche gehört zu KanalListe und
  // ist hier nicht die Aussage.
  await page.request.post(`/api/einsaetze/${einsatzId}/chat/kanaele`, { data: { name: 'Zweiter' } });
  await page.reload();
  const leiste = page.getByTestId('kanal-leiste');
  await expect(leiste.getByText('Zweiter')).toBeVisible();

  // Reihenfolge ist tragend: „Allgemein" ZUERST füllen, damit die Nachrichten des
  // zweiten Kanals die HÖHEREN ids tragen. Sonst zählte eine mitgeschleppte Marke
  // aus „Allgemein" im zweiten Kanal null Treffer, und die Aussage wäre auch ohne
  // den Remount-Schlüssel grün.
  await stromFuellen(page, 12);

  await leiste.getByText('Zweiter').click();
  await expect(page.getByText('Probe 1 —', { exact: false })).toHaveCount(0);
  await stromFuellen(page, 12);

  await leiste.getByText('Allgemein').click();
  await expect(page.getByText('Probe 12 —', { exact: false }).first()).toBeVisible();

  const strom = page.getByTestId('nachrichten-strom');
  await strom.evaluate((el) => el.scrollTo({ top: 0 }));
  await expect.poll(() => strom.evaluate((el) => el.scrollTop)).toBe(0);

  // Der Merker gehört zu EINEM Kanal: nach dem Wechsel steht die Sicht unten und es
  // gibt keine Pille — ohne `key={kanalId}` an `<NachrichtenStrom>` (`ChatPage`)
  // nähme der zweite Kanal Merker und Marke des ersten mit.
  await leiste.getByText('Zweiter').click();
  await expect(page.getByRole('button', { name: /neue Nachricht/ })).toHaveCount(0);
  await expect
    .poll(() => page.getByTestId('nachrichten-strom')
      .evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
    .toBeLessThanOrEqual(24);
});
