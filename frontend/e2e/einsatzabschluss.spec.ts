import { expect, test, type Page } from '@playwright/test';
import { etbMitSystem, systemBuendelAufklappen } from './etb-kern';
import { anmelden, einsatzAnlegen } from './fuehrungsorganisation-kern';
import { wechsleZuRolle } from './rollen-kern';

/**
 * Einsatzabschluss auf den Einsatzdaten (LFH-960, LLH-1814): Unumkehrbares für den ganzen Einsatz
 * steht nicht im Kopf einer Arbeitsseite. Hier steht, was jsdom nicht belegt: auf Handy, Tablet
 * hoch und quer und Desktop trägt das Einsatztagebuch weder im Kopf noch im Menü „Weitere“ einen
 * Abschluss, auf den Einsatzdaten steht „Einsatz abschließen…“ als bedienbarer Knopf außerhalb des
 * Seitenkopfs, und der Dialog passt mit seinem roten Knopf ohne waagerechten Überhang in jede
 * Breite. Am Ende einmal der ganze Ablauf über Seiten (Spec `einsatz-abschluss`): Dialog mit einem
 * offenen Auftrag, Eintippen, Abschluss, Wiederöffnen mit Grund, und das ETB zeigt beide Einträge.
 * Die Logik des Dialogs (Vergleich, Gruppen, Fehler) prüft Vitest
 * (`pages/einsatzdaten/EinsatzAbschlussDialog.test.tsx`).
 *
 * Gemessen als Admin UND als Führungspersonal (`frontend/e2e/AGENTS.md`, Layout-Gate
 * nicht-privilegiert): Führungspersonal schreibt im Einsatz, leitet ihn aber nicht.
 *
 * Mutationsproben (die erste und die dritte für LLH-1814 gefahren, die zweite seit LFH-960):
 *   • in `pages/einsatzdaten/EinsatzAbschlussPaneel.tsx` `darfEinsatzLeiten` auf
 *     `darfImEinsatzSchreiben` → nur der Führungspersonal-Test wird rot (Abschnitt ohne
 *     Leitungsrecht);
 *   • in `pages/EtbPage.tsx` den Menüeintrag „Einsatz abschließen“ zurück in „Weitere“ → beide
 *     Tests werden bei 390 px rot (Menü „Weitere“);
 *   • in `pages/einsatzdaten/EinsatzAbschlussDialog.tsx` `gesperrt` auf `false` → der Admin-Test
 *     wird rot (roter Knopf vor dem Eintippen aktiv).
 */

const BREITEN = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1180, height: 820 },
  { width: 1440, height: 900 },
];

