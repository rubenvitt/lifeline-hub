import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import {
  FS_RUF,
  api,
  einsatzAnlegen,
  element,
  flaeche,
  flaecheInsBild,
  lage,
  mitte,
  oeffneSkizze,
  paneel,
  seedeGrund,
  stiche,
  ziehe,
} from './fernmeldeskizze-kern';
import { svgTextKontrast } from './kontrast-kern';
import { ADMIN, ADMIN_PW, anmeldenAls, wechsleZuRolle } from './rollen-kern';

/**
 * Taktische Fernmeldeskizze (LFH-893): die Nachweise, die NUR im Browser gehen. jsdom rechnet kein
 * Layout, keine SVG-Laufweite, kein Ziehen über echte Zeigerereignisse und keinen zweiten Client.
 * Ersetzt die Skizzen-Tests von `funkplan.spec.ts` (LFH-625: Klappen, Baum, Kante, Schleuse).
 *
 * - MESSUNG (Aufgabe 1.1, geht hier auf): Fläche, Maßstab und Laufweiten bei 1366 (Panel offen),
 *   1024, 768 und 390 px mit 8 × 3; kein Text ragt aus seinem Platz, die Seite läuft nicht über.
 *   Die Werte stehen in design.md D4 (Nachtrag 1.1) und als Annotation am Test.
 * - SAMMELSCHIENE: eine Linie je Sprechgruppe, vier Stellen per Stichleitung daran.
 * - ZIEHEN mit zweitem Kontext: Einheit auf die Schiene, Tabelle und Detailseite folgen ohne
 *   Neuladen; Strg+Z nimmt die Zuordnung zurück, auch dort.
 * - TASTATUR: Zuordnen nur über „Verbinden mit …“, ohne ein einziges Zeigerereignis.
 * - LEITSTELLE: anlegen, in den rückwärtigen Bereich ziehen, über „TMO SL AS“ an die
 *   Führungsstelle binden; sie steht im Kommunikationsplan, kein Abschnitt, keine Einheit kommt
 *   hinzu.
 * - GEPLANT: Strichmuster UND Wort, an Verbindung und Stichleitung, am Schirm und im Druck.
 * - LÜCKEN: Zahl im Bild = Zahl im Paneel; ein Klick auf die Lücke wählt das Element.
 * - WURZEL: ohne Führungsstelle keine erfundene Einsatzleitung.
 * - LAGE: bleibt über Neuladen; „Neu anordnen“ stellt das Auto-Layout her, Zuordnungen bleiben.
 * - GLEICHZEITIG: zwei Kontexte verschieben dasselbe Element — Meldung statt stillem
 *   Überschreiben (409).
 * - RUHIGE FLÄCHE (ersetzt die Schleuse, LFH-867): unter dem Zeiger springt nichts.
 * - RECHTE: Beobachter liest (Hervorheben und Zoom gehen); Stab-Schreibrecht ohne Einheiten;
 *   390 px nur lesen.
 * - PRÜFLISTE 1 und 5: Trefffläche der eingepassten großen Skizze am Fükw, Kontrast
 *   zurückgenommener Texte (Boden 4,5 : 1).
 *
 * Druck (Format, Umbruch, Graustufen): `fernmeldeskizze-druck.spec.ts`.
 *
 * Mutationsproben (Prüfliste): `rufnamenHoehe` in `stab/fernmeldeskizzeLayout.ts` auf eine
 * feste Zeile → die Messung wird rot (Text unter dem Platz); `STRICHMUSTER_GEPLANT` weg → der
 * Geplant-Test wird rot; `istSchmal` in der Rechteweiche weg → der 390-px-Test wird rot.
 */

const FUEKW = { width: 1366, height: 768 };
const HANDSCHIRM = { width: 390, height: 844 };
const SUBPIXEL = 0.5;
/** Prüfliste Kriterium 1: Ziel ≥ 24 × 24 CSS-px oder ein freier Kreis von 24 px. */
const ZIEL_MIN = 24;
/** Prüfliste Kriterium 5: zurückgenommener Text nie unter 4,5 : 1. */
const TEXT_BODEN = 4.5;

// ── Messung 1.1 ────────────────────────────────────────────────────────────────────────────

const LANG_SG = 'BN_BOS_LANGNAME_40';
const LANG_RUF = 'Florian Musterstadt-Nord 12/34';
const LANG_NAME = 'Fachgruppe Wasserschaden/Pumpen Ortsverband Musterstadt-Nordwest';

/** Spec „Viele Abschnitte am Fükw“: acht oberste Abschnitte mit je drei Einheiten an je zwei Gruppen. */
async function seedeGross(page: Page, einsatzId: string) {
  const a = api(page, einsatzId);
  const tmo = (await a.post('sprechgruppen', { bezeichnung: LANG_SG, betriebsart: 'TMO' })).id;
  const dmo = (await a.post('sprechgruppen', { bezeichnung: '314_F*', betriebsart: 'DMO' })).id;
  await a.patch('fuehrungsstelle', { rufname: FS_RUF, sprechgruppe_ids: [tmo] });
  for (let i = 1; i <= 8; i++) {
    const ab = (
      await a.post('abschnitte', {
        name: `Einsatzabschnitt ${i} Nordwest`,
        kurzbezeichnung: `EA ${i}`,
        sprechgruppe_ids: [tmo, dmo],
      })
    ).id;
    for (let j = 1; j <= 3; j++) {
      await a.post('einheiten', {
        name: i === 2 && j === 1 ? LANG_NAME : `Einheit ${i}.${j}`,
        funkrufname: i === 1 && j === 1 ? LANG_RUF : `Florian ${i}/${j}`,
        abschnitt_id: ab,
        sprechgruppe_ids: [tmo, dmo],
      });
    }
  }
  return { tmo, dmo };
}

const MESSGROESSEN = [
  { name: 'Fükw', width: 1366, height: 768 },
  { name: 'Tablet quer', width: 1024, height: 768 },
  { name: 'Tablet hoch', width: 768, height: 1024 },
  { name: 'Handschirm', width: 390, height: 844 },
] as const;

