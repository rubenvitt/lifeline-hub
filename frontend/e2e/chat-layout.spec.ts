import { expect, test, type Page } from '@playwright/test';
import { wechsleZuRolle } from './rollen-kern';

/**
 * Chat-Layout und Auftragsseite auf dem Handschirm: bleibt das Eingabefeld sichtbar, wenn der
 * Nachrichtenstrom lang wird? Das hängt an einer Höhenkette über mehrere Flex-Ebenen.
 *
 * `toBeInViewport()` statt `toBeVisible()`: ein Element unterhalb des sichtbaren Bereichs ist
 * im Sinne von `toBeVisible` sichtbar — genau der Fehlerzustand.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

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

/** Waagerechter Überstand des Dokuments. `<= 0` heißt: kein Querscrollen. */
async function ueberstand(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

test('Chat: die Eingabe bleibt bei langem Strom sichtbar — auch nach dem Absenden', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Chat ${Date.now()}`);

  await page.setViewportSize(SCHMAL);
  await page.goto(`/einsaetze/${einsatzId}/chat`);

  const eingabe = page.getByPlaceholder('Nachricht…');
  await expect(eingabe).toBeVisible();

  // Genug Nachrichten, dass der Strom höher wird als der Schirm. Über die Oberfläche gesendet:
  // geprüft wird das Layout NACH dem Absenden.
  for (let i = 1; i <= 12; i += 1) {
    await eingabe.fill(
      `Probe ${i} — Deichabschnitt Nord meldet Lage unverändert, Kräfte im Einsatz.`,
    );
    await page.getByRole('button', { name: 'Senden' }).click();
    await expect(page.getByText(`Probe ${i} —`, { exact: false })).toBeVisible();
  }

  // Nach dem letzten Absenden steht die Eingabe weiterhin im sichtbaren Bereich.
  await expect(eingabe).toBeInViewport();
  expect(await ueberstand(page)).toBeLessThanOrEqual(0);
});

/**
 * LFH-435 · Zweig: Beobachter (kein Schreibrecht). Statt der Eingabe steht ein Hinweis
 * (`ChatPage.tsx`, `!darfSchreiben`) am Fuß derselben Höhenkette. Geprüft wird wie oben: der
 * Fuß bleibt bei langem Strom im sichtbaren Bereich, das Dokument läuft nicht quer.
 *
 * Der Strom wird als Admin über die API gefüllt — der Beobachter kann nicht senden. Die
 * Vorbedingung „der Strom läuft über" ist tragend: ohne sie stünde die Höhenkette nicht unter
 * Last, und `toBeInViewport()` bewiese nichts.
 */
test('Chat: der Hinweis ersetzt die Eingabe und bleibt bei langem Strom sichtbar (Beobachter)', async ({
  page,
}) => {
  // Zusätzliche Anmeldung und zwölf Seeding-Aufrufe gegenüber dem Admin-Geschwister.
  test.slow();
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Chat lesend ${Date.now()}`);

  // Standardkanal „Allgemein" — derselbe, den die Seite beim Öffnen wählt.
  const kanaele = await page.request.get(`/api/einsaetze/${einsatzId}/chat/kanaele`);
  expect(kanaele.ok(), `Kanäle: ${kanaele.status()}`).toBe(true);
  const kanalId = ((await kanaele.json()) as { id: number }[])[0].id;
  for (let i = 1; i <= 12; i += 1) {
    const antwort = await page.request.post(
      `/api/einsaetze/${einsatzId}/chat/kanaele/${kanalId}/nachrichten`,
      {
        data: {
          inhalt: `Probe ${i} — Deichabschnitt Nord meldet Lage unverändert, Kräfte im Einsatz.`,
        },
      },
    );
    expect(antwort.status(), `Seeding Nachricht ${i}: ${await antwort.text()}`).toBe(201);
  }
  await wechsleZuRolle(page, 'beobachter', einsatzId);

  await page.setViewportSize(SCHMAL);
  await page.goto(`/einsaetze/${einsatzId}/chat`);
  await expect(page.getByText('Probe 12 —', { exact: false })).toBeVisible();

  // ── VORBEDINGUNGEN: der Nur-Lese-Zweig steht, und der Strom läuft über.
  const hinweis = page
    .getByRole('alert')
    .filter({ hasText: 'Schreiben ist der Einsatzleitung und dem Führungspersonal vorbehalten.' });
  await expect(hinweis, 'Vorbedingung: der Hinweis steht statt der Eingabe').toHaveCount(1);
  await expect(
    page.getByPlaceholder('Nachricht…'),
    'Vorbedingung: ohne Schreibrecht keine Eingabe',
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Senden' }),
    'Vorbedingung: ohne Schreibrecht kein „Senden"',
  ).toHaveCount(0);
  await expect
    .poll(
      () =>
        page.getByTestId('nachrichten-strom').evaluate((el) => el.scrollHeight - el.clientHeight),
      { message: 'Vorbedingung: der Strom ist höher als sein Behälter' },
    )
    .toBeGreaterThan(0);

  // ── MESSUNG: der Fuß der Höhenkette bleibt sichtbar, kein Querlauf.
  await expect(hinweis).toBeInViewport();
  expect(await ueberstand(page)).toBeLessThanOrEqual(0);
});