/** Waagerechter Überhang der Seite in px (Chromium rundet `scrollWidth`, 1 px Toleranz). */
async function ueberhang(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/** ETB: kein Abschluss im Kopf, und wo es das Menü „Weitere“ gibt, auch dort nicht. */
async function etbOhneAbschluss(page: Page, einsatzId: string, breite: number, wo: string) {
  await page.goto(`/einsaetze/${einsatzId}/etb`);
  const main = page.locator('main');
  await expect(
    main.getByRole('heading', { level: 1, name: 'ETB', exact: true }),
    `${wo}: ETB geladen`,
  ).toBeVisible();
  await expect(main.getByText('Einsatz abschließen'), `${wo}: kein Abschluss im ETB`).toHaveCount(
    0,
  );
  // Unter `md` (768 px) stehen Nebenwege im Menü „Weitere“, darüber direkt im Kopf.
  const weitere = main.getByRole('button', { name: 'Weitere Aktionen zum Einsatztagebuch' });
  if (breite < 768) {
    await expect(weitere, `${wo}: Menü „Weitere“ steht`).toBeVisible();
    await weitere.click();
    const menue = page.locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');
    await expect(menue.getByRole('menuitem'), `${wo}: Menü „Weitere“`).toHaveText([
      'Drucken / als PDF',
    ]);
    await page.keyboard.press('Escape');
    await expect(menue).toHaveCount(0);
  }
}

test('Einsatzabschluss: nicht im ETB, auf den Einsatzdaten außerhalb des Kopfs, Dialog, Wiederöffnen (Admin)', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await anmelden(page);
  const name = `E2E Einsatzabschluss ${Date.now()}`;
  const einsatzId = await einsatzAnlegen(page, name);
  // Ein offener Punkt: ein Auftrag ohne Bearbeitung.
  const auftrag = await page.request.post(`/api/einsaetze/${einsatzId}/auftraege`, {
    data: {
      auftrag_text: 'Sandsäcke zum Deich bringen',
      empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: 'Logistiktrupp' }],
    },
  });
  expect(auftrag.ok(), `POST …/auftraege: ${auftrag.status()}`).toBe(true);

  for (const breite of BREITEN) {
    await page.setViewportSize(breite);
    const wo = `admin ${breite.width}`;
    await etbOhneAbschluss(page, einsatzId, breite.width, wo);

    await page.goto(`/einsaetze/${einsatzId}/einsatzdaten`);
    const main = page.locator('main');
    await expect(main.getByRole('heading', { name: 'Einsatzabschluss' }), wo).toBeVisible();
    const knopf = main.getByRole('button', { name: 'Einsatz abschließen…', exact: true });
    await expect(knopf, `${wo}: als Wort`).toBeVisible();
    await expect(
      main.locator('[data-lfh="seitenkopf-aktionen"]').getByText('Einsatz abschließen'),
      `${wo}: nicht im Seitenkopf`,
    ).toHaveCount(0);
    const k = await knopf.boundingBox();
    expect(k, `${wo}: Knopf messbar`).not.toBeNull();
    expect(k!.x, `${wo}: links im Bild`).toBeGreaterThanOrEqual(0);
    expect(k!.x + k!.width, `${wo}: rechts im Bild`).toBeLessThanOrEqual(breite.width + 1);
    expect(await ueberhang(page), `${wo}: ohne Überhang`).toBeLessThanOrEqual(1);

    // Der Dialog passt in die Breite; sein roter Knopf ist vor dem Eintippen gesperrt.
    await knopf.click();
    const dialog = page.getByRole('dialog', { name: 'Einsatz abschließen' });
    await expect(dialog.getByRole('region', { name: 'Aufträge' }), wo).toBeVisible();
    const ok = dialog.getByRole('button', { name: 'Einsatz abschließen', exact: true });
    await expect(ok, `${wo}: gesperrt vor dem Eintippen`).toBeDisabled();
    const o = await ok.boundingBox();
    expect(o, `${wo}: roter Knopf messbar`).not.toBeNull();
    expect(o!.x, `${wo}: roter Knopf links im Bild`).toBeGreaterThanOrEqual(0);
    expect(o!.x + o!.width, `${wo}: roter Knopf rechts im Bild`).toBeLessThanOrEqual(
      breite.width + 1,
    );
    expect(await ueberhang(page), `${wo}: Dialog ohne Überhang`).toBeLessThanOrEqual(1);
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(dialog).toHaveCount(0);
  }

  // Der Abschluss selbst: Dialog mit dem offenen Auftrag, erst nach dem Eintippen aktiv.
  const main = page.locator('main');
  await main.getByRole('button', { name: 'Einsatz abschließen…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Einsatz abschließen' });
  const auftraege = dialog.getByRole('region', { name: 'Aufträge' });
  await expect(auftraege.getByText('Sandsäcke zum Deich bringen')).toBeVisible();
  const ok = dialog.getByRole('button', { name: 'Einsatz abschließen', exact: true });
  const bestaetigung = dialog.getByRole('textbox', { name: /Zur Bestätigung/ });
  await bestaetigung.fill('Hochwasser woanders');
  await expect(ok).toBeDisabled();
  // Ohne interne Nummer die Bezeichnung, in Kleinbuchstaben und mit Leerraum am Rand.
  await bestaetigung.fill(`  ${name.toLowerCase()} `);
  await expect(ok).toBeEnabled();
  await ok.click();
  await expect(dialog).toHaveCount(0);
  const paneel = main.getByRole('region', { name: 'Einsatzabschluss' });
  await expect(paneel.getByText(/^Abgeschlossen am /)).toBeVisible();
  let einsatz = await page.request.get(`/api/einsaetze/${einsatzId}`);
  expect(((await einsatz.json()) as { status: string }).status).toBe('abgeschlossen');

  // Wiederöffnen binnen 24 Stunden, mit Grund.
  await paneel.getByRole('button', { name: 'Einsatz wieder öffnen…' }).click();
  const wieder = page.getByRole('dialog', { name: 'Einsatz wieder öffnen' });
  await wieder.getByRole('textbox', { name: 'Grund' }).fill('Falscher Einsatz abgeschlossen');
  await wieder.getByRole('button', { name: 'Einsatz wieder öffnen', exact: true }).click();
  await expect(wieder).toHaveCount(0);
  await expect(
    main.getByRole('button', { name: 'Einsatz abschließen…', exact: true }),
  ).toBeVisible();
  einsatz = await page.request.get(`/api/einsaetze/${einsatzId}`);
  expect(((await einsatz.json()) as { status: string }).status).toBe('aktiv');

  // Beide Schritte stehen im ETB.
  await page.goto(etbMitSystem(einsatzId));
  await systemBuendelAufklappen(page);
  const zeitachse = page.getByRole('region', { name: 'Einsatztagebuch' });
  await expect(zeitachse.getByText('Einsatz abgeschlossen', { exact: true })).toBeVisible();
  await expect(
    zeitachse.getByText(
      /^Einsatz wieder geöffnet \(abgeschlossen am .+\): Falscher Einsatz abgeschlossen$/,
    ),
  ).toBeVisible();
});

