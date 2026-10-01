import { expect, test, type Page } from '@playwright/test';

/**
 * Führungsorganisation als Organigramm (LFH-626): die Nachweise, die NUR im Browser gehen. jsdom
 * rechnet kein Layout, wertet `@media print` nicht aus und kennt keine Contentbreite.
 *
 * - MESSUNG (Aufgabe 2.1, „vor dem Bau messen“): Contentbreite der Seite Einsatzabschnitte am Fükw
 *   mit offenem Panel und die Laufweiten langer Werte. Die Werte stehen in design.md D3
 *   (Nachtrag); hier bleiben sie als Annotation stehen.
 * - BREITE: acht oberste Abschnitte mit je drei Einheiten — am Fükw (1366 × 768, Panel offen) in
 *   mehreren Zeilen von Spalten, bei 1024, 768 und 390 px ebenso ohne waagerechten Überhang von
 *   Seite und Organigramm.
 * - DRUCKPFAD bei A4-Breite (680 px): ein zugeklappter Abschnitt ist nach dem Druckknopf offen
 *   (`beforeprint` selbst ausgelöst, `emulateMedia` feuert es nicht), zwei Spalten, kein Knoten
 *   ragt aus der Druckwurzel, Werkzeugzeile und Umschalter sind aus.
 * - LIVE: ein per API umgehängter Unterabschnitt steht ohne Neuladen unter dem neuen Abschnitt.
 * - ÜBERNAHME: genau EIN POST auf `…/lageberichte`, kein PATCH, danach der Bericht offen.
 *
 * Mutationsproben (Prüfliste): `SPALTE_MIN_PX` auf 600 → am Fükw nur eine Spalte je Zeile, der
 * Mehrspaltennachweis wird rot; `organigrammPrint.css` ohne Ausblenden der Klappziele → Druckpfad
 * rot. Die festen zwei Druckspalten sind bei A4 (680 px) mit 300 px Mindestbreite ohnehin zwei;
 * die Regel sichert nur gegen eine spätere Änderung von `SPALTE_MIN_PX` ab.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const FUEKW = { width: 1366, height: 768 };

/** Absichtlich lange, aber reale Werte. */
const ABSCHNITT = 'Deichverteidigung Nordwest II';
const KURZ = 'EA-NORD-2';
const EINHEIT = 'Fachgruppe Wasserschaden Musterstadt-Nordwest';
const EINHEIT_RUF = 'Florian Musterstadt 1/10';
const FUEHRER = 'Kirchgassner-Wohlfahrt, Maximiliane';
const STAERKE = '12/34/156//202';
const SUBPIXEL = 0.5;
/** A4 hoch, nutzbar (wie `funkplan.spec.ts`, `druck-fluss.spec.ts`). */
const A4_DRUCKBREITE = 680;
const BREITEN = [
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
];

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzAnlegen(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  return page.url().match(/\/einsaetze\/(\d+)/)![1];
}

