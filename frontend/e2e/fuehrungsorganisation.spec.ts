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
  // Der Zeiger steht noch, wo der letzte Klick war, womöglich über dem Organigramm: dann hielte
  // die Zufluss-Schleuse (LFH-867) jede Live-Änderung zurück. Ruhestellung oben links.
  await page.mouse.move(0, 0);
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

// ── Zufluss-Schleuse (LFH-867): kein Sprung unter Fokus oder Zeiger ──────────────────────────────
//
// Die Schleuse sitzt im Gerüst `HaengenderBaum`. Gemessen wird das Rechteck des Links, auf den
// jemand zielt: ohne Schleuse schöbe ein neuer oder umgehängter Knoten davor ihn sofort weg.
// Mutationsproben (Prüfliste, Kriterium 12): `offen` im Gerüst fest auf `true` → alle Schleusenfälle
// hier und der Skizzenfall in `funkplan.spec.ts` werden rot (kein Banner, das Rechteck springt);
// `druckt ||` gestrichen → der Druckfall wird rot.

/** Drei oberste Abschnitte; im ersten ein Unterabschnitt mit Einheit, danach die Einheit EINHEIT. */
async function seedeKlein(page: Page, einsatzId: string) {
  const abschnitte: number[] = [];
  for (let i = 1; i <= 3; i++) {
    abschnitte.push(
      await post(page, einsatzId, 'abschnitte', {
        name: i === 1 ? ABSCHNITT : `Einsatzabschnitt ${i}`,
        kurzbezeichnung: `EA-${i}`,
      }),
    );
  }
  const unter = await post(page, einsatzId, 'abschnitte', {
    name: 'Unterabschnitt Deich',
    ueber_abschnitt_id: abschnitte[0],
  });
  await post(page, einsatzId, 'einheiten', { name: 'Gruppe Deich', abschnitt_id: unter });
  await post(page, einsatzId, 'einheiten', {
    name: EINHEIT,
    funkrufname: EINHEIT_RUF,
    abschnitt_id: abschnitte[0],
  });
  return { abschnitte, unter };
}

const stand = (page: Page) => organigramm(page).locator('[data-lfh="org-stand"]');
const ziel = (page: Page) => organigramm(page).getByRole('link', { name: EINHEIT, exact: true });

async function rechteck(page: Page) {
  const box = await ziel(page).boundingBox();
  expect(box, 'Ziel-Link sichtbar').not.toBeNull();
  return box!;
}

test('Schleuse, Fokus: ein live angelegter Unterabschnitt schiebt den fokussierten Link nicht', async ({
  page,
}) => {
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Organigramm Fokus ${Date.now()}`);
  const { abschnitte } = await seedeKlein(page, einsatzId);
  await oeffneOrganigramm(page, einsatzId);
  await expect(stand(page)).toHaveText('Live');

  await ziel(page).focus();
  const vorher = await rechteck(page);
  await post(page, einsatzId, 'abschnitte', {
    name: 'Unterabschnitt Neu',
    ueber_abschnitt_id: abschnitte[0],
  });

  await expect(stand(page).getByRole('status')).toContainText('1 neu');
  await expect(organigramm(page).getByRole('link', { name: 'Unterabschnitt Neu' })).toHaveCount(0);
  await expect(ziel(page)).toBeFocused();
  const nachher = await rechteck(page);
  expect(nachher.y, 'der fokussierte Link bleibt stehen').toBe(vorher.y);
  expect(nachher.x).toBe(vorher.x);

  // „anzeigen“ wendet den Live-Stand an; erst jetzt rückt der Link.
  await stand(page).getByRole('button', { name: 'anzeigen' }).click();
  await expect(organigramm(page).getByRole('link', { name: 'Unterabschnitt Neu' })).toBeVisible();
  await expect(stand(page).getByRole('status')).toHaveCount(0);
  expect((await rechteck(page)).y).toBeGreaterThan(vorher.y);
});

test('Schleuse, Fokus: ein aufgelöster Abschnitt unter dem Fokus bleibt als Platzhalter stehen', async ({
  page,
}) => {
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Organigramm Entfallen ${Date.now()}`);
  const { abschnitte } = await seedeKlein(page, einsatzId);
  await oeffneOrganigramm(page, einsatzId);

  const dritter = organigramm(page).getByRole('link', { name: 'Einsatzabschnitt 3', exact: true });
  // Gemessen wird die Spalte: der Platzhalter zeichnet kein Zeichen vor den Namen.
  const spalten = organigramm(page).locator('[data-lfh="org-spalte"]');
  await dritter.focus();
  const vorher = await spalten
    .filter({ has: page.getByRole('link', { name: 'Einsatzabschnitt 3', exact: true }) })
    .boundingBox();
  const antwort = await page.request.delete(
    `/api/einsaetze/${einsatzId}/abschnitte/${abschnitte[2]}`,
  );
  expect(antwort.ok(), `Auflösen: ${await antwort.text()}`).toBeTruthy();

  // Der Link wird zum Platzhalter ohne Link; der Fokus fällt nicht auf `body`, sondern auf die
  // Standzeile, und die Schleuse hält weiter.
  const platz = organigramm(page).locator('[data-lfh="org-entfallen"]');
  await expect(platz).toContainText('Einsatzabschnitt 3');
  await expect(stand(page).getByRole('status')).toContainText('1 entfallen');
  await expect(stand(page)).toBeFocused();
  expect(
    await spalten.filter({ has: page.locator('[data-lfh="org-entfallen"]') }).boundingBox(),
    'die Spalte steht still',
  ).toEqual(vorher);

  await stand(page).getByRole('button', { name: 'anzeigen' }).click();
  await expect(platz).toHaveCount(0);
});

