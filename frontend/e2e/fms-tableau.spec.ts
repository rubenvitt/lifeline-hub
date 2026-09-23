import { expect, test, type Page } from '@playwright/test';

/**
 * FMS-Tableau (LFH-642) im echten Browser — zwei Aussagen, die jsdom nicht tragen kann:
 *
 *  1. **Kein waagerechter Querlauf** auf 390, 1024 und 1366 px. Das Kachelraster rechnet
 *     mit `minmax(min(100%, 208px), 1fr)` — ob das am Handschirm eine Spalte ergibt statt
 *     zu überlaufen, ist Layout und in jsdom unsichtbar.
 *  2. **Die Ziffer setzt den Status gegen das echte Backend** und der Wechsel überlebt das
 *     Neuladen: der Beschleuniger schreibt denselben PATCH wie das Menü.
 *
 * Die Wache vor jeder Messung zeigt auf einen Wortlaut, der erst MIT den Daten erscheint
 * (Lehre aus `kraefte-schmal.spec.ts`: `body` ist immer sichtbar, eine Messung davor
 * prüft den Ladebildschirm). Kein `networkidle` — auf Einsatzrouten bleibt der SSE-Strom
 * offen (LFH-385).
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const SUBPIXEL = 0.5;

const FAHRZEUG_EINHEIT = 'Florian Tableau 1';
const FAHRZEUG_FREI = 'Florian Tableau 2';
const EINHEIT = 'Tableauzug';
const ABSCHNITT = 'EA Tableau';

// Login-/Anlege-Helfer kopiert — es gibt (noch) kein geteiltes e2e-Hilfsmodul
// (gleichlautend in den Bestands-Specs vermerkt).
async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/** Seeding per `page.request`: die Session ist Cookie-basiert, der Jar wird geteilt. */
async function post(page: Page, pfad: string, data: unknown): Promise<number> {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return ((await antwort.json()) as { id: number }).id;
}

async function seede(page: Page): Promise<number> {
  const einsatzId = await post(page, '/api/einsaetze', {
    bezeichnung: `FMS-Tableau ${Date.now()}`,
  });
  const basis = `/api/einsaetze/${einsatzId}`;
  const abschnittId = await post(page, `${basis}/abschnitte`, { name: ABSCHNITT });
  const einheitId = await post(page, `${basis}/einheiten`, {
    name: EINHEIT,
    abschnitt_id: abschnittId,
  });
  const efId = await post(page, `${basis}/fahrzeuge`, {
    adhoc: { funkrufname: FAHRZEUG_EINHEIT, fahrzeugtyp: 'LF 20' },
  });
  const zuordnung = await page.request.put(`${basis}/einheiten/${einheitId}/fahrzeug/${efId}`);
  expect(zuordnung.ok(), `Zuordnung: ${await zuordnung.text()}`).toBeTruthy();
  await post(page, `${basis}/fahrzeuge`, { adhoc: { funkrufname: FAHRZEUG_FREI } });
  return einsatzId;
}

const tableau = (page: Page) => page.getByRole('region', { name: 'FMS-Tableau' });

test('das Tableau läuft auf 390, 1024 und 1366 px nicht waagerecht über', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await seede(page);

  for (const breite of [390, 1024, 1366]) {
    await page.setViewportSize({ width: breite, height: 900 });
    // Über die Sprungmarken-Adresse — der Auftrag wird übernommen und geräumt.
    await page.goto(`/einsaetze/${einsatzId}/fahrzeuge?ansicht=tableau`);
    await expect(tableau(page).getByRole('heading', { name: ABSCHNITT })).toBeVisible();
    await expect(tableau(page).getByText(FAHRZEUG_FREI)).toBeVisible();
    await expect(page).not.toHaveURL(/ansicht=/);
    await expect
      .poll(
        () =>
          page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        { message: `${breite} px: das Tableau läuft waagerecht über` },
      )
      .toBeLessThanOrEqual(SUBPIXEL);
  }
});

test('Ziffern setzen den Status der fokussierten Kachel nacheinander, und er übersteht das Neuladen', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await seede(page);
  await page.goto(`/einsaetze/${einsatzId}/fahrzeuge?ansicht=tableau`);

  const knopf = tableau(page).getByRole('button', {
    name: `Status von ${FAHRZEUG_EINHEIT} ändern`,
  });
  // Startstatus der Disposition: der erste gebundene Katalogeintrag, im Seed „3 – Auf Anfahrt".
  await expect(knopf).toContainText('S3');
  await knopf.focus();
  await page.keyboard.press('4');
  await expect(knopf).toContainText('S4');
  await expect(knopf).toContainText('Am Einsatzort');

  // Während der Mutation ist der Knopf `disabled`, und der Browser wirft den Fokus auf
  // <body> (Review LFH-642). Das Tableau gibt ihn danach zurück — sonst ginge die zweite
  // Ziffer ins Leere. Das ist die Aussage, die jsdom nicht tragen kann.
  await expect(knopf).toBeFocused();
  await page.keyboard.press('5');
  await expect(knopf).toContainText('S5');
  await expect(knopf).toBeFocused();

  // Die andere Kachel bleibt unberührt — die Ziffer wirkt nur, wo der Fokus steht.
  await expect(
    tableau(page).getByRole('button', { name: `Status von ${FAHRZEUG_FREI} ändern` }),
  ).toContainText('S3');

  await page.goto(`/einsaetze/${einsatzId}/fahrzeuge?ansicht=tableau`);
  await expect(
    tableau(page).getByRole('button', { name: `Status von ${FAHRZEUG_EINHEIT} ändern` }),
  ).toContainText('S5');
});
