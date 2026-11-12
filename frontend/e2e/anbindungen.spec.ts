import { expect, test } from '@playwright/test';
import { einsatzPerApi } from './einsatz-kern';
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
 * Lage für einen Lagemonitor (LLH-1638, Specs `maschinenzugang` und `lage-schnittstelle`): der
 * Ablauf über Verwaltung, Einsatz und Fremdsystem. Ohne Freigabe liest die Anbindung nichts; die
 * Einsatzleitung schaltet sie auf der Seite „Geräte“ ein, danach liefert `GET /api/v1/lage` den
 * Einsatz, und die Verwaltung nennt ihn. Rechte, Umstellen, Ende und Spiegel prüfen
 * `tests/einsatz_anbindungen.rs` und `tests/public_api_lage.rs`.
 */
test('Lagemonitor anbinden, Einsatz freigeben, Lage lesen', async ({ page, request, baseURL }) => {
  await anmeldenAlsAdmin(page, { startseite: false });
  const stempel = Date.now();
  const einsatzName = `Stadtfest e2e ${stempel}`;
  const einsatzId = await einsatzPerApi(page, einsatzName);

  await page.goto('/admin/einstellungen/anbindungen');
  await page.getByRole('button', { name: 'Anbindung anlegen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Anbindung anlegen' });
  const name = `FüKW Monitor e2e ${stempel}`;
  await dialog.getByRole('textbox', { name: 'Name' }).fill(name);
  await dialog.getByRole('checkbox', { name: /Lage lesen/ }).click();
  await dialog.getByRole('button', { name: 'Anlegen und Code zeigen' }).click();
  const code = (await page.locator('[data-lfh="anbindung-code-text"]').textContent())!;
  await page.getByRole('button', { name: 'Fertig' }).click();
  await expect(page.locator('[data-lfh="anbindung-einsatz"]')).toHaveText(
    'kein Einsatz freigegeben',
  );

  const schluessel = await generateKey();
  const { derivation, request: einloesen } = await prepareRedeem(code, schluessel.publicKey);
  const antwort = await request.post('/api/v1/zugang/redeem', { data: einloesen });
  expect(antwort.status()).toBe(200);
  const cred = await finishRedeem(derivation, schluessel, baseURL!, await antwort.json());
  const lage = async () => {
    const pfad = '/api/v1/lage?karte=none';
    const auth = await signRequest(
      cred,
      'GET',
      pfad,
      new TextEncoder().encode(''),
      Math.floor(Date.now() / 1000),
      `e2e-lage-${Date.now()}-${Math.random()}`,
    );
    const r = await request.get(pfad, { headers: { authorization: auth } });
    expect(r.status()).toBe(200);
    return (await r.json()) as { einsatz: { id: number; bezeichnung: string } | null };
  };
  expect((await lage()).einsatz).toBeNull();

  // Die Einsatzleitung gibt ihren Einsatz frei.
  await page.goto(`/einsaetze/${einsatzId}/einstellungen/geraete`);
  const schalter = page.getByRole('switch', { name: `Anbindung ${name} liest diesen Einsatz` });
  await expect(schalter).not.toBeChecked();
  await schalter.click();
  await expect(schalter).toBeChecked();
  const zeile = page.locator('[data-lfh="einsatz-anbindung"]', { hasText: name });
  await expect(zeile.locator('[data-lfh="einsatz-anbindung-zustand"]')).toContainText(
    'liest diesen Einsatz',
  );
  const gelesen = (await lage()).einsatz;
  expect(gelesen?.id).toBe(Number(einsatzId));
  expect(gelesen?.bezeichnung).toBe(einsatzName);

  // Die Verwaltung nennt den gelesenen Einsatz.
  await page.goto('/admin/einstellungen/anbindungen');
  const eintrag = page.locator('[data-lfh="anbindung-eintrag"]', { hasText: name });
  await expect(eintrag.locator('[data-lfh="anbindung-einsatz"]')).toHaveText(
    `liest ${einsatzName}`,
  );

  // Freigabe beenden: das Fremdsystem liest nichts mehr.
  await page.goto(`/einsaetze/${einsatzId}/einstellungen/geraete`);
  await schalter.click();
  await expect(schalter).not.toBeChecked();
  expect((await lage()).einsatz).toBeNull();
});

test('Anbindungen: eine Führungskraft liest nur, der Grund steht da', async ({ page }) => {
  await anmeldenAlsAdmin(page);
  await wechsleZuRolle(page, 'fuehrungskraft');
  await page.goto('/admin/einstellungen/anbindungen');
  await expect(page.getByText(/nur System-Admin/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Anbindung anlegen' })).toHaveCount(0);
});
