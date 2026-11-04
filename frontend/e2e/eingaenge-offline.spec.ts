import { expect, request, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, benutzerAnlegen, mitgliedEintragen } from './rollen-kern';

/**
 * Eingänge ohne Netz (LLH-1422, Spec `benachrichtigungen`, „Verlauf ohne Netz“).
 *
 * GESÄT: ein zweites Konto (Führungspersonal) erfasst zwei Lagemeldungen ohne Empfängerfunktion,
 * während der Admin den Einsatz offen hat (Muster `eingangshinweis.spec.ts`).
 *
 * GEPRÜFT: ohne Netz zeigt „Eingänge“ den geladenen Verlauf mit „Stand … · offline“; „Alle
 * gelesen“ steht als „Offline vorgemerkt“, die Zahl ist sofort weg, der Server kennt die
 * Markierung noch nicht. Nach der Rückkehr geht genau ein „gelesen“ hinaus, der Server zählt
 * keine ungelesenen mehr, und „Offline vorgemerkt“ verschwindet.
 *
 * Das Neuladen ohne Netz (Verlauf aus der Platte) belegt der Wächter
 * `api/lagebildOffline.guard.test.ts`; ein Prod-Bundle-Fall bräuchte ein Backend, das den Bundle
 * dieses Stands ausliefert.
 *
 * Mutationsprobe: das Paneel sendet „Alle gelesen“ wie vor LLH-1422 direkt → rot, „Offline
 * vorgemerkt“ erscheint nicht.
 *
 * Zweiter Fall (LLH-1477): ein einzelner Eintrag ohne Netz geöffnet: die Zahl sinkt sofort, der
 * Server kennt die Quittung noch nicht; nach der Rückkehr geht genau ein Quittieren hinaus.
 * Mutationsprobe: der Eintrag quittiert wie vor LLH-1477 direkt → rot, die Zahl bleibt bei 2.
 */

const WORTLAUT = 'Pegel am Deichtor 2,40 m, steigend; Sandsackverbau an der Nordseite läuft.';

async function oeffnenMitStrom(page: Page, pfad: string, einsatzId: number) {
  const strom = page.waitForResponse(
    (r) => r.url().endsWith(`/api/einsaetze/${einsatzId}/live`) && r.status() === 200,
  );
  await page.goto(pfad);
  await strom;
}

async function ungeleseneAmServer(page: Page, einsatzId: number): Promise<number> {
  const r = await page.request.get(`/api/einsaetze/${einsatzId}/benachrichtigungen`);
  expect(r.ok(), `GET Verlauf: ${r.status()}`).toBe(true);
  return ((await r.json()) as { ungelesen: number }).ungelesen;
}

/** Einsatz mit zwei ungelesenen Lagemeldungen eines zweiten Kontos, `seite` mit Netz geöffnet. */
async function zweiEingaenge(page: Page, seite: string): Promise<number> {
  await page.setViewportSize({ width: 1366, height: 900 });
  await anmeldenAlsAdmin(page);
  const angelegt = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Eingänge offline ${Date.now()}` },
  });
  expect(angelegt.ok(), `POST /api/einsaetze: ${angelegt.status()}`).toBe(true);
  const einsatzId = ((await angelegt.json()) as { id: number }).id;

  const konto = await benutzerAnlegen(page, 'fuehrungspersonal', 'E2E Zweiter Schirm');
  await mitgliedEintragen(page, String(einsatzId), konto.id, 'fuehrungspersonal');
  await oeffnenMitStrom(page, `/einsaetze/${einsatzId}/${seite}`, einsatzId);

  const zweiter = await request.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const login = await zweiter.post('/api/auth/login', {
      data: { benutzername: konto.benutzername, passwort: konto.passwort },
    });
    expect(login.ok(), `Anmelden zweiter Schirm: ${login.status()}`).toBe(true);
    for (const n of [1, 2]) {
      const r = await zweiter.post(`/api/einsaetze/${einsatzId}/meldungen`, {
        data: {
          absender: `Abschnitt Deich Ost ${n}`,
          meldeweg: 'funk',
          inhalt: WORTLAUT,
          meldungsart: 'lagemeldung',
          ereigniszeit: '2026-10-01 09:30:00',
        },
      });
      expect(r.ok(), `Lagemeldung ${n}: ${r.status()} ${await r.text()}`).toBe(true);
    }
  } finally {
    await zweiter.dispose();
  }

  return einsatzId;
}

test('„Alle gelesen“ ohne Netz wird vorgemerkt und nach der Rückkehr gesendet (LLH-1422)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const einsatzId = await zweiEingaenge(page, 'erinnerungen');

  // Vorbedingung: der Verlauf ist mit Netz geladen.
  const knopf = page.getByRole('button', { name: 'Eingänge, 2 ungelesen' });
  await expect(knopf).toBeVisible({ timeout: 20_000 });

  await page.context().setOffline(true);
  try {
    await knopf.click();
    const verlauf = page.getByRole('region', { name: 'Eingänge' });
    await expect(verlauf.getByRole('list', { name: 'Neu' }).getByRole('listitem')).toHaveCount(2);
    await expect(verlauf.getByText(/^Stand \d{4} · offline$/)).toBeVisible();

    await verlauf.getByRole('button', { name: 'Alle gelesen' }).click();
    await expect(verlauf.getByText('Offline vorgemerkt')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Eingänge, keine ungelesen' })).toBeVisible();
    expect(await ungeleseneAmServer(page, einsatzId)).toBe(2);

    const gelesen = page.waitForResponse((r) =>
      r.url().endsWith(`/api/einsaetze/${einsatzId}/benachrichtigungen/gelesen`),
    );
    await page.context().setOffline(false);
    expect((await gelesen).status()).toBe(204);
    await expect(verlauf.getByText('Offline vorgemerkt')).toHaveCount(0);
    await expect(verlauf.getByText(/^Stand /)).toHaveCount(0);
    expect(await ungeleseneAmServer(page, einsatzId)).toBe(0);
    await expect(page.getByRole('button', { name: 'Eingänge, keine ungelesen' })).toBeVisible();
  } finally {
    await page.context().setOffline(false);
  }
});

test('ein einzelner Eintrag ohne Netz gilt sofort als gelesen und wird danach quittiert (LLH-1477)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  // Die Meldungen sind schon geladen: der Sprung braucht ohne Netz kein neues Modul.
  const einsatzId = await zweiEingaenge(page, 'meldungen');
  const knopf = page.getByRole('button', { name: 'Eingänge, 2 ungelesen' });
  await expect(knopf).toBeVisible({ timeout: 20_000 });

  await page.context().setOffline(true);
  try {
    await knopf.click();
    const verlauf = page.getByRole('region', { name: 'Eingänge' });
    const neu = verlauf.getByRole('list', { name: 'Neu' }).getByRole('link');
    await expect(neu).toHaveCount(2);
    await neu.first().click();
    await expect(page.getByRole('button', { name: 'Eingänge, 1 ungelesen' })).toBeVisible();
    expect(await ungeleseneAmServer(page, einsatzId)).toBe(2);

    const quittiert = page.waitForResponse(
      (r) =>
        /\/api\/benachrichtigungen\/\d+\/quittieren$/.test(r.url()) &&
        r.request().method() === 'POST',
    );
    await page.context().setOffline(false);
    expect((await quittiert).status()).toBe(204);
    await expect.poll(() => ungeleseneAmServer(page, einsatzId)).toBe(1);
    await expect(page.getByRole('button', { name: 'Eingänge, 1 ungelesen' })).toBeVisible();
  } finally {
    await page.context().setOffline(false);
  }
});
