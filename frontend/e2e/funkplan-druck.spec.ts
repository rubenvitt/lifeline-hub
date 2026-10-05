import { expect, test } from '@playwright/test';
import {
  A4_DRUCKBREITE,
  EINHEIT_ZWEI,
  ERREICHBAR,
  FAHRZEUG,
  SG_LANG,
  SUBPIXEL,
  anmelden,
  einsatzAnlegen,
  oeffne,
  seede,
  seedeSprechgruppen,
  sgZeile,
  tabelle,
} from './funkplan-kern';

/**
 * Druck des Funkplans S6 (LFH-548, LFH-848 D8): was nur der Browser zeigt. Chromium, Firefox und
 * WebKit prüfen die Mechanik unter Druckmedium (`DRUCK_SPECS`, LFH-915); ein PDF erzeugt diese
 * Spec nicht, sie braucht deshalb keinen Chromium-Zweig.
 *
 * - DRUCKPFAD bei A4-Breite (680 px, unter `xl`): alle Knoten offen, die Erreichbarkeit steht
 *   trotzdem da (`beforeprint` selbst ausgelöst, `emulateMedia` feuert es nicht), nichts ragt
 *   rechts aus der Druckwurzel.
 * - SPRECHGRUPPEN im Druck: Druckkopf „Funkplan – Sprechgruppen“, Bedienung aus, die letzte
 *   Spalte endet in der Druckwurzel.
 *
 * Der Druckschritt der Führungsstelle bleibt in `funkplan.spec.ts` (Erfassung und Übernahme).
 *
 * Mutationsprobe (Prüfliste LFH-548): `abBreite: 'xl'` an der Erreichbarkeit auch im Druck → der
 * Druckpfad wird rot.
 */

test('Druckpfad bei A4-Breite: alles offen, Erreichbarkeit da, nichts ragt heraus', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Funkplan Druck ${Date.now()}`);
  await seede(page, einsatzId);
  await page.setViewportSize({ width: A4_DRUCKBREITE, height: 900 });
  await oeffne(page, einsatzId);

  // Vorbedingung: unter `xl` fehlt die personenbezogene Spalte am Schirm.
  await expect(tabelle(page).getByRole('columnheader', { name: 'Erreichbarkeit' })).toHaveCount(0);
  // Einen Knoten zuklappen: der Druck muss ihn wieder öffnen (hier über `beforeprint` + Knopf).
  await tabelle(page).locator(`tr[data-row-key^="eh-"] td`).nth(1).click();
  await expect(tabelle(page).getByText(FAHRZEUG)).toHaveCount(0);

  // Der Knopf öffnet alle Knoten und druckt; `window.print` als Stub, der wie der Browser
  // synchron `beforeprint` feuert. Danach bleibt die Seite im Druckzustand (kein `afterprint`).
  await page.evaluate(() => {
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
    };
  });
  await page.getByRole('button', { name: /Drucken/ }).click();
  await page.emulateMedia({ media: 'print' });

  await expect(tabelle(page).getByText(FAHRZEUG)).toHaveCount(1);
  await expect(tabelle(page).getByRole('columnheader', { name: 'Erreichbarkeit' })).toHaveCount(1);
  await expect(tabelle(page).getByText(ERREICHBAR)).toHaveCount(1);

  const lage = await page.evaluate(() => {
    const wurzel = document.querySelector('.funkplan-print-root')!.getBoundingClientRect();
    // Ohne `sticky` (Druckmodus) trägt antd den Bildlauf an `.ant-table-content`.
    const koerper = (document.querySelector('.funkplan-print-root .ant-table-body') ??
      document.querySelector('.funkplan-print-root .ant-table-content'))!;
    const zellen = Array.from(
      document.querySelector('tr.ant-table-row')!.querySelectorAll(':scope > td'),
    ) as HTMLElement[];
    return {
      wurzelRechts: wurzel.right,
      letzteRechts: zellen[zellen.length - 1].getBoundingClientRect().right,
      ueberhang: koerper.scrollWidth - koerper.clientWidth,
      werkzeuge: getComputedStyle(document.querySelector('.funkplan-no-print')!).display,
    };
  });
  expect(lage.werkzeuge, 'Werkzeugzeile im Druck aus').toBe('none');
  expect(lage.ueberhang, `nichts im Bildlauf verborgen (${lage.ueberhang}px)`).toBeLessThanOrEqual(
    1,
  );
  expect(
    lage.letzteRechts,
    `letzte Spalte in der Druckwurzel (Zelle ${lage.letzteRechts}px, Wurzel ${lage.wurzelRechts}px)`,
  ).toBeLessThanOrEqual(lage.wurzelRechts + SUBPIXEL);
  await page.emulateMedia({ media: null });
});

test('Sprechgruppen im Druck bei A4-Breite: Druckkopf, Bedienung aus, nichts ragt heraus', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Sprechgruppen Druck ${Date.now()}`);
  await seedeSprechgruppen(page, einsatzId);
  await page.setViewportSize({ width: A4_DRUCKBREITE, height: 900 });
  await page.goto(`/einsaetze/${einsatzId}/stab/funkplan?ansicht=sprechgruppen`);
  await expect(sgZeile(page, SG_LANG).getByRole('link', { name: EINHEIT_ZWEI })).toBeVisible();

  await page.evaluate(() => {
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
    };
  });
  await page.getByRole('button', { name: 'Drucken / als PDF' }).click();
  await page.emulateMedia({ media: 'print' });

  const lage = await page.evaluate(() => {
    const wurzel = document.querySelector('.funkplan-print-root')!.getBoundingClientRect();
    const sicht = document.querySelector('[aria-label="Sprechgruppen"]')!;
    const koerper = (sicht.querySelector('.ant-table-body') ??
      sicht.querySelector('.ant-table-content'))!;
    const zellen = Array.from(sicht.querySelectorAll('tr.ant-table-row > td')) as HTMLElement[];
    return {
      wurzelRechts: wurzel.right,
      zellenRechts: Math.max(...zellen.map((z) => z.getBoundingClientRect().right)),
      ueberhang: koerper.scrollWidth - koerper.clientWidth,
      werkzeuge: getComputedStyle(document.querySelector('.funkplan-no-print')!).display,
      umschalterKaesten: document
        .querySelector('[role="radiogroup"][aria-label="Darstellung"]')!
        .getClientRects().length,
      kopf: document.querySelector('[data-lfh="druckkopf"]')!.textContent!,
    };
  });
  expect(lage.werkzeuge, 'Werkzeugzeile im Druck aus').toBe('none');
  expect(lage.umschalterKaesten, 'Umschalter im Druck aus').toBe(0);
  expect(lage.kopf, 'Druckkopf nennt die Darstellung').toContain('Funkplan – Sprechgruppen');
  expect(lage.ueberhang, `nichts im Bildlauf verborgen (${lage.ueberhang}px)`).toBeLessThanOrEqual(
    1,
  );
  expect(
    lage.zellenRechts,
    `keine Zelle über der Druckwurzel (Zelle ${lage.zellenRechts}px, Wurzel ${lage.wurzelRechts}px)`,
  ).toBeLessThanOrEqual(lage.wurzelRechts + SUBPIXEL);
  await page.emulateMedia({ media: null });
});
