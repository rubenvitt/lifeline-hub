import type { Browser, Page } from '@playwright/test';
import { waehleIn, waehleStehend } from '../auswahl-kern';
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
 * Bilder des Kapitels „UHS-Tablet und UHS-Laptop“ (`docs/anwender/kapitel/geraet-uhs.md`): das
 * Tablet im Kontext Tablet, der Laptop am Tisch der UHS im Kontext Fükw. Gekoppelt an die UHS des
 * Demo-Einsatzes, jedes Gerät in einem eigenen Browserkontext wie in
 * `e2e/geraet-kopplung.spec.ts`.
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep geraet-uhs`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   patienten.png   frontend/src/geraet/GeraetPatientenPage.tsx
 *   aufnahme.png    frontend/src/pages/personen/AufnahmePage.tsx (Gerätezweig)
 *   grundriss.png   frontend/src/pages/uhs/UhsDetailPage.tsx, frontend/src/pages/uhs/Grundriss.tsx
 *   sichtung.png    frontend/src/personen/SichtungDialog.tsx, frontend/src/geraet/BestaetigtVonFeld.tsx
 *   laptop-uhs.png  frontend/src/geraet/GeraetStellePage.tsx, frontend/src/pages/uhs/UhsKraefte.tsx
 */

const KAPITEL = 'geraet-uhs';

type Ansicht = 'uhs-tablet' | 'uhs-laptop';

interface Uhs {
  id: number;
  bezeichnung: string;
}

async function demoUhs(page: Page, einsatz: number): Promise<Uhs> {
  const antwort = await page.request.get(`/api/einsaetze/${einsatz}/uhs`);
  expect(antwort.ok(), `UHS: ${antwort.status()}`).toBe(true);
  const [erste] = (await antwort.json()) as Uhs[];
  expect(erste, 'der Demo-Einsatz hat eine UHS').toBeDefined();
  return erste;
}

/**
 * Koppelt ein UHS-Gerät an die Demo-UHS: Kopplung als Einsatzleitung über die API, Einlösen in
 * einem eigenen Browserkontext über den QR-Weg (`/koppeln#CODE`).
 */
async function uhsGeraet(
  page: Page,
  browser: Browser,
  ansicht: Ansicht,
  bezeichnung: string,
  viewport: { width: number; height: number },
) {
  await anmelden(page);
  const demo = await demoEinsatz(page);
  const uhs = await demoUhs(page, demo.id);
  const k = await fuelle<{ code: { code: string } }>(
    page,
    'post',
    `/api/einsaetze/${demo.id}/geraete`,
    { ansicht, stelle_id: uhs.id, bezeichnung },
  );
  const kontext = await browser.newContext({ viewport });
  const geraet = await kontext.newPage();
  await uhrAnhalten(geraet);
  await geraet.goto(`/koppeln#${k.code.code}`);
  await geraet.getByRole('button', { name: 'Gerät koppeln' }).click();
  await expect(geraet).toHaveURL(new RegExp(`/geraet/${demo.id}/patienten$`));
  const nav = geraet.getByRole('navigation', { name: 'Gerätenavigation' });
  return { kontext, geraet, nav, einsatz: demo.id, uhs };
}