test('Messung 1.1: 8 × 3 eingepasst bei 1366/1024/768/390 px, kein Text ragt aus seinem Platz', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize(FUEKW);
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzAnlegen(page, `E2E Skizze Messung ${Date.now()}`);
  await seedeGross(page, einsatzId);
  for (const g of MESSGROESSEN) {
    await page.setViewportSize({ width: g.width, height: g.height });
    await oeffneSkizze(
      page,
      einsatzId,
      flaeche(page).getByRole('button', { name: /^Einheit Einheit 8\.3/ }),
    );
    if (g.width === FUEKW.width) {
      await expect(page.locator('[data-lfh="modul-panel"]'), 'Panel offen am Fükw').toBeVisible();
    }
    const m = await page.evaluate(
      async ({ sg, ruf }) => {
        await document.fonts.ready;
        const f = document.querySelector('[data-lfh="skizze-flaeche"]')!.getBoundingClientRect();
        const svg = document.querySelector('[data-lfh="skizze-flaeche"] svg') as SVGSVGElement;
        const vb = svg.viewBox.baseVal;
        const texte = Array.from(svg.querySelectorAll('text')) as SVGTextElement[];
        const lauf = (t: string) => {
          const el = texte.find((x) => x.textContent === t);
          return el ? Math.round(el.getComputedTextLength() * 10) / 10 : -1;
        };
        const einheiten = Array.from(
          document.querySelectorAll('[data-lfh="skizze-element"][data-key^="eh-"]'),
        ).map((e) => e.getBoundingClientRect());
        // Jeder Text einer Stelle liegt in ihrem Platz (erstes `rect`), waagerecht wie senkrecht.
        const ueber: string[] = [];
        for (const el of Array.from(
          document.querySelectorAll('[data-lfh="skizze-element"]'),
        ) as SVGGElement[]) {
          const key = el.dataset.key ?? '';
          if (!/^(fs|ab-|eh-|ks-|ko-)/.test(key)) continue;
          const platz = (el.querySelector(':scope > rect') as SVGRectElement).getBBox();
          for (const t of Array.from(
            el.querySelectorAll('[data-teil="stelle"] text'),
          ) as SVGTextElement[]) {
            // Lücken- und Meldungszeilen stehen bewusst unter bzw. neben dem Platz (D4).
            if (t.closest('[data-teil="luecke"]')) continue;
            const b = t.getBBox();
            if (
              b.x < platz.x - 0.5 ||
              b.x + b.width > platz.x + platz.width + 0.5 ||
              b.y < platz.y - 0.5 ||
              b.y + b.height > platz.y + platz.height + 0.5
            ) {
              ueber.push(
                `${key} „${t.textContent}“ ${Math.round(b.width)}×${Math.round(b.height)} in ${Math.round(platz.width)}×${Math.round(platz.height)}`,
              );
            }
          }
        }
        return {
          ueber,
          flaeche: `${Math.round(f.width)}×${Math.round(f.height)}`,
          viewBox: `${Math.round(vb.width)}×${Math.round(vb.height)}`,
          skala: Math.round(Math.min(f.width / vb.width, f.height / vb.height) * 1000) / 1000,
          sg: lauf(`TMO ${sg}`),
          ruf:
            Math.round(
              texte
                .filter((x) => x.textContent?.replace(/\s+/g, '') === ruf.replace(/\s+/g, ''))
                .reduce((s, x) => Math.max(s, x.getBBox().width), 0) * 10,
            ) / 10,
          einheitMin: `${Math.round(Math.min(...einheiten.map((r) => r.width)))}×${Math.round(Math.min(...einheiten.map((r) => r.height)))}`,
          seite: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      },
      { sg: LANG_SG, ruf: LANG_RUF },
    );
    test.info().annotations.push({
      type: 'messwert',
      description: `${g.name} ${g.width}: Fläche ${m.flaeche} px, viewBox ${m.viewBox}, Maßstab ${m.skala}, „TMO ${LANG_SG}“ ${m.sg} Einheiten, Rufname (30 Zeichen, umgebrochen) ${m.ruf} Einheiten breit, kleinste Einheit ${m.einheitMin} px`,
    });
    expect(m.seite, `${g.width}px: Seite ohne waagerechten Überhang`).toBeLessThanOrEqual(SUBPIXEL);
    expect(m.ueber, `${g.width}px: Text ragt aus seinem Platz`).toEqual([]);
    expect(m.ruf, 'der lange Rufname steht ganz im Bild').toBeGreaterThan(0);
  }
});

// ── Sammelschiene ──────────────────────────────────────────────────────────────────────────

test('Sammelschiene: eine Linie je Sprechgruppe, vier Stellen hängen per Stichleitung daran', async ({
  page,
}) => {
  await page.setViewportSize(FUEKW);
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzAnlegen(page, `E2E Skizze Schiene ${Date.now()}`);
  const n = await seedeGrund(page, einsatzId, { zug: false });
  const schiene = element(page, `sg-${n.bnBos}`);
  await oeffneSkizze(page, einsatzId, schiene);

  await expect(schiene).toHaveAttribute('aria-label', 'Sammelschiene TMO BN_BOS, 4 Teilnehmer');
  await expect(schiene.locator('line[data-teil="schiene"]'), 'genau eine Linie').toHaveCount(1);
  const anSchiene = (await stiche(page)).filter((k) => k.startsWith(`sg-${n.bnBos}~`));
  expect(anSchiene).toEqual(
    [`sg-${n.bnBos}~fs`, ...n.ea.map((id) => `sg-${n.bnBos}~ab-${id}`)].sort(),
  );
  // Jede Stichleitung endet auf der Linie der Schiene, keine Kante je Eltern-Kind-Paar.
  const linieY = Number(await schiene.locator('line[data-teil="schiene"]').getAttribute('y1'));
  for (const key of anSchiene) {
    const punkte = await element(page, key)
      .locator('[data-teil="stich-linie"]')
      .getAttribute('points');
    const ys = punkte!
      .trim()
      .split(/\s+/)
      .map((p) => Number(p.split(',')[1]));
    expect(ys, `${key} endet auf der Schiene`).toContain(linieY);
  }
  await expect(page.locator('[data-lfh="skizze-kante"]')).toHaveCount(0);

  // Wer hört mit? Die Schiene gewählt: ihre vier Stellen voll, die Schiene „314_F*“ tritt zurück.
  await schiene.click();
  await expect(schiene).toHaveAttribute('aria-pressed', 'true');
  for (const key of ['fs', ...n.ea.map((id) => `ab-${id}`)]) {
    await expect(element(page, key), `${key} bleibt voll`).not.toHaveAttribute('opacity');
  }
  await expect(element(page, `sg-${n.f314}`)).toHaveAttribute('opacity', '0.6');
});

// ── Zuordnen durch Ziehen, zweiter Kontext ─────────────────────────────────────────────────

