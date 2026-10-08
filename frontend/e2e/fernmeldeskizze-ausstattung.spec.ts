import { expect, test, type Page } from '@playwright/test';
import {
  api,
  drucke,
  einsatzAnlegen,
  element,
  oeffneSkizze,
  seedeGrund,
} from './fernmeldeskizze-kern';
import { NAME_SCHRIFT } from '../src/stab/fernmeldeskizzeLayout';
import { ADMIN, ADMIN_PW, anmeldenAls } from './rollen-kern';

/**
 * Führungsmittel und Funktionen im Führungsstellen-Kasten (LFH-1029, Spec `stab-fernmeldeskizze`,
 * „Führungsmittel und Funktionen im Kasten“): was nur der Browser zeigt. jsdom rechnet keine
 * Laufweite und keinen Druckmaßstab.
 *
 * - KASTEN: „EAL“ und „ELW 1“ stehen im Kasten des Abschnitts, „S2“ und „S3“ im Kasten
 *   „Einsatzleitung“, das rückwärtige „S6“ nicht; kein Personenname. Jedes Wort liegt im Kasten,
 *   am Schirm und im Druck A4 quer.
 * - MESSUNG: Höhe der Wörter im Druck A4 und A3 quer bei acht obersten Abschnitten,
 *   als Annotation, gegen den Rufnamen desselben Kastens.
 *
 * Mutationsprobe: `ausstattungsZeilen(...).hoehe` in `stellenMasse` weg → der Kasten wächst nicht,
 * die Wörter ragen unten heraus, rot.
 */

const FUEKW = { width: 1366, height: 768 };
const LEITUNG = 'Erika Muster';
const S2_NAME = 'Max Lagemann';

/** Grundnetz, dazu Leitung und ELW 1 für „Einsatzabschnitt Nord“ und eine Stab-Besetzung. */
async function seedeAusstattung(page: Page, einsatzId: string) {
  const n = await seedeGrund(page, einsatzId);
  const a = api(page, einsatzId);
  const leitung = (await a.post('personal', { adhoc: { name: LEITUNG } })).id;
  await a.patch(`abschnitte/${n.ea[0]}`, { leiter_id: leitung });
  const elw = (
    await a.post('fahrzeuge', {
      adhoc: { funkrufname: 'Florian Musterstadt 11/1', fahrzeugtyp: 'ELW 1' },
    })
  ).id;
  await a.put(`einheiten/${n.zug}/fahrzeug/${elw}`);
  const s2 = (await a.post('personal', { adhoc: { name: S2_NAME } })).id;
  await a.put('stab/besetzung/s2', { besetzung_art: 'personal', personal_id: s2 });
  await a.put('stab/besetzung/s3', { besetzung_art: 'einsatzleitung' });
  await a.put('stab/besetzung/s6', { besetzung_art: 'rueckwaertig', bezeichnung: 'ILS' });
  return { ...n, elw };
}

/**
 * Je Ausstattung des Kastens: Schlüssel, Wort, ob es ganz im Kasten liegt, und die Schriftgrade
 * von Wort und Rufname auf dem Papier (CSS-px).
 */
async function ausstattungImKasten(page: Page, key: string) {
  return element(page, key)
    .or(page.locator(`[data-lfh="skizze-flaeche"] g[data-key="${key}"]`))
    .first()
    .evaluate((g, nameSchrift) => {
      const kasten = g.querySelector('[data-teil="kasten"]')!.getBoundingClientRect();
      // Vergleich: der Rufname desselben Kastens (Schrift `NAME_SCHRIFT`).
      const ruf = Array.from(g.querySelectorAll<SVGTextElement>('text')).find(
        (t) => !t.closest('[data-ausstattung]') && t.getAttribute('font-size') === `${nameSchrift}`,
      );
      const rufGrad = nameSchrift * (ruf?.getScreenCTM()?.a ?? 0);
      return Array.from(g.querySelectorAll('[data-ausstattung]')).map((a) => {
        const r = a.getBoundingClientRect();
        const wort = a.querySelector<SVGTextElement>(':scope > text')!;
        return {
          schluessel: a.getAttribute('data-ausstattung'),
          wort: wort.textContent,
          innen:
            r.left >= kasten.left - 0.5 &&
            r.right <= kasten.right + 0.5 &&
            r.top >= kasten.top - 0.5 &&
            r.bottom <= kasten.bottom + 0.5,
          // Schriftgrad auf dem Papier in CSS-px: Grad in Einheiten mal Maßstab der Fläche.
          wortGrad: Number(wort.getAttribute('font-size')) * (wort.getScreenCTM()?.a ?? 0),
          rufGrad,
        };
      });
    }, NAME_SCHRIFT);
}

