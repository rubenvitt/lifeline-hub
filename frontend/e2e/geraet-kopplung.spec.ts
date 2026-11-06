import { expect, test, type Browser, type Page } from '@playwright/test';
import { waehleIn } from './auswahl-kern';
import { anmeldenOhneStartseite } from './lageplan-kern';
import { ADMIN, ADMIN_PW } from './rollen-kern';

/**
 * Gerätekopplung (LFH-892, Spec `geraete-kopplung` und `feldgeraet-bedienung`): die
 * Einsatzleitung koppelt ein UHS-Tablet in den Einsatzeinstellungen, das Gerät löst den Code auf
 * `/koppeln` ein, bleibt auf seiner Hülle und zeigt nach dem Widerruf „Kopplung beendet“ statt
 * der Anmeldung.
 *
 * Zwei Kontexte, weil das Gerät ein eigener Browser ist: die Kopplung ersetzt das Cookie, eine
 * Person und ein Gerät teilen sich keinen Cookie-Jar. Kein `networkidle` (LFH-385).
 *
 * Mutationsprobe: in `RequireAuth` die Gerätemarke nicht beachtet → „Kopplung beendet“ rot (das
 * Gerät landet auf der Anmeldung).
 *
 * Zwei Fälle statt einem (LLH-1563): der Weg brauchte sieben volle Seitenladungen in zwei Kontexten
 * (Anmeldung, Einstellungen, `/koppeln`, das Neuladen nach dem Einlösen, fremde Adresse, Neuladen
 * der Liste, Neuladen des Geräts). Unter `--workers=3` kostet jede über den Vite-Dev-Server 3–7 s;
 * der Fall lief lokal in jedem Lauf ins 30-s-Budget, immer an einer Ladung. Jetzt je vier
 * Ladungen: der erste Fall koppelt über die Oberfläche, der zweite koppelt per API, löst den Code
 * aber am Gerät über die Oberfläche ein (nur so setzt es seine Gerätemarke) und öffnet die Liste
 * der Einsatzleitung erst danach, ohne Neuladen. Angemeldet wird über die API. Jede der vier
 * übrigen Ladungen ist Gegenstand des Falls; unter `--workers=3` im Mix mit anderen
 * Sitzungs-Specs brauchen die Fälle 20–24 s (06.11.2026, Cloud-Sitzung, 4 Kerne).
 */

async function einsatzMitUhs(page: Page): Promise<{ einsatz: number; uhs: number }> {
  async function anlegen(pfad: string, data: unknown) {
    const antwort = await page.request.post(pfad, { data });
    expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
    return (await antwort.json()) as { id: number };
  }
  const einsatz = await anlegen('/api/einsaetze', { bezeichnung: `E2E Gerät ${Date.now()}` });
  const uhs = await anlegen(`/api/einsaetze/${einsatz.id}/uhs`, {
    typ: 'behandlungsplatz',
    bezeichnung: 'UHS Nord',
  });
  return { einsatz: einsatz.id, uhs: uhs.id };
}

/** Wählt im Auswahlfeld `feld` die Option `option` (antd rendert die Liste im Portal). */
async function waehle(page: Page, feld: string, option: string) {
  await waehleIn(page.getByRole('combobox', { name: feld }), option);
}

async function geraetOeffnen(browser: Browser) {
  const kontext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  return { kontext, geraet: await kontext.newPage() };
}

