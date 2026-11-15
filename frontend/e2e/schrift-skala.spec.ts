import { expect, test } from '@playwright/test';
import { anmelden, FUEKW } from './trefflaeche-kern';
import {
  einsatzMitEtb,
  erlaubteGroessen,
  FAKTOR,
  ladeSeite,
  textproben,
  type Textprobe,
} from './schrift-kern';

/**
 * Die Schriftskala am gerenderten Schirm (LLH-1773/LLH-1774/LLH-1775, Spec `schriftskala`).
 *
 * GEPRÜFT auf Überblick, Einsatzdaten, ETB, Betroffene und Lagekarte am Fükw-Schirm:
 * - in `kompakt` steht jeder sichtbare Textknoten in 11, 12, 14, 16, 22 oder 32 px, keiner
 *   darunter; der Seitentitel misst 16 px, der Lauftext der App 14 px;
 * - in `komfortabel` und `handschuh` stehen nur die Stufen mal Faktor (Datenwerte fest), und
 *   Seitentitel und Knopfbeschriftung sind das 1,15- bzw. 1,25-Fache;
 * - der Anteil der Zeichen unter 12 px ist in `komfortabel` und `handschuh` nicht größer als in
 *   `kompakt` (vorher stieg er mit der Stufe: 26,7 / 31,7 / 33,9 %).
 *
 * Mutationsproben: `fontSize: 13` an einer Stelle des Überblicks → rot („13“ ist keine Stufe);
 * `--lfh-schrift-faktor: 1.15` aus `rollen.css` entfernt → rot in `komfortabel`.
 */

const SEITEN = [
  { name: 'Überblick', pfad: '' },
  { name: 'Einsatzdaten', pfad: '/einsatzdaten' },
  { name: 'ETB', pfad: '/etb' },
  { name: 'Betroffene', pfad: '/personen' },
  { name: 'Lagekarte', pfad: '/lagekarte' },
] as const;

const KOPF = '[data-lfh="seitenkopf"]';

function fremdeGroessen(proben: Textprobe[], erlaubt: number[]): string[] {
  return [
    ...new Set(
      proben
        .filter((p) => !erlaubt.some((g) => Math.abs(g - p.groesse) <= 0.05))
        .map((p) => `${p.groesse}px „${p.text}“`),
    ),
  ];
}

function anteilUnter12(proben: Textprobe[]): number {
  const gesamt = proben.reduce((n, p) => n + p.zeichen, 0);
  const klein = proben.filter((p) => p.groesse < 11.95).reduce((n, p) => n + p.zeichen, 0);
  return gesamt === 0 ? 0 : klein / gesamt;
}

test('Schriftskala: nur sechs Stufen, Boden 11 px, wächst mit der Dichte', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page, { startseite: false });
  const id = await einsatzMitEtb(page, `E2E Schriftskala ${Date.now()}`);

  const anteil: Record<string, number> = {};
  for (const dichte of ['kompakt', 'komfortabel', 'handschuh']) {
    const alle: Textprobe[] = [];
    const erlaubt = erlaubteGroessen(dichte);
    for (const seite of SEITEN) {
      await ladeSeite(page, `/einsaetze/${id}${seite.pfad}`, dichte, KOPF);
      await expect
        .poll(async () => fremdeGroessen(await textproben(page), erlaubt), {
          message: `${seite.name} in ${dichte}: Größen außerhalb der Skala`,
        })
        .toEqual([]);
      alle.push(...(await textproben(page)));

      if (seite.name === 'Überblick') {
        const titel = page.locator(`${KOPF} h1`).first();
        await expect(titel).toHaveCSS('font-size', `${16 * FAKTOR[dichte]}px`);
        await expect(page.locator('.ant-app').first()).toHaveCSS(
          'font-size',
          `${Math.round(14 * FAKTOR[dichte] * 100) / 100}px`,
        );
      }
    }
    expect(
      Math.min(...alle.map((p) => p.groesse)),
      `${dichte}: kein Text unter 11 px`,
    ).toBeGreaterThanOrEqual(11);
    anteil[dichte] = anteilUnter12(alle);
  }
  expect(anteil.komfortabel, JSON.stringify(anteil)).toBeLessThanOrEqual(anteil.kompakt);
  expect(anteil.handschuh, JSON.stringify(anteil)).toBeLessThanOrEqual(anteil.kompakt);
});
