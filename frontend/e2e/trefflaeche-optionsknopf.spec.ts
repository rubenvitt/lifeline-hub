import { expect, test, type Page } from '@playwright/test';
import { FUEKW, SUBPIXEL, anmelden, einsatzAnlegen, stelleDichte } from './trefflaeche-kern';

/**
 * Beschrifteter Optionsknopf (LFH-1048): antd baut `label.ant-radio-wrapper` wie das Label des
 * Kästchens — so hoch wie seine Schrift, ohne Komponenten-Token für die Höhe. Den Boden setzt
 * `antdOptionsknopf` (`theme/tokens.ts`) am Kontext; ob er am gerenderten Label ankommt und Kreis
 * und Text mittig stehen, belegt nur der Browser.
 *
 * Messfläche: der Dialog „Ansicht … löschen“ der Lagekarte, heute die einzige Stelle mit
 * beschrifteten Optionsknöpfen. Gemessen wird das LABEL, das Kreis und Text umschließt und als
 * Ganzes klickt, nicht der 16-px-Kreis. Böden als Literale (Muster `trefflaeche-kern.ts`): die
 * kurze Achse aus Gate 3, in `kompakt` 24 statt der Steuerhöhe 30, wie beim Kästchen.
 *
 * Gegenprobe: `kompakt` STRENG kleiner als `handschuh` — eine Untergrenze allein bliebe grün, wenn
 * das Label in jeder Stufe 72 px mäße.
 *
 * Nur als Admin (LFH-435 geprüft): der Dialog setzt Schreibrecht voraus (das Menü
 * „Ansichts-Aktionen“ fehlt ohne). Der Boden hängt an keiner Rolle, er kommt aus dem Kontext.
 */

const BODEN = { kompakt: 24, komfortabel: 48, handschuh: 72 } as const;
type Stufe = keyof typeof BODEN;
const STUFEN = Object.keys(BODEN) as Stufe[];
const OPTIONEN = ['Auf allen Ansichten sichtbar machen (empfohlen)', 'Mitlöschen'];

const zehntel = (n: number) => Math.round(n * 10) / 10;

async function oeffneLoeschDialog(page: Page) {
  const kopf = page.locator('section[data-paneel="ansicht"] button[aria-expanded]').first();
  if ((await kopf.getAttribute('aria-expanded')) === 'false') await kopf.click();
  await page.getByRole('button', { name: 'Ansichts-Aktionen' }).click();
  await page.getByRole('menuitem', { name: /Löschen/ }).click();
  const dialog = page.getByRole('dialog', { name: /^Ansicht „Optionsknopf. löschen$/ });
  await expect(dialog).toBeVisible();
  // Erst nach der Zoom-Einblendung messen: währenddessen ist der Dialog skaliert.
  await expect(page.locator('.ant-zoom-appear, .ant-zoom-enter')).toHaveCount(0);
  return dialog;
}

test('beschrifteter Optionsknopf hält die Dichte-Staffel (Kartenansicht löschen)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Optionsknopf ${Date.now()}`);
  // Löschen ist für die Standardansicht gesperrt: eine zweite Ansicht anlegen und per
  // `?ansicht=` aktiv schalten. Der GET legt die Standardansicht an.
  const basis = `/api/einsaetze/${einsatzId}/karten-ansichten`;
  expect((await page.request.get(basis)).ok()).toBeTruthy();
  const neu = await page.request.post(basis, { data: { name: 'Optionsknopf' } });
  expect(neu.ok(), `Seeding Ansicht: ${neu.status()} ${await neu.text()}`).toBeTruthy();
  const { id: ansichtId } = (await neu.json()) as { id: number };

  const je = new Map<Stufe, number>();
  const notiz: string[] = [];
  for (const stufe of STUFEN) {
    await page.goto(`/einsaetze/${einsatzId}/lagekarte?ansicht=${ansichtId}`);
    await stelleDichte(page, stufe);
    const dialog = await oeffneLoeschDialog(page);
    const labels = dialog.locator('label.ant-radio-wrapper');
    // Vorbedingung: wirklich die beiden beschrifteten Optionsknöpfe, nicht `Radio.Button`.
    await expect(labels).toHaveCount(OPTIONEN.length);
    await expect(dialog.locator('.ant-radio-button-wrapper')).toHaveCount(0);

    let kleinstes = Number.POSITIVE_INFINITY;
    for (const text of OPTIONEN) {
      const label = labels.filter({ hasText: text });
      const kasten = await label.boundingBox();
      expect(kasten, `${text} (${stufe}): kein Kasten messbar`).not.toBeNull();
      expect(
        kasten!.height,
        `${text} (${stufe}): gemessen ${kasten!.height} px, Soll ≥ ${BODEN[stufe]}`,
      ).toBeGreaterThanOrEqual(BODEN[stufe] - SUBPIXEL);
      // Mittig: Kreis UND Text stehen in der Mitte des Labels. Den Kreis zentriert antd selbst
      // (`alignSelf`); der Text stünde ohne `alignItems` oben auf der Grundlinie (antd: `baseline`).
      const mitteLabel = kasten!.y + kasten!.height / 2;
      for (const [teil, selektor] of [
        ['Kreis', '.ant-radio'],
        ['Text', '.ant-radio-label'],
      ] as const) {
        const k = await label.locator(selektor).boundingBox();
        expect(k, `${text} (${stufe}): ${teil} nicht messbar`).not.toBeNull();
        const versatz = k!.y + k!.height / 2 - mitteLabel;
        expect(
          Math.abs(versatz),
          `${text} (${stufe}): ${teil} ${zehntel(versatz)} px neben der Mitte`,
        ).toBeLessThanOrEqual(2);
      }
      kleinstes = Math.min(kleinstes, kasten!.height);
    }
    je.set(stufe, kleinstes);
    notiz.push(`${stufe}: ${zehntel(kleinstes)} px`);
  }

  test.info().annotations.push({ type: 'messwert', description: notiz.join(' | ') });
  expect(
    je.get('kompakt')!,
    `Gegenprobe: die Stufe muss durchschlagen — ${notiz.join(', ')}`,
  ).toBeLessThan(je.get('handschuh')!);
});