test('Chat: unter md trägt eine Segmentleiste die Kanäle, nicht die Seitenspalte', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Chat Kanäle ${Date.now()}`);

  await page.setViewportSize(SCHMAL);
  await page.goto(`/einsaetze/${einsatzId}/chat`);
  await expect(page.getByPlaceholder('Nachricht…')).toBeVisible();

  // Die Kanalliste wird unter `md` durch die Leiste ERSETZT, nicht bloß ausgeblendet — sonst
  // stünden beide Navigationen im Baum.
  await expect(page.getByTestId('kanal-leiste')).toBeVisible();
  await expect(page.getByTestId('kanal-spalte')).toHaveCount(0);

  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(page.getByTestId('kanal-spalte')).toBeVisible();
  await expect(page.getByTestId('kanal-leiste')).toHaveCount(0);
});

/**
 * Viele Kanäle mit langen Namen, als Admin über die API gesät: die Leiste muss sie tragen, ohne
 * dass das Dokument quer läuft (LFH-976).
 */
async function vieleKanaeleSaeen(page: Page, einsatzId: string) {
  // Erst die Liste abrufen: der Server legt „Allgemein" beim ersten Abruf an, danach sind es
  // fest neun Kanäle.
  const liste = await page.request.get(`/api/einsaetze/${einsatzId}/chat/kanaele`);
  expect(liste.ok(), `Kanäle: ${liste.status()}`).toBe(true);
  for (let i = 1; i <= 8; i += 1) {
    const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/chat/kanaele`, {
      data: { name: `Einsatzabschnitt Nord ${i} Deichverteidigung` },
    });
    expect(antwort.status(), `Seeding Kanal ${i}: ${await antwort.text()}`).toBe(201);
  }
}

/**
 * LFH-976 · Zweig: Führungspersonal (schreibt, leitet nicht). Unter `md` ersetzt die Leiste die
 * Kanalliste samt Kopfaktion; der Knopf neben ihr öffnet dieselbe Anlage. Vorbedingung vor der
 * Messung: der Knopf steht für diese Rolle. Gemessen wird nach der Anlage — der neue Kanal steht
 * als Segment da, wählbar, und das Dokument läuft auch mit vielen Kanälen nicht quer.
 */
