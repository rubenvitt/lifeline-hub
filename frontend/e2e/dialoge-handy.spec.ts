import { expect, test, type Locator, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, wechsleZuRolle, type Rolle } from './rollen-kern';

/**
 * Dialoge am Handy (LFH-953): auf 390 px liegt jedes Bedienziel im Schirm und lässt sich klicken.
 *
 * - **Erfassungsfuß** (`components/Erfassung.tsx`): die drei Knöpfe der Serie liefen nebeneinander
 *   links aus dem Dialog („Abbrechen“ bei x = −75). Unter `md` stehen sie untereinander.
 * - **Zeiteingabe** (`anzeige/ZeitpunktEingabe.tsx`): antds Panel mit Uhrzeit war 437 px breit,
 *   „OK“ und die Uhrzeit lagen außerhalb, die Seite scrollte seitlich. Unter `md` steht es als
 *   Blatt am unteren Rand (`anzeige/ZeitpunktEingabe.css`).
 * - **Kürzel** „Strg + ↵“ nur bei feinem Zeiger (`components/Erfassung.css`).
 *
 * Gemessen in `kompakt` und `komfortabel` (die breiteren Knöpfe verschlimmerten den Überlauf) und
 * je Fläche zusätzlich nicht-privilegiert (`e2e/AGENTS.md`, LFH-435): die Erfassung als
 * Führungspersonal, der ETB-Filter als Beobachter. „Abbrechen“ und „OK“ werden geklickt, nicht nur
 * auf Sichtbarkeit geprüft (LFH-355).
 */

/** 390 px breit; 700 px ist die sichtbare Höhe im Browser eines 844er-Handys (Adress- und
 *  Werkzeugleiste abgezogen). Mit der Gerätehöhe sähe die Spec ein Blatt, das am Handy nicht passt. */
const HANDY = { width: 390, height: 700 };
const TABLET_HOCH = { width: 820, height: 1180 };
const DESKTOP = { width: 1440, height: 900 };
const SUBPIXEL = 0.5;
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';
const STUFEN = ['kompakt', 'komfortabel'] as const;
/** Das Blatt misst zusätzlich `handschuh`: dort ist es höher als der Schirm und rollt in sich. */
const STUFEN_BLATT = [...STUFEN, 'handschuh'] as const;
type Stufe = (typeof STUFEN_BLATT)[number];
/** Steuerhöhe der Stufe als Literal (Dichte-Staffel, `frontend/AGENTS.md`). */
const STEUERHOEHE: Record<Stufe, number> = { kompakt: 30, komfortabel: 48, handschuh: 72 };
/** Freier Streifen über dem Blatt, auf den man zum Schließen tippt (Blatt ≤ 85 % der Höhe). */
const STREIFEN = Math.floor(HANDY.height * 0.15) - 1;

/** Das offene Panel einer Zeiteingabe. */
const panel = (page: Page) => page.locator('.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)');

/**
 * Der Knopf der TanStack-Query-Devtools steht nur im DEV-Build, gegen den die Suite fährt, fest
 * unten rechts — genau über „OK“ im Blatt. Im Betrieb gibt es ihn nicht (wie
 * `fokus-verdeckung.spec.ts`).
 */
async function ohneDevtoolsKnopf(page: Page) {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const stil = document.createElement('style');
      stil.textContent = '[class*="tsqd-open-btn"] { display: none !important; }';
      document.head.append(stil);
    });
  });
}

