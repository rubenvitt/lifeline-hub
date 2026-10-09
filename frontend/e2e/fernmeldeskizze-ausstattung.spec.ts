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
 * - ZEICHENKONTRAST (LFH-1107): jedes taktische Zeichen der Skizze, Stelle wie Ausstattung, hält am
 *   Schirm in beiden Modi mit seinem Umriss ≥ 3 : 1 gegen den Grund, auf dem es steht (WCAG 1.4.11);
 *   im Druck steht keine Unterlage.
 *
 * Mutationsprobe: `ausstattungsZeilen(...).hoehe` in `stellenMasse` weg → der Kasten wächst nicht,
 * die Wörter ragen unten heraus, rot. Die Unterlage (`ZeichenUnterlage`) weg → im Modus `dark`
 * hält der schwarze Umriss von „1. Zug“ und „ELW 1“ auf `flaeche` nur rund 1,1 : 1, rot.
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

/**
 * Je taktischem Zeichen der Fläche (Stelle `data-teil="tz"`, Ausstattung `data-ausstattung`): der
 * schwächste Umriss gegen den Grund, auf dem das Zeichen steht. Umriss sind alle Striche des
 * Zeichens (`stroke`), Füllungen und Schrift im Körper zählen nicht, sie stehen auf dem Körper.
 * Grund ist von oben nach unten das Erste, das unter dem Zeichen gemalt ist: die Unterlage direkt
 * davor, sonst die Fläche des Kastens, sonst die komponierte HTML-Fläche unter der Skizze.
 * Deckkraft ist nicht modelliert und ein Fehler (gemessen wird ohne Zurücktreten).
 */
async function zeichenUmrisse(flaeche: Locator) {
  await expect(flaeche.locator('[data-teil="tz"] svg').first()).toBeVisible();
  return flaeche.evaluate((wurzel) => {
    type F = [number, number, number, number];
    function rgb(wert: string): F {
      const m = /^rgba?\(([^)]+)\)$/.exec(wert);
      if (!m) throw new Error(`Nicht unterstützte Farbe: ${wert}`);
      const t = m[1].split(/[\s,/]+/).map(Number);
      return [t[0], t[1], t[2], t[3] ?? 1];
    }
    function darueber(vorne: F, hinten: F): F {
      const a = vorne[3] + hinten[3] * (1 - vorne[3]);
      if (a === 0) return [0, 0, 0, 0];
      return [0, 1, 2]
        .map((i) => (vorne[i] * vorne[3] + hinten[i] * hinten[3] * (1 - vorne[3])) / a)
        .concat(a) as F;
    }
    function luminanz(f: F) {
      const l = f.slice(0, 3).map((n) => {
        const s = n / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return l[0] * 0.2126 + l[1] * 0.7152 + l[2] * 0.0722;
    }
    const verhaeltnis = (a: F, b: F) => {
      const [x, y] = [luminanz(a), luminanz(b)].sort((p, q) => p - q);
      return (y + 0.05) / (x + 0.05);
    };
    const flaecheSvg = wurzel.querySelector('svg')!;
    let html: F = [0, 0, 0, 0];
    const vorfahren: Element[] = [];
    for (let e: Element | null = flaecheSvg.parentElement; e; e = e.parentElement)
      vorfahren.push(e);
    for (const e of vorfahren.reverse()) {
      const stil = getComputedStyle(e);
      if (stil.backgroundImage !== 'none' || Number(stil.opacity) !== 1)
        throw new Error(`Nicht unterstützte Komposition an ${e.tagName}`);
      html = darueber(rgb(stil.backgroundColor), html);
    }
    if (html[3] !== 1) throw new Error('Kein opaker Hintergrund belegt');
    const sichtbar = (e: Element | null): e is SVGGraphicsElement =>
      !!e && getComputedStyle(e).display !== 'none';
    const zeichen = Array.from(
      wurzel.querySelectorAll<SVGSVGElement>('[data-teil="tz"] svg, [data-ausstattung] svg'),
    );
    return zeichen.map((svg) => {
      for (let e: Element | null = svg; e && e !== flaecheSvg; e = e.parentElement)
        if (Number(getComputedStyle(e).opacity) !== 1) throw new Error('Deckkraft am Zeichen');
      const element = svg.closest('[data-lfh="skizze-element"]')!;
      const unterlage = svg.previousElementSibling?.matches('[data-teil="zeichen-grund"]')
        ? svg.previousElementSibling
        : null;
      const kasten = element.querySelector('[data-teil="kasten"]');
      const grundElement = sichtbar(unterlage) ? unterlage : sichtbar(kasten) ? kasten : null;
      const grund = grundElement ? darueber(rgb(getComputedStyle(grundElement).fill), html) : html;
      const striche = Array.from(svg.querySelectorAll('*'))
        .map((e) => getComputedStyle(e))
        .filter((s) => s.stroke !== 'none' && parseFloat(s.strokeWidth) > 0)
        .map((s) => darueber(rgb(s.stroke), grund));
      if (striche.length === 0) throw new Error('Zeichen ohne Umriss');
      const ausstattung = svg.closest('[data-ausstattung]');
      return {
        name: ausstattung
          ? `${element.getAttribute('data-key')}/${ausstattung.getAttribute('data-ausstattung')}`
          : element.getAttribute('data-key')!,
        grund: grundElement ? (grundElement === unterlage ? 'Unterlage' : 'Kasten') : 'Fläche',
        verhaeltnis: Math.min(...striche.map((f) => verhaeltnis(f, grund))),
      };
    });
  });
}

for (const modus of ['dark', 'light'] as const) {
  test(`Zeichenkontrast: jedes taktische Zeichen hält am Schirm im Modus ${modus} 3 : 1 gegen seinen Grund, im Druck ohne Unterlage`, async ({
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

    const umrisse = await zeichenUmrisse(flaeche);
    await flaeche.screenshot({ path: test.info().outputPath(`zeichen-${modus}.png`) });
    // Ohne Organisation: die Einheit „1. Zug“ und das Fahrzeugzeichen des ELW 1.
    expect(umrisse.map((u) => u.name)).toEqual(
      expect.arrayContaining(['fs', `eh-${n.zug}`, `ab-${n.ea[0]}/fz-${n.elw}`, 'fs/s2']),
    );
    test.info().annotations.push({
      type: 'messwert',
      description: `${modus}: ${umrisse.map((u) => `${u.name} ${u.verhaeltnis.toFixed(2)} (${u.grund})`).join(' · ')}`,
    });
    expect(
      umrisse.filter((u) => u.verhaeltnis < 3).map((u) => `${u.name}: ${u.verhaeltnis.toFixed(2)}`),
      `Umriss unter 3 : 1 (${modus})`,
    ).toEqual([]);

    await drucke(page);
    await expect(flaeche.locator('[data-teil="zeichen-grund"]')).toHaveCount(0);
    await page.emulateMedia({ media: null });
  });
}