test('Kasten: EAL und ELW 1 am Abschnitt, S2 und S3 an der Einsatzleitung, kein Name — am Schirm und im Druck', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzAnlegen(page, `E2E Skizze Ausstattung ${Date.now()}`);
  const n = await seedeAusstattung(page, einsatzId);
  const ab = `ab-${n.ea[0]}`;
  await oeffneSkizze(
    page,
    einsatzId,
    element(page, ab).locator(`[data-ausstattung="fz-${n.elw}"]`),
  );

  const amAbschnitt = await ausstattungImKasten(page, ab);
  expect(amAbschnitt.map((x) => x.wort)).toEqual(['EAL', 'ELW 1']);
  const anFs = await ausstattungImKasten(page, 'fs');
  expect(anFs.map((x) => x.wort)).toEqual(['S2', 'S3']);
  for (const x of [...amAbschnitt, ...anFs])
    expect(x.innen, `${x.schluessel} im Kasten`).toBe(true);
  const flaeche = page.locator('[data-lfh="skizze-flaeche"]');
  await expect(flaeche).not.toContainText(LEITUNG);
  await expect(flaeche).not.toContainText(S2_NAME);
  await flaeche.screenshot({ path: test.info().outputPath('ausstattung-schirm.png') });

  const papier = page.getByRole('radiogroup', { name: 'Papierformat' });
  await papier.getByRole('radio', { name: 'A4 quer' }).click();
  await drucke(page);
  const imDruck = await ausstattungImKasten(page, ab);
  expect(imDruck.map((x) => x.wort)).toEqual(['EAL', 'ELW 1']);
  for (const x of imDruck) expect(x.innen, `Druck: ${x.schluessel} im Kasten`).toBe(true);
  await page.emulateMedia({ media: null });
});

test('Messung: Schriftgrad der Ausstattung im Druck A4 und A3 quer bei acht obersten Abschnitten', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize(FUEKW);
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzAnlegen(page, `E2E Skizze Ausstattung Messung ${Date.now()}`);
  const a = api(page, einsatzId);
  const tmo = (await a.post('sprechgruppen', { bezeichnung: 'BN_BOS', betriebsart: 'TMO' })).id;
  await a.patch('fuehrungsstelle', {
    rufname: 'Florian Musterstadt 10/1',
    sprechgruppe_ids: [tmo],
  });
  await a.put('stab/besetzung/s2', { besetzung_art: 'einsatzleitung' });
  let erstes = 0;
  for (let i = 1; i <= 8; i++) {
    const leitung = (await a.post('personal', { adhoc: { name: `Leitung ${i}` } })).id;
    const ab = (
      await a.post('abschnitte', {
        name: `Einsatzabschnitt ${i} Nordwest`,
        kurzbezeichnung: `EA ${i}`,
        leiter_id: leitung,
        sprechgruppe_ids: [tmo],
      })
    ).id;
    erstes ||= ab;
    for (let j = 1; j <= 3; j++) {
      const eh = (
        await a.post('einheiten', {
          name: `Einheit ${i}.${j}`,
          funkrufname: `Florian ${i}/${j}`,
          abschnitt_id: ab,
          sprechgruppe_ids: [tmo],
        })
      ).id;
      if (j === 1) {
        const fz = (
          await a.post('fahrzeuge', {
            adhoc: { funkrufname: `Florian ${i}/11`, fahrzeugtyp: 'ELW 1' },
          })
        ).id;
        await a.put(`einheiten/${eh}/fahrzeug/${fz}`);
      }
    }
  }
  await oeffneSkizze(
    page,
    einsatzId,
    element(page, `ab-${erstes}`).locator('[data-ausstattung="eal"]'),
  );
  const papier = page.getByRole('radiogroup', { name: 'Papierformat' });
  const messwerte: string[] = [];
  for (const format of ['A4 quer', 'A3 quer'] as const) {
    await papier.getByRole('radio', { name: format }).click();
    await drucke(page);
    const imDruck = await ausstattungImKasten(page, `ab-${erstes}`);
    expect(imDruck.map((x) => x.wort)).toEqual(['EAL', 'ELW 1']);
    for (const x of imDruck) expect(x.innen, `${format}: ${x.schluessel} im Kasten`).toBe(true);
    const pt = (px: number) => `${((px * 72) / 96).toFixed(1)} pt`;
    const wort = Math.min(...imDruck.map((x) => x.wortGrad));
    messwerte.push(`${format}: Wort ${pt(wort)}, Rufname ${pt(imDruck[0].rufGrad)}`);
    await page.emulateMedia({ media: null });
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  }
  test.info().annotations.push({
    type: 'messwert',
    description: `8 × 3, Schriftgrad im Druck: ${messwerte.join('; ')}`,
  });
  await page.emulateMedia({ media: null });
});
