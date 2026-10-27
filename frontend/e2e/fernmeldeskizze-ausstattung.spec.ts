import { expect, test, type Locator, type Page } from '@playwright/test';
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
import { waehleIn } from './auswahl-kern';
import { einsatzdatenPfad } from '../src/routing/deeplinks';
import {
  hinterlegteZeichen,
  messzeile,
  mitHinterlegung,
  unterDrei,
  zeichenKontraste,
} from './zeichen-kontrast-kern';

/**
 * Führungsmittel und Funktionen im Führungsstellen-Kasten (LFH-1029, Spec `stab-fernmeldeskizze`,
 * „Führungsmittel und Funktionen im Kasten“): was nur der Browser zeigt. jsdom rechnet keine
 * Laufweite und keinen Druckmaßstab.
 *
 * - KASTEN: „EAL“ und „ELW 1“ stehen im Kasten des Abschnitts, „S2“ und „S3“ im Kasten
 *   „Einsatzleitung“, das rückwärtige „S6“ nicht; kein Personenname. Jedes Wort liegt im Kasten,
 *   am Schirm und im Druck A4 quer.
 * - FÜHRUNGSSTELLE (LFH-1106): ein auf Einsatzdaten der Führungsstelle zugeordneter ELW 2 steht
 *   im Kasten „Einsatzleitung“ und nicht im Kasten seines Abschnitts.
 * - MESSUNG: Höhe der Wörter im Druck A4 und A3 quer bei acht obersten Abschnitten,
 *   als Annotation, gegen den Rufnamen desselben Kastens.
 *
 * - ZEICHENKONTRAST (LFH-1107, LLH-1409): jedes taktische Zeichen der Skizze, Stelle wie
 *   Ausstattung, hält am Schirm in beiden Modi ≥ 3 : 1 (WCAG 1.4.11). Nachts zeichnet die
 *   Bibliothek es mit dem Render-Theme `dark` selbst hell: die Kontur hält gegen ihre
 *   Hinterlegung, die Hinterlegung gegen den Grund (Kasten oder Fläche), ohne Quadrat dahinter.
 *   Am Tag und im Druck kein Theme. Messkern `zeichen-kontrast-kern.ts`.
 *
 * Mutationsprobe: `ausstattungsZeilen(...).hoehe` in `stellenMasse` weg → der Kasten wächst nicht,
 * die Wörter ragen unten heraus, rot. Das Theme in `SkizzenFlaeche` weg (`tzTheme` immer
 * `undefined`) → im Modus `dark` fehlt die Hinterlegung, und der schwarze Umriss von „1. Zug“ und
 * „ELW 1“ hält auf `flaeche` nur rund 1,1 : 1, rot. Das Theme auch im Druck → Druckprobe rot.
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

test('Führungsstelle: der auf Einsatzdaten zugeordnete ELW 2 steht im Kasten „Einsatzleitung“, nicht im Abschnitt', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzAnlegen(page, `E2E Skizze Führungsstelle ${Date.now()}`);
  const n = await seedeAusstattung(page, einsatzId);
  const a = api(page, einsatzId);
  // Am Zug des Abschnitts: ohne Zuordnung stünde er im Kasten des Abschnitts.
  const elw2 = (
    await a.post('fahrzeuge', {
      adhoc: { funkrufname: 'Florian Musterstadt 10/1', fahrzeugtyp: 'ELW 2' },
    })
  ).id;
  await a.put(`einheiten/${n.zug}/fahrzeug/${elw2}`);

  await page.goto(einsatzdatenPfad(Number(einsatzId)));
  const paneel = page.getByRole('region', { name: 'Eigene Führungsstelle' });
  await paneel.getByRole('button', { name: 'Fahrzeuge eintragen' }).click();
  await waehleIn(
    paneel.getByRole('combobox', { name: 'Fahrzeuge' }),
    'Florian Musterstadt 10/1 (ELW 2)',
  );
  await paneel.getByRole('button', { name: 'Fahrzeuge speichern' }).click();
  await expect(
    paneel.getByRole('button', { name: 'Fahrzeuge bearbeiten' }),
  ).toHaveAccessibleDescription('Florian Musterstadt 10/1 (ELW 2)');

  await oeffneSkizze(
    page,
    einsatzId,
    page.locator(`[data-lfh="skizze-flaeche"] [data-ausstattung="fz-${elw2}"]`),
  );
  const anFs = await ausstattungImKasten(page, 'fs');
  expect(anFs.map((x) => x.wort)).toEqual(['S2', 'S3', 'ELW 2']);
  for (const x of anFs) expect(x.innen, `${x.schluessel} im Kasten`).toBe(true);
  const amAbschnitt = await ausstattungImKasten(page, `ab-${n.ea[0]}`);
  expect(amAbschnitt.map((x) => x.wort)).toEqual(['EAL', 'ELW 1']);
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

/** Die taktischen Zeichen der Fläche: Stelle (`data-teil="tz"`) und Ausstattung. */
const skizzenZeichen = (flaeche: Locator) =>
  flaeche.locator('[data-teil="tz"] svg, [data-ausstattung] svg');

for (const modus of ['dark', 'light'] as const) {
  test(`Zeichenkontrast: jedes taktische Zeichen hält am Schirm im Modus ${modus} 3 : 1, nachts über das Theme \`dark\`, im Druck ohne`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(FUEKW);
    await anmeldenAls(page, ADMIN, ADMIN_PW);
    const einsatzId = await einsatzAnlegen(
      page,
      `E2E Skizze Zeichenkontrast ${modus} ${Date.now()}`,
    );
    const n = await seedeAusstattung(page, einsatzId);
    await page.evaluate((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
    await oeffneSkizze(
      page,
      einsatzId,
      element(page, `ab-${n.ea[0]}`).locator(`[data-ausstattung="fz-${n.elw}"]`),
    );
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
    const flaeche = page.locator('[data-lfh="skizze-flaeche"]');

    const werte = await zeichenKontraste(skizzenZeichen(flaeche));
    await flaeche.screenshot({ path: test.info().outputPath(`zeichen-${modus}.png`) });
    // Ohne Organisation: die Einheit „1. Zug“ und das Fahrzeugzeichen des ELW 1.
    expect(werte.map((w) => w.name)).toEqual(
      expect.arrayContaining(['fs', `eh-${n.zug}`, `ab-${n.ea[0]}/fz-${n.elw}`, 'fs/s2']),
    );
    test
      .info()
      .annotations.push({ type: 'messwert', description: `${modus}: ${messzeile(werte)}` });
    // Vorbedingung: nachts trägt jedes Zeichen das Theme `dark`, am Tag keins.
    expect(
      mitHinterlegung(werte, modus !== 'dark'),
      `Theme ${modus === 'dark' ? 'fehlt' : 'am Tag'}`,
    ).toEqual([]);
    expect(unterDrei(werte), `unter 3 : 1 (${modus})`).toEqual([]);

    await drucke(page);
    expect(await hinterlegteZeichen(skizzenZeichen(flaeche)), 'Zeichen mit Theme im Druck').toBe(0);
    await page.emulateMedia({ media: null });
  });
}
