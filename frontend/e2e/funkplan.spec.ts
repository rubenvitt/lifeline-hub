import { expect, test, type Page } from '@playwright/test';

/**
 * Funkplan S6 (LFH-548): die Nachweise, die NUR im Browser gehen. jsdom rechnet kein Layout,
 * wertet `@media print` nicht aus und kennt keine Contentbreite.
 *
 * - MESSUNG (Aufgabe 1.1, Akzeptanzkriterium „Breite vor dem Bau“): Contentbreite am Fükw mit
 *   offenem Panel und die Laufweiten langer Werte. Die Werte stehen in design.md D4 (Nachtrag);
 *   hier bleiben sie als Annotation stehen, und die Tabelle hat am Fükw keinen Überhang.
 * - LÜCKEN IM ERSTEN BILD bei 1366 × 768 mit offenem Modulpanel (`toBeInViewport`).
 * - 390 px: Tabelle, nicht Karten; die Kennung bleibt fixiert.
 * - DRUCKPFAD bei A4-Breite (680 px, unter `xl`): alle Knoten offen, die Erreichbarkeit steht
 *   trotzdem da (`beforeprint` selbst ausgelöst, `emulateMedia` feuert es nicht), nichts ragt
 *   rechts aus der Druckwurzel.
 * - ÜBERNAHME: genau EIN POST auf `…/lageberichte`, kein PATCH, danach der Bericht offen.
 * - ZEILENLINK: die Kennung einer Einheit führt auf ihre Detailseite.
 *
 * Mutationsprobe (Prüfliste): `abBreite: 'xl'` an der Erreichbarkeit auch im Druck → der
 * Druckpfad wird rot.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const FUEKW = { width: 1366, height: 768 };
const HANDSCHIRM = { width: 390, height: 844 };
/** A4 hoch, nutzbar (wie `meldebild-tabelle.spec.ts`, `druck-fluss.spec.ts`). */
const A4_DRUCKBREITE = 680;
const SUBPIXEL = 0.5;

/** Absichtlich lange, aber reale Werte (dieselben wie in der Messung vor dem Bau). */
const ABSCHNITT = 'Deichverteidigung Nordwest II';
const KURZ = 'EA-NORD-2';
const EINHEIT = 'Fachgruppe Wasserschaden Musterstadt-Nordwest';
const EINHEIT_RUF = 'Florian Musterstadt 1/10';
const ERREICHBAR = '+49 171 1234567';
const FAHRZEUG = 'Florian Musterstadt-Nordwest 1/42-1';
const FUEHRER = 'Kirchgassner-Wohlfahrt, Maximiliane';
const LOKAL = 'DMO 999 Reserve';

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

/**
 * Ein Abschnitt mit Sprechgruppen, eine Einheit darunter mit Erreichbarkeit und ohne
 * Sprechgruppe, ein Fahrzeug mit Führer in der Einheit, ein Fahrzeug ohne Einheit (Sammelknoten)
 * und eine nicht zugeordnete einsatzlokale Sprechgruppe: jede Lücke hat einen Treffer.
 */
