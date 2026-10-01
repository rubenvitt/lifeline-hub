import { expect, test, type Page } from '@playwright/test';

/**
 * Führungsorganisation als Organigramm (LFH-626): die Nachweise, die NUR im Browser gehen. jsdom
 * rechnet kein Layout, wertet `@media print` nicht aus und kennt keine Contentbreite.
 *
 * - MESSUNG (Aufgabe 2.1, „vor dem Bau messen“): Contentbreite der Seite Einsatzabschnitte am Fükw
 *   mit offenem Panel und die Laufweiten langer Werte. Die Werte stehen in design.md D3
 *   (Nachtrag); hier bleiben sie als Annotation stehen.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const FUEKW = { width: 1366, height: 768 };

/** Absichtlich lange, aber reale Werte. */
const ABSCHNITT = 'Deichverteidigung Nordwest II';
const KURZ = 'EA-NORD-2';
const EINHEIT = 'Fachgruppe Wasserschaden Musterstadt-Nordwest';
const EINHEIT_RUF = 'Florian Musterstadt 1/10';
const FUEHRER = 'Kirchgassner-Wohlfahrt, Maximiliane';
const STAERKE = '12/34/156//202';

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

async function post(page: Page, einsatzId: string, pfad: string, data: unknown): Promise<number> {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/${pfad}`, { data });
  expect(antwort.ok(), `Seeding ${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return ((await antwort.json()) as { id: number }).id;
}

test('Messung vor dem Bau: Contentbreite am Fükw und Laufweiten langer Werte', async ({ page }) => {
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Organigramm Messung ${Date.now()}`);
  const abschnitt = await post(page, einsatzId, 'abschnitte', {
    name: ABSCHNITT,
    kurzbezeichnung: KURZ,
  });
  await post(page, einsatzId, 'einheiten', {
    name: EINHEIT,
    funkrufname: EINHEIT_RUF,
    abschnitt_id: abschnitt,
  });
  await page.goto(`/einsaetze/${einsatzId}/einsatzabschnitte`);
  await expect(page.getByText(ABSCHNITT).first()).toBeVisible();
  await expect(page.locator('[data-lfh="modul-panel"]'), 'Panel offen am Fükw').toBeVisible();

  const messwerte = await page.evaluate(
    async ({ text, mono }) => {
      await document.fonts.ready;
      const inhalt = document.querySelector('[data-lfh="seiten-inhalt"]') as HTMLElement;
      const s = getComputedStyle(inhalt);
      const contentBreite =
        inhalt.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
      const grund = getComputedStyle(document.body);
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
      document.body.append(probe);
      const miss = (wert: string, schrift: string) => {
        probe.style.font = schrift;
        probe.textContent = wert;
        return Math.ceil(probe.getBoundingClientRect().width);
      };
      const textSchrift = `600 ${grund.fontSize} ${grund.fontFamily}`;
      const monoSchrift = "400 12px 'LFH JetBrains Mono', ui-monospace, monospace";
      const ergebnis: Record<string, number> = {
        contentBreite,
        grundSchriftPx: parseFloat(grund.fontSize),
      };
      for (const [k, v] of Object.entries(text)) ergebnis[`text:${k}`] = miss(v, textSchrift);
      for (const [k, v] of Object.entries(mono)) ergebnis[`mono:${k}`] = miss(v, monoSchrift);
      probe.remove();
      return ergebnis;
    },
    {
      text: { abschnitt: ABSCHNITT, einheit: EINHEIT, fuehrer: FUEHRER },
      mono: { kurz: KURZ, einheitRuf: EINHEIT_RUF, staerke: STAERKE },
    },
  );
  for (const [k, v] of Object.entries(messwerte)) {
    test.info().annotations.push({ type: 'messwert', description: `${k}=${v}` });
    console.log(`messwert ${k}=${v}`);
  }
  expect(messwerte.contentBreite).toBeGreaterThan(0);
});
