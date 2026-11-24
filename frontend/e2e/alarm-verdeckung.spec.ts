import { expect, request, test, type Locator, type Page } from '@playwright/test';
import { anmelden, einsatzAnlegen, post } from './fuehrungsorganisation-kern';
import { benutzerAnlegen, mitgliedEintragen } from './rollen-kern';

/**
 * Alarmzone verdeckt nichts (LLH-1735, Spec `benachrichtigungen`, „Alarmzone verdeckt nichts“;
 * Spec `einsatztauglichkeit-layout`, „Kein Fokusziel vollständig verdeckt“). Vorher standen
 * Alarme als antd-Notification oben rechts über Seitenaktionen, dem Navigations-Drawer und
 * Dialogen (LFH-1112, LLH-1716). Jetzt steht die Zone im Rahmen unter dem Kopf, schiebt den
 * Inhalt und liegt unter Drawer und Dialog.
 *
 * GESÄT: überfällige Schichten. Der Erinnerungs-Scheduler meldet sie im nächsten Takt (30 s)
 * über den echten Weg (Live-Strom → AlarmZentrale → Alarmzone), kein synthetisches Ereignis.
 *
 * GEPRÜFT mit Treffer-Prüfung (`frontend/e2e/AGENTS.md`: `toBeVisible` belegt keine
 * Klickbarkeit): „Schicht beginnen“ mit echtem Klick, jedes Bedienelement der Kommandoleiste
 * probehalber (`trial`). Dazu die Lage: die Zone beginnt unter dem Kopf, der Seitenkopf unter
 * der Zone; gerollt klebt sie unter dem Kopf; über ihr liegen Dialog und Drawer.
 *
 * Mutationsproben (gefahren): `position: sticky` an der Zone entfernen → rot an „gerollt klebt
 * sie“; `zIndex` der Zone über 1000 → rot an „Dialog liegt über der Zone“.
 */

const KOPF = '[data-lfh="rahmen-kopf"]';
const SEITENKOPF = '[data-lfh="seitenkopf"]';
const ZONE = '[data-lfh="alarmzone"]';
const EINTRAG = '[data-lfh="alarm-eintrag"]';
const BAND = '[data-lfh="eingangsband"]';

async function seede(page: Page, anzahl: number): Promise<string> {
  const einsatzId = await einsatzAnlegen(page, `E2E Alarmverdeckung ${Date.now()}`);
  const jetzt = Date.now();
  for (let i = 1; i <= anzahl; i++) {
    const einheit = await post(page, einsatzId, 'units', { name: `Florian Alarm ${i}` });
    await post(page, einsatzId, 'reliefs', {
      einheit_id: einheit,
      rhythmus_minuten: 360,
      beginn_at: new Date(jetzt - (400 + i) * 60_000).toISOString(),
    });
  }
  return einsatzId;
}

async function box(ort: Locator) {
  const b = await ort.boundingBox();
  expect(b, 'Element ohne Box').not.toBeNull();
  return b!;
}

async function zonenZahl(page: Page): Promise<number> {
  return Number((await page.locator(ZONE).getAttribute('data-anzahl')) ?? 0);
}

/** Was in der Mitte der Zone obenauf liegt, gehört nicht zur Zone. */
async function zoneVerdeckt(page: Page): Promise<boolean> {
  return page.locator(ZONE).evaluate((zone) => {
    const r = zone.getBoundingClientRect();
    return !zone.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  });
}

/**
 * Jedes sichtbare Bedienelement der Kommandoleiste liegt obenauf: der Treffer in seiner Mitte
 * ist es selbst. Bedienbare zusätzlich mit `trial`-Klick; ein gesperrter Zustandsknopf
 * („Benachrichtigung blockiert“) besteht keinen Klick, trägt aber seinen Tooltip.
 */
async function kommandoleisteKlickbar(page: Page) {
  const ziele = page
    .locator(KOPF)
    .locator('button, a[href], input, [role="button"], [role="combobox"]');
  let geprueft = 0;
  for (const ziel of await ziele.all()) {
    if (!(await ziel.isVisible())) continue;
    const obenauf = await ziel.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
    const name = (await ziel.getAttribute('aria-label')) ?? (await ziel.innerText());
    expect(obenauf, `„${name}“ in der Kommandoleiste ist verdeckt`).toBe(true);
    if (await ziel.isEnabled()) await ziel.click({ trial: true, timeout: 3_000 });
    geprueft++;
  }
  expect(geprueft, 'keine Bedienelemente in der Kommandoleiste gefunden').toBeGreaterThan(3);
}