async function seede(page: Page, einsatzId: string) {
  const basis = `/api/einsaetze/${einsatzId}`;
  const post = async (pfad: string, data: unknown) => {
    const antwort = await page.request.post(`${basis}/${pfad}`, { data });
    expect(
      antwort.ok(),
      `Seeding ${pfad}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
    return ((await antwort.json()) as { id: number }).id;
  };
  const tmo = await post('sprechgruppen', { bezeichnung: 'TMO 412_F_DRK', betriebsart: 'TMO' });
  const dmo = await post('sprechgruppen', { bezeichnung: 'DMO 505', betriebsart: 'DMO' });
  await post('sprechgruppen', { bezeichnung: LOKAL, betriebsart: 'DMO' });
  const abschnitt = await post('abschnitte', {
    name: ABSCHNITT,
    kurzbezeichnung: KURZ,
    kommunikationsmittel: 'digitalfunk',
    sprechgruppe_ids: [tmo, dmo],
  });
  const einheit = await post('einheiten', {
    name: EINHEIT,
    funkrufname: EINHEIT_RUF,
    abschnitt_id: abschnitt,
    erreichbarkeit: ERREICHBAR,
  });
  const fahrzeug = await post('fahrzeuge', {
    adhoc: { funkrufname: FAHRZEUG, fahrzeugtyp: 'HLF 20' },
  });
  const zuordnung = await page.request.put(`${basis}/einheiten/${einheit}/fahrzeug/${fahrzeug}`);
  expect(zuordnung.ok(), `Zuordnung: ${await zuordnung.text()}`).toBeTruthy();
  const fuehrer = await post('personal', {
    adhoc: { name: FUEHRER, staerke_position: 'fuehrer' },
  });
  const besatzung = await page.request.put(`${basis}/fahrzeuge/${fahrzeug}/besatzung/${fuehrer}`);
  expect(besatzung.ok(), `Besatzung: ${await besatzung.text()}`).toBeTruthy();
  await post('fahrzeuge', { adhoc: { funkrufname: 'Florian ELW 1' } });
  return { einheit };
}

const tabelle = (page: Page) => page.getByRole('region', { name: 'Funkplan' });

async function oeffne(page: Page, einsatzId: string) {
  await page.goto(`/einsaetze/${einsatzId}/stab/funkplan`);
  // Datenanker: das Fahrzeug steht erst, wenn Abschnitt, Einheit und Fahrzeug geladen sind.
  await expect(tabelle(page).getByText(FAHRZEUG)).toBeVisible();
}

test('Fükw mit offenem Panel: Messwerte, kein Überhang, Lücken im ersten Bild', async ({
  page,
}) => {
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Funkplan ${Date.now()}`);
  await seede(page, einsatzId);
  await oeffne(page, einsatzId);

  await expect(page.locator('[data-lfh="modul-panel"]'), 'Panel offen am Fükw').toBeVisible();

  // ── Messung (Aufgabe 1.1): Contentbreite und Laufweiten in der Tabellenschrift.
  const messwerte = await page.evaluate(
    async ({ werte }) => {
      await document.fonts.ready;
      const inhalt = document.querySelector('[data-lfh="seiten-inhalt"]') as HTMLElement;
      const s = getComputedStyle(inhalt);
      const contentBreite =
        inhalt.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
      const zelle = document.querySelector('tr.ant-table-row td:nth-child(2)') as HTMLElement;
      const zs = getComputedStyle(zelle);
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
      document.body.append(probe);
      const miss = (wert: string, schrift: string) => {
        probe.style.font = schrift;
        probe.textContent = wert;
        return Math.ceil(probe.getBoundingClientRect().width);
      };
      const mono = "400 12px 'LFH JetBrains Mono', ui-monospace, monospace";
      const ergebnis: Record<string, number> = {
        contentBreite,
        zellpolster: parseFloat(zs.paddingLeft) + parseFloat(zs.paddingRight),
      };
      for (const [k, v] of Object.entries(werte)) ergebnis[`mono:${k}`] = miss(v, mono);
      probe.remove();
      return ergebnis;
    },
    {
      werte: {
        kurz: KURZ,
        einheitRuf: EINHEIT_RUF,
        fahrzeug: FAHRZEUG,
        sprechgruppe: 'TMO 412_F_DRK',
      },
    },
  );
  for (const [k, v] of Object.entries(messwerte)) {
    test.info().annotations.push({ type: 'messwert', description: `${k}=${v}` });
  }

  // Die Spaltenbreiten (Σ 1020 px) passen in die Contentbreite: kein waagerechter Bildlauf,
  // auch mit der Erreichbarkeit (1366 ≥ xl).
  await expect(tabelle(page).getByRole('columnheader', { name: 'Erreichbarkeit' })).toBeVisible();
  const ueberhang = await page
    .locator('.ant-table-body')
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(ueberhang, `Tabelle am Fükw ohne Überhang (gemessen ${ueberhang}px)`).toBeLessThanOrEqual(
    SUBPIXEL,
  );

  // ── Lücken im ersten Bild, mit ihren Zahlen.
  const luecken = page.getByRole('region', { name: 'Lücken' });
  await expect(luecken).toBeInViewport();
  const zeile = (titel: string) =>
    luecken.locator('[data-lfh="funkplan-luecke"]').filter({ hasText: titel });
  await expect(zeile('Einheiten ohne Sprechgruppe')).toContainText('1');
  await expect(
    zeile('Einheiten ohne Sprechgruppe').getByRole('link', { name: EINHEIT }),
  ).toBeVisible();
  await expect(zeile('Abschnitte ohne Sprechgruppe')).toContainText('0');
  await expect(zeile('Einsatzlokale Sprechgruppen ohne Zuordnung')).toContainText(LOKAL);
  await expect(luecken.getByText('nicht erfasst')).toBeInViewport();
});

