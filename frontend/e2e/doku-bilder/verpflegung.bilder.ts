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
 *                          frontend/src/verpflegung/ZeitfensterKarte.tsx (samt Ist je Stelle und
 *                          Klappe „Einheiten“, LLH-1055)
 *   zeitfenster-anlegen.png frontend/src/verpflegung/VerpflegungDialoge.tsx (`ZeitfensterDialog`)
 *   ausgabe-nachtragen.png frontend/src/verpflegung/VerpflegungDialoge.tsx (`AusgabeDialog`, Felder
 *                          „Empfänger“ und „Stelle“), frontend/src/verpflegung/ZeitfensterKarte.tsx
 *                          (Menü der Karte)
 *   stellen.png            frontend/src/verpflegung/StellenListe.tsx (Ansicht „Stellen“),
 *                          frontend/src/verpflegung/stellenKern.ts
 *   ausgabe-zaehlen.png    frontend/src/verpflegung/AusgabeAnsicht.tsx (Stellen- und
 *                          Empfängerwahl), frontend/src/verpflegung/EmpfaengerStand.tsx,
 *                          frontend/src/verpflegung/zaehltasteStil.ts (Fükw, offene Sammlung)
 *
 * Demo-Lücke (D3): die Demo-Daten tragen keine Verpflegung. Die Spec legt drei Stellen an
 * (LLH-1040: „Feldküche BR Sportplatz“ und „Ausgabe Turnhalle Nord“ aktiv, „Zuführung Deich“
 * geplant) und drei Zeitfenster — „Getränke“ laufend und gedeckt, einsatzweit; „Mittag“ laufend
 * mit Unterdeckung samt Sonderkost, den beiden aktiven Stellen zugeordnet und an ihnen mit 100 und
 * 80 EP ausgegeben, dazu eine zurückgenommene Ausgabe; „Abendessen“ anstehend und offen. Den
 * Einheiten des Demo-Einsatzes ohne Eintreffen trägt sie eines nach (LLH-1055), damit sie unter
 * „Noch nicht verpflegt“ stehen statt unter „ohne Eintreffen“. Das
 * Zählbild steht zuletzt: seine Sammlung bucht sich nach der Ruhe womöglich und änderte sonst die
 * Zahlen der übrigen Bilder.
 */

const KAPITEL = 'verpflegung';

interface Zeitfenster {
  id: number;
}
interface AusgabeErgebnis {
  ausgabe_id: number;
}
interface Stelle {
  id: number;
}

