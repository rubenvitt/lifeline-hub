import { expect, test, type Page } from '@playwright/test';

/**
 * Kommunikationsplan S6 (LFH-848): die Nachweise, die NUR im Browser gehen. jsdom rechnet kein
 * Layout, wertet `@media print` nicht aus und kennt keine Contentbreite.
 *
 * - MESSUNG (Aufgabe 1.1, „Breite vor dem Bau“): Contentbreite am Fükw mit offenem Panel und die
 *   Laufweiten langer Werte; die Werte stehen als Annotation da und in design.md D5 (Nachtrag).
 *   Die Tabelle hat am Fükw keinen Überhang.
 * - LÜCKE „Leitstelle“ im ersten Bild bei 1366 × 768 mit offenem Modulpanel.
 * - 390 px: Tabelle, nicht Karten; die Kennung bleibt fixiert.
 * - ANLEGEN über die Masken, LIVE in einer zweiten Seite ohne Neuladen; die Lücke schließt sich.
 * - DRUCKPFAD bei A4-Breite (680 px): keine Aktionsspalte, keine Knöpfe, nichts ragt heraus.
 *
 * Mutationsprobe (Prüfliste): `mindestBreite` der Verbindungen auf 700 → Überhang am Fükw rot.
 */

const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
const FUEKW = { width: 1366, height: 768 };
const HANDSCHIRM = { width: 390, height: 844 };
const A4_DRUCKBREITE = 680;
const SUBPIXEL = 0.5;

/** Absichtlich lange, aber reale Werte. */
const FHP = 'Lagekartenführer';
const BEHOERDE = 'Polizeiinspektion Musterstadt-Nordwest, Führungsgruppe';
const NUMMER = '+49 421 361-12345';
const HINWEIS = 'Lagedienst rund um die Uhr, außerhalb Bürozeit über Zentrale';
const ABSCHNITT = 'Deichverteidigung Nordwest II';

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzAnlegen(page: Page, name: string): Promise<string> {
  const antwort = await page.request.post('/api/einsaetze', { data: { bezeichnung: name } });
  expect(antwort.ok(), `Einsatz: ${await antwort.text()}`).toBeTruthy();
  return String(((await antwort.json()) as { id: number }).id);
}

interface Stelle {
  id: number;
  bezeichnung?: string | null;
  funktion?: string | null;
}

/** FHP mit langer Bezeichnung, eine Behörde mit zwei Verbindungen, ein Abschnitt mit Nummer —
 *  aber KEINE Leitstelle: die Lücke hat einen Treffer. */
async function seede(page: Page, einsatzId: string) {
  const basis = `/api/einsaetze/${einsatzId}`;
  const stelle = async (data: unknown): Promise<Stelle[]> => {
    const a = await page.request.post(`${basis}/stab/kommunikationsplan/stellen`, { data });
    expect(a.status(), `Stelle: ${await a.text()}`).toBe(201);
    return (await a.json()) as Stelle[];
  };
  await stelle({ stellenart: 'funktion', funktion: 's2' });
  await stelle({ stellenart: 'funktion', funktion: 'fuehrungshilfspersonal', bezeichnung: FHP });
  const plan = await stelle({ stellenart: 'behoerde', bezeichnung: BEHOERDE });
  const behoerde = plan.find((s) => s.bezeichnung === BEHOERDE)!;
  for (const data of [
    { mittel: 'festnetz', wert: NUMMER, hinweis: HINWEIS },
    { mittel: 'fax', wert: '+49 421 361-12399' },
  ]) {
    const a = await page.request.post(
      `${basis}/stab/kommunikationsplan/stellen/${behoerde.id}/verbindungen`,
      { data },
    );
    expect(a.status(), `Verbindung: ${await a.text()}`).toBe(201);
  }
  const ab = await page.request.post(`${basis}/abschnitte`, {
    data: { name: ABSCHNITT, kommunikationsmittel: 'festnetz', erreichbarkeit: '0421 500' },
  });
  expect(ab.ok(), `Abschnitt: ${await ab.text()}`).toBeTruthy();
}

const tabelle = (page: Page) => page.getByRole('region', { name: 'Kommunikationsplan' });

async function oeffne(page: Page, einsatzId: string) {
  await page.goto(`/einsaetze/${einsatzId}/stab/kommunikationsplan`);
  // Datenanker: die Nummer steht erst, wenn der gepflegte Plan geladen ist.
  await expect(tabelle(page).getByRole('link', { name: NUMMER })).toBeVisible();
  await expect(tabelle(page).getByText(ABSCHNITT)).toBeVisible();
}

