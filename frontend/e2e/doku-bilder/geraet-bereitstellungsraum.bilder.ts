import type { Browser, Page } from '@playwright/test';
import {
  KONTEXTE,
  anmelden,
  demoEinsatz,
  expect,
  fotografiere,
  fuelle,
  test,
  uhrAnhalten,
} from './kern';

/**
 * Bilder des Kapitels „Bereitstellungsraum“ (`docs/anwender/kapitel/geraet-bereitstellungsraum.md`):
 * ein Tablet am Bereitstellungsraum, Kontext Tablet, eigener Browserkontext wie in
 * `e2e/geraet-kopplung.spec.ts`. Der Demo-Raum ist schon in Betrieb; damit „In Betrieb nehmen“
 * nachgeklickt werden kann, legt die Spec als Einsatzleitung einen geplanten Raum an (D3).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep geraet-bereitstellungsraum`, Mitänderungsregel in
 * `docs/anwender/AGENTS.md`):
 *   geplant.png   frontend/src/pages/bereitstellungsraum/BrDetailPage.tsx (Gerätezweig)
 *   raum.png      frontend/src/pages/bereitstellungsraum/BrDetailPage.tsx,
 *                 frontend/src/pages/bereitstellungsraum/KraefteOhneBrSidebar.tsx
 *   melden.png    frontend/src/geraet/GeraetMeldungenPage.tsx, frontend/src/geraet/GeraetMeldungen.tsx
 */

const KAPITEL = 'geraet-bereitstellungsraum';
const RAUM = 'Sportplatz Süd';

/** Ein geplanter Bereitstellungsraum, einmal je Lauf. */
async function geplanterRaum(page: Page, einsatz: number): Promise<number> {
  const pfad = `/api/einsaetze/${einsatz}/bereitstellungsraeume`;
  const liste = (await (await page.request.get(pfad)).json()) as {
    id: number;
    bezeichnung: string;
  }[];
  const da = liste.find((b) => b.bezeichnung === RAUM);
  if (da) return da.id;
  const neu = await fuelle<{ id: number }>(page, 'post', pfad, {
    bezeichnung: RAUM,
    standort: 'Am Sportplatz 2, Zufahrt über Tor 3',
  });
  return neu.id;
}

/** Koppelt ein Tablet an den geplanten Raum, eigener Browserkontext, Uhr angehalten. */
async function raumTablet(page: Page, browser: Browser) {
  await anmelden(page);
  const demo = await demoEinsatz(page);
  const br = await geplanterRaum(page, demo.id);
  const k = await fuelle<{ code: { code: string } }>(
    page,
    'post',
    `/api/einsaetze/${demo.id}/geraete`,
    { ansicht: 'bereitstellungsraum', stelle_id: br, bezeichnung: 'Tablet Einweiser' },
  );
  const kontext = await browser.newContext({ viewport: KONTEXTE.tablet });
  const geraet = await kontext.newPage();
  await uhrAnhalten(geraet);
  await geraet.goto(`/koppeln#${k.code.code}`);
  await geraet.getByRole('button', { name: 'Gerät koppeln' }).click();
  await expect(geraet).toHaveURL(new RegExp(`/geraet/${demo.id}/br/${br}$`));
  const nav = geraet.getByRole('navigation', { name: 'Gerätenavigation' });
  await expect(nav.getByRole('link')).toHaveText(['Raum', 'Melden']);
  return { kontext, geraet, nav };
}

test.describe(KAPITEL, () => {
  test('Raum in Betrieb nehmen und Kräfte anmelden', async ({ page, browser }) => {
    const { kontext, geraet } = await raumTablet(page, browser);
    try {
      await expect(geraet.getByRole('heading', { level: 1, name: RAUM })).toBeVisible();
      const inBetrieb = geraet.getByRole('button', { name: 'In Betrieb nehmen' });
      await expect(inBetrieb).toBeVisible();
      // Im Zustand „geplant“ nimmt der Raum noch keine Kräfte an.
      await expect(geraet.getByRole('button', { name: / zuweisen$/ })).toHaveCount(0);
      // Das Gerät storniert und löst nicht auf.
      await expect(geraet.getByRole('button', { name: 'Stornieren' })).toHaveCount(0);
      await geraet.mouse.move(0, 0);
      await fotografiere(geraet, KAPITEL, 'geplant');
      await inBetrieb.click();
      await expect(inBetrieb).toHaveCount(0);
      await expect(geraet.getByRole('button', { name: 'Auflösen' })).toHaveCount(0);

      // Zwei freie Einheiten aus „Kräfte ohne BR“ anmelden.
      const frei = geraet.getByRole('button', { name: / zuweisen$/ });
      await expect(frei.first()).toBeVisible();
      const belegung = geraet.getByTestId('br-belegung');
      for (let i = 0; i < 2; i++) {
        const name = ((await frei.first().getAttribute('aria-label')) ?? '').replace(
          / zuweisen$/,
          '',
        );
        await frei.first().click();
        await expect(belegung.getByText(name, { exact: true })).toBeVisible();
      }
      // Die Rückmeldungen („… dem BR zugewiesen“) verdeckten die Kopfzeile; bei angehaltener Uhr
      // schließen sie nicht von selbst. Neu laden zeigt denselben Stand ohne sie.
      await geraet.reload();
      await expect(belegung.getByRole('button', { name: 'entfernen' })).toHaveCount(2);
      await geraet.mouse.move(0, 0);
      await fotografiere(geraet, KAPITEL, 'raum');

      // Nachgeklickt: „entfernen“ meldet eine Kraft wieder ab.
      const entfernen = belegung.getByRole('button', { name: 'entfernen' });
      const vorher = await entfernen.count();
      await entfernen.first().click();
      await expect(entfernen).toHaveCount(vorher - 1);
    } finally {
      await kontext.close();
    }
  });

  test('Meldung an die Einsatzleitung', async ({ page, browser }) => {
    const { kontext, geraet, nav } = await raumTablet(page, browser);
    try {
      await nav.getByRole('link', { name: 'Melden' }).click();
      await expect(geraet.getByRole('heading', { level: 1, name: 'Melden' })).toBeVisible();
      await geraet.getByLabel('Inhalt').fill('Zufahrt Tor 3 blockiert, Anfahrt nur über Tor 1');
      await geraet.getByRole('radio', { name: 'dringend' }).click();
      await geraet.getByLabel('Inhalt').focus();
      await geraet.getByLabel('Inhalt').blur();
      await geraet.mouse.move(0, 0);
      await fotografiere(geraet, KAPITEL, 'melden');
      await geraet.getByRole('button', { name: 'Meldung senden' }).click();
      await expect(geraet.getByText(/Meldung #\d+ gesendet/)).toBeVisible();
      await expect(geraet.getByText('Zufahrt Tor 3 blockiert', { exact: false })).toBeVisible();
    } finally {
      await kontext.close();
    }
  });
});
