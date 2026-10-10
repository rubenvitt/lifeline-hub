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
 * Bilder des Kapitels „Betreuungsstelle“ (`docs/anwender/kapitel/geraet-betreuungsstelle.md`):
 * ein Tablet an der Betreuungsstelle des Demo-Einsatzes, Kontext Tablet, eigener Browserkontext
 * wie in `e2e/geraet-kopplung.spec.ts`. Die Demo-Daten tragen keine namentlich untergebrachten
 * Personen; drei bringt die Spec als Einsatzleitung über die API unter (D3).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep geraet-betreuungsstelle`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   betroffene.png        frontend/src/geraet/GeraetBetroffenePage.tsx
 *   aufnahme.png          frontend/src/pages/personen/AufnahmePage.tsx (Gerätezweig ohne Sichtung)
 *   belegung-melden.png   frontend/src/geraet/GeraetBetreuungsstellePage.tsx,
 *                         frontend/src/betreuung/BetreuungDialoge.tsx
 */

const KAPITEL = 'geraet-betreuungsstelle';

/** Die Betreuungsstelle des Demo-Einsatzes. */
async function demoStelle(page: Page, einsatz: number): Promise<{ id: number }> {
  const antwort = await page.request.get(`/api/einsaetze/${einsatz}/betreuung`);
  expect(antwort.ok(), `Betreuung: ${antwort.status()}`).toBe(true);
  const [stelle] = ((await antwort.json()) as { stellen: { id: number }[] }).stellen;
  expect(stelle, 'der Demo-Einsatz hat eine Betreuungsstelle').toBeDefined();
  return stelle;
}

/** Drei Personen mit Verbleib Notunterkunft in der Stelle, einmal je Lauf. */
async function unterbringen(page: Page, einsatz: number, stelle: number) {
  const vorhanden = (await (
    await page.request.get(`/api/einsaetze/${einsatz}/personen`)
  ).json()) as {
    name: string | null;
  }[];
  if (vorhanden.some((p) => p.name === 'Schröder')) return;
  for (const [vorname, name, alter] of [
    ['Ilse', 'Schröder', 79],
    ['Walter', 'Schröder', 82],
    ['Mehmet', 'Yilmaz', 45],
  ] as const) {
    const p = await fuelle<{ id: number }>(page, 'post', `/api/einsaetze/${einsatz}/personen`, {
      vorname,
      name,
      alter_geschaetzt: alter,
      herkunft_adresse: 'Mühlbachweg 20',
      status: 'betroffen',
    });
    await fuelle(page, 'post', `/api/einsaetze/${einsatz}/personen/${p.id}/verbleib`, {
      art: 'notunterkunft',
      betreuungsstelle_id: stelle,
    });
  }
}

/** Koppelt ein Tablet an die Demo-Betreuungsstelle, eigener Browserkontext, Uhr angehalten. */
async function stellenTablet(page: Page, browser: Browser) {
  await anmelden(page);
  const demo = await demoEinsatz(page);
  const stelle = await demoStelle(page, demo.id);
  await unterbringen(page, demo.id, stelle.id);
  const k = await fuelle<{ code: { code: string } }>(
    page,
    'post',
    `/api/einsaetze/${demo.id}/geraete`,
    { ansicht: 'betreuungsstelle', stelle_id: stelle.id, bezeichnung: 'Tablet Aula' },
  );
  const kontext = await browser.newContext({ viewport: KONTEXTE.tablet });
  const geraet = await kontext.newPage();
  await uhrAnhalten(geraet);
  await geraet.goto(`/koppeln#${k.code.code}`);
  await geraet.getByRole('button', { name: 'Gerät koppeln' }).click();
  await expect(geraet).toHaveURL(new RegExp(`/geraet/${demo.id}/betroffene$`));
  const nav = geraet.getByRole('navigation', { name: 'Gerätenavigation' });
  await expect(nav.getByRole('link')).toHaveText(['Betroffene', 'Aufnahme', 'Stelle']);
  return { kontext, geraet, nav };
}

test.describe(KAPITEL, () => {
  test('Betroffene der Stelle', async ({ page, browser }) => {
    const { kontext, geraet } = await stellenTablet(page, browser);
    try {
      await expect(geraet.getByRole('heading', { level: 1, name: 'Betroffene' })).toBeVisible();
      await expect(geraet.getByText('Schröder, Ilse')).toBeVisible();
      await geraet.mouse.move(0, 0);
      await fotografiere(geraet, KAPITEL, 'betroffene');
    } finally {
      await kontext.close();
    }
  });

  test('Aufnahme ohne Sichtung', async ({ page, browser }) => {
    const { kontext, geraet, nav } = await stellenTablet(page, browser);
    try {
      await nav.getByRole('link', { name: 'Aufnahme' }).click();
      await expect(geraet.getByRole('radiogroup', { name: 'Sichtungskategorie' })).toHaveCount(0);
      await geraet.getByLabel('Geschätztes Alter (Jahre)').fill('34');
      await geraet.getByLabel('Geschätztes Alter (Jahre)').blur();
      await geraet.mouse.move(0, 0);
      await fotografiere(geraet, KAPITEL, 'aufnahme');
      await geraet.getByRole('button', { name: 'Weitere Angaben' }).click();
      await geraet.getByLabel('Name', { exact: true }).fill('Krause');
      await geraet.getByLabel('Vorname', { exact: true }).fill('Hanna');
      await geraet.getByRole('button', { name: 'Speichern und nächste' }).click();
      await expect(geraet.getByText(/Erfasst als R-\d{3} · untergebracht/)).toBeVisible();
      await nav.getByRole('link', { name: 'Betroffene' }).click();
      await expect(geraet.getByText('Krause, Hanna')).toBeVisible();
    } finally {
      await kontext.close();
    }
  });

  test('Belegung melden und Meldung an die Einsatzleitung', async ({ page, browser }) => {
    const { kontext, geraet, nav } = await stellenTablet(page, browser);
    try {
      await nav.getByRole('link', { name: 'Stelle' }).click();
      await expect(geraet).toHaveURL(/\/betreuung$/);
      await geraet.getByRole('button', { name: 'Belegung melden' }).click();
      const dialog = geraet.getByRole('dialog');
      await dialog.getByLabel('Belegt gesamt (Personen)').fill('84');
      await dialog.getByLabel('Belegt gesamt (Personen)').blur();
      await fotografiere(dialog, KAPITEL, 'belegung-melden');
      await dialog.getByRole('button', { name: 'Melden', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(geraet.getByText(/Belegung gemeldet: 84/)).toBeVisible();

      // Nachgeklickt: Meldung an die Einsatzleitung aus dem Bereich „Meldungen“.
      await geraet.getByRole('tab', { name: 'Meldungen' }).click();
      await geraet.getByLabel('Inhalt').fill('Feldbetten werden knapp, noch 10 frei');
      await geraet.getByRole('button', { name: 'Meldung senden' }).click();
      await expect(geraet.getByText(/Meldung #\d+ gesendet/)).toBeVisible();
      await expect(geraet.getByLabel('Inhalt')).toHaveValue('');
    } finally {
      await kontext.close();
    }
  });
});
