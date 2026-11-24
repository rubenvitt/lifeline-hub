import { expect, test, type Page } from '@playwright/test';
import { beobachteShifts, bericht, ruheShifts } from './cls-kern';
import { einsatzPerApi } from './einsatz-kern';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Startliste „Einsatz starten“ im Überblick (LLH-1815, Spec `ueberblick-startliste`, Paneel
 * `pages/fuehrung/StartlistePaneel.tsx`, Regeln `pages/fuehrung/startliste.ts`). Hier steht nur,
 * was der Browser oder ein Ablauf zeigt (`e2e/AGENTS.md`): die Lage der Reihen beim Laden, der
 * Sprung in die Einsatzdaten samt Erfassung und das Verschwinden über den Live-Strom. Die Regeln
 * je Punkt, Sichtbarkeit, Sperre und Ausblenden pinnen `startliste.test.ts` und
 * `UeberblickPage.test.tsx`.
 *
 * KEIN LAYOUTSPRUNG: die Reihe steht zwischen Alarmzeile und Paneelreihen (ein Band gibt es seit
 * LLH-1748 nicht mehr). Die Abfrage der jüngsten Lagefeststellung wird gehalten, bis die Seite
 * ruht; dann steht nur die Alarmzeile, die Paneelreihen warten mit der Startliste. Nach dem Loslassen erscheinen sie gemeinsam, und bis
 * „Offene Vorgänge“ fertig ist, verschiebt sich keine Reihe.
 *
 * Mutationsprobe (17.11.2026): in `UeberblickPage.tsx` die Schranke `startlisteLaedt ? null` durch
 * `false ? null` ersetzt → rot an der Vorbedingung (die Reihen stehen vor der Startliste).
 */

/** Dieselbe Hausgrenze wie `ueberblick-vorgaenge-cls.spec.ts` — eine Setzung, keine Toleranz. */
const HAUS_GRENZE = 0.03;

const ANSICHTEN = {
  breit: { width: 1440, height: 900 },
  schmal: { width: 390, height: 844 },
} as const;

const startliste = (page: Page) => page.getByRole('region', { name: 'Einsatz starten' });
const punkt = (page: Page, schluessel: string) =>
  page.locator(`[data-lfh="startliste-punkt"][data-schluessel="${schluessel}"]`);

async function post(page: Page, pfad: string, data: unknown): Promise<void> {
  const r = await page.request.post(pfad, { data });
  expect(r.ok(), `${pfad}: ${r.status()} ${await r.text()}`).toBeTruthy();
}

/** Oberkante eines Elements im Dokument (nicht im Viewport), auf ganze Pixel. */
async function oben(page: Page, selektor: string): Promise<number> {
  return page
    .locator(selektor)
    .first()
    .evaluate((el) => Math.round(el.getBoundingClientRect().top + window.scrollY));
}

for (const [ansicht, groesse] of Object.entries(ANSICHTEN)) {
  test(`leerer Einsatz ${ansicht}: Startliste erscheint mit den Paneelreihen, nichts verrutscht (${groesse.width} px)`, async ({
    page,
  }) => {
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzPerApi(page, `E2E Startliste ${ansicht} ${Date.now()}`);
    await page.setViewportSize(groesse);
    await beobachteShifts(page);

    let loslassen!: () => void;
    const tor = new Promise<void>((f) => (loslassen = f));
    let gehalten = 0;
    await page.route(new RegExp(`/api/einsaetze/${einsatzId}/etb\\?`), async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('typ') === 'lage') {
        gehalten += 1;
        await tor;
      }
      return route.continue();
    });

    await page.goto(`/einsaetze/${einsatzId}/ueberblick`);
    // Vorbedingung: die Lage-Abfrage hängt, die Alarmzeile steht, darunter noch nichts.
    await expect(page.getByRole('status', { name: 'Was brennt' })).toBeVisible();
    await expect.poll(() => gehalten).toBeGreaterThan(0);
    await expect(startliste(page)).toHaveCount(0);
    await expect(page.locator('[data-lfh="ueberblick-paneele"]')).toHaveCount(0);
    await ruheShifts(page);

    loslassen();
    await expect(startliste(page)).toBeVisible();
    await expect(page.locator('[data-lfh="startliste-punkt"][data-zustand="offen"]')).toHaveCount(
      5,
    );
    const vorher = {
      reihe: await oben(page, '[data-lfh="ueberblick-paneele"]'),
      zweiteReihe: await oben(page, '[data-lfh="ueberblick-paneele-gliederung"]'),
    };

    // Endzustand: alle Abschnitte der „Offenen Vorgänge“ geladen, kein Ladezeichen im Inhalt.
    await expect(page.locator('[data-lfh="seiten-inhalt"] [aria-busy="true"]')).toHaveCount(0);
    const m = await ruheShifts(page);
    expect({
      reihe: await oben(page, '[data-lfh="ueberblick-paneele"]'),
      zweiteReihe: await oben(page, '[data-lfh="ueberblick-paneele-gliederung"]'),
    }).toEqual(vorher);
    // Die Punkte brechen um, statt die Seite waagerecht laufen zu lassen.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      'kein waagerechter Überlauf',
    ).toBe(true);
    test.info().annotations.push({ type: 'messwert', description: bericht(m) });
    expect(m.summe, bericht(m)).toBeLessThanOrEqual(HAUS_GRENZE);
  });
}