test('Chat: unter md legt das Führungspersonal einen Kanal über die Leiste an', async ({
  page,
}) => {
  test.slow();
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Chat Kanal anlegen ${Date.now()}`);
  await vieleKanaeleSaeen(page, einsatzId);
  await wechsleZuRolle(page, 'fuehrungspersonal', einsatzId);

  await page.setViewportSize(SCHMAL);
  await page.goto(`/einsaetze/${einsatzId}/chat`);
  await expect(page.getByPlaceholder('Nachricht…')).toBeVisible();

  // ── VORBEDINGUNG: der Rollenzweig steht — Leiste statt Spalte, Anlage für diese Rolle da.
  const leiste = page.getByTestId('kanal-leiste');
  await expect(leiste).toBeVisible();
  await expect(page.getByTestId('kanal-spalte')).toHaveCount(0);
  const anlegen = leiste.getByRole('button', { name: 'Kanal anlegen' });
  await expect(anlegen, 'Vorbedingung: Führungspersonal sieht die Anlage').toHaveCount(1);
  expect(await ueberstand(page)).toBeLessThanOrEqual(0);

  // Geklickt, nicht bloß sichtbar geprüft (LFH-355).
  await anlegen.click();
  const dialog = page.getByRole('dialog', { name: 'Neuer Kanal' });
  await dialog.getByLabel('Name').fill('Verpflegung');
  await dialog.getByLabel('Name').press('Enter');
  await expect(dialog).toBeHidden();

  // ── MESSUNG: ohne Neuladen als Segment da und wählbar; kein Querlauf.
  const segment = leiste.getByRole('tab', { name: 'Verpflegung' });
  await segment.click();
  await expect(segment).toHaveAttribute('aria-selected', 'true');
  await expect(anlegen).toBeInViewport();
  expect(await ueberstand(page)).toBeLessThanOrEqual(0);
});

/** LFH-976 · Zweig: Beobachter. Ohne Schreibrecht fehlt die Anlage, wie in der Kanalliste ab `md`. */
test('Chat: unter md fehlt dem Beobachter die Kanalanlage, die Leiste läuft nicht quer', async ({
  page,
}) => {
  test.slow();
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Chat Kanal lesend ${Date.now()}`);
  await vieleKanaeleSaeen(page, einsatzId);
  await wechsleZuRolle(page, 'beobachter', einsatzId);

  await page.setViewportSize(SCHMAL);
  await page.goto(`/einsaetze/${einsatzId}/chat`);

  // ── VORBEDINGUNG: Nur-Lese-Zweig steht, die Leiste trägt die gesäten Kanäle.
  const leiste = page.getByTestId('kanal-leiste');
  await expect(leiste.getByRole('tab')).toHaveCount(9);
  await expect(
    page.getByRole('alert').filter({
      hasText: 'Schreiben ist der Einsatzleitung und dem Führungspersonal vorbehalten.',
    }),
  ).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Kanal anlegen' })).toHaveCount(0);

  // ── MESSUNG
  expect(await ueberstand(page)).toBeLessThanOrEqual(0);
});

test('Aufträge: auf 390 px scrollt der Body nicht waagerecht', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Auftraege ${Date.now()}`);

  await page.setViewportSize(SCHMAL);
  await page.goto(`/einsaetze/${einsatzId}/auftraege`);
  // Reiterkopf (h3, Versalien per CSS); `level` trennt ihn vom h1-Seitentitel, ohne `exact`,
  // damit die Schreibweise egal ist.
  await expect(page.getByRole('heading', { level: 3, name: 'Aufträge' })).toBeVisible();
  expect(await ueberstand(page)).toBeLessThanOrEqual(0);

  // Das Erfassungsformular aufgeklappt gemessen — die Fläche, die es im Betrieb gibt.
  await page.getByRole('button', { name: /Auftrag erteilen/ }).click();
  await expect(page.getByLabel('Auftrag / Was')).toBeVisible();
  expect(await ueberstand(page)).toBeLessThanOrEqual(0);

  await page.getByText(/Befehlsschema/).click();
  await expect(page.getByLabel('Ort / Wo')).toBeVisible();
  expect(await ueberstand(page)).toBeLessThanOrEqual(0);
});