const FELDKUECHE = 'Feldküche BR Sportplatz';
/** Untereinheit des Demo-Einsatzes (`src/demo/szenario.rs`, `EINHEITEN_VORLAGEN`). */
const STAFFEL = 'Rettungsstaffel';
const TURNHALLE = 'Ausgabe Turnhalle Nord';

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

      const stelle = async (
        bezeichnung: string,
        art: string,
        standort: string,
        aktiv: boolean,
      ): Promise<number> => {
        const { id } = await fuelle<Stelle>(api, 'post', `${basis}/stellen`, {
          bezeichnung,
          art,
          standort,
        });
        if (aktiv) await fuelle(api, 'post', `${basis}/stellen/${id}/status`, { status: 'aktiv' });
        return id;
      };
      // Eintreffen der Demo-Einheiten (LLH-1055), nur wo es fehlt.
      const stand = (await (await api.get(basis)).json()) as {
        empfaenger: { einheiten: { id: number; eintreffen_at?: string | null }[] };
      };
      for (const e of stand.empfaenger.einheiten.filter((x) => !x.eintreffen_at)) {
        await fuelle(api, 'post', `/api/einsaetze/${demo.id}/einheiten/${e.id}/zeitachse`, {
          art: 'eintreffen',
          zeitpunkt_at: new Date(jetzt.getTime() - 120 * 60_000).toISOString(),
        });
      }

      const feldkueche = await stelle(FELDKUECHE, 'feldkueche', 'Sportplatz am Deich', true);
      const turnhalle = await stelle(TURNHALLE, 'ausgabestelle', 'Turnhalle Nord', true);
      await stelle('Zuführung Deich', 'zufuehrung', 'Deichweg, Höhe Schöpfwerk', false);

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
        bedarf_kraefte: 120,
        bedarf_betreute: 80,
        sonderkost: { vegetarisch: 14 },
      });
      await fuelle(api, 'patch', `${basis}/zeitfenster/${mittag.id}`, {
        stelle_ids: [feldkueche, turnhalle],
        verpflegungsart: 'warm',
      });
      await fuelle(api, 'post', `${basis}/zeitfenster/${mittag.id}/ausgaben`, {
        menge: 100,
        verpflegungsstelle_id: feldkueche,
        zeitpunkt_at: um(jetzt, -25),
        sonderkost: { vegetarisch: 10 },
      });
      await fuelle(api, 'post', `${basis}/zeitfenster/${mittag.id}/ausgaben`, {
        menge: 80,
        verpflegungsstelle_id: turnhalle,
        zeitpunkt_at: um(jetzt, -20),
        sonderkost: { vegetarisch: 2 },
      });
      const falsch = await fuelle<AusgabeErgebnis>(
        api,
        'post',
        `${basis}/zeitfenster/${mittag.id}/ausgaben`,
        { menge: 5, verpflegungsstelle_id: turnhalle, zeitpunkt_at: um(jetzt, -15) },
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
    // Höher als der Fükw: mit dem Ist je Stelle passt „Abendessen“ sonst nicht mehr ins Bild
    // (die Liste scrollt im Inhalt, das Elementbild schneidet dort ab).
    await page.setViewportSize({ width: 1440, height: 1200 });
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/verpflegung`);
    const liste = page.getByRole('region', { name: 'Laufende und anstehende Zeitfenster' });
    await expect(liste.locator('[data-lfh="verpflegung-karte"]')).toHaveCount(3);
    await expect(liste.getByText('zurückgenommen')).toBeVisible();
    await expect(liste.locator('[data-lfh="je-stelle-text"]')).toHaveCount(2);
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
    await dialog.getByRole('combobox', { name: 'Stelle' }).click();
    await page
      .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
      .locator(`.ant-select-item-option[title="${TURNHALLE}"]`)
      .click();
    await expect(dialog.getByLabel('Zuführungsziel')).toHaveCount(0);
    // Empfänger (LLH-1055): die eingetragene Menge bleibt, die Stärke belegt nur eine leere vor.
    await dialog.getByRole('combobox', { name: 'Empfänger' }).click();
    await page
      .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
      .locator(`.ant-select-item-option[title^="${STAFFEL}"]`)
      .click();
    await expect(dialog.getByLabel('Menge (EP)')).toHaveValue('10');
    await dialog.getByLabel('Menge (EP)').focus();
    await dialog.getByLabel('Menge (EP)').blur();
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0).toBeGreaterThan(400);
    await fotografiere(dialog, KAPITEL, 'ausgabe-nachtragen');
  });

  test('Ansicht „Stellen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/verpflegung`);
    await page.getByRole('radio', { name: 'Stellen (3)' }).click();
    const stellen = page.getByRole('region', { name: 'Verpflegungsstellen' });
    await expect(stellen.locator('[data-lfh="verpflegungsstelle"]')).toHaveCount(3);
    await expect(stellen.getByText('100 EP ausgegeben')).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(stellen, KAPITEL, 'stellen');
  });

  test('Portionen an der Ausgabe zählen', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/verpflegung`);
    // Der Sprung je Stelle: die Ausgabeansicht öffnet mit der Feldküche gewählt.
    await page
      .getByRole('link', { name: new RegExp(`^Ausgabe öffnen an ${FELDKUECHE} zu Mittag`) })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Mittag' })).toBeVisible();
    await expect(page.locator('[data-lfh="ausgabe-stelle-ist"]')).toHaveText(
      'an der Stelle 100 EP',
    );
    // Die Rettungsstaffel holt ab: „Wählen“ an ihrer Zeile, ihre Stärke mit einem Tipp.
    await page.getByRole('button', { name: `Empfänger wählen: ${STAFFEL}` }).click();
    await page
      .getByRole('button', { name: new RegExp(`^Stärke zählen: \\d+ EP an ${STAFFEL}$`) })
      .click();
    await page.getByRole('button', { name: /^vegetarisch/ }).click();
    await expect(page.locator('[data-lfh="sammlung-menge"]')).not.toHaveText('0');
    // Die ganze Seite: Kopf oben, Zähltasten am unteren Rand; das Element allein ist ein Fenster
    // hoch und läge zum Teil unter der Kopfleiste.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.move(0, 0);
    await fotografiere(page, KAPITEL, 'ausgabe-zaehlen');
  });
});