test('Ziehen: Einheit auf die Schiene, Tabelle und Detailseite im zweiten Kontext folgen ohne Neuladen; Strg+Z nimmt zurück', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize(FUEKW);
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzAnlegen(page, `E2E Skizze Ziehen ${Date.now()}`);
  const n = await seedeGrund(page, einsatzId);

  const zweiter = await browser.newContext({ viewport: FUEKW });
  try {
    const tabelle = await zweiter.newPage();
    await anmeldenAls(tabelle, ADMIN, ADMIN_PW);
    const strom = tabelle.waitForResponse(
      (r) => r.url().endsWith(`/api/einsaetze/${einsatzId}/live`) && r.status() === 200,
    );
    await tabelle.goto(`/einsaetze/${einsatzId}/stab/funkplan`);
    await strom;
    const zeile = tabelle
      .getByRole('region', { name: 'Funkplan' })
      .locator(`tr[data-row-key="eh-${n.zug}"]`);
    await expect(zeile).toContainText('BN_BOS');
    await expect(zeile).not.toContainText('314_F*');

    const detail = await zweiter.newPage();
    const strom2 = detail.waitForResponse(
      (r) => r.url().endsWith(`/api/einsaetze/${einsatzId}/live`) && r.status() === 200,
    );
    await detail.goto(`/einsaetze/${einsatzId}/einheiten/${n.zug}`);
    await strom2;
    const funk = detail.getByTestId('funk-erreichbarkeit');
    await expect(funk).toContainText('TMO: BN_BOS');
    await expect(funk).not.toContainText('314_F*');

    const zug = element(page, `eh-${n.zug}`);
    await oeffneSkizze(page, einsatzId, zug);
    await flaecheInsBild(page);
    const linie = element(page, `sg-${n.f314}`).locator('line[data-teil="schiene"]');
    const k = (await linie.boundingBox())!;
    const zuordnung = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/einheiten/${n.zug}/sprechgruppen/${n.f314}`) &&
        r.request().method() === 'PUT',
    );
    await ziehe(page, await mitte(zug.locator(':scope > rect').first()), {
      x: k.x + k.width * 0.2,
      y: k.y + k.height / 2,
    });
    expect((await zuordnung).ok(), 'Zuordnung gespeichert').toBe(true);
    await expect(element(page, `sg-${n.f314}~eh-${n.zug}`)).toHaveCount(1);

    // Der zweite Kontext folgt ohne Neuladen.
    await expect(zeile).toContainText('314_F*');
    await expect(funk).toContainText('DMO: 314_F*');

    // Strg+Z am Element: die Zuordnung ist wieder weg, überall.
    await page.mouse.move(0, 0);
    await zug.focus();
    const loesen = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/einheiten/${n.zug}/sprechgruppen/${n.f314}`) &&
        r.request().method() === 'DELETE',
    );
    await page.keyboard.press('Control+z');
    expect((await loesen).ok(), 'Rückgängig gespeichert').toBe(true);
    await expect(element(page, `sg-${n.f314}~eh-${n.zug}`)).toHaveCount(0);
    await expect(zeile).not.toContainText('314_F*');
    await expect(funk).not.toContainText('314_F*');
    await expect(zeile).toContainText('BN_BOS');
  } finally {
    await zweiter.close();
  }
});

// ── Zuordnen mit der Tastatur ──────────────────────────────────────────────────────────────