test('Einsatzleiter über den Sprung erfassen: die Startliste setzt den Haken', async ({ page }) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzPerApi(page, `E2E Startliste Einsatzleiter ${Date.now()}`);
  await page.goto(`/einsaetze/${einsatzId}/ueberblick`);

  await startliste(page)
    .getByRole('link', { name: /Einsatzleiter/ })
    .click();
  // Der Auftrag rollt zum Paneel, fokussiert die Erfassung und verschwindet aus der Adresse.
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/einsatzdaten$`));
  const paneel = page.getByRole('region', { name: 'Eigene Führungsstelle' });
  const eintragen = paneel.getByRole('button', { name: 'Einsatzleiter eintragen' });
  await expect(eintragen).toBeFocused();
  await expect(paneel).toBeInViewport();

  await eintragen.click();
  await paneel.getByRole('combobox', { name: 'Einsatzleiter' }).fill('KBM Weber');
  await page.getByText('„KBM Weber“ als externen Einsatzleiter übernehmen').click();
  await paneel.getByRole('button', { name: 'Einsatzleiter speichern' }).click();
  await expect(paneel.getByRole('button', { name: 'Einsatzleiter bearbeiten' })).toContainText(
    'KBM Weber (extern)',
  );

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/ueberblick$`));
  await expect(punkt(page, 'einsatzleiter')).toHaveAttribute('data-zustand', 'erledigt');
  await expect(punkt(page, 'einsatzleiter')).toContainText('KBM Weber (extern)');
  await expect(punkt(page, 'einsatzort')).toHaveAttribute('data-zustand', 'offen');
});

test('letzter Punkt von einem anderen Schirm: das Paneel verschwindet über den Live-Strom', async ({
  page,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzPerApi(page, `E2E Startliste letzter Punkt ${Date.now()}`);
  const basis = `/api/einsaetze/${einsatzId}`;
  const ort = await page.request.patch(basis, {
    data: { einsatzort: 'Deich West', einsatzort_lat: 52.103, einsatzort_lon: 9.356 },
  });
  expect(ort.ok(), await ort.text()).toBeTruthy();
  const leiter = await page.request.patch(`${basis}/command-post`, {
    data: { einsatzleiter: { art: 'extern', name: 'KBM Weber' } },
  });
  expect(leiter.ok(), await leiter.text()).toBeTruthy();
  await post(page, `${basis}/sectors`, { name: 'EA Nord' });
  await post(page, `${basis}/units`, { name: 'Florian Nord 1' });

  // Erst mit dem Abo des Stroms schreiben (`e2e/AGENTS.md`, Live-Strom).
  const strom = page.waitForResponse((r) => r.url().endsWith(`${basis}/live`) && r.ok());
  await page.goto(`/einsaetze/${einsatzId}/ueberblick`);
  await strom;
  await expect(startliste(page)).toBeVisible();
  await expect(punkt(page, 'lage')).toHaveAttribute('data-zustand', 'offen');
  await expect(page.locator('[data-lfh="startliste-punkt"][data-zustand="erledigt"]')).toHaveCount(
    4,
  );

  await post(page, `${basis}/etb`, {
    typ: 'lage',
    von: 'EA Nord',
    an: 'ELW 1',
    inhalt: 'Deich hält, Wasserstand fällt',
  });

  await expect(startliste(page)).toHaveCount(0);
  await expect(page.locator('[data-lfh="ueberblick-startliste"]')).toHaveCount(0);
  await expect(page.locator('[data-lfh="ueberblick-paneele"]')).toBeVisible();
});