async function pruefe(page: Page, anzahl: number) {
  await expect(page.locator(ZONE)).toHaveAttribute('data-anzahl', String(anzahl), {
    timeout: 75_000,
  });
  // Die Zone steht unter dem Kopf, der Seitenkopf darunter: sie schiebt, statt zu verdecken.
  const kopf = await box(page.locator(KOPF));
  const zone = await box(page.locator(ZONE));
  const seitenkopf = await box(page.locator(SEITENKOPF));
  expect(zone.y).toBeGreaterThanOrEqual(kopf.y + kopf.height - 0.5);
  expect(seitenkopf.y).toBeGreaterThanOrEqual(zone.y + zone.height - 0.5);
  await kommandoleisteKlickbar(page);

  // Die Hauptaktion des Seitenkopfs mit echtem Klick; der Dialog liegt über der Zone.
  await page.getByRole('button', { name: 'Schicht beginnen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect(await zoneVerdeckt(page), 'Dialog liegt über der Zone').toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

test.describe('Alarmzone verdeckt nichts', () => {
  test.setTimeout(150_000);

  test('Desktop 1366: ein Alarm, Seitenaktion frei, „Gelesen“ quittiert', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await anmelden(page);
    const einsatzId = await seede(page, 1);
    await page.goto(`/einsaetze/${einsatzId}/abloesung`);
    await expect(page.getByRole('article', { name: 'Schicht Florian Alarm 1' })).toBeVisible();

    await pruefe(page, 1);

    // „Gelesen“ quittiert, die Seite bleibt, die Zone geht.
    await page.locator(EINTRAG).getByRole('button', { name: 'Gelesen', exact: true }).click();
    await expect(page.locator(ZONE)).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/abloesung$`));
  });

  test('Tablet 820: drei Alarme gebündelt, gerollt unter dem Kopf, Drawer darüber, „Öffnen“ wirkt', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await anmelden(page);
    const einsatzId = await seede(page, 3);
    await page.goto(`/einsaetze/${einsatzId}/abloesung`);
    await expect(page.getByRole('article', { name: 'Schicht Florian Alarm 3' })).toBeVisible();

    await pruefe(page, 3);
    // Ab zwei gebündelt: eine Zeile mit dem jüngsten.
    await expect(page.locator(EINTRAG)).toHaveCount(1);
    await expect(page.getByRole('button', { name: '+ 2 weitere', exact: true })).toBeVisible();

    // Der Navigations-Drawer liegt über der Zone.
    await page.getByRole('button', { name: 'Navigation öffnen' }).click();
    await expect(page.locator('.ant-drawer-open')).toBeVisible();
    expect(await zoneVerdeckt(page), 'Drawer liegt über der Zone').toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('.ant-drawer-open')).toHaveCount(0);

    // Gerollt: die Zone klebt unter dem Kopf.
    await page.setViewportSize({ width: 820, height: 600 });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const kopf = await box(page.locator(KOPF));
    await expect
      .poll(async () => (await box(page.locator(ZONE))).y, { message: 'Zone klebt unter dem Kopf' })
      .toBeCloseTo(kopf.y + kopf.height, 0);
    // Klebt der Seitenkopf (zjt7c073, nur wenn er ins Drittel der Fensterhöhe passt), steht er
    // unter der Zone: sie zählt zur Kopfebene, an der er hängt.
    if (
      (await page.locator(SEITENKOPF).evaluate((el) => getComputedStyle(el).position)) === 'sticky'
    ) {
      const zoneGerollt = await box(page.locator(ZONE));
      await expect
        .poll(async () => (await box(page.locator(SEITENKOPF))).y, {
          message: 'Seitenkopf klebt unter der Zone',
        })
        .toBeCloseTo(zoneGerollt.y + zoneGerollt.height, 0);
    }
    await kommandoleisteKlickbar(page);

    // Tab durch die Zone rollt die Seite nicht (Fokusabstand ausgesetzt wie im Kopf).
    const vorher = await page.evaluate(() => window.scrollY);
    await page.locator(ZONE).getByRole('button').first().focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => window.scrollY), 'Tab durch die Zone rollt').toBe(vorher);

    // Rückwärts getabbt liegt kein Ziel des Inhalts vollständig hinter Kopf oder Zone.
    const zone = await box(page.locator(ZONE));
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Shift+Tab');
      const ziel = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        if (el.closest('[data-lfh="rahmen-kopf"], [data-lfh="alarmzone"]')) return null;
        const r = el.getBoundingClientRect();
        return { unten: r.y + r.height, name: el.getAttribute('aria-label') ?? el.textContent };
      });
      if (!ziel) continue;
      expect(ziel.unten, `„${ziel.name}“ liegt hinter der Zone`).toBeGreaterThan(
        zone.y + zone.height,
      );
    }

    // Aufgeklappt springt „Öffnen“ und quittiert nur seinen Alarm.
    await page.getByRole('button', { name: '+ 2 weitere', exact: true }).click();
    await expect(page.locator(EINTRAG)).toHaveCount(3);
    await page
      .locator(EINTRAG)
      .first()
      .getByRole('button', { name: 'Öffnen', exact: true })
      .click();
    await expect.poll(() => zonenZahl(page)).toBe(2);
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/abloesung`));
  });

  test('Desktop 1366: drei Alarme und ein Eingang — das Band verdrängt und verdeckt keinen Alarm', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await anmelden(page);
    const einsatzId = await seede(page, 3);
    // Eigene Aktionen melden nichts: der Eingang kommt von einem zweiten Konto.
    const konto = await benutzerAnlegen(page, 'fuehrungspersonal', 'E2E Eingang Verdeckung');
    await mitgliedEintragen(page, einsatzId, konto.id, 'fuehrungspersonal');
    await page.goto(`/einsaetze/${einsatzId}/abloesung`);
    await expect(page.getByRole('article', { name: 'Schicht Florian Alarm 3' })).toBeVisible();
    await expect(page.locator(ZONE)).toHaveAttribute('data-anzahl', '3', { timeout: 75_000 });

    const zweiter = await request.newContext({ baseURL: test.info().project.use.baseURL });
    try {
      const login = await zweiter.post('/api/auth/login', {
        data: { benutzername: konto.benutzername, passwort: konto.passwort },
      });
      expect(login.ok(), `Anmelden zweiter Schirm: ${login.status()}`).toBe(true);
      const meldung = await zweiter.post(`/api/einsaetze/${einsatzId}/reports`, {
        data: {
          absender: 'Abschnitt Nord',
          meldeweg: 'funk',
          inhalt: 'Lage ruhig, keine Veränderung.',
          meldungsart: 'lagemeldung',
          ereigniszeit: '2026-10-01 09:30:00',
        },
      });
      expect(meldung.ok(), `Meldung: ${meldung.status()} ${await meldung.text()}`).toBe(true);
    } finally {
      await zweiter.dispose();
    }

    const band = page.locator(BAND);
    await expect(band).toBeVisible({ timeout: 20_000 });
    // Der Eingang steht nicht in der Zone, und das Band liegt nicht über ihr.
    expect(await zonenZahl(page)).toBe(3);
    const bandBox = await box(band);
    const z = await box(page.locator(ZONE));
    const ueberlappt =
      z.x < bandBox.x + bandBox.width &&
      bandBox.x < z.x + z.width &&
      z.y < bandBox.y + bandBox.height &&
      bandBox.y < z.y + z.height;
    expect(ueberlappt, 'Eingangsband liegt über der Alarmzone').toBe(false);
    await kommandoleisteKlickbar(page);
    // Das Band unten im Bild, mit Abstand zum Rand.
    const hoehe = page.viewportSize()!.height;
    expect(bandBox.y + bandBox.height).toBeLessThanOrEqual(hoehe);
    expect(bandBox.y + bandBox.height).toBeGreaterThan(hoehe - 80);
  });

  test('Handy 390: ein Alarm steht in der Leiste unten und bleibt beim Tippen als eine Zeile (LLH-1738)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await anmelden(page);
    const einsatzId = await seede(page, 1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/einsaetze/${einsatzId}/etb`);
    const leiste = page.locator('[data-lfh="handy-leiste"]');
    await expect(leiste).toContainText('1 Alarm', { timeout: 75_000 });
    // Oben steht keine Zone; die Leiste trägt den Alarm.
    await expect(page.locator(ZONE)).toHaveCount(0);
    await page
      .locator('.etb-erfassung-sticky')
      .getByPlaceholder(/Inhalt/)
      .focus();
    await expect(leiste).toBeVisible();
    await expect(leiste).toContainText('1 Alarm');
    expect((await box(leiste)).height).toBeLessThanOrEqual(48);
  });
});