test('Einsatzabschluss: fehlt für Führungspersonal auf allen Breiten', async ({ page }) => {
  test.setTimeout(180_000);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Einsatzabschluss FP ${Date.now()}`);
  await wechsleZuRolle(page, 'fuehrungspersonal', einsatzId);

  for (const breite of BREITEN) {
    await page.setViewportSize(breite);
    const wo = `fuehrungspersonal ${breite.width}`;
    await etbOhneAbschluss(page, einsatzId, breite.width, wo);

    await page.goto(`/einsaetze/${einsatzId}/einsatzdaten`);
    const main = page.locator('main');
    // Vorbedingung: der Rollenzweig steht — Führungspersonal bearbeitet die Kopfdaten, verwaltet
    // aber den Zugriff nicht (LFH-1170: kein Sprung dorthin).
    await expect(main.getByRole('button', { name: 'Bezeichnung bearbeiten' }), wo).toBeVisible();
    if (breite.width < 768) {
      // Unter `md` stehen die Nebenwege als Menüeinträge hinter „Weitere“, nie als Link.
      await page.getByRole('button', { name: 'Weitere Aktionen zu den Einsatzdaten' }).click();
      const menue = page.getByRole('menu');
      await expect(
        menue.getByRole('menuitem', { name: 'Einsatzbericht drucken' }),
        wo,
      ).toBeVisible();
      await expect(menue.getByRole('menuitem', { name: /Zugriff verwalten/ }), wo).toHaveCount(0);
      await page.keyboard.press('Escape');
    } else {
      await expect(page.getByRole('link', { name: 'Einsatzbericht drucken' }), wo).toBeVisible();
      await expect(page.getByRole('link', { name: /Zugriff verwalten/ }), wo).toHaveCount(0);
    }
    await expect(main.getByRole('heading', { name: 'Einsatzabschluss' }), wo).toHaveCount(0);
    await expect(main.getByText('Einsatz abschließen'), wo).toHaveCount(0);
    expect(await ueberhang(page), `${wo}: ohne Überhang`).toBeLessThanOrEqual(1);
  }
});
