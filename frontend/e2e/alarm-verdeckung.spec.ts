import { expect, test, type Locator, type Page } from '@playwright/test';
import { anmelden, einsatzAnlegen, post } from './fuehrungsorganisation-kern';

/**
 * Stehende Alarme verdecken keine Bedienkante (LFH-1112, Spec `einsatztauglichkeit-layout`).
 * Die AlarmZentrale zeigt Alarme als stehende Benachrichtigung oben rechts. Vorher lag sie
 * dort über dem rechten Ende von Kommandoleiste und Seitenkopf; bei 1366 px war „Schicht
 * beginnen“ ganz verdeckt.
 *
 * GESÄT: überfällige Schichten. Der Erinnerungs-Scheduler meldet sie im nächsten Takt (30 s)
 * über den echten Weg (Live-Strom → AlarmZentrale), kein synthetisches Ereignis.
 *
 * GEPRÜFT mit Treffer-Prüfung (`frontend/e2e/AGENTS.md`: `toBeVisible` belegt keine
 * Klickbarkeit): „Schicht beginnen“ mit echtem Klick, jedes Bedienelement der Kommandoleiste
 * probehalber (`trial`, dieselbe Prüfung, ob nichts darüber liegt, ohne Menüs zu öffnen). Dazu
 * die Lage: jeder Alarm beginnt unter Kommandoleiste und Seitenkopf, gerollt unter der Leiste.
 *
 * Mutationsproben (beide gefahren): die Regel `--notification-top` in `src/index.css` entfernen
 * → beide Tests rot („Alarm beginnt bei 18, Bedienkante 97“); dazu die Lageprüfung aussetzen →
 * rot an der Treffer-Prüfung (Ton- und Benachrichtigungsknopf der Kommandoleiste verdeckt).
 */

const KOPF = '[data-lfh="rahmen-kopf"]';
const SEITENKOPF = '[data-lfh="seitenkopf"]';
const ALARM = '.ant-notification-notice:not(.ant-notification-fade-leave)';
/** Abstand der Alarme zur Bedienkante (`ALARM_ABSTAND` in `components/alarmOben.ts`). */
const ABSTAND = 8;

async function seede(page: Page, anzahl: number): Promise<string> {
  const einsatzId = await einsatzAnlegen(page, `E2E Alarmverdeckung ${Date.now()}`);
  const jetzt = Date.now();
  for (let i = 1; i <= anzahl; i++) {
    const einheit = await post(page, einsatzId, 'einheiten', { name: `Florian Alarm ${i}` });
    await post(page, einsatzId, 'abloesungen', {
      einheit_id: einheit,
      rhythmus_minuten: 360,
      beginn_at: new Date(jetzt - (400 + i) * 60_000).toISOString(),
    });
  }
  return einsatzId;
}

async function unterkante(ort: Locator): Promise<number> {
  const box = await ort.boundingBox();
  expect(box, 'Element ohne Box').not.toBeNull();
  return box!.y + box!.height;
}

/** Oberkante des obersten stehenden Alarms (die DOM-Folge ist nicht die Bildfolge). */
async function obersterAlarm(page: Page): Promise<number> {
  const oben = await page
    .locator(ALARM)
    .evaluateAll((alarme) => alarme.map((a) => a.getBoundingClientRect().y));
  return Math.min(...oben);
}

/** Jeder stehende Alarm beginnt unter `kante` (+ Abstand), auf den halben Pixel. */
async function alarmeUnter(page: Page, kante: number) {
  const alarme = page.locator(ALARM);
  for (const alarm of await alarme.all()) {
    const box = await alarm.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y, `Alarm beginnt bei ${box!.y}, Bedienkante ${kante}`).toBeGreaterThanOrEqual(
      kante + ABSTAND - 0.5,
    );
  }
}

/**
 * Jedes sichtbare Bedienelement der Kommandoleiste liegt obenauf: der Treffer in seiner Mitte
 * ist es selbst. Bedienbare zusätzlich mit `trial`-Klick; ein gesperrter Zustandsknopf
 * („Benachrichtigungen: blockiert“) besteht keinen Klick, trägt aber seinen Tooltip.
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
  await expect(page.locator(ALARM)).toHaveCount(anzahl, { timeout: 75_000 });
  await expect(page.locator(ALARM).first()).toBeVisible();
  const kante = Math.max(
    await unterkante(page.locator(KOPF)),
    await unterkante(page.locator(SEITENKOPF)),
  );
  await alarmeUnter(page, kante);
  await kommandoleisteKlickbar(page);

  // Die Hauptaktion des Seitenkopfs mit echtem Klick: der Dialog öffnet sich.
  await page.getByRole('button', { name: 'Schicht beginnen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

test.describe('Stehende Alarme unter der Bedienkante', () => {
  test.setTimeout(150_000);

  test('Desktop 1366: ein Alarm, Kopfknopf und Kommandoleiste erreichbar, Alarm quittierbar', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await anmelden(page);
    const einsatzId = await seede(page, 1);
    await page.goto(`/einsaetze/${einsatzId}/abloesung`);
    await expect(page.getByRole('article', { name: 'Schicht Florian Alarm 1' })).toBeVisible();

    await pruefe(page, 1);

    // Der Alarm bleibt bedienbar: „Schließen“ quittiert ihn.
    const alarm = page.locator(ALARM);
    await alarm.getByRole('button', { name: 'Schließen', exact: true }).click();
    await expect(alarm).toHaveCount(0);
  });

  test('Tablet 820: drei Alarme, gerollt unter der Leiste, „Öffnen“ wirkt', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await anmelden(page);
    const einsatzId = await seede(page, 3);
    await page.goto(`/einsaetze/${einsatzId}/abloesung`);
    await expect(page.getByRole('article', { name: 'Schicht Florian Alarm 3' })).toBeVisible();

    await pruefe(page, 3);

    // Gerollt: der Seitenkopf ist aus dem Bild, die Alarme rücken unter die klebende Leiste.
    await page.setViewportSize({ width: 820, height: 600 });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const kopfUnten = await unterkante(page.locator(KOPF));
    await expect
      .poll(async () => unterkante(page.locator(SEITENKOPF)), {
        message: 'Seitenkopf rollt unter die Leiste',
      })
      .toBeLessThanOrEqual(kopfUnten);
    await expect.poll(async () => obersterAlarm(page)).toBeCloseTo(kopfUnten + ABSTAND, 0);
    await kommandoleisteKlickbar(page);

    // „Öffnen“ führt zur Ablösung und quittiert den Alarm.
    const erster = page.locator(ALARM).first();
    await erster.getByRole('button', { name: 'Öffnen', exact: true }).click();
    await expect(page.locator(ALARM)).toHaveCount(2);
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/abloesung`));
  });
});