test('LFH-892: in den Einstellungen koppeln, auf der Hülle bleiben', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await anmeldenOhneStartseite(page, ADMIN, ADMIN_PW);
  const { einsatz } = await einsatzMitUhs(page);

  // Einsatzleitung: Tablet koppeln.
  await page.goto(`/einsaetze/${einsatz}/einstellungen/geraete`);
  await page.getByRole('button', { name: 'Gerät koppeln' }).click();
  await waehle(page, 'Ansicht', 'UHS-Tablet');
  await waehle(page, 'Unfallhilfsstelle', 'UHS Nord');
  await page.getByLabel('Gerätebezeichnung').fill('Tablet 1');
  await page.getByRole('button', { name: 'Koppeln', exact: true }).click();
  const codeText = page.locator('[data-lfh="kopplungscode-text"]');
  await expect(codeText).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = (await codeText.textContent())!.replace('-', '');
  await page.getByRole('button', { name: 'Fertig' }).click();

  // Gerät: Code aus dem Fragment einlösen.
  const { kontext, geraet } = await geraetOeffnen(browser);
  try {
    await geraet.goto(`/koppeln#${code}`);
    await expect(geraet.getByLabel('Kopplungscode')).toHaveValue(code);
    await expect(geraet).toHaveURL(/\/koppeln$/);
    await geraet.getByRole('button', { name: 'Gerät koppeln' }).click();
    await expect(geraet).toHaveURL(new RegExp(`/geraet/${einsatz}/patienten$`));
    await expect(geraet.getByRole('banner').getByText('UHS Nord', { exact: true })).toBeVisible();

    // Eine fremde Adresse führt auf die Startseite der Hülle.
    await geraet.goto(`/einsaetze/${einsatz}/lagekarte`);
    await expect(geraet).toHaveURL(new RegExp(`/geraet/${einsatz}/patienten$`));
  } finally {
    await kontext.close();
  }
});

test('LFH-892: widerrufen → „Kopplung beendet“, der Code gilt nicht noch einmal', async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await anmeldenOhneStartseite(page, ADMIN, ADMIN_PW);
  const { einsatz, uhs } = await einsatzMitUhs(page);
  const antwort = await page.request.post(`/api/einsaetze/${einsatz}/geraete`, {
    data: { ansicht: 'uhs-tablet', uhs_id: uhs, bezeichnung: 'Tablet 1' },
  });
  expect(antwort.ok(), `Kopplung: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  const { code } = ((await antwort.json()) as { code: { code: string } }).code;

  const { kontext, geraet } = await geraetOeffnen(browser);
  try {
    await geraet.goto(`/koppeln#${code}`);
    await geraet.getByRole('button', { name: 'Gerät koppeln' }).click();
    await expect(geraet).toHaveURL(new RegExp(`/geraet/${einsatz}/patienten$`));

    // Die Liste der Einsatzleitung zeigt die Kopplung als gekoppelt.
    await page.goto(`/einsaetze/${einsatz}/einstellungen/geraete`);
    await expect(page.locator('[data-lfh="geraet-zustand"]')).toContainText('gekoppelt');

    // Widerruf mit Rückfrage.
    await page.getByRole('button', { name: 'Aktionen zu Gerät UHS Nord · Tablet 1' }).click();
    await page.getByRole('menuitem', { name: /Widerrufen/ }).click();
    const dialog = page.getByRole('dialog', { name: 'UHS Nord · Tablet 1 widerrufen?' });
    await dialog.getByRole('button', { name: 'Widerrufen' }).click();
    await expect(page.locator('[data-lfh="geraet-zustand"]')).toContainText('widerrufen');

    // Der Server kennt die Sitzung nicht mehr …
    expect((await geraet.request.get('/api/auth/me')).status()).toBe(401);
    // … und das Gerät zeigt „Kopplung beendet“, keine Anmeldung für Personen.
    await geraet.reload();
    await expect(geraet).toHaveURL(/\/kopplung-beendet$/);
    await expect(geraet.getByRole('heading', { name: 'Kopplung beendet' })).toBeVisible();
    await expect(geraet.getByLabel('Passwort')).toHaveCount(0);

    // Der Weg zurück führt zur Codeeingabe; ein verbrauchter Code gilt nicht noch einmal.
    await geraet.getByRole('button', { name: 'Neuen Code eingeben' }).click();
    await expect(geraet).toHaveURL(/\/koppeln$/);
    await geraet.getByLabel('Kopplungscode').fill(code);
    await geraet.getByRole('button', { name: 'Gerät koppeln' }).click();
    await expect(geraet.getByText(/Dieser Code gilt nicht \(mehr\)/)).toBeVisible();
  } finally {
    await kontext.close();
  }
});