test('390 px: Tabelle statt Karten, die Kennung bleibt fixiert', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Funkplan schmal ${Date.now()}`);
  await seede(page, einsatzId);
  await page.setViewportSize(HANDSCHIRM);
  await oeffne(page, einsatzId);
  await expect(tabelle(page).locator('.ant-table')).toHaveCount(1);
  await expect(page.locator('[data-lfh="datensicht-karte"]')).toHaveCount(0);
  const fixiert = tabelle(page).locator('th.ant-table-cell-fix-start');
  await expect(fixiert).toHaveCount(1);
  await expect(fixiert).toHaveText('Stelle');
  await expect(fixiert).toHaveCSS('position', 'sticky');
});

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

test('Übernahme: genau ein POST, kein PATCH, danach der Bericht', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Funkplan Übernahme ${Date.now()}`);
  await seede(page, einsatzId);
  await page.setViewportSize(FUEKW);
  await oeffne(page, einsatzId);

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
  await expect(page.getByText(ERREICHBAR)).toHaveCount(0);
});

test('die Kennung einer Einheit führt auf ihre Detailseite', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Funkplan Link ${Date.now()}`);
  const { einheit } = await seede(page, einsatzId);
  await page.setViewportSize(FUEKW);
  await oeffne(page, einsatzId);
  await tabelle(page).getByRole('link', { name: EINHEIT }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/einheiten/${einheit}$`));
});

// ── Darstellung „Skizze“: die Fernmeldeskizze (LFH-625) ──────────────────────────────────────────
//
// - MESSUNG (Aufgabe 4.1, „vor dem Bau messen“): Contentbreite der Funkplan-Seite am Fükw mit
//   offenem Panel und die Laufweiten langer Funkangaben in Mono 12. Die Werte stehen in
//   design.md D5 (Nachtrag); `SPALTE_MIN_PX` des geteilten Gerüsts trägt sie.
// - BREITE: acht Abschnitte mit je drei Einheiten mit Sprechgruppen — am Fükw mehrere Zeilen von
//   Spalten, bei 1024, 768 und 390 px ohne Überhang von Seite, Skizze und Knoten.
// - LÜCKEN IM ERSTEN BILD auch in der Skizze, mit der neuen Zeile.
// - DRUCKPFAD bei A4 (680 px): zugeklappter Abschnitt offen, Druckkopf „Fernmeldeskizze“,
//   Bedienung aus, kein Knoten über der Druckwurzel.
// - LIVE: eine per API zugeordnete Sprechgruppe macht aus „keine gemeinsame Sprechgruppe“ ohne
//   Neuladen die gemeinsame Kante.

