import { expect, test, type Page } from '@playwright/test';
import { wechsleZuRolle } from './rollen-kern';

// Das Katalogtabellen-Primitiv am schmalen Schirm: die Tabelle scrollt in sich, drückt die
// Seite nicht breit, und Kopfzeile und erste Spalte stehen. jsdom rechnet kein Layout.
//
// Gemessen wird nur DOM, das das Primitiv selbst erzeugt, nicht der Seitencontainer — die
// seitenweite Aussage für diese Route trägt `gate1-ueberlauf.spec.ts`.

const BREITE = 390;
const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

test.use({ viewport: { width: BREITE, height: 844 } });

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

/**
 * x-Positionen der fixierten und einer nicht-fixierten Zelle DERSELBEN Datenzeile, dazu der
 * verbleibende waagerechte Bildlaufweg. Gemessen an der Körperzelle (`td`): mit `sticky`
 * gleicht antd Kopf und Körper per Skript ab, eine Messung am Kopf wäre ein Wettlauf.
 * RELATIV ZUM BILDLAUFCONTAINER: die Fixierung sagt „bleibt am linken Rand IHRES Containers";
 * absolut gemessen wanderte der Container zwischen zwei Messungen und die Zusicherung wackelte.
 */
async function zellenX(page: Page) {
  return page.evaluate(() => {
    const koerper = document.querySelector('.ant-table-body')!;
    const zeile = document.querySelector('tr.ant-table-row')!;
    const fix = zeile.querySelector('td.ant-table-cell-fix-start')!;
    const nicht = zeile.querySelector('td:not(.ant-table-cell-fix-start)')!;
    const bezug = koerper.getBoundingClientRect().x;
    return {
      fix: fix.getBoundingClientRect().x - bezug,
      nichtFix: nicht.getBoundingClientRect().x - bezug,
      restweg: koerper.scrollWidth - koerper.clientWidth,
    };
  });
}

