import { waehleIn } from '../auswahl-kern';
import {
  apiAlsAdmin,
  anmelden,
  demoEinsatz,
  expect,
  fotografiere,
  fuelle,
  test,
  uhrAnhalten,
} from './kern';

/**
 * Bilder des Kapitels „Presse und Infotelefon“ (`docs/anwender/kapitel/presse-infotelefon.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep presse-infotelefon`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   pressearbeit.png      frontend/src/pages/PressePage.tsx
 *   medienkontakt.png     frontend/src/pages/PressePage.tsx (Dialog „Medienkontakt erfassen“)
 *   pressemitteilung.png  frontend/src/pages/PressemitteilungDetailPage.tsx
 *   infotelefon.png       frontend/src/pages/InfotelefonPage.tsx,
 *                         frontend/src/infotelefon/AnrufErfassung.tsx
 *
 * Füllung (D3): der Demo-Einsatz kennt keine Pressearbeit. Zwei Medienkontakte, ein Entwurf
 * „Erstinformation“ und drei Anrufe kommen über die API, jeweils nur, wenn sie fehlen (ein Lauf
 * aller Kapitel teilt eine Datenbank). Alle Namen und Nummern sind erfunden.
 */

const KAPITEL = 'presse-infotelefon';
const MITTEILUNG = 'Starkregen Musterstadt – Evakuierung Ortsteil Nord';

test.describe(KAPITEL, () => {
  let mitteilungId = 0;

  test.beforeAll(async () => {
    const api = await apiAlsAdmin();
    const { id } = await demoEinsatz(api);
    const stab = `/api/einsaetze/${id}/stab`;

    const kontakte = (await (await api.get(`${stab}/medienkontakte`)).json()) as {
      thema: string;
    }[];
    if (!kontakte.some((k) => k.thema === 'Zahl der Evakuierten')) {
      await fuelle(api, 'post', `${stab}/medienkontakte`, {
        art: 'anfrage',
        medium: 'Radio Musterstadt',
        thema: 'Zahl der Evakuierten',
        kontakt_name: 'Redaktion Frühdienst',
        kontakt_erreichbarkeit: '0561 400 100',
        eingang_at: new Date(Date.now() - 25 * 60_000).toISOString(),
      });
    }
    if (!kontakte.some((k) => k.thema === 'Drehgenehmigung am Deich')) {
      await fuelle(api, 'post', `${stab}/medienkontakte`, {
        art: 'termin',
        medium: 'Musterstädter Anzeiger',
        thema: 'Drehgenehmigung am Deich',
        eingang_at: new Date(Date.now() - 50 * 60_000).toISOString(),
      });
    }

    const mitteilungen = (await (await api.get(`${stab}/pressemitteilungen`)).json()) as {
      id: number;
      titel: string;
    }[];
    mitteilungId =
      mitteilungen.find((m) => m.titel === MITTEILUNG)?.id ??
      (
        await fuelle<{ id: number }>(api, 'post', `${stab}/pressemitteilungen`, {
          vorlage: 'erstinformation',
          titel: MITTEILUNG,
          abschnitte: [
            {
              schluessel: 'sachverhalt',
              text:
                'Seit dem Morgen hat Starkregen den Mühlbach über die Ufer treten lassen. Im ' +
                'Ortsteil Nord stehen Keller und Straßen unter Wasser.',
            },
            {
              schluessel: 'massnahmen',
              text: 'Einzelne Straßenzüge werden evakuiert, eine Betreuungsstelle ist eingerichtet.',
            },
          ],
        })
      ).id;

    const anrufe = (await (await api.get(`${stab}/infotelefon`)).json()) as unknown[];
    if (anrufe.length === 0) {
      const minutenZurueck = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
      await fuelle(api, 'post', `${stab}/infotelefon`, {
        anliegen: 'auskunft_lage',
        notiz: 'Fragt nach Sperrung der Mühlbachstraße',
        eingang_at: minutenZurueck(40),
      });
      await fuelle(api, 'post', `${stab}/infotelefon`, {
        anliegen: 'hilfeangebot',
        notiz: 'Bietet Sandsäcke und Transporter an',
        anrufer_name: 'Bauhof Kleinstadt',
        eingang_at: minutenZurueck(20),
      });
      await fuelle(api, 'post', `${stab}/infotelefon`, {
        anliegen: 'vermisstensuche',
        notiz: 'Sucht Nachbarin aus der Mühlbachstraße 14',
        anrufer_name: 'E. Muster',
        rueckruf: '0170 555 0400',
        rueckruf_noetig: true,
        eingang_at: minutenZurueck(5),
      });
    }
    await api.dispose();
  });

  test('Seite „Pressearbeit“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/stab/presse`);
    await expect(page.getByText('Zahl der Evakuierten').first()).toBeVisible();
    await expect(page.getByRole('link', { name: MITTEILUNG })).toBeVisible();
    await fotografiere(page, KAPITEL, 'pressearbeit');
  });

  test('Dialog „Medienkontakt erfassen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/stab/presse`);
    await page.getByRole('button', { name: 'Medienkontakt erfassen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Medienkontakt erfassen' });
    await waehleIn(dialog.getByRole('combobox', { name: 'Art' }), 'Anfrage');
    await dialog.getByLabel('Medium').fill('Regionalfernsehen Nord');
    await dialog.getByLabel('Thema').fill('Lage an der Turnhalle');
    await dialog.getByLabel('Thema').blur();
    await page.mouse.move(0, 0);
    await fotografiere(dialog, KAPITEL, 'medienkontakt');
  });

  test('Pressemitteilung im Entwurf', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/stab/presse/mitteilungen/${mitteilungId}`);
    await expect(page.getByRole('button', { name: 'Freigeben' })).toBeVisible();
    await expect(page.locator('textarea#sachverhalt')).toHaveValue(/Ortsteil Nord/);
    // Der Einstieg öffnet den ersten leeren Abschnitt; gezeigt wird der Sachverhalt mit Text.
    await page.getByRole('tab', { name: /Sachverhalt/ }).click();
    await expect(page.locator('textarea#sachverhalt')).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.mouse.move(0, 0);
    await fotografiere(page, KAPITEL, 'pressemitteilung');
  });

  test('Seite „Informationstelefon“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/stab/infotelefon`);
    const protokoll = page.getByRole('list', { name: 'Anrufprotokoll' });
    await expect(protokoll.getByText('Sucht Nachbarin aus der Mühlbachstraße 14')).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await fotografiere(page, KAPITEL, 'infotelefon');
  });
});