test('Fükw mit offenem Panel: Messwerte, kein Überhang, Lücke im ersten Bild', async ({ page }) => {
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Kommunikationsplan ${Date.now()}`);
  await seede(page, einsatzId);
  await oeffne(page, einsatzId);
  await expect(page.locator('[data-lfh="modul-panel"]'), 'Panel offen am Fükw').toBeVisible();

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
      const text = `400 14px ${getComputedStyle(zelle).fontFamily}`;
      const mono = "400 14px 'LFH JetBrains Mono', ui-monospace, monospace";
      const ergebnis: Record<string, number> = {
        contentBreite,
        zellpolster: parseFloat(zs.paddingLeft) + parseFloat(zs.paddingRight),
        'text:funktion': miss(werte.funktion, text),
        'mono:nummer': miss(werte.nummer, mono),
        'text:hinweis': miss(werte.hinweis, text),
      };
      probe.remove();
      return ergebnis;
    },
    {
      werte: {
        funktion: `Führungshilfspersonal · ${FHP}`,
        nummer: NUMMER,
        hinweis: HINWEIS,
      },
    },
  );
  for (const [k, v] of Object.entries(messwerte)) {
    test.info().annotations.push({ type: 'messwert', description: `${k}=${v}` });
  }

  const ueberhang = await tabelle(page)
    .locator('.ant-table-body, .ant-table-content')
    .first()
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(ueberhang, `Tabelle am Fükw ohne Überhang (gemessen ${ueberhang}px)`).toBeLessThanOrEqual(
    SUBPIXEL,
  );
  const seite = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(seite, 'Seite ohne waagerechten Bildlauf').toBeLessThanOrEqual(SUBPIXEL);

  await expect(page.getByText('Leitstelle: keine Verbindung erfasst')).toBeInViewport();
});

test('390 px: Tabelle statt Karten, die Kennung bleibt fixiert', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Kommunikationsplan schmal ${Date.now()}`);
  await seede(page, einsatzId);
  await page.setViewportSize(HANDSCHIRM);
  await oeffne(page, einsatzId);
  await expect(tabelle(page).locator('.ant-table')).toHaveCount(1);
  await expect(page.locator('[data-lfh="datensicht-karte"]')).toHaveCount(0);
  const fixiert = tabelle(page).locator('th.ant-table-cell-fix-start');
  await expect(fixiert).toHaveCount(1);
  await expect(fixiert).toHaveText('Stelle');
  await expect(fixiert).toHaveCSS('position', 'sticky');
  const seite = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(seite, 'Seite ohne waagerechten Bildlauf bei 390 px').toBeLessThanOrEqual(SUBPIXEL);
});

test('Leitstelle und Verbindung anlegen: die zweite Seite folgt live, die Lücke schließt sich', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(FUEKW);
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Kommunikationsplan live ${Date.now()}`);
  await seede(page, einsatzId);
  await oeffne(page, einsatzId);
  const zweite = await context.newPage();
  await zweite.setViewportSize(FUEKW);
  await oeffne(zweite, einsatzId);
  await expect(zweite.getByText('Leitstelle: keine Verbindung erfasst')).toBeVisible();

  await page.getByRole('button', { name: 'Stelle hinzufügen' }).click();
  const maske = page.getByRole('dialog', { name: 'Stelle hinzufügen' });
  await maske.getByLabel('Art').click();
  await page.getByTitle('Leitstelle', { exact: true }).click();
  await maske.getByLabel('Bezeichnung').fill('ILS Nordwest');
  await maske.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(maske).toBeHidden();

  await page.getByRole('button', { name: 'Verbindung zu ILS Nordwest hinzufügen' }).click();
  const verbindung = page.getByRole('dialog', { name: /Verbindung hinzufügen/ });
  await verbindung.getByLabel('Mittel').click();
  await page.getByTitle('Festnetz', { exact: true }).click();
  await verbindung.getByLabel('Nummer/Adresse').fill('0421 112 0');
  await verbindung.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(verbindung).toBeHidden();

  // Ohne Neuladen: das `stab`-Ereignis zieht den Plan der zweiten Seite nach.
  await expect(zweite.getByRole('link', { name: '0421 112 0' })).toHaveAttribute(
    'href',
    'tel:04211120',
  );
  await expect(zweite.getByText('Leitstelle: keine Verbindung erfasst')).toHaveCount(0);
  await expect(page.getByText('Leitstelle: keine Verbindung erfasst')).toHaveCount(0);
});

test('Druckpfad bei A4-Breite: ohne Aktionen und Knöpfe, nichts ragt heraus', async ({ page }) => {
  await anmelden(page);
  const einsatzId = await einsatzAnlegen(page, `E2E Kommunikationsplan Druck ${Date.now()}`);
  await seede(page, einsatzId);
  await page.setViewportSize({ width: A4_DRUCKBREITE, height: 900 });
  await oeffne(page, einsatzId);
  await expect(tabelle(page).getByRole('columnheader', { name: 'Aktionen' })).toHaveCount(1);

  await page.evaluate(() => {
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
    };
  });
  await page.getByRole('button', { name: /Drucken/ }).click();
  await page.emulateMedia({ media: 'print' });

  await expect(tabelle(page).getByRole('columnheader', { name: 'Aktionen' })).toHaveCount(0);
  await expect(page.locator('[data-lfh="druckkopf"]')).toContainText('Kommunikationsplan');
  const lage = await page.evaluate(() => {
    const wurzel = document
      .querySelector('.kommunikationsplan-print-root')!
      .getBoundingClientRect();
    const koerper = (document.querySelector('.kommunikationsplan-print-root .ant-table-body') ??
      document.querySelector('.kommunikationsplan-print-root .ant-table-content'))!;
    const zellen = Array.from(
      document.querySelector('tr.ant-table-row')!.querySelectorAll(':scope > td'),
    ) as HTMLElement[];
    const knoepfe = Array.from(
      document.querySelectorAll('.kommunikationsplan-print-root button'),
    ).filter((b) => (b as HTMLElement).offsetParent !== null).length;
    return {
      wurzelRechts: wurzel.right,
      letzteRechts: zellen[zellen.length - 1].getBoundingClientRect().right,
      ueberhang: koerper.scrollWidth - koerper.clientWidth,
      knoepfe,
    };
  });
  expect(lage.knoepfe, 'keine sichtbaren Knöpfe im Druck').toBe(0);
  expect(lage.ueberhang, `nichts im Bildlauf verborgen (${lage.ueberhang}px)`).toBeLessThanOrEqual(
    1,
  );
  expect(
    lage.letzteRechts,
    `letzte Spalte in der Druckwurzel (Zelle ${lage.letzteRechts}px, Wurzel ${lage.wurzelRechts}px)`,
  ).toBeLessThanOrEqual(lage.wurzelRechts + SUBPIXEL);
  await page.emulateMedia({ media: null });
});