test('Katalogtabelle bei 390 px: scrollt in sich, drückt die Seite nicht breit, Kopfzeile bleibt stehen', async ({
  page,
}) => {
  await anmelden(page);
  // Benutzerliste: sechs Spalten. Die Zeilen legt der Spec SELBST per API an — mit nur der
  // Zeile des Harness-Admins bliebe bei 400 px Schirmhöhe keine Bildlaufreserve, und die
  // Vorbedingung hinge an der Reihenfolge anderer Specs.
  const LAUF = Date.now();
  for (let i = 0; i < 8; i += 1) {
    const antwort = await page.request.post('/api/benutzer', {
      data: {
        anzeigename: `E2E Katalog ${LAUF}-${i}`,
        benutzername: `e2e-katalog-${LAUF}-${i}`,
        passwort: 'e2e-katalog-pw-123',
      },
    });
    expect(
      antwort.ok(),
      `Seeding Benutzer ${i}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
  }
  await page.goto('/admin/benutzer');
  const zeile = page.locator('tr.ant-table-row').first();
  await expect(zeile).toBeVisible();

  const koerper = page.locator('.ant-table-body');
  const rahmen = page.locator('.ant-table').first();

  // (a) Die Tabelle ist breiter als der Schirm UND scrollt in sich. Beide Hälften sind
  //     nötig: ohne den Überhang wäre (b) trivial erfüllt und bewiese nichts.
  const masse = await koerper.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(masse.scrollWidth).toBeGreaterThan(masse.clientWidth);

  // (b) …und der Tabellenrahmen bleibt trotzdem im Schirm: der Überhang lebt im
  //     Scrollcontainer, nicht in der Seitenbreite. Gemessen wird `scrollWidth` (der INHALT),
  //     nicht `clientWidth` — die innere Breite kann die des Elternelements konstruktiv nie
  //     überschreiten und bliebe auch ohne `scroll={{ x: 'max-content' }}` grün.
  const rahmenMasse = await rahmen.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(
    rahmenMasse.scrollWidth,
    `Tabelleninhalt drückt die Seite breit (scrollWidth ${rahmenMasse.scrollWidth}, clientWidth ${rahmenMasse.clientWidth})`,
  ).toBeLessThanOrEqual(BREITE);

  // (c) Die erste Spalte ist die fixierte, menschenlesbare Kennung — genau eine.
  const fixierte = page.locator('th.ant-table-cell-fix-start');
  await expect(fixierte).toHaveCount(1);
  await expect(fixierte).toHaveCSS('position', 'sticky');

  // (d) Die Kopfzeile steht wirklich fest.
  const kopf = page.locator('.ant-table-sticky-holder');
  await expect(kopf).toHaveCSS('position', 'sticky');

  // ---- (e) Wirknachweis der FIXIERTEN SPALTE: waagerecht scrollen, x-Position halten.
  //      (c) pinnt die Klasse, hier kommt die WIRKUNG dazu — `toBeVisible` allein bliebe auch
  //      ohne Fixierung grün.
  const xVor = await zellenX(page);
  // Vorbedingung: ohne Bildlaufweg wäre die Messung darunter leer.
  expect(xVor.restweg, 'Vorbedingung: Tabelle braucht waagerechten Bildlaufweg').toBeGreaterThan(
    50,
  );

  await koerper.evaluate((el) => el.scrollTo(300, 0));
  const xNach = await zellenX(page);

  // BEIDE Hälften: ohne „die nicht-fixierte Zelle ist gewandert" wäre ein nicht ausgeführter
  // Bildlauf grün; ohne „die fixierte hält" bewiese das Wandern nichts über die Fixierung.
  expect(xNach.nichtFix, 'nicht-fixierte Zelle muss mitwandern').toBeLessThan(xVor.nichtFix - 100);
  expect(
    Math.abs(xNach.fix - xVor.fix),
    `fixierte Spalte hält ihre x-Position (${xVor.fix} → ${xNach.fix})`,
  ).toBeLessThanOrEqual(1);

  // ---- (f) Wirknachweis der STEHENDEN KOPFZEILE. Er braucht Bildlaufreserve, und `y >= 0`
  //      allein ist auch ohne Fixierung wahr, solange die Kopfzeile weit unten startet. Die
  //      BREITE bleibt 390 px (die Frage dieses Specs), die HÖHE wird verkürzt.
  await page.setViewportSize({ width: BREITE, height: 400 });
  await expect(zeile).toBeVisible();

  const kopfVor = (await kopf.boundingBox())!;
  const hoeheVor = kopfVor.height;
  // Ziel: knapp ÜBER den Startpunkt der Kopfzeile — ohne Fixierung stünde sie bei −20 px. Ein
  // fester Wert träfe je nach Startposition zu wenig Reserve oder liefe durch die ganze
  // Tabelle (dann gibt die Fixierung die Kopfzeile frei).
  const ziel = kopfVor.y + 20;
  await page.evaluate((z) => window.scrollTo(0, z), ziel);
  const erreicht = await page.evaluate(() => window.scrollY);
  expect(erreicht, 'Vorbedingung: die Seite muss so weit scrollen können').toBeCloseTo(ziel, 0);

  const rahmenNach = (await rahmen.boundingBox())!;
  // Vorbedingung: die Tabelle steht noch im Bild — sonst wäre ein negatives y kein
  // Fixierungsfehler, sondern eine durchgelaufene Tabelle.
  expect(
    rahmenNach.y + rahmenNach.height,
    'Vorbedingung: die Tabelle darf noch nicht durchgelaufen sein',
  ).toBeGreaterThan(hoeheVor);

  const kopfNach = (await kopf.boundingBox())!;
  // Die Kopfzeile steht am oberen Rand, statt mit der Seite aus dem Bild zu wandern.
  expect(
    Math.abs(kopfNach.y),
    `Kopfzeile steht am oberen Rand (${kopfVor.y} → ${kopfNach.y})`,
  ).toBeLessThanOrEqual(1);
});

/**
 * LFH-435 · Zweig „Org-Führungskraft": die Benutzerliste des Admin-Tests leitet sie um, gemessen
 * wird deshalb die Katalogtabelle der Fahrzeug-Stammdaten. Ohne Admin-Recht steht der
 * Rechtehinweis, „Fahrzeug anlegen" ist gesperrt, und die Aktionsspalte ENTFÄLLT
 * (`stammdaten/dienststatus.tsx`, Befund M45) — die Tabelle hat also eine Spalte weniger. Das
 * gefährdet die Aussagekraft: passte sie ohne Aktionen in den Schirm, wäre (a) bis (f) trivial.
 * Gesät wird deshalb langer Stoff, und der Bildlaufweg bleibt Vorbedingung.
 */
test('Katalogtabelle bei 390 px: scrollt auch ohne Aktionsspalte in sich, Kopfzeile bleibt stehen (Führungskraft)', async ({
  page,
}) => {
  await anmelden(page);
  const LAUF = Date.now();
  // 16 Zeilen: mit dem Rechtehinweis darüber startet die Tabelle tiefer, und (f) braucht
  // Bildlaufweg unter der Kopfzeile (8 reichten auf 400 px nicht).
  for (let i = 0; i < 16; i += 1) {
    const antwort = await page.request.post('/api/fahrzeuge', {
      data: {
        // Funkrufnamen sind je Org eindeutig.
        funkrufname: `E2E Katalog Florian Musterstadt-Nordwest ${LAUF}-${i}`,
        fahrzeugtyp: 'Wechselladerfahrzeug mit Abrollbehälter Hochwasser',
        traegerorganisation: 'Freiwillige Feuerwehr Musterstadt-Nordwest Löschzug Deichweg',
        kennzeichen: `MU-NW ${4600 + i}`,
      },
    });
    expect(
      antwort.ok(),
      `Seeding Fahrzeug ${i}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
  }
  await wechsleZuRolle(page, 'fuehrungskraft');
  await page.goto('/admin/stammdaten/fahrzeuge');

  const zeile = page.locator('tr.ant-table-row').first();
  await expect(zeile).toBeVisible();
  await expect(
    page.getByText(`E2E Katalog Florian Musterstadt-Nordwest ${LAUF}-0`),
    'der gesäte Stoff steht in der Tabelle',
  ).toBeVisible();

  // ── VORBEDINGUNGEN: der Nur-Lese-Zweig steht.
  await expect(
    page.getByRole('alert').filter({ hasText: 'dürfen die Stammdaten ändern' }),
    'Vorbedingung: der Rechtehinweis des Nur-Lese-Zweigs steht',
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Fahrzeug anlegen' }),
    'Vorbedingung: die Primäraktion steht gesperrt, nicht versteckt',
  ).toBeDisabled();
  // Zeilenaktionen sind ohne Recht ABWESEND (M45), nicht gesperrt.
  await expect(
    page.getByRole('columnheader', { name: 'Aktionen' }),
    'Vorbedingung: ohne Admin-Recht entfällt die Aktionsspalte',
  ).toHaveCount(0);
  for (const aktion of ['Bearbeiten', 'Außer Dienst', 'Wieder in Dienst']) {
    await expect(
      page.locator('tr.ant-table-row').getByRole('button', { name: aktion }),
      `Vorbedingung: keine Zeilenaktion „${aktion}"`,
    ).toHaveCount(0);
  }

  const koerper = page.locator('.ant-table-body');
  const rahmen = page.locator('.ant-table').first();

  // (a) Die Tabelle ist breiter als der Schirm UND scrollt in sich.
  const masse = await koerper.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(
    masse.scrollWidth,
    'Vorbedingung: auch ohne Aktionsspalte ist die Tabelle breiter als der Schirm',
  ).toBeGreaterThan(masse.clientWidth);

  // (b) …und der Tabellenrahmen drückt die Seite nicht breit.
  const rahmenMasse = await rahmen.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(
    rahmenMasse.scrollWidth,
    `Tabelleninhalt drückt die Seite breit (scrollWidth ${rahmenMasse.scrollWidth}, clientWidth ${rahmenMasse.clientWidth})`,
  ).toBeLessThanOrEqual(BREITE);

  // (c) Genau eine fixierte, menschenlesbare Kennung.
  const fixierte = page.locator('th.ant-table-cell-fix-start');
  await expect(fixierte).toHaveCount(1);
  await expect(fixierte).toHaveCSS('position', 'sticky');

  // (d) Die Kopfzeile steht fest.
  const kopf = page.locator('.ant-table-sticky-holder');
  await expect(kopf).toHaveCSS('position', 'sticky');

  // (e) Wirknachweis der fixierten Spalte.
  const xVor = await zellenX(page);
  expect(xVor.restweg, 'Vorbedingung: Tabelle braucht waagerechten Bildlaufweg').toBeGreaterThan(
    50,
  );
  await koerper.evaluate((el) => el.scrollTo(300, 0));
  const xNach = await zellenX(page);
  expect(xNach.nichtFix, 'nicht-fixierte Zelle muss mitwandern').toBeLessThan(xVor.nichtFix - 100);
  expect(
    Math.abs(xNach.fix - xVor.fix),
    `fixierte Spalte hält ihre x-Position (${xVor.fix} → ${xNach.fix})`,
  ).toBeLessThanOrEqual(1);

  // (f) Wirknachweis der stehenden Kopfzeile — mit dem Rechtehinweis darüber startet sie tiefer.
  await page.setViewportSize({ width: BREITE, height: 400 });
  await expect(zeile).toBeVisible();
  const kopfVor = (await kopf.boundingBox())!;
  const hoeheVor = kopfVor.height;
  const ziel = kopfVor.y + 20;
  await page.evaluate((z) => window.scrollTo(0, z), ziel);
  const erreicht = await page.evaluate(() => window.scrollY);
  expect(erreicht, 'Vorbedingung: die Seite muss so weit scrollen können').toBeCloseTo(ziel, 0);
  const rahmenNach = (await rahmen.boundingBox())!;
  expect(
    rahmenNach.y + rahmenNach.height,
    'Vorbedingung: die Tabelle darf noch nicht durchgelaufen sein',
  ).toBeGreaterThan(hoeheVor);
  const kopfNach = (await kopf.boundingBox())!;
  expect(
    Math.abs(kopfNach.y),
    `Kopfzeile steht am oberen Rand (${kopfVor.y} → ${kopfNach.y})`,
  ).toBeLessThanOrEqual(1);
});
