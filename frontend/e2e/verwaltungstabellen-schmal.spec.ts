import { expect, test, type Locator, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

/**
 * Layout-Gate der Verwaltungstabellen (LFH-980): Benutzer, Fahrzeuge, Personal und Sprechgruppen
 * auf Handy 390, Tablet hoch 820 und Tablet quer 1180, dazu die Seitenleiste der Verwaltung und
 * das Suchfeld.
 *
 * Belegt wird, was der Nutzer tut: Status und Aktionen stehen ohne waagerechtes Wischen VOLL im
 * Bild, liegen unter keiner fixierten Spalte (Treffertest in der Mitte) und lassen sich klicken
 * (`toBeVisible()` allein reicht nicht, `frontend/e2e/AGENTS.md`). Unter `md` stehen die Aktionen
 * im Menü. Gewartet wird auf die gesäte Zeile, nie auf `networkidle`.
 */

const LAUF = Date.now();

interface Ansicht {
  name: string;
  breite: number;
  hoehe: number;
  /** Unter `md` (768): Aktionen im Menü statt als Knöpfe. */
  schmal: boolean;
}

const ANSICHTEN: Ansicht[] = [
  { name: 'Handy 390', breite: 390, hoehe: 844, schmal: true },
  { name: 'Tablet hoch 820', breite: 820, hoehe: 1180, schmal: false },
  { name: 'Tablet quer 1180', breite: 1180, hoehe: 820, schmal: false },
];

interface Tabelle {
  name: string;
  pfad: string;
  /** Bezeichnung im zugänglichen Namen des Spaltenschalters. */
  schalter: string;
  /** Sät eine Zeile mit langem, aber realistischem Stoff und gibt ihre Kennung zurück. */
  saeen: (page: Page, marke: string) => Promise<string>;
  /** Wort der Statuszelle der gesäten Zeile. */
  status: string;
  /** Zugänglicher Name des Aktionsmenüs der gesäten Zeile. */
  menue: (kennung: string) => string;
  /** Der zweite Knopf neben „Bearbeiten“ (Rückfrage bzw. Statuswechsel). */
  zweiteAktion: string;
}

async function saeen(page: Page, pfad: string, daten: object): Promise<void> {
  const antwort = await page.request.post(pfad, { data: daten });
  expect(antwort.ok(), `Seeding ${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
}

const TABELLEN: Tabelle[] = [
  {
    name: 'Benutzer',
    pfad: '/admin/benutzer',
    schalter: 'Benutzer',
    saeen: async (page, marke) => {
      const kennung = `Maximiliane Kirchgassner-Wohlfahrt ${marke}`;
      await saeen(page, '/api/benutzer', {
        anzeigename: kennung,
        benutzername: `e2e-verwaltung-${marke}`,
        passwort: 'e2e-verwaltung-pw-123',
      });
      return kennung;
    },
    status: 'aktiv',
    menue: (k) => `Aktionen zu Benutzer ${k}`,
    zweiteAktion: 'Deaktivieren',
  },
  {
    name: 'Fahrzeuge',
    pfad: '/admin/stammdaten/fahrzeuge',
    schalter: 'Fahrzeuge',
    saeen: async (page, marke) => {
      const kennung = `Florian Musterstadt 11/44-${marke}`;
      await saeen(page, '/api/fahrzeuge', {
        funkrufname: kennung,
        fahrzeugtyp: 'Wechselladerfahrzeug mit Abrollbehälter Hochwasser',
        traegerorganisation: 'Freiwillige Feuerwehr Musterstadt-Nordwest Löschzug Deichweg',
        kennzeichen: 'MU-NW 4711',
      });
      return kennung;
    },
    status: 'in Dienst',
    menue: (k) => `Aktionen zu Fahrzeug ${k}`,
    zweiteAktion: 'Außer Dienst nehmen',
  },
  {
    name: 'Personal',
    pfad: '/admin/stammdaten/personal',
    schalter: 'Personal',
    saeen: async (page, marke) => {
      const kennung = `Kirchgassner-Wohlfahrt, Maximiliane ${marke}`;
      await saeen(page, '/api/personal', {
        name: kennung,
        personalnummer: `PN-${marke}`,
        traegerorganisation: 'Freiwillige Feuerwehr Musterstadt-Nordwest Löschzug Deichweg',
      });
      return kennung;
    },
    status: 'in Dienst',
    menue: (k) => `Aktionen zu Person ${k}`,
    zweiteAktion: 'Außer Dienst nehmen',
  },
  {
    name: 'Sprechgruppen',
    pfad: '/admin/stammdaten/sprechgruppen',
    schalter: 'Sprechgruppen',
    saeen: async (page, marke) => {
      const kennung = `412_F_DRK_${marke}`;
      await saeen(page, '/api/sprechgruppen', {
        bezeichnung: kennung,
        betriebsart: 'TMO',
        hinweis: 'Führungskanal Abschnitt Nord, Rückfallebene DMO 77 bei Netzausfall',
      });
      return kennung;
    },
    status: 'Aktiv',
    menue: (k) => `Aktionen zu Sprechgruppe ${k}`,
    zweiteAktion: 'Deaktivieren',
  },
];

/**
 * Liegt das Element VOLL im Viewport und ist es in seiner Mitte das oberste? Das zweite ist der
 * Treffertest: eine Zelle unter einer fixierten Spalte stünde geometrisch im Bild und wäre doch
 * nicht zu treffen.
 */
async function vollImBild(ziel: Locator, breite: number, was: string): Promise<void> {
  await ziel.scrollIntoViewIfNeeded();
  const box = (await ziel.boundingBox())!;
  expect(box, `${was}: kein Rahmen`).not.toBeNull();
  expect(box.x, `${was} links angeschnitten (x ${box.x})`).toBeGreaterThanOrEqual(0);
  expect(
    box.x + box.width,
    `${was} rechts angeschnitten (${box.x + box.width} > ${breite})`,
  ).toBeLessThanOrEqual(breite + 0.5);
  const ueber = await ziel.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const treffer = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    if (treffer != null && (el === treffer || el.contains(treffer))) return null;
    const zelle = treffer?.closest('td, th');
    return `${treffer?.tagName}.${treffer?.className} in „${zelle?.textContent?.slice(0, 60)}“`;
  });
  expect(ueber, `${was} liegt unter einem anderen Element`).toBeNull();
}

/** Das OFFENE Menü — antd lässt geschlossene Portale im Baum stehen. */
function offenesMenue(page: Page): Locator {
  return page.locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');
}

for (const ansicht of ANSICHTEN) {
  test.describe(`Verwaltungstabellen ${ansicht.name}`, () => {
    test.use({ viewport: { width: ansicht.breite, height: ansicht.hoehe } });

    for (const tabelle of TABELLEN) {
      test(`${tabelle.name}: Status und Aktionen ohne Wischen erreichbar, Spaltenschalter zählt`, async ({
        page,
      }) => {
        await anmeldenAlsAdmin(page);
        const marke = `${LAUF}-${ansicht.breite}`;
        const kennung = await tabelle.saeen(page, marke);
        await page.goto(tabelle.pfad);

        // Auf die gesäte Zeile verengen: die Listen blättern ab 50 Zeilen, und die Temp-DB lebt
        // über den ganzen Lauf.
        await page.locator('[data-lfh="katalog-werkzeuge"] input').fill(marke);
        const zeile = page.locator('tr.ant-table-row').filter({ hasText: kennung });
        await expect(zeile).toHaveCount(1);
        // Der Bildlauf der Tabelle steht am Anfang: was jetzt nicht im Bild ist, bräuchte Wischen.
        const koerper = page.locator('.ant-table-body');
        expect(await koerper.evaluate((el) => el.scrollLeft)).toBe(0);

        // Spaltenschalter mit Zähler: nie still verschwunden.
        const schalter = page.getByRole('button', { name: new RegExp(`— ${tabelle.schalter}$`) });
        await expect(schalter).toBeVisible();

        const status = zeile.getByText(tabelle.status, { exact: true });
        await vollImBild(status, ansicht.breite, `Status „${tabelle.status}“`);

        if (ansicht.schmal) {
          const ausloeser = zeile.getByRole('button', { name: tabelle.menue(kennung) });
          await vollImBild(ausloeser, ansicht.breite, 'Aktionsmenü');
          await ausloeser.click();
          const menue = offenesMenue(page);
          await expect(menue.getByRole('menuitem', { name: 'Bearbeiten' })).toBeVisible();
          await expect(menue.getByRole('menuitem', { name: tabelle.zweiteAktion })).toBeVisible();
          await menue.getByRole('menuitem', { name: 'Bearbeiten' }).click();
        } else {
          const zweite = zeile.getByRole('button', { name: tabelle.zweiteAktion, exact: true });
          await vollImBild(zweite, ansicht.breite, `„${tabelle.zweiteAktion}“`);
          const bearbeiten = zeile.getByRole('button', { name: 'Bearbeiten', exact: true });
          await vollImBild(bearbeiten, ansicht.breite, '„Bearbeiten“');
          await bearbeiten.click();
        }
        // Der Klick wirkt: der Bearbeiten-Dialog steht.
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
      });
    }
  });
}

test.describe('Verwaltungstabellen ohne Schreibrecht', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /**
   * LFH-435: Ohne Admin-Recht entfällt die Aktionsspalte (`stammdaten/dienststatus.tsx`). Der
   * Status muss trotzdem rechts im Bild stehen, auch neben einer langen Kennung.
   */
  test('Fahrzeuge (Führungskraft): Status ohne Wischen, keine Aktionen', async ({ page }) => {
    await anmeldenAlsAdmin(page);
    const marke = `${LAUF}-fk`;
    const kennung = await TABELLEN[1].saeen(page, marke);
    await wechsleZuRolle(page, 'fuehrungskraft');
    await page.goto('/admin/stammdaten/fahrzeuge');
    await expect(
      page.locator('[data-lfh="rechte-hinweis"]').filter({ hasText: 'nur System-Admin' }),
      'Vorbedingung: der Rechtehinweis des Nur-Lese-Zweigs steht',
    ).toBeVisible();
    await page.locator('[data-lfh="katalog-werkzeuge"] input').fill(marke);
    const zeile = page.locator('tr.ant-table-row').filter({ hasText: kennung });
    await expect(zeile).toHaveCount(1);
    await expect(
      zeile.getByRole('button', { name: /Aktionen zu/ }),
      'Vorbedingung: ohne Recht keine Aktionen',
    ).toHaveCount(0);
    await vollImBild(zeile.getByText('in Dienst', { exact: true }), 390, 'Status „in Dienst“');
    await expect(page.getByRole('button', { name: /— Fahrzeuge$/ })).toBeVisible();
  });

  /** Sprechgruppen ändert nur der System-Admin; ohne ihn fehlt die Aktionsspalte, „Aktiv“ bleibt. */
  test('Sprechgruppen (Führungskraft): Aktiv ohne Wischen, keine Aktionen', async ({ page }) => {
    await anmeldenAlsAdmin(page);
    const marke = `${LAUF}-fk`;
    const kennung = await TABELLEN[3].saeen(page, marke);
    await wechsleZuRolle(page, 'fuehrungskraft');
    await page.goto('/admin/stammdaten/sprechgruppen');
    await page.locator('[data-lfh="katalog-werkzeuge"] input').fill(marke);
    const zeile = page.locator('tr.ant-table-row').filter({ hasText: kennung });
    await expect(zeile).toHaveCount(1);
    await expect(
      page.locator('.ant-table-thead th').filter({ hasText: /^Aktionen$/ }),
      'Vorbedingung: ohne Recht keine Aktionsspalte',
    ).toHaveCount(0);
    await expect(zeile.getByRole('button', { name: /Aktionen zu/ })).toHaveCount(0);
    await vollImBild(zeile.getByText('Aktiv', { exact: true }), 390, 'Status „Aktiv“');
    await expect(page.getByRole('button', { name: /— Sprechgruppen$/ })).toBeVisible();
  });
});

test.describe('Abschneide-Indikator', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Fahrzeuge bei 390: die verdeckte Seite trägt eine Kante, am Ende verschwindet sie', async ({
    page,
  }) => {
    await anmeldenAlsAdmin(page);
    const marke = `${LAUF}-kante`;
    const kennung = await TABELLEN[1].saeen(page, marke);
    await page.goto('/admin/stammdaten/fahrzeuge');
    await page.locator('[data-lfh="katalog-werkzeuge"] input').fill(marke);
    await expect(page.locator('tr.ant-table-row').filter({ hasText: kennung })).toHaveCount(1);

    const koerper = page.locator('.ant-table-body');
    const restweg = await koerper.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(restweg, 'Vorbedingung: die Tabelle muss waagerecht weiterlaufen').toBeGreaterThan(20);

    /** Der Schatten der ersten rechts fixierten Zelle der Zeile (`::after`). */
    const kante = () =>
      page.evaluate(() => {
        const zelle = document.querySelector(
          'tr.ant-table-row td.ant-table-cell-fix-end-shadow-show',
        );
        return zelle ? getComputedStyle(zelle, '::after').boxShadow : null;
      });
    const vorher = await kante();
    expect(vorher, 'rechts liegt Inhalt verborgen: die Kante steht').not.toBeNull();
    const rahmenFarbe = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--lfh-steuer-rahmen').trim(),
    );
    // Die Kante zeichnet in `steuerRahmen`, nicht in antds blassem `colorSplit`.
    const rgb = await page.evaluate((farbe) => {
      const probe = document.createElement('div');
      probe.style.color = farbe;
      document.body.appendChild(probe);
      const wert = getComputedStyle(probe).color;
      probe.remove();
      return wert;
    }, rahmenFarbe);
    expect(vorher).toContain(rgb);

    await koerper.evaluate((el) => el.scrollTo(el.scrollWidth, 0));
    await expect.poll(kante, { message: 'am rechten Ende ist nichts mehr verborgen' }).toBeNull();
  });
});

test.describe('Suchfeld', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  /** Passt der Platzhalter ganz in das Eingabefeld? Gemessen mit der Schrift des Felds. */
  async function platzhalterPasst(page: Page) {
    return page.locator('[data-lfh="katalog-werkzeuge"] input').evaluate((el) => {
      const feld = el as HTMLInputElement;
      const stil = getComputedStyle(feld);
      const leinwand = document.createElement('canvas').getContext('2d')!;
      leinwand.font = `${stil.fontWeight} ${stil.fontSize} ${stil.fontFamily}`;
      const text = leinwand.measureText(feld.placeholder).width;
      const innen = feld.clientWidth - parseFloat(stil.paddingLeft) - parseFloat(stil.paddingRight);
      return { text, innen, platzhalter: feld.placeholder };
    });
  }

  for (const pfad of [
    '/admin/benutzer',
    '/admin/stammdaten/fahrzeuge',
    '/admin/stammdaten/personal',
    '/admin/stammdaten/sprechgruppen',
    '/admin/stammdaten/material',
    '/admin/karten/online',
  ]) {
    test(`${pfad}: Platzhalter auf 1440 ungekürzt`, async ({ page }) => {
      await anmeldenAlsAdmin(page);
      await page.goto(pfad);
      await expect(page.locator('[data-lfh="katalog-werkzeuge"] input')).toBeVisible();
      const { text, innen, platzhalter } = await platzhalterPasst(page);
      expect(text, `„${platzhalter}“ (${text} px) passt in ${innen} px`).toBeLessThanOrEqual(innen);
    });
  }

  test('unter md nimmt das Suchfeld die volle Zeile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await anmeldenAlsAdmin(page);
    await page.goto('/admin/stammdaten/fahrzeuge');
    const werkzeuge = page.locator('[data-lfh="katalog-werkzeuge"]');
    const feld = werkzeuge.locator('.ant-input-search').first();
    await expect(feld).toBeVisible();
    const zeile = (await werkzeuge.boundingBox())!;
    const box = (await feld.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(zeile.width - 1);
  });
});

test.describe('Seitenleiste der Verwaltung', () => {
  for (const ansicht of [
    { name: 'Tablet quer 1180', breite: 1180, hoehe: 820 },
    { name: 'Desktop 1440', breite: 1440, hoehe: 900 },
  ]) {
    test(`${ansicht.name}: der unterste Eintrag ist markiert und im Bild, die Seite folgt dem Inhalt`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: ansicht.breite, height: ansicht.hoehe });
      // „Demo-Daten“ erscheint nur bei freigeschalteten Demo-Daten; ohne Backend-Schalter so belegt
      // wie in `hinweis-kontrast.spec.ts`. Es ist der unterste Eintrag des Menüs.
      await page.route(
        (url) => url.pathname === '/api/demo-daten',
        (route) =>
          route.request().method() === 'GET'
            ? route.fulfill({ json: { importiert: false } })
            : route.fallback(),
      );
      await anmeldenAlsAdmin(page);
      await page.goto('/admin/demo-daten');
      const menue = page.locator('[data-lfh="verwaltung-menue"]');
      const eintrag = menue.getByRole('menuitem', { name: 'Demo-Daten' });
      await expect(eintrag).toHaveClass(/ant-menu-item-selected/);

      // Vorbedingung: das Menü ist höher als der Schirm, sonst wäre „im Bild“ trivial.
      const menueHoehe = await menue.evaluate((el) => el.scrollHeight);
      expect(menueHoehe, 'Vorbedingung: das Menü überragt den Schirm').toBeGreaterThan(
        ansicht.hoehe,
      );

      // Der markierte Eintrag steht im Bild, ohne dass die Seite gerollt wurde.
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      const box = (await eintrag.boundingBox())!;
      expect(box.y, 'Eintrag oben angeschnitten').toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, 'Eintrag unter dem Schirmrand').toBeLessThanOrEqual(ansicht.hoehe);

      // Die Seitenhöhe folgt dem Inhalt, nicht dem Menü: der Inhalt der Demo-Daten-Seite ist
      // kürzer als der Schirm, also scrollt die Seite nicht.
      const inhaltUnten = await page
        .locator('.ant-layout-content')
        .last()
        .evaluate((el) => {
          const kinder = [...el.children].map((k) => k.getBoundingClientRect().bottom);
          return Math.max(...kinder);
        });
      expect(inhaltUnten, 'Vorbedingung: kurzer Inhalt').toBeLessThan(ansicht.hoehe);
      const hoehe = await page.evaluate(() => document.documentElement.scrollHeight);
      expect(hoehe, `Seitenhöhe ${hoehe} folgt dem Menü`).toBeLessThanOrEqual(ansicht.hoehe);
    });
  }

  /**
   * Ohne Demo-Daten ist „Aufbewahrung“ der unterste Eintrag. Die Seite rollt hier nicht mit: der
   * Eintrag muss allein durch den Bildlauf des Menüs ins Bild kommen, und zwar mit der GEMESSENEN
   * Höhe des Menüs, nicht mit der Höhe vor der ersten Messung.
   */
  test('Tablet quer 1180: ohne Demo-Daten steht „Aufbewahrung“ markiert im Bild', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.route(
      (url) => url.pathname === '/api/demo-daten',
      (route) =>
        route.request().method() === 'GET' ? route.fulfill({ status: 404 }) : route.fallback(),
    );
    await anmeldenAlsAdmin(page);
    await page.goto('/admin/aufbewahrung');
    const menue = page.locator('[data-lfh="verwaltung-menue"]');
    const eintrag = menue.getByRole('menuitem', { name: 'Aufbewahrung' });
    await expect(eintrag).toHaveClass(/ant-menu-item-selected/);
    await expect(
      menue.getByRole('menuitem', { name: 'Demo-Daten' }),
      'Vorbedingung: ohne Demo-Daten ist „Aufbewahrung“ der unterste Eintrag',
    ).toHaveCount(0);
    expect(
      await menue.evaluate((el) => el.scrollHeight),
      'Vorbedingung: das Menü überragt den Schirm',
    ).toBeGreaterThan(820);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const box = (await eintrag.boundingBox())!;
    const rahmen = (await menue.boundingBox())!;
    expect(box.y, 'Eintrag oben angeschnitten').toBeGreaterThanOrEqual(rahmen.y);
    expect(box.y + box.height, 'Eintrag unter dem Rand des Menüs').toBeLessThanOrEqual(
      rahmen.y + rahmen.height + 0.5,
    );
    expect(rahmen.y + rahmen.height, 'Menü reicht unter den Schirmrand').toBeLessThanOrEqual(820);
  });

  test('Desktop 1440: auf einer langen Seite klebt das Menü beim Bildlauf', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await anmeldenAlsAdmin(page);
    // Lange Seite: genug Fahrzeuge, dass der Inhalt den Schirm überragt.
    for (let i = 0; i < 20; i += 1) {
      await saeen(page, '/api/fahrzeuge', { funkrufname: `E2E Leiste ${LAUF}-${i}` });
    }
    await page.goto('/admin/stammdaten/fahrzeuge');
    await expect(page.locator('tr.ant-table-row').first()).toBeVisible();
    const reserve = await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight,
    );
    expect(reserve, 'Vorbedingung: die Seite scrollt').toBeGreaterThan(200);
    await page.evaluate((z) => window.scrollTo(0, z), reserve);
    const menue = page.locator('[data-lfh="verwaltung-menue"]');
    const box = (await menue.boundingBox())!;
    // Ab `md` klebt der Kopf (LFH-952); das Menü hängt sich unter ihn (`frontend/AGENTS.md`, Rahmen).
    const rahmenOben = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lfh-rahmen-oben')),
    );
    expect(rahmenOben, 'Vorbedingung: der Kopf klebt').toBeGreaterThan(0);
    expect(
      Math.abs(box.y - rahmenOben),
      `das Menü klebt unter dem Kopf (y ${box.y}, Kopf ${rahmenOben})`,
    ).toBeLessThanOrEqual(1);
    await vollImBild(menue.getByRole('menuitem', { name: 'Fahrzeuge' }), 1440, 'Eintrag Fahrzeuge');
  });
});