async function einsatzAnlegen(page: Page): Promise<string> {
  const r = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Dialoge Handy ${Date.now()}` },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return String(((await r.json()) as { id: number }).id);
}

async function stelleDichte(page: Page, dichte: Stufe) {
  await page.evaluate(([s, w]) => window.localStorage.setItem(s, w), [
    DICHTE_SCHLUESSEL,
    dichte,
  ] as const);
}

/** Wache: trennt „Überlauf“ von „Stufe gar nicht angekommen“. */
async function stufeAngekommen(page: Page, dichte: Stufe) {
  await expect(page.locator('html')).toHaveAttribute('data-dichte', dichte);
}

async function kasten(ziel: Locator) {
  const k = await ziel.boundingBox();
  expect(k, 'kein Kasten messbar').not.toBeNull();
  return k!;
}

/** Liegt `k` ganz in `rahmen`? Mit Subpixel-Toleranz. */
function liegtIn(
  k: { x: number; y: number; width: number; height: number },
  rahmen: { x: number; y: number; width: number; height: number },
) {
  return (
    k.x >= rahmen.x - SUBPIXEL &&
    k.y >= rahmen.y - SUBPIXEL &&
    k.x + k.width <= rahmen.x + rahmen.width + SUBPIXEL &&
    k.y + k.height <= rahmen.y + rahmen.height + SUBPIXEL
  );
}

const SCHIRM = { x: 0, y: 0, ...HANDY };

async function keinSeitlicherUeberlauf(page: Page, wo: string) {
  const breite = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(breite, `${wo}: scrollWidth ${breite}, Soll ≤ ${HANDY.width}`).toBeLessThanOrEqual(
    HANDY.width,
  );
}

/** Kalendertitel (antd, deutsches Gebietsschema) eines Tages in zwei Tagen. */
function tagInZweiTagen(): string {
  const d = new Date(Date.now() + 2 * 24 * 3600 * 1000);
  const zwei = (n: number) => String(n).padStart(2, '0');
  return `${zwei(d.getUTCDate())}.${zwei(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

/**
 * Das offene Panel liegt im Schirm; Tag und Stunde werden gewählt und mit „OK“ übernommen.
 * Der Tag liegt in der Zukunft, egal in welcher Zone: Seeds von „jetzt“ fallen danach heraus.
 */
async function waehleImPanel(page: Page, stunde: number, wo: string, dichte: Stufe) {
  const p = await pruefeBlatt(page, wo);
  await p.locator(`td[title="${tagInZweiTagen()}"]`).click();
  const zelle = p.locator(
    `.ant-picker-time-panel-column[data-type="hour"] li[data-value="${stunde}"]`,
  );
  await zelle.scrollIntoViewIfNeeded();
  const hoehe = (await kasten(zelle.locator('.ant-picker-time-panel-cell-inner'))).height;
  expect(
    hoehe,
    `${wo}: Uhrzeitzelle ${hoehe} px, Soll ≥ ${STEUERHOEHE[dichte]} (${dichte})`,
  ).toBeGreaterThanOrEqual(STEUERHOEHE[dichte] - SUBPIXEL);
  await zelle.click();
  const ok = p.getByRole('button', { name: 'OK', exact: true });
  expect(liegtIn(await kasten(ok), SCHIRM), `${wo}: „OK“ liegt nicht im Schirm`).toBe(true);
  await ok.click();
}

/** Das offene Blatt liegt im Schirm und lässt oben einen Streifen zum Wegtippen frei. */
async function pruefeBlatt(page: Page, wo: string) {
  const p = panel(page);
  await expect(p).toBeVisible();
  // Erst nach der Einblendung messen: währenddessen ist das Panel skaliert.
  await expect(page.locator('.ant-slide-up-appear, .ant-slide-up-enter')).toHaveCount(0);
  const k = await kasten(p);
  expect(liegtIn(k, SCHIRM), `${wo}: Panel ${JSON.stringify(k)} liegt nicht im Schirm`).toBe(true);
  expect(k.y, `${wo}: über dem Blatt bleibt kein Streifen zum Schließen`).toBeGreaterThanOrEqual(
    STREIFEN,
  );
  await keinSeitlicherUeberlauf(page, `${wo}, Panel offen`);
  return p;
}

/** Serienmaske: „Betroffene erfassen“ über ihre Adresse (`?neu=1`). */
async function pruefeSerienfuss(page: Page, einsatzId: string, wer: string) {
  await page.goto(`/einsaetze/${einsatzId}/personen?neu=1`);
  const dialog = page.getByRole('dialog', { name: 'Betroffene erfassen' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('.ant-zoom-appear, .ant-zoom-enter')).toHaveCount(0);

  const rahmen = await kasten(dialog);
  const knoepfe = [
    dialog.getByRole('button', { name: 'Abbrechen', exact: true }),
    dialog.getByRole('button', { name: 'Speichern und nächste', exact: true }),
    dialog.getByRole('button', { name: 'Erfassen', exact: true }),
  ];
  for (const knopf of knoepfe) {
    const k = await kasten(knopf);
    const name = await knopf.textContent();
    expect(liegtIn(k, rahmen), `${wer}: „${name}“ ${JSON.stringify(k)} liegt nicht im Dialog`).toBe(
      true,
    );
    // Waagerecht im Schirm; senkrecht rollt der Dialog in `komfortabel` (die Knöpfe stehen unten).
    expect(
      k.x >= -SUBPIXEL && k.x + k.width <= HANDY.width + SUBPIXEL,
      `${wer}: „${name}“ ${JSON.stringify(k)} ragt seitlich aus dem Schirm`,
    ).toBe(true);
  }
  await keinSeitlicherUeberlauf(page, `${wer}, Serienmaske`);
  // Die Speicherknöpfe würden absenden; `trial` prüft dieselbe Klickbarkeit ohne Klick.
  await knoepfe[1].click({ trial: true });
  await knoepfe[2].click({ trial: true });
  await knoepfe[0].click();
  await expect(dialog).toBeHidden();
}

for (const dichte of STUFEN) {
  test(`Serienmaske auf 390 px, Stufe ${dichte}: alle Fußknöpfe im Dialog, „Abbrechen“ schließt`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzAnlegen(page);
    await page.setViewportSize(HANDY);
    await stelleDichte(page, dichte);
    await page.goto(`/einsaetze/${einsatzId}/personen`);
    await stufeAngekommen(page, dichte);
    await pruefeSerienfuss(page, einsatzId, `admin, ${dichte}`);

    await wechsleZuRolle(page, 'fuehrungspersonal', einsatzId);
    await stelleDichte(page, dichte);
    await page.goto(`/einsaetze/${einsatzId}/personen`);
    await stufeAngekommen(page, dichte);
    await pruefeSerienfuss(page, einsatzId, `fuehrungspersonal, ${dichte}`);
  });

  test(`„Zeitfenster anlegen“ auf 390 px, Stufe ${dichte}: Beginn und Ende bis „Anlegen“`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await ohneDevtoolsKnopf(page);
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzAnlegen(page);
    await page.setViewportSize(HANDY);

    for (const rolle of [null, 'fuehrungspersonal'] as (Rolle | null)[]) {
      const wer = `${rolle ?? 'admin'}, ${dichte}`;
      if (rolle) await wechsleZuRolle(page, rolle, einsatzId);
      await stelleDichte(page, dichte);
      await page.goto(`/einsaetze/${einsatzId}/verpflegung`);
      await stufeAngekommen(page, dichte);

      // Der Kopfknopf; im leeren Zustand trägt die Leerfläche einen zweiten.
      await page
        .locator('[data-lfh="seitenkopf"]')
        .getByRole('button', { name: 'Zeitfenster anlegen', exact: true })
        .click();
      const dialog = page.getByRole('dialog', { name: 'Zeitfenster anlegen' });
      await expect(dialog).toBeVisible();
      const bezeichnung = `Mittag ${rolle ?? 'admin'} ${dichte}`;
      await dialog.getByLabel('Bezeichnung', { exact: true }).fill(bezeichnung);

      await dialog.getByPlaceholder('Beginn', { exact: true }).click();
      await waehleImPanel(page, 12, `${wer}, Beginn`, dichte);
      // antd springt nach „OK“ ins Ende-Feld; das Panel bleibt dafür offen.
      await waehleImPanel(page, 13, `${wer}, Ende`, dichte);
      await expect(panel(page)).toBeHidden();

      await dialog.getByLabel('Einsatzkräfte (EP)', { exact: true }).fill('20');
      await dialog.getByLabel('Betreute (EP)', { exact: true }).fill('10');
      const anlegen = dialog.getByRole('button', { name: 'Anlegen', exact: true });
      await anlegen.scrollIntoViewIfNeeded();
      expect(liegtIn(await kasten(anlegen), SCHIRM), `${wer}: „Anlegen“ im Schirm`).toBe(true);
      await anlegen.click();
      await expect(dialog).toBeHidden();
      await expect(
        page.getByRole('article', { name: new RegExp(`^Zeitfenster ${bezeichnung} `) }),
      ).toBeVisible();
      await keinSeitlicherUeberlauf(page, `${wer}, Verpflegung`);
    }
  });
}

for (const dichte of STUFEN_BLATT) {
  test(`ETB-Filter „von“ auf 390 px, Stufe ${dichte}: Zeitpunkt mit Uhrzeit setzen, Filter wirkt`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await ohneDevtoolsKnopf(page);
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzAnlegen(page);
    const inhalt = `Lagemeldung vor dem Filter ${Date.now()}`;
    const r = await page.request.post(`/api/einsaetze/${einsatzId}/etb`, {
      data: { typ: 'meldung', inhalt, von: 'ELW 1', an: 'Leitstelle' },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    await page.setViewportSize(HANDY);

    for (const rolle of [null, 'beobachter'] as (Rolle | null)[]) {
      const wer = `${rolle ?? 'admin'}, ${dichte}`;
      if (rolle) await wechsleZuRolle(page, rolle, einsatzId);
      await stelleDichte(page, dichte);
      await page.goto(`/einsaetze/${einsatzId}/etb`);
      await stufeAngekommen(page, dichte);
      await expect(page.getByText(inhalt)).toBeVisible();
      // Vorbedingung des Rollenzweigs: ohne Schreibrecht fehlt die Erfassungsleiste.
      await expect(page.locator('.etb-erfassung-sticky')).toHaveCount(rolle ? 0 : 1);

      await page.getByRole('button', { name: /^Filter/ }).click();
      const von = page.getByPlaceholder('von', { exact: true });
      await von.click();
      await waehleImPanel(page, 14, `${wer}, ETB „von“`, dichte);

      await expect(panel(page)).toBeHidden();
      await expect(von).toHaveValue(/ 14:00/);
      await expect(page.getByText(inhalt)).toBeHidden();
      await expect(page.getByText('Kein Eintrag passt zum Filter')).toBeVisible();
      await keinSeitlicherUeberlauf(page, `${wer}, ETB gefiltert`);
    }
  });
}

test.describe('Touchgerät 390 px (grober Zeiger)', () => {
  test.use({ viewport: HANDY, hasTouch: true, isMobile: true });

  test('kein Tastenkürzel im Serienknopf; Zeitfeld ohne Tastatur, Blatt per Tippen schließen und übernehmen', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await ohneDevtoolsKnopf(page);
    await anmeldenAlsAdmin(page);
    const einsatzId = await einsatzAnlegen(page);
    // Vorbedingung: das Gerät meldet wirklich einen groben Zeiger ohne Hover.
    expect(
      await page.evaluate(() => window.matchMedia('(hover: hover) and (pointer: fine)').matches),
    ).toBe(false);

    await page.goto(`/einsaetze/${einsatzId}/personen?neu=1`);
    const dialog = page.getByRole('dialog', { name: 'Betroffene erfassen' });
    const serie = dialog.getByRole('button', { name: 'Speichern und nächste', exact: true });
    await expect(serie).toBeVisible();
    await expect(serie.locator('.lfh-serien-kuerzel')).toHaveCount(1);
    await expect(serie.locator('.lfh-serien-kuerzel')).toBeHidden();
    // `innerText` folgt der Darstellung, `textContent` sähe das ausgeblendete Kürzel.
    expect(await serie.innerText()).not.toMatch(/Strg|⌘/);

    // Gewählt wird im Blatt; das Feld nimmt keinen Fokus für die Tastatur an.
    await page.goto(`/einsaetze/${einsatzId}/etb`);
    await page.getByRole('button', { name: /^Filter/ }).tap();
    const von = page.getByPlaceholder('von', { exact: true });
    await expect(von).toHaveAttribute('readonly', '');

    // Ohne Wert heraus: Tippen auf den Streifen über dem Blatt schließt es, das Feld bleibt leer.
    await von.tap();
    const blatt = await pruefeBlatt(page, 'Touch, ETB „von“');
    await expect(blatt.getByRole('button', { name: 'OK', exact: true })).toBeDisabled();
    await page.touchscreen.tap(HANDY.width / 2, Math.floor(STREIFEN / 2));
    await expect(panel(page)).toBeHidden();
    await expect(von).toHaveValue('');

    // Mit Wert: Tag und Stunde antippen, „OK“ übernimmt.
    await von.tap();
    const p = await pruefeBlatt(page, 'Touch, ETB „von“');
    await p.locator(`td[title="${tagInZweiTagen()}"]`).tap();
    await p.locator('.ant-picker-time-panel-column[data-type="hour"] li[data-value="9"]').tap();
    await p.getByRole('button', { name: 'OK', exact: true }).tap();
    await expect(panel(page)).toBeHidden();
    await expect(von).toHaveValue(/ 09:00/);
  });
});

test('Tablet hoch und Desktop: Fußreihe bleibt einzeilig, Panel bleibt am Feld, Kürzel sichtbar', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await anmeldenAlsAdmin(page);
  const einsatzId = await einsatzAnlegen(page);

  for (const groesse of [TABLET_HOCH, DESKTOP]) {
    const wo = `${groesse.width} px`;
    await page.setViewportSize(groesse);
    await page.goto(`/einsaetze/${einsatzId}/personen?neu=1`);
    const dialog = page.getByRole('dialog', { name: 'Betroffene erfassen' });
    await expect(dialog).toBeVisible();
    await expect(page.locator('.ant-zoom-appear, .ant-zoom-enter')).toHaveCount(0);
    const serie = dialog.getByRole('button', { name: 'Speichern und nächste', exact: true });
    const kuerzel = serie.locator('.lfh-serien-kuerzel');
    await expect(kuerzel).toBeVisible();
    await expect(kuerzel).toHaveText(/Strg \+ ↵|⌘ ↵/);
    const ys = await Promise.all(
      ['Abbrechen', 'Speichern und nächste', 'Erfassen'].map(async (name) =>
        Math.round((await kasten(dialog.getByRole('button', { name, exact: true }))).y),
      ),
    );
    expect(new Set(ys).size, `${wo}: Fußknöpfe in einer Reihe (${ys.join(', ')})`).toBe(1);
    await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await expect(dialog).toBeHidden();

    await page.goto(`/einsaetze/${einsatzId}/etb`);
    // Ab `md` nimmt die Erfassungsleiste beim Laden den Fokus; ein früher geöffnetes Panel
    // schlösse sich dabei wieder.
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.tagName ?? 'BODY'))
      .not.toBe('BODY');
    const von = page.getByPlaceholder('von', { exact: true });
    await von.click();
    await expect(panel(page)).toBeVisible();
    await expect(page.locator('.ant-slide-up-appear, .ant-slide-up-enter')).toHaveCount(0);
    await expect(panel(page)).not.toHaveClass(/lfh-zeit-blatt/);
    const feld = await kasten(von);
    const p = await kasten(panel(page));
    // Am Feld: direkt darunter oder, wenn unten kein Platz ist, direkt darüber.
    const abstand = Math.min(
      Math.abs(p.y - (feld.y + feld.height)),
      Math.abs(p.y + p.height - feld.y),
    );
    expect(abstand, `${wo}: Panel ${JSON.stringify(p)} hängt nicht am Feld`).toBeLessThan(16);
    await expect(von).not.toHaveAttribute('readonly', '');
    await page.keyboard.press('Escape');
  }
});
