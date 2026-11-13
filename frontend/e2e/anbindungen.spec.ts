import { expect, test } from '@playwright/test';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';
import {
  finishRedeem,
  generateKey,
  prepareRedeem,
  signRequest,
} from '../../docs/api/clients/typescript/machineClient';

/**
 * Anbindungen (LLH-1652, Spec `maschinenzugang`): der Admin legt eine Anbindung an und sieht den
 * Code genau einmal; ein Fremdsystem löst ihn mit dem TypeScript-Referenz-Client ein und ruft
 * `GET /api/v1/me` signiert auf; danach zeigt die Zeile Schlüssel und „zuletzt genutzt“. Die
 * Prüfung der Anmeldung im Einzelnen steht in `tests/maschinenzugang.rs`.
 */
test('Anbindung anlegen, Code einlösen, signiert abrufen', async ({ page, request, baseURL }) => {
  await anmeldenAlsAdmin(page);
  await page.goto('/admin/einstellungen/anbindungen');
  await page.getByRole('button', { name: 'Anbindung anlegen' }).click();

  const dialog = page.getByRole('dialog', { name: 'Anbindung anlegen' });
  const name = `Adapter e2e ${Date.now()}`;
  await dialog.getByRole('textbox', { name: 'Name' }).fill(name);
  await dialog.getByRole('checkbox', { name: /Lage lesen/ }).click();
  await dialog.getByRole('button', { name: 'Anlegen und Code zeigen' }).click();

  const codeText = page.locator('[data-lfh="anbindung-code-text"]');
  await expect(codeText).toHaveText(/^([0-9A-Z]{4}-){3}[0-9A-Z]{4}$/);
  const code = (await codeText.textContent())!;
  await page.getByRole('button', { name: 'Fertig' }).click();

  // Nach dem Anlegen steht die Ansicht der neuen Anbindung (Item-Route).
  await expect(page).toHaveURL(/\/admin\/einstellungen\/anbindungen\/[0-9a-f-]{36}$/);
  const titel = page.locator('[data-lfh="anbindung-titel"]');
  await expect(titel).toContainText(name);
  await expect(titel).toContainText('wartet auf Schlüssel');

  // Das Fremdsystem löst ein, mit dem Referenz-Client.
  const schluessel = await generateKey();
  const { derivation, request: einloesen } = await prepareRedeem(code, schluessel.publicKey);
  const antwort = await request.post('/api/v1/zugang/redeem', { data: einloesen });
  expect(antwort.status()).toBe(200);
  const cred = await finishRedeem(derivation, schluessel, baseURL!, await antwort.json());

  const pfad = '/api/v1/me';
  const auth = await signRequest(
    cred,
    'GET',
    pfad,
    new TextEncoder().encode(''),
    Math.floor(Date.now() / 1000),
    `e2e-${Date.now()}`,
  );
  const me = await request.get(pfad, { headers: { authorization: auth } });
  expect(me.status()).toBe(200);
  expect((await me.json()).name).toBe(name);
  expect(me.headers()['lifeline-signature']).toBeTruthy();

  await page.reload();
  await expect(titel).toContainText('aktiv');
  await expect(page.locator('[data-lfh="anbindung-fingerabdruck"]')).toHaveText(
    /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/,
  );
  await expect(page.locator('[data-lfh="anbindung-rechte"]')).toHaveText('Lage lesen lage:read');

  // Name in der Ansicht ändern; die Liste zeigt ihn mit „zuletzt genutzt“.
  await page.getByRole('button', { name: 'Zugang bearbeiten' }).click();
  const feld = page.getByRole('textbox', { name: 'Name' });
  await feld.fill(`${name} neu`);
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(titel).toContainText(`${name} neu`);
  await page.getByRole('link', { name: 'Anbindungen' }).click();
  const zeile = page.locator('[data-lfh="anbindung-eintrag"]', { hasText: `${name} neu` });
  await expect(zeile).toContainText('zuletzt genutzt');
});

/**
 * Einwurf-Zugang (LLH-1654, Spec `einwurf-zugang`): der Admin legt einen Zugang an und sieht die
 * Adresse mit Schlüssel genau einmal; ein Absender ruft sie auf wie BOSWatch (GET mit Abfrage);
 * die Zeile zeigt „zuletzt genutzt“; nach dem Widerruf lehnt der Server den Schlüssel ab. Die
 * Prüfungen im Einzelnen stehen in `tests/einwurf.rs`.
 */
test('Einwurf-Zugang anlegen, einwerfen, widerrufen', async ({ page, request }) => {
  await anmeldenAlsAdmin(page);
  await page.goto('/admin/einstellungen/anbindungen');
  const paneel = page.locator('[data-lfh="einwurf-zugaenge"]');
  // Der Test-Server läuft ohne TLS mit `--einwurf-allow-http`: die Seite sagt es.
  await expect(paneel.locator('[data-lfh="einwurf-transport"]')).toContainText(
    'Einwürfe ohne TLS erlaubt',
  );

  await paneel.getByRole('button', { name: 'Einwurf-Zugang anlegen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Einwurf-Zugang anlegen' });
  const name = `BOSWatch e2e ${Date.now()}`;
  await dialog.getByRole('textbox', { name: 'Name' }).fill(name);
  await dialog.getByRole('button', { name: 'Anlegen und Adresse zeigen' }).click();

  const adresseText = page.locator('[data-lfh="einwurf-adresse-text"]');
  await expect(adresseText).toHaveText(
    /\/api\/v1\/einwurf\/llh_ew_[A-Za-z0-9_-]{43}\/alarmmeldung$/,
  );
  const pfad = new URL((await adresseText.textContent())!).pathname;
  await page.getByRole('button', { name: 'Fertig' }).click();
  await expect(adresseText).toHaveCount(0);

  // Der Absender wirft ein; die Antwort trägt keine Daten.
  const einwurf = await request.get(`${pfad}?ric=1234567&text=B2%20Wohnung`);
  expect(einwurf.status()).toBe(204);
  expect(await einwurf.text()).toBe('');
  expect(einwurf.headers()['cache-control']).toBe('no-store');

  await page.reload();
  const zeile = page.locator('[data-lfh="einwurf-eintrag"]', { hasText: name });
  await expect(zeile).toContainText('zuletzt genutzt');
  await expect(zeile).not.toContainText('llh_ew_');

  // Widerruf nach Rückfrage; danach gilt der Schlüssel nicht mehr.
  await zeile.getByRole('button', { name: `Aktionen zu Einwurf-Zugang ${name}` }).click();
  await page.getByRole('menuitem', { name: /Widerrufen/ }).click();
  await page
    .getByRole('dialog', { name: `${name} widerrufen?` })
    .getByRole('button', { name: 'Widerrufen' })
    .click();
  await expect(zeile).toContainText('widerrufen');
  const danach = await request.get(`${pfad}?text=nach-dem-widerruf`);
  expect(danach.status()).toBe(401);
  expect((await danach.json()).code).toBe('unauthorized');
});

test('Anbindungen: eine Führungskraft liest nur, der Grund steht da', async ({ page }) => {
  await anmeldenAlsAdmin(page);
  await wechsleZuRolle(page, 'fuehrungskraft');
  await page.goto('/admin/einstellungen/anbindungen');
  await expect(page.getByText(/nur System-Admin/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Anbindung anlegen' })).toHaveCount(0);
});