test.describe(KAPITEL, () => {
  test('Patientenliste am Tablet', async ({ page, browser }) => {
    const { kontext, geraet } = await uhsGeraet(
      page,
      browser,
      'uhs-tablet',
      'Tablet Eingang',
      KONTEXTE.tablet,
    );
    try {
      await expect(geraet.getByRole('heading', { level: 1, name: 'Patienten' })).toBeVisible();
      await expect(geraet.getByRole('button', { name: 'Patient aufnehmen' })).toBeVisible();
      await expect(geraet.getByRole('table').getByRole('row').nth(1)).toBeVisible();
      // Der Zeiger stünde sonst noch über einer Zeile (Hover-Fläche im Bild).
      await geraet.mouse.move(0, 0);
      await fotografiere(geraet, KAPITEL, 'patienten');
    } finally {
      await kontext.close();
    }
  });

  test('Aufnahme am Tablet', async ({ page, browser }) => {
    const { kontext, geraet, nav } = await uhsGeraet(
      page,
      browser,
      'uhs-tablet',
      'Tablet Eingang',
      KONTEXTE.tablet,
    );
    try {
      await nav.getByRole('link', { name: 'Aufnahme' }).click();
      await expect(geraet).toHaveURL(/\/aufnahme\?uhs=\d+$/);
      await geraet.locator('#sichtung').getByText('SK II', { exact: true }).click();
      await fotografiere(geraet.locator('main'), KAPITEL, 'aufnahme');
      await geraet.getByRole('button', { name: 'Speichern und nächste' }).click();
      await expect(geraet.getByText(/Erfasst als R-\d{3} · SK II · im Wartebereich/)).toBeVisible();
    } finally {
      await kontext.close();
    }
  });

  test('Grundriss am Tablet, Patient einem Platz zuweisen', async ({ page, browser }) => {
    const { kontext, geraet, nav } = await uhsGeraet(
      page,
      browser,
      'uhs-tablet',
      'Tablet Eingang',
      KONTEXTE.tablet,
    );
    try {
      await nav.getByRole('link', { name: 'Grundriss' }).click();
      await expect(geraet.getByRole('button', { name: 'Plätze bearbeiten' })).toHaveCount(0);
      const platz = geraet.getByTestId('platz-karte').filter({ hasText: 'Behandlungsplatz 1' });
      await expect(platz).toBeVisible();
      await fotografiere(geraet.locator('main'), KAPITEL, 'grundriss');

      // Nachgeklickt: Tippen auf den freien Platz öffnet „Patient zuweisen“.
      await platz.click();
      const dialog = geraet.getByRole('dialog', { name: /^Patient zuweisen — Behandlungsplatz 1/ });
      await dialog.getByRole('combobox', { name: 'Patient' }).click();
      await waehleStehend(geraet, 'R-001 · Mustermann', { exact: false });
      await dialog.getByRole('button', { name: 'Erfassen' }).click();
      await expect(dialog).toHaveCount(0);
      await expect(platz).toContainText('Mustermann');
    } finally {
      await kontext.close();
    }
  });

  test('Sichtung mit „Bestätigt von“', async ({ page, browser }) => {
    const { kontext, geraet, einsatz, uhs } = await uhsGeraet(
      page,
      browser,
      'uhs-tablet',
      'Tablet Eingang',
      KONTEXTE.tablet,
    );
    try {
      // Eine noch nicht gesichtete Person der UHS (die Demo-Patienten sind schon gesichtet).
      const person = await fuelle<{ id: number }>(
        page,
        'post',
        `/api/einsaetze/${einsatz}/personen`,
        {
          name: 'Neumann',
          uhs_id: uhs.id,
        },
      );
      const bestaetiger = (await (
        await geraet.request.get(`/api/einsaetze/${einsatz}/personen/bestaetiger`)
      ).json()) as { name: string; funktion: string | null }[];
      const mit = bestaetiger.find((b) => b.funktion) ?? bestaetiger[0];
      expect(mit, 'Personal im Demo-Einsatz').toBeDefined();
      const label = mit.funktion ? `${mit.name} · ${mit.funktion}` : mit.name;

      await geraet.goto(`/geraet/${einsatz}/patienten/${person.id}`);
      await geraet.getByRole('button', { name: 'Sichten', exact: true }).click();
      const dialog = geraet.getByRole('dialog', { name: 'Sichtung erfassen' });
      await waehleIn(dialog.getByRole('combobox', { name: 'Kategorie' }), 'SK II');
      await waehleIn(dialog.getByRole('combobox', { name: 'Bestätigt von' }), label);
      await dialog.getByRole('combobox', { name: 'Bestätigt von' }).blur();
      await fotografiere(dialog, KAPITEL, 'sichtung');
      await dialog.getByRole('button', { name: 'Übernehmen' }).click();
      await expect(dialog).toHaveCount(0);
      await expect(geraet.getByText(`bestätigt: ${mit.name}`)).toBeVisible();
    } finally {
      await kontext.close();
    }
  });

  test('Bereich „UHS“ am Laptop', async ({ page, browser }) => {
    const { kontext, geraet, nav } = await uhsGeraet(
      page,
      browser,
      'uhs-laptop',
      'Laptop Leitung',
      KONTEXTE.fuekw,
    );
    try {
      await expect(nav.getByRole('link')).toHaveText(['Patienten', 'Aufnahme', 'Grundriss', 'UHS']);
      await nav.getByRole('link', { name: 'UHS' }).click();
      await expect(geraet).toHaveURL(/\/stelle$/);
      await geraet.getByRole('tab', { name: 'Kräfte' }).click();
      await expect(geraet.getByTestId('uhs-staerke')).toBeVisible();
      await expect(geraet.getByRole('button', { name: 'Einheit zuordnen' })).toHaveCount(0);
      await fotografiere(geraet.locator('main'), KAPITEL, 'laptop-uhs');

      // Nachgeklickt: Meldung an die Einsatzleitung.
      await geraet.getByRole('tab', { name: 'Meldungen' }).click();
      await geraet.getByLabel('Inhalt').fill('Decken werden knapp');
      await geraet.getByRole('button', { name: 'Meldung senden' }).click();
      await expect(geraet.getByText(/Meldung #\d+ gesendet/)).toBeVisible();
      await expect(geraet.getByLabel('Inhalt')).toHaveValue('');

      // Nachgeklickt: der Laptop bearbeitet den Grundriss.
      await nav.getByRole('link', { name: 'Grundriss' }).click();
      await expect(geraet.getByRole('button', { name: 'Plätze bearbeiten' })).toBeVisible();
    } finally {
      await kontext.close();
    }
  });
});
