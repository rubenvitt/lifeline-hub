import { expect, test, type Page } from '@playwright/test';
import { kontrast, pruefe } from './kontrast-kern';

async function vorbereiten(page: Page, modus: 'light' | 'dark') {
  await page.addInitScript((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(`Kontrast ${modus} ${Date.now()}`);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
  return `/einsaetze/${page.url().match(/\/einsaetze\/(\d+)/)![1]}`;
}

async function post(page: Page, pfad: string, data: unknown) {
  const response = await page.request.post(`/api${pfad}`, { data });
  expect(response.ok(), `${pfad}: ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.json();
}

for (const modus of ['light', 'dark'] as const) {
  const minimum = modus === 'light' ? 7 : 5;
  test(`${modus}: sechs SK-Auswahlflächen auf Route und im Modal`, async ({ page }) => {
    test.setTimeout(90_000);
    const basis = await vorbereiten(page, modus);
    for (const ort of ['route', 'modal']) {
      await page.goto(`${basis}/personen${ort === 'route' ? '/aufnahme' : ''}`);
      if (ort === 'modal') await page.getByRole('button', { name: 'Schnellerfassung' }).click();
      const gruppe = page.locator('#sichtung');
      await expect(gruppe.locator('.ant-tag')).toHaveText([
        'SK I',
        'SK II',
        'SK III',
        'SK IV',
        'tot',
        'unverletzt',
      ]);
      for (const label of ['SK I', 'SK II', 'SK III', 'SK IV', 'tot', 'unverletzt']) {
        const tag = gruppe.locator('.ant-tag').filter({ hasText: new RegExp(`^${label}$`) });
        await page.mouse.move(0, 0);
        await pruefe(tag, minimum, `${modus}/${ort}/${label}/ungewählt`);
        await tag.hover();
        await pruefe(tag, minimum, `${modus}/${ort}/${label}/hover`);
        await tag.click();
        await expect(gruppe.getByRole('radio', { checked: true })).toHaveCount(1);
        await expect(gruppe.getByRole('radio', { name: label, exact: true })).toBeChecked();
        await pruefe(tag, minimum, `${modus}/${ort}/${label}/gewählt+hover`);
        await page.mouse.move(0, 0);
        await pruefe(tag, minimum, `${modus}/${ort}/${label}/gewählt`);
      }
    }
  });

  test(`${modus}: alle Personen- und Schadensstatus in Liste und Detail`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const basis = await vorbereiten(page, modus);
    const personen = [];
    for (const [status, label] of [
      ['erfasst', 'erfasst'],
      ['vermisst', 'vermisst'],
      ['betroffen', 'betroffen'],
      ['verstorben', 'verstorben'],
      ['abgemeldet', 'abgemeldet'],
    ]) {
      const p = await post(page, `${basis}/personen`, { antreff_ort: `Kontrast ${status}` });
      if (status !== 'erfasst') await post(page, `${basis}/personen/${p.id}/status`, { status });
      personen.push({ id: p.id, label });
    }
    const schaeden = [];
    for (const label of ['offen', 'übergeben', 'abgeschlossen']) {
      const s = await post(page, `${basis}/schaeden`, {
        typ: 'sachschaden',
        ausmass: 'gering',
        ort: `Kontrast ${label}`,
      });
      if (label === 'übergeben')
        await post(page, `${basis}/schaeden/${s.id}/uebergeben`, { uebergeben_an: 'Teststelle' });
      if (label === 'abgeschlossen')
        await post(page, `${basis}/schaeden/${s.id}/abschliessen`, { abschluss_grund: 'behoben' });
      schaeden.push({ id: s.id, label });
    }
    for (const [modul, saetze] of [
      ['personen', personen],
      ['schaeden', schaeden],
    ] as const) {
      await page.goto(`${basis}/${modul}`);
      // Schäden filtern seit dem Neuentwurf über eine Segmentleiste (`radio`), Personen ggf.
      // noch über Reiter — der Griff nimmt beide Rollen.
      await page
        .getByRole('tab', { name: 'Alle', exact: true })
        .or(page.getByRole('radio', { name: 'Alle', exact: true }))
        .click();
      await expect(page.locator('.ant-table-row')).toHaveCount(saetze.length);
      for (const { id, label } of saetze) {
        const tag = page
          .locator(`.ant-table-row[data-row-key="${id}"] .ant-tag`)
          .filter({ hasText: new RegExp(`^${label}(?: \\(Teststelle\\))?$`) });
        await expect(tag).toHaveCount(1);
        await pruefe(tag, minimum, `${modus}/${modul}/${label}/Liste`);
      }
      for (const { id, label } of saetze) {
        await page.goto(`${basis}/${modul}/${id}`);
        const tag = page.locator('.ant-tag').filter({ hasText: new RegExp(`^${label}$`) });
        await expect(tag).toHaveCount(1);
        await pruefe(tag, minimum, `${modus}/${modul}/${label}/Detail`);
      }
    }
  });
}

test('Kontrastmessung komponiert Alpha und erkennt unlesbare Schrift', async ({ page }) => {
  await page.setContent(
    '<body style="background:rgb(0,0,0)"><div style="background:rgba(255,255,255,0.5)"><span style="color:rgba(255,255,255,0.5)">Probe</span></div></body>',
  );
  const tag = page.getByText('Probe');
  const messung = await kontrast(tag);
  expect(messung.grund).toEqual([127.5, 127.5, 127.5, 1]);
  expect(messung.text).toEqual([191.25, 191.25, 191.25, 1]);
  expect(messung.verhaeltnis).toBeLessThan(3);
  await tag.evaluate((e) => {
    e.style.color = 'rgb(127,127,127)';
  });
  expect((await kontrast(tag)).verhaeltnis).toBeLessThan(1.01);
});