async function post(page: Page, einsatzId: string, pfad: string, data: unknown): Promise<number> {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/${pfad}`, { data });
  expect(antwort.ok(), `Seeding ${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return ((await antwort.json()) as { id: number }).id;
}

test('Messung vor dem Bau: Contentbreite am Fükw und Laufweiten langer Werte', async ({ page }) => {
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Organigramm Messung ${Date.now()}`);
  const abschnitt = await post(page, einsatzId, 'abschnitte', {
    name: ABSCHNITT,
    kurzbezeichnung: KURZ,
  });
  await post(page, einsatzId, 'einheiten', {
    name: EINHEIT,
    funkrufname: EINHEIT_RUF,
    abschnitt_id: abschnitt,
  });
  await page.goto(`/einsaetze/${einsatzId}/einsatzabschnitte`);
  await expect(page.getByText(ABSCHNITT).first()).toBeVisible();
  await expect(page.locator('[data-lfh="modul-panel"]'), 'Panel offen am Fükw').toBeVisible();

  const messwerte = await page.evaluate(
    async ({ text, mono }) => {
      await document.fonts.ready;
      const inhalt = document.querySelector('[data-lfh="seiten-inhalt"]') as HTMLElement;
      const s = getComputedStyle(inhalt);
      const contentBreite =
        inhalt.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
      const grund = getComputedStyle(document.body);
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
      document.body.append(probe);
      const miss = (wert: string, schrift: string) => {
        probe.style.font = schrift;
        probe.textContent = wert;
        return Math.ceil(probe.getBoundingClientRect().width);
      };
      const textSchrift = `600 ${grund.fontSize} ${grund.fontFamily}`;
      const monoSchrift = "400 12px 'LFH JetBrains Mono', ui-monospace, monospace";
      const ergebnis: Record<string, number> = {
        contentBreite,
        grundSchriftPx: parseFloat(grund.fontSize),
      };
      for (const [k, v] of Object.entries(text)) ergebnis[`text:${k}`] = miss(v, textSchrift);
      for (const [k, v] of Object.entries(mono)) ergebnis[`mono:${k}`] = miss(v, monoSchrift);
      probe.remove();
      return ergebnis;
    },
    {
      text: { abschnitt: ABSCHNITT, einheit: EINHEIT, fuehrer: FUEHRER },
      mono: { kurz: KURZ, einheitRuf: EINHEIT_RUF, staerke: STAERKE },
    },
  );
  for (const [k, v] of Object.entries(messwerte)) {
    test.info().annotations.push({ type: 'messwert', description: `${k}=${v}` });
    console.log(`messwert ${k}=${v}`);
  }
  expect(messwerte.contentBreite).toBeGreaterThan(0);
});

/** Acht oberste Abschnitte mit je drei Einheiten, im ersten ein Unterabschnitt. */
async function seedeGross(page: Page, einsatzId: string) {
  const abschnitte: number[] = [];
  for (let i = 1; i <= 8; i++) {
    const id = await post(page, einsatzId, 'abschnitte', {
      name: i === 1 ? ABSCHNITT : `Einsatzabschnitt ${i}`,
      kurzbezeichnung: `EA-${i}`,
    });
    abschnitte.push(id);
    for (let j = 1; j <= 3; j++) {
      await post(page, einsatzId, 'einheiten', {
        name: i === 1 && j === 1 ? EINHEIT : `Einheit ${i}.${j}`,
        funkrufname: i === 1 && j === 1 ? EINHEIT_RUF : `Florian ${i}/${j}`,
        abschnitt_id: id,
      });
    }
  }
  const unter = await post(page, einsatzId, 'abschnitte', {
    name: 'Unterabschnitt Deich',
    ueber_abschnitt_id: abschnitte[0],
  });
  await post(page, einsatzId, 'einheiten', { name: 'Gruppe Deich', abschnitt_id: unter });
  return { abschnitte, unter };
}

const organigramm = (page: Page) => page.getByRole('region', { name: 'Organigramm' });

async function oeffneOrganigramm(page: Page, einsatzId: string) {
  await page.goto(`/einsaetze/${einsatzId}/einsatzabschnitte?ansicht=organigramm`);
  // Datenanker: die Einheit steht erst, wenn Abschnitte und Einheiten geladen sind.
  await expect(organigramm(page).getByRole('link', { name: 'Gruppe Deich' })).toBeVisible();
}

/** Überhang von Seite und Organigramm sowie der Knoten über den rechten Rand. */
async function ueberhaenge(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const org = document.querySelector('[data-lfh="organigramm"]') as HTMLElement;
    const rechts = org.getBoundingClientRect().right;
    const knotenRechts = Math.max(
      ...Array.from(document.querySelectorAll('[data-lfh="org-knoten"]')).map(
        (k) => k.getBoundingClientRect().right,
      ),
    );
    return {
      seite: doc.scrollWidth - doc.clientWidth,
      organigramm: org.scrollWidth - org.clientWidth,
      knoten: knotenRechts - rechts,
      zeilen: new Set(
        Array.from(document.querySelectorAll('[data-lfh="org-spalte"]')).map((s) =>
          Math.round(s.getBoundingClientRect().top),
        ),
      ).size,
      spalten: new Set(
        Array.from(document.querySelectorAll('[data-lfh="org-spalte"]')).map((s) =>
          Math.round(s.getBoundingClientRect().left),
        ),
      ).size,
    };
  });
}

test('Fükw mit offenem Panel und acht Abschnitten: Spalten in Zeilen, kein Überhang', async ({
  page,
}) => {
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Organigramm Fükw ${Date.now()}`);
  await seedeGross(page, einsatzId);
  await oeffneOrganigramm(page, einsatzId);
  await expect(page.locator('[data-lfh="modul-panel"]'), 'Panel offen am Fükw').toBeVisible();

  const m = await ueberhaenge(page);
  expect(m.seite, `Seite ohne Überhang (${m.seite}px)`).toBeLessThanOrEqual(SUBPIXEL);
  expect(m.organigramm, `Organigramm ohne Überhang (${m.organigramm}px)`).toBeLessThanOrEqual(
    SUBPIXEL,
  );
  expect(m.knoten, `kein Knoten über dem Rand (${m.knoten}px)`).toBeLessThanOrEqual(SUBPIXEL);
  expect(m.spalten, 'mehrere Spalten nebeneinander').toBeGreaterThanOrEqual(3);
  expect(m.zeilen, 'acht Abschnitte brechen in mehrere Zeilen um').toBeGreaterThan(1);

  // Die Einsatzleitung trägt ihre Lücke als Wort, keine Zahl.
  const el = organigramm(page).getByRole('group', { name: 'Einsatzleitung' });
  await expect(el).toContainText('Leitung nicht erfasst');
  await expect(el).not.toContainText('//');
});