/** Eine absichtlich lange, aber reale Bezeichnung (≥ 24 Zeichen). */
const SG_LANG = 'TMO 412_F_DRK Nordwest-Reserve';
const KANTE_LANG = `⇄ TMO ${SG_LANG} · DMO 505`;
const OHNE_KANAL = 'Gruppe ohne Kanal';

async function seedeSkizze(page: Page, einsatzId: string) {
  const basis = `/api/einsaetze/${einsatzId}`;
  const post = async (pfad: string, data: unknown) => {
    const antwort = await page.request.post(`${basis}/${pfad}`, { data });
    expect(
      antwort.ok(),
      `Seeding ${pfad}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
    return ((await antwort.json()) as { id: number }).id;
  };
  const tmo = await post('sprechgruppen', { bezeichnung: SG_LANG, betriebsart: 'TMO' });
  const dmo = await post('sprechgruppen', { bezeichnung: 'DMO 505', betriebsart: 'DMO' });
  const fremd = await post('sprechgruppen', { bezeichnung: 'DMO 606', betriebsart: 'DMO' });
  let ohneKanal = 0;
  for (let i = 1; i <= 8; i++) {
    const abschnitt = await post('abschnitte', {
      name: i === 1 ? ABSCHNITT : `Einsatzabschnitt ${i}`,
      kurzbezeichnung: i === 1 ? KURZ : `EA-${i}`,
      sprechgruppe_ids: [tmo, dmo],
    });
    for (let j = 1; j <= 3; j++) {
      const ohne = i === 1 && j === 3;
      const id = await post('einheiten', {
        name: ohne ? OHNE_KANAL : i === 1 && j === 1 ? EINHEIT : `Einheit ${i}.${j}`,
        funkrufname: i === 1 && j === 1 ? EINHEIT_RUF : `Florian ${i}/${j}`,
        abschnitt_id: abschnitt,
        sprechgruppe_ids: ohne ? [fremd] : [dmo, tmo],
      });
      if (ohne) ohneKanal = id;
    }
  }
  return { ohneKanal, dmo };
}

const skizze = (page: Page) => page.getByRole('region', { name: 'Fernmeldeskizze' });

async function oeffneSkizze(page: Page, einsatzId: string) {
  await page.goto(`/einsaetze/${einsatzId}/stab/funkplan?ansicht=skizze`);
  // Datenanker: die Einheit steht erst, wenn Abschnitte und Einheiten geladen sind.
  await expect(skizze(page).getByRole('link', { name: OHNE_KANAL })).toBeVisible();
}

/** Überhang von Seite und Skizze, Knoten über den rechten Rand, Spalten und Zeilen. */
async function skizzenMasse(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const bild = document.querySelector('[data-lfh="skizze"]') as HTMLElement;
    const rechts = bild.getBoundingClientRect().right;
    const spalten = Array.from(bild.querySelectorAll('[data-lfh="org-spalte"]'));
    return {
      seite: doc.scrollWidth - doc.clientWidth,
      skizze: bild.scrollWidth - bild.clientWidth,
      knoten:
        Math.max(
          ...Array.from(bild.querySelectorAll('[data-lfh="org-knoten"]')).map(
            (k) => k.getBoundingClientRect().right,
          ),
        ) - rechts,
      spalten: new Set(spalten.map((s) => Math.round(s.getBoundingClientRect().left))).size,
      zeilen: new Set(spalten.map((s) => Math.round(s.getBoundingClientRect().top))).size,
    };
  });
}

test('Skizze am Fükw: Messwerte, Spalten in Zeilen, kein Überhang, Lücken im ersten Bild', async ({
  page,
}) => {
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Fernmeldeskizze ${Date.now()}`);
  await seedeSkizze(page, einsatzId);
  await oeffneSkizze(page, einsatzId);
  await expect(page.locator('[data-lfh="modul-panel"]'), 'Panel offen am Fükw').toBeVisible();

  // ── Messung (Aufgabe 4.1).
  const messwerte = await page.evaluate(
    async ({ werte }) => {
      await document.fonts.ready;
      const inhalt = document.querySelector('[data-lfh="seiten-inhalt"]') as HTMLElement;
      const s = getComputedStyle(inhalt);
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
      document.body.append(probe);
      const mono = "400 12px 'LFH JetBrains Mono', ui-monospace, monospace";
      const ergebnis: Record<string, number> = {
        contentBreite: inhalt.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight),
        spaltenBreite: Math.round(
          document.querySelector('[data-lfh="org-spalte"]')!.getBoundingClientRect().width,
        ),
      };
      for (const [k, v] of Object.entries(werte)) {
        probe.style.font = mono;
        probe.textContent = v;
        ergebnis[`mono:${k}`] = Math.ceil(probe.getBoundingClientRect().width);
      }
      probe.remove();
      return ergebnis;
    },
    { werte: { sprechgruppe: `TMO ${SG_LANG}`, kante: KANTE_LANG, einheitRuf: EINHEIT_RUF } },
  );
  for (const [k, v] of Object.entries(messwerte)) {
    test.info().annotations.push({ type: 'messwert', description: `${k}=${v}` });
    console.log(`messwert ${k}=${v}`);
  }

  const m = await skizzenMasse(page);
  expect(m.seite, `Seite ohne Überhang (${m.seite}px)`).toBeLessThanOrEqual(SUBPIXEL);
  expect(m.skizze, `Skizze ohne Überhang (${m.skizze}px)`).toBeLessThanOrEqual(SUBPIXEL);
  expect(m.knoten, `kein Knoten über dem Rand (${m.knoten}px)`).toBeLessThanOrEqual(SUBPIXEL);
  expect(m.spalten, 'mehrere Spalten nebeneinander').toBeGreaterThanOrEqual(3);
  expect(m.zeilen, 'acht Abschnitte brechen in mehrere Zeilen um').toBeGreaterThan(1);

  // Kanten: gemeinsam als ⇄, ohne gemeinsamen Kanal als Wort.
  await expect(
    skizze(page).locator('[data-lfh="skizze-kante"]').filter({ hasText: KANTE_LANG }).first(),
  ).toBeVisible();
  await expect(
    skizze(page)
      .locator('[data-lfh="org-knoten"]')
      .filter({ has: page.getByRole('link', { name: OHNE_KANAL }) }),
  ).toContainText('keine gemeinsame Sprechgruppe');
  await expect(skizze(page).getByRole('group', { name: 'Einsatzleitung' })).toContainText(
    'Gegenstelle nicht erfasst',
  );

  // ── Lücken im ersten Bild, auch in der Skizze, mit der neuen Zeile.
  const luecken = page.getByRole('region', { name: 'Lücken' });
  await expect(luecken).toBeInViewport();
  const zeile = luecken
    .locator('[data-lfh="funkplan-luecke"]')
    .filter({ hasText: 'Verbindungen ohne gemeinsame Sprechgruppe' });
  await expect(zeile).toBeInViewport();
  await expect(zeile).toContainText('1');
  await expect(zeile.getByRole('link', { name: OHNE_KANAL })).toBeVisible();
});