test('Schleuse, Zeiger: ein umgehängter Unterabschnitt springt nicht unter dem Zeiger', async ({
  page,
}) => {
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Organigramm Zeiger ${Date.now()}`);
  const { abschnitte, unter } = await seedeKlein(page, einsatzId);
  await oeffneOrganigramm(page, einsatzId);

  await ziel(page).hover();
  await expect(stand(page)).toHaveText('Live pausiert');
  const vorher = await rechteck(page);
  const antwort = await page.request.patch(`/api/einsaetze/${einsatzId}/abschnitte/${unter}`, {
    data: { ueber_abschnitt_id: abschnitte[1] },
  });
  expect(antwort.ok(), `Umhängen: ${await antwort.text()}`).toBeTruthy();

  await expect(stand(page).getByRole('status')).toContainText('1 umgehängt');
  expect((await rechteck(page)).y, 'der Link unter dem Zeiger bleibt stehen').toBe(vorher.y);
  const spalte = (name: string) =>
    organigramm(page)
      .locator('[data-lfh="org-spalte"]')
      .filter({ has: page.getByRole('link', { name, exact: true }) });
  await expect(spalte(ABSCHNITT).getByRole('link', { name: 'Unterabschnitt Deich' })).toBeVisible();

  // Der Zeiger geht: der Live-Stand gilt, ohne Banner.
  await page.mouse.move(0, 0);
  await expect(
    spalte('Einsatzabschnitt 2').getByRole('link', { name: 'Unterabschnitt Deich' }),
  ).toBeVisible();
  await expect(stand(page)).toHaveText('Live');
  expect((await rechteck(page)).y).toBeLessThan(vorher.y);
});

for (const groesse of [FUEKW, { width: 390, height: 844 }]) {
  test(`Schleuse bei ${groesse.width} px: der Banner verschiebt die erste Ebene nicht`, async ({
    page,
  }) => {
    await page.setViewportSize(groesse);
    await anmelden(page);
    const einsatzId = await einsatzAnlegen(page, `E2E Organigramm Banner ${Date.now()}`);
    await seedeKlein(page, einsatzId);
    await oeffneOrganigramm(page, einsatzId);
    const ebene1 = organigramm(page).locator('[data-lfh="org-ebene1"]');
    // Seitenbezogen: „anzeigen“ und der Fokus dürfen die Seite rollen, das ist kein Sprung.
    const oben = () => ebene1.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);

    await ziel(page).focus();
    const ruhe = await oben();
    await post(page, einsatzId, 'abschnitte', { name: 'Einsatzabschnitt Neu' });
    await expect(stand(page).getByRole('status')).toContainText('1 neu');
    expect(await oben(), 'Banner erscheint: erste Ebene bleibt').toBe(ruhe);
    const ueberhang = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(ueberhang, 'der Banner läuft nicht über').toBeLessThanOrEqual(SUBPIXEL);

    await stand(page).getByRole('button', { name: 'anzeigen' }).click();
    await expect(stand(page).getByRole('status')).toHaveCount(0);
    expect(await oben(), 'Banner verschwindet: erste Ebene bleibt').toBe(ruhe);
  });
}

test('Schleuse: der gehaltene Kopf folgt trotzdem der Breite', async ({ page }) => {
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Organigramm Kopf ${Date.now()}`);
  await seedeKlein(page, einsatzId);
  await oeffneOrganigramm(page, einsatzId);
  const kopfReihe = organigramm(page)
    .locator('[data-lfh="org-einsatzleitung"]')
    .locator('xpath=..');
  await expect(kopfReihe).toHaveCSS('flex-direction', 'row');

  // Gehalten wird der Inhalt des Kopfs, nicht seine Anordnung: unter `md` steht er untereinander,
  // sonst liefe er bei 390 px waagerecht über.
  await ziel(page).focus();
  await expect(stand(page)).toHaveText('Live pausiert');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(kopfReihe).toHaveCSS('flex-direction', 'column');
  await expect(stand(page)).toHaveText('Live pausiert');
});

test('Schleuse im Druck: ein wartender Abschnitt steht auf dem Papier, die Standzeile nicht', async ({
  page,
}) => {
  await page.setViewportSize({ width: A4_DRUCKBREITE, height: 900 });
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Organigramm Druck wartend ${Date.now()}`);
  await seedeKlein(page, einsatzId);
  await oeffneOrganigramm(page, einsatzId);

  // Gehalten über den Fokus: der Zeiger hielte nicht, das Druckmedium baut das Layout um und
  // Chromium meldet dann `pointerleave` — die Schleuse öffnete auch ohne Druckweiche.
  await ziel(page).focus();
  await post(page, einsatzId, 'abschnitte', { name: 'Einsatzabschnitt Neu' });
  await expect(stand(page).getByRole('status')).toContainText('1 neu');

  // Strg+P: der Browser feuert `beforeprint`, der Fokus bleibt im Organigramm.
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print' });
  await expect(organigramm(page).getByRole('link', { name: 'Einsatzabschnitt Neu' })).toHaveCount(
    1,
  );
  await expect(stand(page)).toBeHidden();
  await expect(ziel(page)).toBeFocused();
  await page.emulateMedia({ media: null });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
});
