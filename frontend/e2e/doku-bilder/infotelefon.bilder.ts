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
 * Bilder des Kapitels „Informationstelefon“ (`docs/anwender/kapitel/infotelefon.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep infotelefon`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   infotelefon.png  frontend/src/pages/InfotelefonPage.tsx,
 *                    frontend/src/infotelefon/AnrufErfassung.tsx
 *
 * Füllung (D3): der Demo-Einsatz kennt keine Anrufe. Drei Anrufe kommen über die API, nur wenn
 * noch keiner da ist (ein Lauf aller Kapitel teilt eine Datenbank). Die API liegt weiter unter
 * `…/stab/infotelefon` (`frontend/src/infotelefon/AGENTS.md`). Alle Namen und Nummern sind
 * erfunden.
 */

const KAPITEL = 'infotelefon';

test.describe(KAPITEL, () => {
  test.beforeAll(async () => {
    const api = await apiAlsAdmin();
    const { id } = await demoEinsatz(api);
    const pfad = `/api/einsaetze/${id}/stab/infotelefon`;

    const anrufe = (await (await api.get(pfad)).json()) as unknown[];
    if (anrufe.length === 0) {
      const minutenZurueck = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
      await fuelle(api, 'post', pfad, {
        anliegen: 'auskunft_lage',
        notiz: 'Fragt nach Sperrung der Mühlbachstraße',
        eingang_at: minutenZurueck(40),
      });
      await fuelle(api, 'post', pfad, {
        anliegen: 'hilfeangebot',
        notiz: 'Bietet Sandsäcke und Transporter an',
        anrufer_name: 'Bauhof Kleinstadt',
        eingang_at: minutenZurueck(20),
      });
      await fuelle(api, 'post', pfad, {
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

  test('Seite „Informationstelefon“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/infotelefon`);
    const protokoll = page.getByRole('list', { name: 'Anrufprotokoll' });
    await expect(protokoll.getByText('Sucht Nachbarin aus der Mühlbachstraße 14')).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await fotografiere(page, KAPITEL, 'infotelefon');
  });
});
