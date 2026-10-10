import { request, type APIRequestContext, type Page } from '@playwright/test';
import { waehleIn } from '../auswahl-kern';
import { anmelden, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';
import { kontoAnlegen } from '../konto-anlegen';

/**
 * Bilder des Kapitels „Zugangsprotokoll“ (`docs/anwender/kapitel/zugangsprotokoll.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep zugangsprotokoll`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   zugangsaenderungen.png  frontend/src/zugangsprotokoll/ZugangsprotokollPage.tsx,
 *                           frontend/src/zugangsprotokoll/zugangsprotokollText.ts
 *   anmeldungen-konto.png   frontend/src/zugangsprotokoll/ZugangsprotokollPage.tsx,
 *                           frontend/src/zugangsprotokoll/zugangsprotokollText.ts
 *   fehlversuche.png        frontend/src/zugangsprotokoll/ZugangsprotokollPage.tsx,
 *                           frontend/src/zugangsprotokoll/zugangsprotokollText.ts
 *
 * Füllung (D3): die Demo-Daten legen keine Benutzer an und ändern keinen Zugang. Die Spec legt
 * „Kim Beispiel“ an und spielt über die API durch, was beide Spuren füllt: Anmeldungen von zwei
 * Geräten, zwei Fehlversuche (falsches Passwort, vertippter Name), eine vom Admin beendete
 * Sitzung, Rollenwechsel, Passwortwechsel, Abmeldung, Deaktivieren und Reaktivieren, dazu ein
 * Schalten des Anmeldewegs „Passwort“ (bleibt an). Nur zwei Fehlversuche: ab zehn sperrt der
 * Server die Quelle, und alle Aufrufe kommen von derselben Adresse.
 */

const KAPITEL = 'zugangsprotokoll';
const PERSON = { anzeigename: 'Kim Beispiel', benutzername: 'k.beispiel' };
const PASSWORT = 'beispiel-passwort-123';
const NEUES_PASSWORT = 'beispiel-passwort-456';

const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

/** Eigener API-Kontext für ein Gerät der Person. Der Aufrufer räumt ihn mit `dispose()`. */
async function geraet(userAgent: string): Promise<APIRequestContext> {
  return request.newContext({ baseURL: test.info().project.use.baseURL, userAgent });
}

async function login(api: APIRequestContext, benutzername: string, passwort: string) {
  return api.post('/api/auth/login', { data: { benutzername, passwort } });
}

/** Spielt die Zugangsgeschichte der Person einmal je Lauf durch. */
async function zugangsgeschichte(page: Page): Promise<void> {
  const liste = await page.request.get('/api/benutzer');
  expect(liste.ok(), `Benutzerliste: ${liste.status()}`).toBe(true);
  const vorhanden = ((await liste.json()) as { benutzername: string }[]).some(
    (b) => b.benutzername === PERSON.benutzername,
  );
  if (vorhanden) return;

  const { id } = await kontoAnlegen(page.request, { ...PERSON, passwort: PASSWORT });

  const ipad = await geraet(IPAD);
  const windows = await geraet(WINDOWS);
  const fremd = await geraet(WINDOWS);
  try {
    for (const api of [ipad, windows]) {
      const antwort = await login(api, PERSON.benutzername, PASSWORT);
      expect(antwort.ok(), `Anmeldung ${PERSON.benutzername}: ${antwort.status()}`).toBe(true);
    }
    // Zwei Fehlversuche: falsches Passwort, vertippter Name ohne Konto.
    expect((await login(fremd, PERSON.benutzername, 'falsch-geraten')).status()).toBe(401);
    expect((await login(fremd, 'k.beispeil', PASSWORT)).status()).toBe(401);

    // Der Admin beendet die Anmeldung am Windows-Rechner.
    const sitzungen = await page.request.get(`/api/benutzer/${id}/sitzungen`);
    expect(sitzungen.ok(), `Sitzungen: ${sitzungen.status()}`).toBe(true);
    const amRechner = ((await sitzungen.json()) as { kennung: string; geraet?: string }[]).find(
      (s) => s.geraet?.includes('Windows'),
    );
    expect(amRechner, 'Sitzung am Windows-Rechner').toBeTruthy();
    await fuelle(page, 'delete', `/api/benutzer/${id}/sitzungen/${amRechner!.kennung}`);

    await fuelle(page, 'patch', `/api/benutzer/${id}`, { org_rolle: 'fuehrungskraft' });

    // Die Person wechselt am iPad ihr Passwort und meldet sich ab.
    const wechsel = await ipad.post('/api/auth/passwort', {
      data: { altes_passwort: PASSWORT, neues_passwort: NEUES_PASSWORT },
    });
    expect(wechsel.ok(), `Passwortwechsel: ${wechsel.status()}`).toBe(true);
    const abmeldung = await ipad.post('/api/auth/logout');
    expect(abmeldung.ok(), `Abmeldung: ${abmeldung.status()}`).toBe(true);

    await fuelle(page, 'post', `/api/benutzer/${id}/deaktivieren`);
    await fuelle(page, 'patch', `/api/benutzer/${id}`, { aktiv: true });
    await fuelle(page, 'put', '/api/auth/providers/passwort', { aktiviert: true });
  } finally {
    for (const api of [ipad, windows, fremd]) await api.dispose();
  }
}

/** Segmentleiste, Filterleiste und Liste der Seite, ohne Seitenkopf. */
function inhalt(page: Page) {
  return page.locator('[data-lfh="zugangsprotokoll-filter"]').locator('xpath=..');
}

test.describe(KAPITEL, () => {
  test('Spur „Zugangsänderungen“', async ({ page }) => {
    await anmelden(page);
    await zugangsgeschichte(page);
    await uhrAnhalten(page);
    await page.goto('/admin/zugangsprotokoll');
    const tabelle = page.locator('.ant-table-wrapper');
    await expect(tabelle.getByText('Konto angelegt')).toBeVisible();
    await expect(tabelle.getByText('Anmeldeweg aktiviert')).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(inhalt(page), KAPITEL, 'zugangsaenderungen');
  });

  test('Spur „Anmeldungen“ für ein Konto', async ({ page }) => {
    await anmelden(page);
    await zugangsgeschichte(page);
    await uhrAnhalten(page);
    await page.goto('/admin/zugangsprotokoll');
    await page.getByRole('radio', { name: 'Anmeldungen' }).click();
    const konto = page.getByRole('combobox', { name: 'Konto' });
    await konto.fill(PERSON.benutzername);
    const tabelle = page.locator('.ant-table-wrapper');
    await expect(tabelle.getByText('Passwort geändert')).toBeVisible();
    await expect(tabelle.getByText('admin', { exact: true })).toHaveCount(0);
    await konto.blur();
    await page.mouse.move(0, 0);
    await fotografiere(inhalt(page), KAPITEL, 'anmeldungen-konto');
  });

  test('Fehlgeschlagene Anmeldungen', async ({ page }) => {
    await anmelden(page);
    await zugangsgeschichte(page);
    await uhrAnhalten(page);
    await page.goto('/admin/zugangsprotokoll');
    await page.getByRole('radio', { name: 'Anmeldungen' }).click();
    await waehleIn(page.getByRole('combobox', { name: 'Ereignis' }), 'Anmeldung fehlgeschlagen');
    const tabelle = page.locator('.ant-table-wrapper');
    await expect(tabelle.getByText('k.beispeil')).toBeVisible();
    await expect(tabelle.getByText('Anmeldung', { exact: true })).toHaveCount(0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.mouse.move(0, 0);
    await fotografiere(inhalt(page), KAPITEL, 'fehlversuche');
  });
});
