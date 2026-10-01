import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Fußfuge eines Dialogs mit antds STANDARDFUSS (LFH-653, Spec `einsatztauglichkeit-layout`,
 * „Abstand zwischen den Knöpfen eines Dialogfußes“, Szenario „Dialog mit Standardfuß“).
 *
 * antd trennt die Knöpfe seiner eigenen Füße mit `marginXS` (3 / 5 / 7 px). Die Regel in
 * `src/index.css` setzt den Folgeknopf auf `var(--ant-padding)` (11 / 18 / 26). Ob die Variable AM
 * KNOPF auflöst und die Regel antds `:where(…)`-Selektor schlägt, belegt nur der Browser — der
 * Modal-Fuß hat von den drei Füßen den spezifischsten Selektor. Der Titelabstand bleibt antds
 * `marginXS`; die Regel darf ihn nicht mitnehmen.
 *
 * Messfläche: „Neue Ansicht" auf der Lagekarte, ein `<Modal>` mit `onOk`/`onCancel` und ohne
 * `footer` — also genau antds Fuß.
 *
 * Nur als Admin (LFH-435 geprüft): der Dialog setzt Schreibrecht voraus, ohne es gibt es keinen
 * Fuß zu messen. Die Fuge selbst hängt an keiner Rolle — sie kommt aus einer globalen Stilregel.
 */

const TABLET = { width: 1024, height: 768 };
const SUBPIXEL = 0.5;
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** Böden als Literale. `fuge: null` = nur gemessen (Fükw, Ausnahme der Leitlinie). `titel` ist
 *  antds `marginXS` der Stufe (`abstand.xs`), der unverändert bleiben soll. */
const STAFFEL = [
  { dichte: 'kompakt', soll: 30, fuge: null, titel: 3 },
  { dichte: 'komfortabel', soll: 48, fuge: 8, titel: 5 },
  { dichte: 'handschuh', soll: 72, fuge: 16, titel: 7 },
] as const;

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function kasten(ziel: Locator) {
  const k = await ziel.boundingBox();
  expect(k, 'kein Kasten messbar').not.toBeNull();
  return k!;
}

const zehntel = (n: number) => Math.round(n * 10) / 10;

for (const { dichte, soll, fuge: fugeBoden, titel } of STAFFEL) {
  test(`Standardfuß „Neue Ansicht", Stufe ${dichte}: Fuge, Knopfhöhe, Titelabstand`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await anmelden(page);
    const r = await page.request.post('/api/einsaetze', {
      data: { bezeichnung: `E2E Dialogfuß ${dichte} ${Date.now()}` },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    const { id } = (await r.json()) as { id: number };

    await page.setViewportSize(TABLET);
    await page.goto(`/einsaetze/${id}/lagekarte`);
    await page.evaluate(([schluessel, wert]) => window.localStorage.setItem(schluessel, wert), [
      DICHTE_SCHLUESSEL,
      dichte,
    ] as const);
    await page.reload();
    // Wache: trennt „Fuge zu schmal" von „Stufe gar nicht angekommen".
    await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);

    const kopf = page.locator('section[data-paneel="ansicht"] button[aria-expanded]').first();
    if ((await kopf.getAttribute('aria-expanded')) === 'false') await kopf.click();
    await page.getByRole('button', { name: 'Ansichts-Aktionen' }).click();
    await page.getByRole('menuitem', { name: /Neue Ansicht/ }).click();

    const dialog = page.getByRole('dialog', { name: 'Neue Ansicht' });
    await expect(dialog).toBeVisible();
    // Erst nach der Zoom-Einblendung messen: währenddessen ist der Dialog skaliert.
    await expect(page.locator('.ant-zoom-appear, .ant-zoom-enter')).toHaveCount(0);
    // Vorbedingung: wirklich antds Fuß, nicht ein selbstgebauter.
    const fuss = dialog.locator('.ant-modal-footer');
    await expect(fuss.locator('> .ant-btn')).toHaveCount(2);

    const abbrechen = await kasten(fuss.getByRole('button', { name: 'Abbrechen' }));
    const speichern = await kasten(fuss.getByRole('button', { name: 'Speichern' }));
    const fuge = zehntel(speichern.x - (abbrechen.x + abbrechen.width));
    const kopfzeile = await kasten(dialog.locator('.ant-modal-header'));
    const inhalt = await kasten(dialog.locator('.ant-modal-body'));
    const titelabstand = zehntel(inhalt.y - (kopfzeile.y + kopfzeile.height));

    test.info().annotations.push({
      type: 'messwert',
      description: `${dichte}: Fuge Abbrechen|Speichern ${fuge} px, Knöpfe ${zehntel(abbrechen.height)} / ${zehntel(speichern.height)} px, Titelabstand ${titelabstand} px`,
    });

    for (const [name, k] of [
      ['Abbrechen', abbrechen],
      ['Speichern', speichern],
    ] as const) {
      expect(
        k.height,
        `${name} (${dichte}): ${k.height} px, Soll ≥ ${soll}`,
      ).toBeGreaterThanOrEqual(soll - SUBPIXEL);
    }
    if (fugeBoden !== null) {
      expect(fuge, `Fuge (${dichte}): ${fuge} px, Soll ≥ ${fugeBoden}`).toBeGreaterThanOrEqual(
        fugeBoden - SUBPIXEL,
      );
    }
    expect(
      Math.abs(titelabstand - titel),
      `Titelabstand (${dichte}): ${titelabstand} px, unverändert ${titel}`,
    ).toBeLessThanOrEqual(SUBPIXEL);
  });
}
