import {
  anmelden,
  apiAlsAdmin,
  demoEinsatz,
  expect,
  fotografiere,
  fuelle,
  test,
  uhrAnhalten,
} from './kern';

/**
 * Bilder des Kapitels „Verpflegung“ (`docs/anwender/kapitel/verpflegung.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep verpflegung`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   zeitfenster.png        frontend/src/pages/VerpflegungPage.tsx,
 *                          frontend/src/verpflegung/ZeitfensterKarte.tsx
 *   zeitfenster-anlegen.png frontend/src/verpflegung/VerpflegungDialoge.tsx (`ZeitfensterDialog`)
 *   ausgabe-nachtragen.png frontend/src/verpflegung/VerpflegungDialoge.tsx (`AusgabeDialog`),
 *                          frontend/src/verpflegung/ZeitfensterKarte.tsx (Menü der Karte)
 *   ausgabe-zaehlen.png    frontend/src/verpflegung/AusgabeAnsicht.tsx,
 *                          frontend/src/verpflegung/zaehltasteStil.ts (Fükw, offene Sammlung)
 *
 * Demo-Lücke (D3): die Demo-Daten tragen keine Verpflegung. Die Spec legt drei Zeitfenster an —
 * „Getränke“ laufend und gedeckt, „Mittag“ laufend mit Unterdeckung samt Sonderkost und einer
 * zurückgenommenen Ausgabe, „Abendessen“ anstehend und offen. Das Zählbild steht zuletzt: seine
 * Sammlung bucht sich nach der Ruhe womöglich und änderte sonst die Zahlen der übrigen Bilder.
 */

const KAPITEL = 'verpflegung';

interface Zeitfenster {
  id: number;
}
interface AusgabeErgebnis {
  ausgabe_id: number;
}

/** Drahtformat des Servers: UTC ohne Zonenkennung. */
function draht(zeit: Date): string {
  return zeit.toISOString().slice(0, 19).replace('T', ' ');
}

function um(basis: Date, minuten: number): string {
  return draht(new Date(basis.getTime() + minuten * 60_000));
}

test.describe(KAPITEL, () => {
  test.beforeAll(async () => {
    const api = await apiAlsAdmin();
    try {
      const demo = await demoEinsatz(api);
      const basis = `/api/einsaetze/${demo.id}/verpflegung`;
      const jetzt = new Date();

      const getraenke = await fuelle<Zeitfenster>(api, 'post', `${basis}/zeitfenster`, {
        bezeichnung: 'Getränke',
        von_at: um(jetzt, -90),
        bis_at: um(jetzt, 90),
        bedarf_kraefte: 20,
        bedarf_betreute: 0,
      });
      await fuelle(api, 'post', `${basis}/zeitfenster/${getraenke.id}/ausgaben`, {
        menge: 20,
        ort: 'Einsatzleitung, Feuerwehrhaus',
        zeitpunkt_at: um(jetzt, -80),
      });

      const mittag = await fuelle<Zeitfenster>(api, 'post', `${basis}/zeitfenster`, {
        bezeichnung: 'Mittag',
        von_at: um(jetzt, -30),
        bis_at: um(jetzt, 60),
        bedarf_kraefte: 12,
        bedarf_betreute: 8,
        sonderkost: { vegetarisch: 3 },
      });
      await fuelle(api, 'post', `${basis}/zeitfenster/${mittag.id}/ausgaben`, {
        menge: 10,
        ort: 'Turnhalle Nord',
        zeitpunkt_at: um(jetzt, -20),
        sonderkost: { vegetarisch: 2 },
      });
      const falsch = await fuelle<AusgabeErgebnis>(
        api,
        'post',
        `${basis}/zeitfenster/${mittag.id}/ausgaben`,
        { menge: 5, ort: 'Turnhalle Nord', zeitpunkt_at: um(jetzt, -15) },
      );
      await fuelle(api, 'post', `${basis}/ausgaben/${falsch.ausgabe_id}/zuruecknehmen`);

      await fuelle(api, 'post', `${basis}/zeitfenster`, {
        bezeichnung: 'Abendessen',
        von_at: um(jetzt, 300),
        bis_at: um(jetzt, 360),
        bedarf_kraefte: 14,
        bedarf_betreute: 8,
      });
    } finally {
      await api.dispose();
    }
  });

  test('Laufende und anstehende Zeitfenster', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/verpflegung`);
    const liste = page.getByRole('region', { name: 'Laufende und anstehende Zeitfenster' });
    await expect(liste.locator('[data-lfh="verpflegung-karte"]')).toHaveCount(3);
    await expect(liste.getByText('zurückgenommen')).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(liste, KAPITEL, 'zeitfenster');
  });

  test('Dialog „Zeitfenster anlegen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/verpflegung`);
    await page.getByRole('button', { name: 'Zeitfenster anlegen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Zeitfenster anlegen' });
    await dialog.getByLabel('Bezeichnung').fill('Nachtverpflegung');
    await expect(
      dialog.getByText('Vorschlag: Personal im Einsatz', { exact: false }),
    ).toBeVisible();
    await dialog.getByLabel('Bezeichnung').blur();
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0).toBeGreaterThan(400);
    await fotografiere(dialog, KAPITEL, 'zeitfenster-anlegen');
  });

  test('Dialog „Ausgabe nachtragen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/verpflegung`);
    await page.getByRole('button', { name: /^Aktionen zu Zeitfenster Mittag/ }).click();
    await page.getByRole('menuitem', { name: 'Ausgabe nachtragen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ausgabe nachtragen: Mittag' });
    await dialog.getByLabel('Menge (EP)').fill('10');
    await dialog.getByLabel('Ort').fill('Turnhalle Nord');
    await dialog.getByLabel('Ort').blur();
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0).toBeGreaterThan(400);
    await fotografiere(dialog, KAPITEL, 'ausgabe-nachtragen');
  });

  test('Portionen an der Ausgabe zählen', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/verpflegung`);
    await page.getByRole('link', { name: /^Ausgabe öffnen zu Mittag/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Mittag' })).toBeVisible();
    await page.getByRole('button', { name: /^vegetarisch/ }).click();
    const plus1 = page.locator('[data-lfh="zaehltasten"]').getByRole('button', {
      name: '+1',
      exact: true,
    });
    await plus1.click();
    await plus1.click();
    await expect(page.locator('[data-lfh="sammlung-menge"]')).toHaveText('3');
    // Die ganze Seite: Kopf oben, Zähltasten am unteren Rand; das Element allein ist ein Fenster
    // hoch und läge zum Teil unter der Kopfleiste.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.move(0, 0);
    await fotografiere(page, KAPITEL, 'ausgabe-zaehlen');
  });
});