for (const groesse of BREITEN) {
  test(`${groesse.width} px: kein waagerechter Überhang`, async ({ page }) => {
    await anmelden(page);
    const einsatzId = await einsatzAnlegen(page, `E2E Organigramm ${groesse.width} ${Date.now()}`);
    await seedeGross(page, einsatzId);
    await page.setViewportSize(groesse);
    await oeffneOrganigramm(page, einsatzId);
    const m = await ueberhaenge(page);
    expect(m.seite, `Seite ohne Überhang (${m.seite}px)`).toBeLessThanOrEqual(SUBPIXEL);
    expect(m.organigramm, `Organigramm ohne Überhang (${m.organigramm}px)`).toBeLessThanOrEqual(
      SUBPIXEL,
    );
    expect(m.knoten, `kein Knoten über dem Rand (${m.knoten}px)`).toBeLessThanOrEqual(SUBPIXEL);
  });
}

test('Druckpfad bei A4-Breite: alles offen, zwei Spalten, nichts ragt heraus', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Organigramm Druck ${Date.now()}`);
  await seedeGross(page, einsatzId);
  await page.setViewportSize({ width: A4_DRUCKBREITE, height: 900 });
  await oeffneOrganigramm(page, einsatzId);

  // Einen Abschnitt zuklappen: der Druck muss ihn wieder öffnen.
  await organigramm(page)
    .getByRole('button', { name: `Unterstellte von ${ABSCHNITT}` })
    .click();
  await expect(organigramm(page).getByRole('link', { name: 'Gruppe Deich' })).toHaveCount(0);

  // `window.print` als Stub, der wie der Browser synchron `beforeprint` feuert.
  await page.evaluate(() => {
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
    };
  });
  await page.getByRole('button', { name: 'Drucken / als PDF' }).click();
  await page.emulateMedia({ media: 'print' });

  await expect(organigramm(page).getByRole('link', { name: 'Gruppe Deich' })).toHaveCount(1);
  const lage = await page.evaluate(() => {
    const wurzel = document.querySelector('.organigramm-print-root')!.getBoundingClientRect();
    const knotenRechts = Math.max(
      ...Array.from(document.querySelectorAll('[data-lfh="org-knoten"]')).map(
        (k) => k.getBoundingClientRect().right,
      ),
    );
    return {
      wurzelRechts: wurzel.right,
      knotenRechts,
      spalten: new Set(
        Array.from(document.querySelectorAll('[data-lfh="org-spalte"]')).map((s) =>
          Math.round(s.getBoundingClientRect().left),
        ),
      ).size,
      werkzeuge: getComputedStyle(document.querySelector('.organigramm-no-print')!).display,
      umschalter: getComputedStyle(document.querySelector('[role="radiogroup"]')!).display,
      klappen: getComputedStyle(document.querySelector('[data-lfh="org-klappen"]')!).display,
      kopf: document
        .querySelector('.organigramm-print-root')!
        .textContent!.includes('Führungsorganisation'),
    };
  });
  expect(lage.werkzeuge, 'Werkzeugzeile im Druck aus').toBe('none');
  expect(lage.umschalter, 'Umschalter im Druck aus').toBe('none');
  expect(lage.klappen, 'Klappziele im Druck aus').toBe('none');
  expect(lage.kopf, 'Druckkopf „Führungsorganisation“').toBe(true);
  expect(lage.spalten, 'A4: zwei feste Spalten').toBe(2);
  expect(
    lage.knotenRechts,
    `kein Knoten über der Druckwurzel (Knoten ${lage.knotenRechts}px, Wurzel ${lage.wurzelRechts}px)`,
  ).toBeLessThanOrEqual(lage.wurzelRechts + SUBPIXEL);
  await page.emulateMedia({ media: null });
});

test('live: ein umgehängter Unterabschnitt steht ohne Neuladen am neuen Ort', async ({ page }) => {
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Organigramm Live ${Date.now()}`);
  const { abschnitte, unter } = await seedeGross(page, einsatzId);
  await oeffneOrganigramm(page, einsatzId);

  const spalte = (name: string) =>
    organigramm(page)
      .locator('[data-lfh="org-spalte"]')
      .filter({ has: page.getByRole('link', { name, exact: true }) });
  await expect(spalte(ABSCHNITT).getByRole('link', { name: 'Unterabschnitt Deich' })).toBeVisible();

  const antwort = await page.request.patch(`/api/einsaetze/${einsatzId}/abschnitte/${unter}`, {
    data: { ueber_abschnitt_id: abschnitte[1] },
  });
  expect(antwort.ok(), `Umhängen: ${await antwort.text()}`).toBeTruthy();

  await expect(
    spalte('Einsatzabschnitt 2').getByRole('link', { name: 'Unterabschnitt Deich' }),
  ).toBeVisible();
  await expect(spalte(ABSCHNITT).getByRole('link', { name: 'Unterabschnitt Deich' })).toHaveCount(
    0,
  );
});

test('Übernahme: genau ein POST, kein PATCH, danach der Bericht', async ({ page }) => {
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Organigramm Übernahme ${Date.now()}`);
  await seedeGross(page, einsatzId);
  await oeffneOrganigramm(page, einsatzId);

  const anfragen: string[] = [];
  page.on('request', (r) => {
    if (/\/lageberichte(\/\d+)?$/.test(new URL(r.url()).pathname) && r.method() !== 'GET') {
      anfragen.push(`${r.method()} ${new URL(r.url()).pathname}`);
    }
  });
  await page.getByRole('button', { name: 'In Lagebericht übernehmen' }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/lageberichte/\\d+$`));
  expect(anfragen).toEqual([`POST /api/einsaetze/${einsatzId}/lageberichte`]);
  await expect(page.getByText(ABSCHNITT).first()).toBeVisible();
});