for (const groesse of [
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
]) {
  test(`Skizze bei ${groesse.width} px: kein waagerechter Überhang`, async ({ page }) => {
    await anmelden(page);
    const einsatzId = await einsatzAnlegen(page, `E2E Skizze ${groesse.width} ${Date.now()}`);
    await seedeSkizze(page, einsatzId);
    await page.setViewportSize(groesse);
    await oeffneSkizze(page, einsatzId);
    const m = await skizzenMasse(page);
    expect(m.seite, `Seite ohne Überhang (${m.seite}px)`).toBeLessThanOrEqual(SUBPIXEL);
    expect(m.skizze, `Skizze ohne Überhang (${m.skizze}px)`).toBeLessThanOrEqual(SUBPIXEL);
    expect(m.knoten, `kein Knoten über dem Rand (${m.knoten}px)`).toBeLessThanOrEqual(SUBPIXEL);
  });
}

test('Skizze im Druck bei A4-Breite: alles offen, Druckkopf, nichts ragt heraus', async ({
  page,
}) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Skizze Druck ${Date.now()}`);
  await seedeSkizze(page, einsatzId);
  await page.setViewportSize({ width: A4_DRUCKBREITE, height: 900 });
  await oeffneSkizze(page, einsatzId);

  await skizze(page)
    .getByRole('button', { name: `Unterstellte von ${ABSCHNITT}` })
    .click();
  await expect(skizze(page).getByRole('link', { name: OHNE_KANAL })).toHaveCount(0);

  await page.evaluate(() => {
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
    };
  });
  await page.getByRole('button', { name: 'Drucken / als PDF' }).click();
  await page.emulateMedia({ media: 'print' });

  await expect(skizze(page).getByRole('link', { name: OHNE_KANAL })).toHaveCount(1);
  const lage = await page.evaluate(() => {
    const wurzel = document.querySelector('.funkplan-print-root')!.getBoundingClientRect();
    const bild = document.querySelector('[data-lfh="skizze"]')!;
    return {
      wurzelRechts: wurzel.right,
      knotenRechts: Math.max(
        ...Array.from(bild.querySelectorAll('[data-lfh="org-knoten"]')).map(
          (k) => k.getBoundingClientRect().right,
        ),
      ),
      spalten: new Set(
        Array.from(bild.querySelectorAll('[data-lfh="org-spalte"]')).map((s) =>
          Math.round(s.getBoundingClientRect().left),
        ),
      ).size,
      werkzeuge: getComputedStyle(document.querySelector('.funkplan-no-print')!).display,
      umschalter: getComputedStyle(document.querySelector('[role="radiogroup"]')!).display,
      klappen: getComputedStyle(bild.querySelector('[data-lfh="org-klappen"]')!).display,
      kopf: document.querySelector('[data-lfh="druckkopf"]')!.textContent!,
    };
  });
  expect(lage.werkzeuge, 'Werkzeugzeile im Druck aus').toBe('none');
  expect(lage.umschalter, 'Umschalter im Druck aus').toBe('none');
  expect(lage.klappen, 'Klappziele im Druck aus').toBe('none');
  expect(lage.kopf, 'Druckkopf „Fernmeldeskizze“').toContain('Fernmeldeskizze');
  expect(lage.spalten, 'A4: zwei feste Spalten').toBe(2);
  expect(
    lage.knotenRechts,
    `kein Knoten über der Druckwurzel (Knoten ${lage.knotenRechts}px, Wurzel ${lage.wurzelRechts}px)`,
  ).toBeLessThanOrEqual(lage.wurzelRechts + SUBPIXEL);
  await page.emulateMedia({ media: null });
});

test('Skizze live: eine zugeordnete Sprechgruppe schließt die Lücke ohne Neuladen', async ({
  page,
}) => {
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Skizze Live ${Date.now()}`);
  const { ohneKanal, dmo } = await seedeSkizze(page, einsatzId);
  await oeffneSkizze(page, einsatzId);

  const knoten = skizze(page)
    .locator('[data-lfh="org-knoten"]')
    .filter({ has: page.getByRole('link', { name: OHNE_KANAL }) });
  await expect(knoten).toContainText('keine gemeinsame Sprechgruppe');

  const antwort = await page.request.patch(`/api/einsaetze/${einsatzId}/einheiten/${ohneKanal}`, {
    data: { sprechgruppe_ids: [dmo] },
  });
  expect(antwort.ok(), `Zuordnen: ${await antwort.text()}`).toBeTruthy();

  await expect(knoten.locator('[data-lfh="skizze-kante"]')).toHaveText('⇄ DMO 505');
  await expect(knoten).not.toContainText('keine gemeinsame Sprechgruppe');
});