test('Tastatur: „1. Zug“ per Tab wählen, „Verbinden mit …“ (V), „314“ suchen, Enter — ohne Zeiger zugeordnet', async ({
  page,
}) => {
  await page.setViewportSize(FUEKW);
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzAnlegen(page, `E2E Skizze Tastatur ${Date.now()}`);
  const n = await seedeGrund(page, einsatzId);
  // Jedes echte Zeigerereignis nach dem Laden zählt: der Weg muss ohne gehen.
  await page.addInitScript(() => {
    const w = window as unknown as { zeiger: number };
    w.zeiger = 0;
    for (const typ of ['pointerdown', 'mousedown', 'click', 'touchstart']) {
      window.addEventListener(
        typ,
        (e) => {
          // Ein per Taste ausgelöster `click` trägt `detail` 0; ein echter Klick nicht.
          if (e.isTrusted && (typ !== 'click' || (e as MouseEvent).detail !== 0)) w.zeiger += 1;
        },
        true,
      );
    }
  });
  const zug = element(page, `eh-${n.zug}`);
  await oeffneSkizze(page, einsatzId, zug, { zeiger: false });

  // Der Fokus kommt wie mit Tab auf die Fläche (rovingender Einstieg), dann Tab bis zum Zug.
  await flaeche(page).locator('[data-lfh="skizze-element"][tabindex="0"]').focus();
  for (let i = 0; i < 20; i++) {
    if (await zug.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(zug).toBeFocused();
  await page.keyboard.press('v');
  const dialog = page.locator('[data-lfh="skizze-verbinden-dialog"]');
  const suche = dialog.getByRole('combobox', { name: 'Sprechgruppe oder Stelle suchen' });
  await expect(suche).toBeFocused();
  await page.keyboard.type('314');
  await expect(dialog.getByRole('option').first()).toContainText('DMO 314_F*');
  const zuordnung = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/einheiten/${n.zug}/sprechgruppen/${n.f314}`) &&
      r.request().method() === 'PUT',
  );
  await page.keyboard.press('Enter');
  expect((await zuordnung).ok()).toBe(true);
  await expect(dialog).toHaveCount(0);
  await expect(element(page, `sg-${n.f314}~eh-${n.zug}`)).toHaveCount(1);
  const einheiten = await api(page, einsatzId).get<
    { id: number; sprechgruppen: { id: number }[] }[]
  >('einheiten');
  expect(einheiten.find((e) => e.id === n.zug)!.sprechgruppen.map((s) => s.id)).toContain(n.f314);
  expect(
    await page.evaluate(() => (window as unknown as { zeiger: number }).zeiger),
    'kein Zeigerereignis',
  ).toBe(0);
});

// ── Leitstelle im rückwärtigen Bereich ─────────────────────────────────────────────────────

test('Leitstelle: anlegen, in den rückwärtigen Bereich ziehen, über „TMO SL AS“ an die Führungsstelle binden — im Kommunikationsplan, kein Abschnitt, keine Einheit', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzAnlegen(page, `E2E Skizze Leitstelle ${Date.now()}`);
  const a = api(page, einsatzId);
  const slAs = (await a.post('sprechgruppen', { bezeichnung: 'SL AS', betriebsart: 'TMO' })).id;
  await a.patch('fuehrungsstelle', { rufname: FS_RUF, sprechgruppe_ids: [slAs] });
  const zaehle = async () => ({
    abschnitte: (await a.get<unknown[]>('abschnitte')).length,
    einheiten: (await a.get<unknown[]>('einheiten')).length,
  });
  const vorher = await zaehle();
  await oeffneSkizze(page, einsatzId, element(page, 'fs'));

  // Palette auf (am Fükw zu), Externe Stelle anlegen.
  const knopf = page.locator('[data-lfh="skizze-palette-knopf"]');
  if ((await knopf.getAttribute('aria-expanded')) !== 'true') await knopf.click();
  await page.locator('[data-lfh="skizze-anlegen-extern"]').click();
  const anlegen = page.getByRole('dialog', { name: 'Externe Stelle anlegen' });
  await anlegen.getByLabel('Bezeichnung').fill('ILS Musterhausen');
  await anlegen.getByRole('button', { name: 'Anlegen' }).click();
  const leitstelle = flaeche(page).getByRole('button', {
    name: /^Externe Stelle ILS Musterhausen/,
  });
  await expect(leitstelle).toBeVisible();
  const ksKey = (await leitstelle.getAttribute('data-key'))!;
  expect(ksKey).toMatch(/^ks-\d+$/);

  // Rückwärtigen Bereich anlegen (Vorgabe der Bezeichnung) und die Leitstelle hineinziehen.
  await page.locator('[data-lfh="skizze-anlegen-bereich"]').click();
  const bereichDialog = page.getByRole('dialog', { name: 'Bereich anlegen' });
  await expect(bereichDialog.getByLabel('Bezeichnung')).toHaveValue('Rückwärtiger Bereich');
  await bereichDialog.getByRole('button', { name: 'Anlegen' }).click();
  const bereich = flaeche(page).getByRole('button', { name: 'Bereich Rückwärtiger Bereich' });
  await expect(bereich).toBeVisible();
  await flaecheInsBild(page);
  const b = (await bereich.locator('rect[stroke-dasharray]').boundingBox())!;
  const verschoben = page.waitForResponse(
    (r) => r.url().includes(`/lage/${ksKey}`) && r.request().method() === 'PUT',
  );
  const platz = leitstelle.locator(':scope > rect').first();
  const p = (await platz.boundingBox())!;
  // Abgelegt wird am Zeiger: er muss im Bereich so liegen, dass der Platz hineinpasst, und weit
  // genug von jeder Schiene, sonst ordnet der Zug zu, statt zu verschieben (D6).
  const schienenY = await page
    .locator('[data-lfh="skizze-flaeche"] line[data-teil="schiene"]')
    .evaluateAll((ls) => ls.map((l) => l.getBoundingClientRect().y));
  const zielX = b.x + b.width / 2;
  let zielY = b.y + b.height / 2;
  let bester = -1;
  for (let y = b.y + p.height / 2 + 4; y <= b.y + b.height - p.height / 2 - 4; y += 2) {
    const abstand = Math.min(...schienenY.map((sy) => Math.abs(sy - y)), Infinity);
    if (abstand > bester) [bester, zielY] = [abstand, y];
  }
  expect(bester, 'Vorbedingung: im Bereich gibt es Platz abseits der Schienen').toBeGreaterThan(24);
  await ziehe(page, await mitte(platz), { x: zielX, y: zielY });
  expect((await verschoben).ok(), 'Lage gespeichert').toBe(true);
  await expect(async () => {
    const r = (await platz.boundingBox())!;
    const g = (await bereich.locator('rect[stroke-dasharray]').boundingBox())!;
    expect(r.x).toBeGreaterThanOrEqual(g.x - SUBPIXEL);
    expect(r.y).toBeGreaterThanOrEqual(g.y - SUBPIXEL);
    expect(r.x + r.width).toBeLessThanOrEqual(g.x + g.width + SUBPIXEL);
    expect(r.y + r.height).toBeLessThanOrEqual(g.y + g.height + SUBPIXEL);
  }, 'die Leitstelle steht innerhalb der Grenze des Bereichs').toPass();

  // An „TMO SL AS“ binden: dort hängt schon die Führungsstelle.
  await page.mouse.move(0, 0);
  await leitstelle.focus();
  await page.keyboard.press('v');
  await page.keyboard.type('SL AS');
  await page.keyboard.press('Enter');
  await expect(element(page, `sg-${slAs}~${ksKey}`)).toHaveCount(1);
  await expect(element(page, `sg-${slAs}~fs`)).toHaveCount(1);
  await expect(element(page, `sg-${slAs}`)).toHaveAttribute(
    'aria-label',
    'Sammelschiene TMO SL AS, 2 Teilnehmer',
  );
  // Mit einem Kanal ist die Lücke „Leitstelle“ zu.
  await expect(
    page.getByRole('region', { name: 'Lücken' }).getByText('Leitstelle: keine Verbindung erfasst'),
  ).toHaveCount(0);

  expect(await zaehle(), 'kein Abschnitt, keine Einheit hinzugekommen').toEqual(vorher);
  await page.goto(`/einsaetze/${einsatzId}/stab/kommunikationsplan`);
  const plan = page.getByRole('region', { name: 'Kommunikationsplan' });
  const zeile = plan.locator('tr').filter({ hasText: 'ILS Musterhausen' });
  await expect(zeile).toHaveCount(1);
  await expect(zeile).toContainText('SL AS');
});

// ── Geplant: Strichmuster und Wort ─────────────────────────────────────────────────────────

test('Geplant: Verbindung und Stichleitung gestrichelt mit dem Wort „geplant“, bestehend durchgezogen — am Schirm und im Druck', async ({
  page,
}) => {
  await page.setViewportSize(FUEKW);
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzAnlegen(page, `E2E Skizze geplant ${Date.now()}`);
  const n = await seedeGrund(page, einsatzId, { zug: false });
  const a = api(page, einsatzId);
  const slAs = (await a.post('sprechgruppen', { bezeichnung: 'SL AS', betriebsart: 'TMO' })).id;
  const stelle = async (stellenart: string, bezeichnung: string) => {
    const plan = await a.post<{ id: number; bezeichnung: string }[]>(
      'stab/kommunikationsplan/stellen',
      { stellenart, bezeichnung },
    );
    return plan.find((s) => s.bezeichnung === bezeichnung)!.id;
  };
  const ils = await stelle('leitstelle', 'ILS Musterhausen');
  const polizei = await stelle('behoerde', 'Polizei');
  await a.put(`stab/kommunikationsplan/stellen/${polizei}/sprechgruppen/${slAs}`, {
    status: 'geplant',
  });
  await a.put(`stab/kommunikationsplan/stellen/${ils}/sprechgruppen/${slAs}`, {
    status: 'bestehend',
  });
  const geplant = (
    await a.post('stab/fernmeldeskizze/verbindungen', {
      von: { art: 'fuehrungsstelle', id: null },
      nach: { art: 'stelle', id: ils },
      art: 'daten',
      medium: 'leitung',
      status: 'geplant',
    })
  ).id;
  const bestehend = (
    await a.post('stab/fernmeldeskizze/verbindungen', {
      von: { art: 'abschnitt', id: n.ea[0] },
      nach: { art: 'stelle', id: polizei },
      art: 'telefon',
      medium: 'leitung',
      status: 'bestehend',
    })
  ).id;

  const pruefe = async (wo: string, sel: (key: string) => Locator) => {
    const vg = sel(`vb-${geplant}`);
    await expect(vg.locator('[data-teil="linie"]'), `${wo}: geplant gestrichelt`).toHaveAttribute(
      'stroke-dasharray',
      '8 5',
    );
    await expect(vg.locator('[data-teil="geplant"]'), `${wo}: Wort „geplant“`).toHaveText(
      'geplant',
    );
    const vb = sel(`vb-${bestehend}`);
    await expect(vb.locator('[data-teil="linie"]')).not.toHaveAttribute('stroke-dasharray');
    await expect(vb.locator('[data-teil="geplant"]')).toHaveCount(0);
    const stich = sel(`sg-${slAs}~ks-${polizei}`);
    await expect(stich.locator('[data-teil="stich-linie"]')).toHaveAttribute(
      'stroke-dasharray',
      '8 5',
    );
    await expect(stich.locator('[data-teil="geplant"]')).toHaveText('geplant');
    const fest = sel(`sg-${slAs}~ks-${ils}`);
    await expect(fest.locator('[data-teil="stich-linie"]')).not.toHaveAttribute('stroke-dasharray');
  };

  await oeffneSkizze(page, einsatzId, element(page, `vb-${geplant}`));
  await expect(element(page, `sg-${slAs}~ks-${polizei}`)).toHaveAttribute(
    'aria-label',
    'Stichleitung Polizei an TMO SL AS, geplant',
  );
  await pruefe('Schirm', (key) => element(page, key));

  await page.evaluate(() => {
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
    };
  });
  await page.getByRole('button', { name: /Drucken/ }).click();
  await page.emulateMedia({ media: 'print' });
  // Im Druck sind die Elemente schlichte Gruppen ohne Bedienung (kein `data-lfh`).
  await expect(page.locator('[data-lfh="skizze-element"]')).toHaveCount(0);
  await pruefe('Druck', (key) => page.locator(`[data-lfh="skizze-flaeche"] g[data-key="${key}"]`));
  await page.emulateMedia({ media: null });
});

// ── Lücken: Bild zählt wie das Paneel ──────────────────────────────────────────────────────

/** Zeilen des Lücken-Paneels, die die Skizze am Element zeigt (Erreichbarkeit zeigt sie nie). */
const SKIZZEN_LUECKEN = [
  'Abschnitte ohne Sprechgruppe',
  'Einheiten ohne Sprechgruppe',
  'Verbindungen ohne gemeinsame Sprechgruppe',
  'Einsatzlokale Sprechgruppen ohne Zuordnung',
  'Sprechgruppen mit nur einem Teilnehmer',
];

async function seedeLuecken(page: Page, einsatzId: string) {
  const a = api(page, einsatzId);
  const bnBos = (await a.post('sprechgruppen', { bezeichnung: 'BN_BOS', betriebsart: 'TMO' })).id;
  const d505 = (await a.post('sprechgruppen', { bezeichnung: '505', betriebsart: 'DMO' })).id;
  await a.patch('fuehrungsstelle', { rufname: FS_RUF, sprechgruppe_ids: [bnBos] });
  const ea = (
    await a.post('abschnitte', {
      name: 'Einsatzabschnitt Nord',
      kurzbezeichnung: 'EA 1',
      sprechgruppe_ids: [bnBos],
    })
  ).id;
  const einheit = async (name: string, funkrufname: string | null, sprechgruppe_ids: number[]) =>
    (await a.post('einheiten', { name, funkrufname, abschnitt_id: ea, sprechgruppe_ids })).id;
  const mit = await einheit('1. Zug', 'Florian 1/1', [bnBos]);
  const ohne = await einheit('2. Zug', null, []);
  const fremd = await einheit('3. Zug', 'Florian 1/3', [d505]);
  const plan = await a.post<{ id: number; bezeichnung: string }[]>(
    'stab/kommunikationsplan/stellen',
    { stellenart: 'leitstelle', bezeichnung: 'ILS Musterhausen' },
  );
  const ils = plan.find((s) => s.bezeichnung === 'ILS Musterhausen')!.id;
  return { bnBos, d505, ea, mit, ohne, fremd, ils };
}

test('Lücken: die Zahl im Bild ist die Zahl im Paneel; ein Klick auf die Lücke wählt das Element', async ({
  page,
}) => {
  await page.setViewportSize(FUEKW);
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzAnlegen(page, `E2E Skizze Lücken ${Date.now()}`);
  const n = await seedeLuecken(page, einsatzId);
  await oeffneSkizze(page, einsatzId, element(page, `ks-${n.ils}`));

  const imBild = await page
    .locator('[data-lfh="skizze-flaeche"] [data-teil="luecke"] > text')
    .evaluateAll((ts) =>
      ts.flatMap((t) => (t.textContent ?? '').split(' · ').filter((s) => s.trim() !== '')),
    );
  const luecken = page.getByRole('region', { name: 'Lücken' });
  const imPaneel = await luecken.locator('[data-lfh="funkplan-luecke"]').evaluateAll(
    (zeilen, titel) =>
      zeilen.reduce((summe, z) => {
        const spans = z.querySelectorAll(':scope > div > span');
        const name = spans[0]?.textContent ?? '';
        if (name.startsWith('Leitstelle: keine Verbindung erfasst')) return summe + 1;
        if (!titel.includes(name)) return summe;
        return summe + Number(spans[1]?.textContent ?? 'NaN');
      }, 0),
    SKIZZEN_LUECKEN,
  );
  test.info().annotations.push({
    type: 'messwert',
    description: `Lücken im Bild ${imBild.length} (${imBild.join(', ')}), im Paneel ${imPaneel}`,
  });
  expect(imBild.sort()).toEqual(
    [
      'keine Sprechgruppe',
      'keine gemeinsame Sprechgruppe',
      'nur ein Teilnehmer',
      'Leitstelle: keine Verbindung erfasst',
    ].sort(),
  );
  expect(imBild.length, 'Bild zählt wie das Paneel').toBe(imPaneel);

  // Klick auf die Lücke im Paneel wählt das Element in der Skizze.
  await luecken
    .locator('[data-lfh="funkplan-luecke"]')
    .filter({ hasText: 'Verbindungen ohne gemeinsame Sprechgruppe' })
    .getByRole('button', { name: '3. Zug' })
    .click();
  await expect(element(page, `eh-${n.fremd}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-lfh="skizze-paneel-titel"]')).toContainText('3. Zug');
  await luecken.getByRole('button', { name: 'ILS Musterhausen' }).click();
  await expect(element(page, `ks-${n.ils}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(element(page, `eh-${n.fremd}`)).toHaveAttribute('aria-pressed', 'false');
});

// ── Wurzel ohne Führungsstelle ─────────────────────────────────────────────────────────────

test('Wurzel: ohne erfasste Führungsstelle keine erfundene Einsatzleitung', async ({ page }) => {
  await page.setViewportSize(FUEKW);
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzAnlegen(page, `E2E Skizze Wurzel ${Date.now()}`);
  const a = api(page, einsatzId);
  const bnBos = (await a.post('sprechgruppen', { bezeichnung: 'BN_BOS', betriebsart: 'TMO' })).id;
  const ea = (
    await a.post('abschnitte', {
      name: 'Einsatzabschnitt Nord',
      kurzbezeichnung: 'EA 1',
      sprechgruppe_ids: [bnBos],
    })
  ).id;
  await a.post('einheiten', {
    name: '1. Zug',
    funkrufname: 'Florian 1/1',
    abschnitt_id: ea,
    sprechgruppe_ids: [bnBos],
  });
  await oeffneSkizze(page, einsatzId, element(page, `ab-${ea}`));

  await expect(element(page, 'fs')).toHaveAttribute(
    'aria-label',
    'Führungsstelle Einsatzleitung: Gegenstelle nicht erfasst',
  );
  expect(
    (await stiche(page)).filter((k) => k.endsWith('~fs')),
    'keine Stichleitung der Einsatzleitung',
  ).toEqual([]);
  await expect(element(page, 'fs')).not.toContainText('Florian');
  await expect(element(page, `ab-${ea}`)).not.toHaveAttribute(
    'aria-label',
    /keine gemeinsame Sprechgruppe/,
  );
  await expect(element(page, `sg-${bnBos}`)).toHaveAttribute(
    'aria-label',
    'Sammelschiene TMO BN_BOS, 2 Teilnehmer',
  );
});

// ── Lage bleibt, „Neu anordnen“ ────────────────────────────────────────────────────────────

test('Lage: zweimal Pfeil rechts bleibt über Neuladen; „Neu anordnen“ stellt das Auto-Layout her, Zuordnungen bleiben', async ({
  page,
}) => {
  await page.setViewportSize(FUEKW);
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzAnlegen(page, `E2E Skizze Lage ${Date.now()}`);
  const n = await seedeGrund(page, einsatzId);
  const ea1 = element(page, `ab-${n.ea[0]}`);
  await oeffneSkizze(page, einsatzId, ea1);
  const auto = await lage(ea1);
  const zuordnungen = await stiche(page);

  await ea1.focus();
  for (let i = 0; i < 2; i++) {
    const gespeichert = page.waitForResponse(
      (r) => r.url().includes(`/lage/ab-${n.ea[0]}`) && r.request().method() === 'PUT',
    );
    await page.keyboard.press('ArrowRight');
    expect((await gespeichert).ok()).toBe(true);
  }
  await expect.poll(() => lage(ea1)).toEqual({ x: auto.x + 16, y: auto.y });

  // Neu geladen über den Pfad mit Sichtvorgabe (`?ansicht=skizze` ist nach dem Öffnen verbraucht).
  await oeffneSkizze(page, einsatzId, ea1);
  await expect
    .poll(() => lage(ea1), { message: 'Lage nach Neuladen' })
    .toEqual({
      x: auto.x + 16,
      y: auto.y,
    });

  await page.getByRole('button', { name: 'Neu anordnen', exact: true }).click();
  const frage = page.getByRole('dialog', { name: 'Neu anordnen?' });
  const verworfen = page.waitForResponse(
    (r) => r.url().endsWith('/stab/fernmeldeskizze/lage') && r.request().method() === 'DELETE',
  );
  await frage.getByRole('button', { name: 'Neu anordnen' }).click();
  expect((await verworfen).ok()).toBe(true);
  await expect.poll(() => lage(ea1), { message: 'wieder im Auto-Layout' }).toEqual(auto);
  expect(await stiche(page), 'Zuordnungen unverändert').toEqual(zuordnungen);
  const abschnitt = await api(page, einsatzId).get<{ sprechgruppen: { id: number }[] }[]>(
    'abschnitte',
  );
  expect(abschnitt.map((x) => x.sprechgruppen.map((s) => s.id))).toEqual([
    [n.bnBos],
    expect.arrayContaining([n.bnBos, n.f314]),
    [n.bnBos],
  ]);
});

// ── Gleichzeitig verschieben ───────────────────────────────────────────────────────────────

test('Gleichzeitig: zwei Kontexte verschieben dieselbe Einheit — B bekommt eine Meldung statt stillem Überschreiben', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzAnlegen(page, `E2E Skizze gleichzeitig ${Date.now()}`);
  const n = await seedeGrund(page, einsatzId);
  const key = `eh-${n.zug}`;

  const zweiter = await browser.newContext({ viewport: FUEKW });
  try {
    const b = await zweiter.newPage();
    await anmeldenAls(b, ADMIN, ADMIN_PW);
    // B ist „vom selben Stand aus“ unterwegs: sein Abruf der Skizze nach A's Live-Ereignis
    // hängt in der Leitung, bis B selbst gespeichert hat (Latenz, kein Abschalten des Stroms).
    let halten = false;
    const wartend: Route[] = [];
    await b.route(/\/api\/einsaetze\/\d+\/stab\/fernmeldeskizze$/, async (route) => {
      if (halten && route.request().method() === 'GET') {
        wartend.push(route);
        return;
      }
      await route.continue();
    });
    await oeffneSkizze(b, einsatzId, element(b, key));
    await oeffneSkizze(page, einsatzId, element(page, key));
    const start = await lage(element(page, key));
    halten = true;

    // A verschiebt zuerst und speichert.
    await element(page, key).focus();
    const aGespeichert = page.waitForResponse(
      (r) => r.url().includes(`/lage/${key}`) && r.request().method() === 'PUT',
    );
    await page.keyboard.press('ArrowDown');
    expect((await aGespeichert).ok()).toBe(true);
    const beiA = await lage(element(page, key));
    expect(beiA).toEqual({ x: start.x, y: start.y + 8 });
    // Vorbedingung: das Ereignis ist bei B angekommen, sein neuer Abruf wartet.
    await expect.poll(() => wartend.length, { message: 'B hat A’s Ereignis' }).toBeGreaterThan(0);

    // B verschiebt vom alten Stand aus.
    await element(b, key).focus();
    const bAntwort = b.waitForResponse(
      (r) => r.url().includes(`/lage/${key}`) && r.request().method() === 'PUT',
    );
    await b.keyboard.press('ArrowRight');
    expect((await bAntwort).status(), 'B’s Stand ist veraltet').toBe(409);
    halten = false;
    for (const r of wartend.splice(0)) await r.continue();

    await expect(element(b, key)).toContainText('von einem anderen Arbeitsplatz verschoben');
    await expect.poll(() => lage(element(b, key)), { message: 'B zeigt A’s Lage' }).toEqual(beiA);
    await expect
      .poll(() => lage(element(page, key)), { message: 'A behält seine Lage' })
      .toEqual(beiA);
    const gespeichert = await api(page, einsatzId).get<{
      lage: { element: string; x: number; y: number }[];
    }>('stab/fernmeldeskizze');
    expect(gespeichert.lage.find((l) => l.element === key)).toMatchObject(beiA);
  } finally {
    await zweiter.close();
  }
});

// ── Ruhige Fläche (ersetzt die Schleuse LFH-867) ───────────────────────────────────────────

test('Ruhige Fläche: eine aufgelöste Einheit lässt die Einheit unter dem Zeiger stehen, bis er geht', async ({
  page,
}) => {
  await page.setViewportSize(FUEKW);
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzAnlegen(page, `E2E Skizze ruhig ${Date.now()}`);
  const a = api(page, einsatzId);
  const bnBos = (await a.post('sprechgruppen', { bezeichnung: 'BN_BOS', betriebsart: 'TMO' })).id;
  await a.patch('fuehrungsstelle', { rufname: FS_RUF, sprechgruppe_ids: [bnBos] });
  const ea1 = (await a.post('abschnitte', { name: 'EA Nord', sprechgruppe_ids: [bnBos] })).id;
  const vorne = (
    await a.post('einheiten', { name: 'Zug A', abschnitt_id: ea1, sprechgruppe_ids: [bnBos] })
  ).id;
  const hinten = (
    await a.post('einheiten', { name: 'Zug B', abschnitt_id: ea1, sprechgruppe_ids: [bnBos] })
  ).id;
  const ziel = element(page, `eh-${hinten}`);
  await oeffneSkizze(page, einsatzId, ziel);
  const vorher = await lage(ziel);

  await ziel.hover();
  // „Zug A“ wird an einem anderen Arbeitsplatz aufgelöst; im Auto-Layout rückte „Zug B“ auf.
  const weg = await page.request.delete(`/api/einsaetze/${einsatzId}/einheiten/${vorne}`);
  expect(weg.ok(), `Auflösen: ${weg.status()} ${await weg.text()}`).toBe(true);
  // Vorbedingung: das Ereignis ist angekommen — „Zug A“ ist aus dem Bild.
  await expect(element(page, `eh-${vorne}`)).toHaveCount(0);
  expect(await lage(ziel), 'unter dem Zeiger springt nichts').toEqual(vorher);

  await page.mouse.move(0, 0);
  await expect
    .poll(() => lage(ziel), { message: 'ohne Zeiger gilt das Auto-Layout' })
    .not.toEqual(vorher);
});

// ── Rechte ─────────────────────────────────────────────────────────────────────────────────

test('Rechte: der Beobachter liest — kein Griff, nichts verschiebt, aber Hervorheben und Zoom gehen', async ({
  page,
}) => {
  await page.setViewportSize(FUEKW);
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzAnlegen(page, `E2E Skizze Beobachter ${Date.now()}`);
  const n = await seedeGrund(page, einsatzId);
  await wechsleZuRolle(page, 'beobachter', einsatzId);
  const ea1 = element(page, `ab-${n.ea[0]}`);
  await oeffneSkizze(page, einsatzId, ea1);

  await expect(page.locator('[data-lfh="skizze-palette-knopf"]')).toHaveCount(0);
  await expect(page.locator('[data-lfh="skizze-neu-anordnen"]')).toHaveCount(0);
  await expect(page.locator('[data-lfh="skizze-rueckgaengig"]')).toHaveCount(0);

  const schreibend: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && r.url().includes(`/api/einsaetze/${einsatzId}/`))
      schreibend.push(`${r.method()} ${r.url()}`);
  });
  await ea1.click();
  await expect(ea1).toHaveAttribute('aria-pressed', 'true');
  await expect(paneel(page).locator('[data-lfh="skizze-rechte-grund"]')).toContainText(
    'Kein Schreibrecht im Einsatz',
  );
  await expect(page.locator('[data-lfh="skizze-griff"]'), 'kein Griff').toHaveCount(0);
  const vorher = await lage(ea1);
  await ea1.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('v');
  await expect(page.locator('[data-lfh="skizze-verbinden-dialog"]')).toHaveCount(0);
  expect(await lage(ea1)).toEqual(vorher);

  // Hervorheben: die Schiene „314_F*“ gewählt, ihr Teilnehmer voll, der Rest tritt zurück.
  await element(page, `sg-${n.f314}`).click();
  await expect(element(page, `ab-${n.ea[1]}`)).not.toHaveAttribute('opacity');
  await expect(ea1).toHaveAttribute('opacity', '0.6');
  // Zoom: „+“ vergrößert, „Einpassen“ passt wieder ein.
  const breite = () =>
    flaeche(page).evaluate((s) => Number(s.getAttribute('viewBox')!.split(' ')[2]));
  const eingepasst = await breite();
  await page.getByRole('button', { name: 'Vergrößern' }).click();
  await expect.poll(breite).toBeLessThan(eingepasst);
  await page.getByRole('button', { name: 'Einpassen' }).click();
  await expect.poll(breite).toBe(eingepasst);
  expect(schreibend, 'der Beobachter schreibt nichts').toEqual([]);
});

test('Rechte: Schreibrecht auf den Stab ohne Einheiten — keine Einheit greifbar, der Server lehnt mit 403 ab', async ({
  page,
}) => {
  await page.setViewportSize(FUEKW);
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzAnlegen(page, `E2E Skizze Stab ohne Einheiten ${Date.now()}`);
  const n = await seedeGrund(page, einsatzId);
  // Einheiten nur für Admins (Modulsperre per Override, `e2e/AGENTS.md`); der Stab bleibt frei.
  const sperre = await page.request.put(`/api/einsaetze/${einsatzId}/modul-overrides/einheiten`, {
    data: { sichtbar: true, benoetigte_rolle: 'admin' },
  });
  expect(sperre.ok(), `Override: ${sperre.status()} ${await sperre.text()}`).toBeTruthy();
  await wechsleZuRolle(page, 'fuehrungspersonal', einsatzId);
  const ea1 = element(page, `ab-${n.ea[0]}`);
  await oeffneSkizze(page, einsatzId, ea1);

  // Vorbedingung des Zweigs: die Fläche schreibt (Stab), die Einheiten fehlen mit Grund.
  await expect(page.locator('[data-lfh="skizze-neu-anordnen"]')).toBeVisible();
  await expect(page.locator('[data-lfh="skizze-fehlend"]')).toContainText('Einheiten');
  await expect(
    page.locator('[data-lfh="skizze-element"][data-key^="eh-"]'),
    'ohne Leserecht steht keine Einheit da, also auch keine greifbare',
  ).toHaveCount(0);
  // Der Abschnitt hat seinen Griff (Recht auf Abschnitte), Zuordnen geht dort.
  await ea1.click();
  await expect(page.locator('[data-lfh="skizze-griff"][data-griff="kreis"]')).toHaveCount(1);
  await expect(paneel(page).locator('[data-lfh="skizze-rechte-grund"]')).toHaveCount(0);

  const direkt = await page.request.put(
    `/api/einsaetze/${einsatzId}/einheiten/${n.zug}/sprechgruppen/${n.f314}`,
  );
  expect(direkt.status(), 'direkter Aufruf ohne Recht auf Einheiten').toBe(403);
});

test('Mobil 390 px: nur lesen — kein Griff, keine Palette, aber Hervorheben und Zoom', async ({
  page,
}) => {
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzAnlegen(page, `E2E Skizze mobil ${Date.now()}`);
  const n = await seedeGrund(page, einsatzId);
  await page.setViewportSize(HANDSCHIRM);
  const ea1 = element(page, `ab-${n.ea[0]}`);
  await oeffneSkizze(page, einsatzId, ea1);

  await expect(page.locator('[data-lfh="skizze-palette-knopf"]')).toHaveCount(0);
  await expect(page.locator('[data-lfh="skizze-rueckgaengig"]')).toHaveCount(0);
  await ea1.click();
  await expect(paneel(page).locator('[data-lfh="skizze-rechte-grund"]')).toContainText(
    'Am schmalen Bildschirm nur lesen',
  );
  await expect(page.locator('[data-lfh="skizze-griff"]')).toHaveCount(0);
  await expect(ea1).toHaveCSS('cursor', 'pointer');

  await element(page, `sg-${n.f314}`).click();
  await expect(ea1).toHaveAttribute('opacity', '0.6');
  const breite = () =>
    flaeche(page).evaluate((s) => Number(s.getAttribute('viewBox')!.split(' ')[2]));
  const eingepasst = await breite();
  await page.getByRole('button', { name: 'Vergrößern' }).click();
  await expect.poll(breite).toBeLessThan(eingepasst);
  const seite = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(seite, 'gezoomt läuft die Seite nicht über').toBeLessThanOrEqual(SUBPIXEL);
});

// ── Prüfliste Kriterium 1 und 5 ────────────────────────────────────────────────────────────

/**
 * Trefffläche jedes Elements (Platz bzw. Trefferrechteck der Schiene) in CSS-px; unter 24 px
 * zählt die Abstandsausnahme (WCAG 2.5.8): ein Kreis von 24 px um die Mitte schneidet kein
 * anderes Ziel und keinen anderen solchen Kreis.
 */
async function treffflaechen(page: Page) {
  return page.evaluate((min) => {
    const ziele = Array.from(document.querySelectorAll('[data-lfh="skizze-element"]')).flatMap(
      (el) => {
        const key = el.getAttribute('data-key')!;
        if (!/^(fs|ab-|eh-|ks-|ko-|sg-\d+$)/.test(key)) return [];
        const r = el.querySelector(':scope > rect')!.getBoundingClientRect();
        return [{ key, x: r.x, y: r.y, b: r.width, h: r.height }];
      },
    );
    const klein = ziele.filter((z) => z.b < min || z.h < min);
    const kreisFrei = (z: (typeof ziele)[number]) => {
      const cx = z.x + z.b / 2;
      const cy = z.y + z.h / 2;
      return ziele.every((o) => {
        if (o === z) return true;
        const nx = Math.max(o.x, Math.min(cx, o.x + o.b));
        const ny = Math.max(o.y, Math.min(cy, o.y + o.h));
        const abstand = Math.hypot(cx - nx, cy - ny);
        if (abstand < min / 2) return false;
        if (o.b < min || o.h < min) {
          const d = Math.hypot(cx - (o.x + o.b / 2), cy - (o.y + o.h / 2));
          if (d < min) return false;
        }
        return true;
      });
    };
    return {
      anzahl: ziele.length,
      kleinste: ziele.reduce((k, z) => (Math.min(z.b, z.h) < Math.min(k.b, k.h) ? z : k), ziele[0]),
      ohneAusnahme: klein
        .filter((z) => !kreisFrei(z))
        .map((z) => `${z.key} ${Math.round(z.b)}×${Math.round(z.h)}`),
      klein: klein.length,
    };
  }, ZIEL_MIN);
}

test('Prüfliste 1: die eingepasste große Skizze hält am Fükw 24 × 24 px je Ziel; Messwert 390 px', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzAnlegen(page, `E2E Skizze Kriterium 1 ${Date.now()}`);
  await seedeGross(page, einsatzId);
  const anker = flaeche(page).getByRole('button', { name: /^Einheit Einheit 8\.3/ });
  await oeffneSkizze(page, einsatzId, anker);
  await expect(page.locator('[data-lfh="modul-panel"]'), 'Panel offen am Fükw').toBeVisible();
  const fuekw = await treffflaechen(page);
  test.info().annotations.push({
    type: 'messwert',
    description: `Fükw: ${fuekw.anzahl} Ziele, kleinstes ${fuekw.kleinste.key} ${Math.round(fuekw.kleinste.b)}×${Math.round(fuekw.kleinste.h)} px, unter 24 px: ${fuekw.klein}`,
  });
  expect(fuekw.klein, 'am Fükw ist jedes Ziel mindestens 24 × 24 px').toBe(0);

  // 390 px liest nur; das Tippen wählt. Gemessen und gemeldet, nicht als Boden gesetzt.
  await page.setViewportSize(HANDSCHIRM);
  await oeffneSkizze(page, einsatzId, anker);
  const mobil = await treffflaechen(page);
  test.info().annotations.push({
    type: 'messwert',
    description: `390 px: kleinstes ${mobil.kleinste.key} ${Math.round(mobil.kleinste.b)}×${Math.round(mobil.kleinste.h)} px, unter 24 px: ${mobil.klein}, davon ohne freien 24-px-Kreis: ${mobil.ohneAusnahme.length} (${mobil.ohneAusnahme.slice(0, 6).join(', ')})`,
  });
});

test('Prüfliste 5: zurückgenommene Texte halten 4,5 : 1 (Name, Rufname, Lückenwort, „kein Rufname“)', async ({
  page,
}) => {
  await page.setViewportSize(FUEKW);
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzAnlegen(page, `E2E Skizze Kriterium 5 ${Date.now()}`);
  const n = await seedeLuecken(page, einsatzId);
  await oeffneSkizze(page, einsatzId, element(page, `ks-${n.ils}`));
  // Die Schiene „DMO 505“ gewählt: nur „3. Zug“ hängt daran, alles andere tritt zurück.
  await element(page, `sg-${n.d505}`).click();
  const zurueck = (key: string) => element(page, key);
  await expect(zurueck(`eh-${n.ohne}`)).toHaveAttribute('opacity', '0.6');
  await expect(zurueck(`eh-${n.mit}`)).toHaveAttribute('opacity', '0.6');

  const faelle: [string, Locator][] = [
    ['Name', zurueck(`eh-${n.mit}`).locator('[data-teil="stelle"] > text').first()],
    ['Rufname', zurueck(`eh-${n.mit}`).locator('[data-teil="stelle"] > text').nth(1)],
    ['kein Rufname', zurueck(`eh-${n.ohne}`).locator('[data-teil="stelle"] > text').nth(1)],
    ['Lückenwort', zurueck(`eh-${n.ohne}`).locator('[data-teil="luecke"] > text')],
    ['Kasten (EA 1)', zurueck(`ab-${n.ea}`).locator('[data-teil="stelle"] > text').first()],
  ];
  const gemessen: string[] = [];
  const unter: string[] = [];
  for (const [name, text] of faelle) {
    await expect(text, `${name}: Text steht`).toHaveCount(1);
    const m = await svgTextKontrast(text);
    gemessen.push(`${name} ${m.verhaeltnis.toFixed(2)} (Deckkraft ${m.deckkraft})`);
    if (m.verhaeltnis < TEXT_BODEN) unter.push(`${name}: ${m.verhaeltnis.toFixed(2)} : 1`);
  }
  test.info().annotations.push({ type: 'messwert', description: gemessen.join(' · ') });
  expect(unter, `zurückgenommen unter ${TEXT_BODEN} : 1`).toEqual([]);
});
