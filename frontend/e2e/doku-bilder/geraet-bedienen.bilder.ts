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
 * Bilder des Kapitels „Gerät bedienen“ (`docs/anwender/kapitel/geraet-bedienen.md`): Koppeln am
 * Gerät, Hülle mit Kopfzeile, Gerätemenü und „Kopplung beendet“, im Kontext Tablet. Das Gerät ist
 * ein eigener Browserkontext wie in `e2e/geraet-kopplung.spec.ts`; die Kopplung legt der Admin als
 * Einsatzleitung des Demo-Einsatzes über die API an.
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep geraet-bedienen`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   koppeln.png            frontend/src/geraet/KoppelnPage.tsx, frontend/src/geraet/GeraeteKarte.tsx
 *   kopfzeile.png          frontend/src/geraet/GeraeteKopf.tsx
 *   geraetemenue.png       frontend/src/geraet/GeraeteMenue.tsx
 *   handschuh.png          frontend/src/geraet/GeraeteLayout.tsx, frontend/src/geraet/GeraetPatientenPage.tsx
 *   kopplung-beendet.png   frontend/src/geraet/KopplungBeendetPage.tsx
 */

const KAPITEL = 'geraet-bedienen';

interface Kopplung {
  kopplung: { id: number };
  code: { code: string };
}

/** Die UHS des Demo-Einsatzes. */
async function demoUhs(page: Page, einsatz: number): Promise<number> {
  const antwort = await page.request.get(`/api/einsaetze/${einsatz}/uhs`);
  expect(antwort.ok(), `UHS: ${antwort.status()}`).toBe(true);
  const [erste] = (await antwort.json()) as { id: number }[];
  expect(erste, 'der Demo-Einsatz hat eine UHS').toBeDefined();
  return erste.id;
}

/** Ende der Kopplung in `minuten` ab jetzt, in der Form des Servers (UTC). */
function endeIn(minuten: number): string {
  return new Date(Date.now() + minuten * 60_000).toISOString().slice(0, 16).replace('T', ' ');
}

/** Legt eine Kopplung als Einsatzleitung an. */
async function kopplungAnlegen(page: Page, einsatz: number, daten: object): Promise<Kopplung> {
  return fuelle<Kopplung>(page, 'post', `/api/einsaetze/${einsatz}/geraete`, daten);
}

/** Eigener Browserkontext für das Gerät (eigener Cookie-Jar), Uhr angehalten. */
async function geraetOeffnen(browser: Browser) {
  const kontext = await browser.newContext({ viewport: KONTEXTE.tablet });
  const geraet = await kontext.newPage();
  await uhrAnhalten(geraet);
  return { kontext, geraet };
}

/** Löst den Code am Gerät über den QR-Weg (`/koppeln#CODE`) ein. */
async function koppeln(geraet: Page, code: string) {
  await geraet.goto(`/koppeln#${code}`);
  await expect(geraet.getByLabel('Kopplungscode')).toHaveValue(code);
  await geraet.getByRole('button', { name: 'Gerät koppeln' }).click();
  await expect(geraet).toHaveURL(/\/geraet\/\d+\/patienten$/);
}

test.describe(KAPITEL, () => {
  test('Seite „Gerät koppeln“ am Gerät', async ({ page, browser }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const uhs = await demoUhs(page, demo.id);
    const k = await kopplungAnlegen(page, demo.id, {
      ansicht: 'uhs-tablet',
      stelle_id: uhs,
      bezeichnung: 'Tablet Eingang',
    });
    const { kontext, geraet } = await geraetOeffnen(browser);
    try {
      await geraet.goto(`/koppeln#${k.code.code}`);
      const karte = geraet.locator('.login-karte');
      await expect(karte.getByLabel('Kopplungscode')).toHaveValue(k.code.code);
      // Die Seite nimmt den Code sofort aus der Adresse.
      await expect(geraet).toHaveURL(/\/koppeln$/);
      await fotografiere(karte, KAPITEL, 'koppeln');
      await karte.getByRole('button', { name: 'Gerät koppeln' }).click();
      await expect(geraet).toHaveURL(/\/geraet\/\d+\/patienten$/);
    } finally {
      await kontext.close();
    }
  });

  test('Kopfzeile mit bald endender Kopplung', async ({ page, browser }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const uhs = await demoUhs(page, demo.id);
    const k = await kopplungAnlegen(page, demo.id, {
      ansicht: 'uhs-tablet',
      stelle_id: uhs,
      bezeichnung: 'Tablet Eingang',
      laeuft_ab_at: endeIn(45),
    });
    const { kontext, geraet } = await geraetOeffnen(browser);
    try {
      await koppeln(geraet, k.code.code);
      const kopf = geraet.locator('[data-lfh="geraet-kopf"]');
      await expect(kopf.locator('[data-lfh="kopf-kopplungsende"]')).toHaveAttribute(
        'data-bald',
        'ja',
      );
      await expect(kopf.getByText('Tablet Eingang')).toBeVisible();
      await fotografiere(kopf, KAPITEL, 'kopfzeile');
    } finally {
      await kontext.close();
    }
  });

  test('Gerätemenü, Hilfe und zurück', async ({ page, browser }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const uhs = await demoUhs(page, demo.id);
    const k = await kopplungAnlegen(page, demo.id, {
      ansicht: 'uhs-tablet',
      stelle_id: uhs,
      bezeichnung: 'Tablet Eingang',
    });
    const { kontext, geraet } = await geraetOeffnen(browser);
    try {
      await koppeln(geraet, k.code.code);
      await geraet.getByRole('button', { name: 'Gerätemenü' }).click();
      const menue = geraet.getByRole('menu');
      await expect(menue.getByRole('menuitem', { name: 'Gerät abmelden …' })).toBeVisible();
      await fotografiere(menue, KAPITEL, 'geraetemenue');

      // Nachgeklickt: „Hilfe“ verlässt die Hülle, „Zum Gerät“ führt zurück.
      await menue.getByRole('menuitem', { name: 'Hilfe' }).click();
      await expect(geraet).toHaveURL(/\/hilfe$/);
      await geraet.getByRole('button', { name: 'Zum Gerät' }).click();
      await expect(geraet).toHaveURL(/\/geraet\/\d+\/patienten$/);
    } finally {
      await kontext.close();
    }
  });

  test('Hülle in der Handschuh-Stufe, dann abmelden', async ({ page, browser }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const uhs = await demoUhs(page, demo.id);
    const k = await kopplungAnlegen(page, demo.id, {
      ansicht: 'uhs-tablet',
      stelle_id: uhs,
      bezeichnung: 'Tablet Eingang',
    });
    const { kontext, geraet } = await geraetOeffnen(browser);
    try {
      await koppeln(geraet, k.code.code);
      await geraet.getByRole('button', { name: 'Gerätemenü' }).click();
      await geraet.getByRole('menuitem', { name: 'Handschuh' }).click();
      await expect(geraet.getByRole('menu')).toHaveCount(0);
      // Die Wahl bleibt am Gerät gespeichert, auch nach dem Neuladen.
      await geraet.reload();
      await expect(geraet.getByRole('heading', { level: 1, name: 'Patienten' })).toBeVisible();
      await expect(geraet.getByRole('table').getByRole('row').nth(1)).toBeVisible();
      await geraet.mouse.move(0, 0);
      await fotografiere(geraet, KAPITEL, 'handschuh');

      // Nachgeklickt: „Gerät abmelden …“ fragt zurück und führt zur Codeeingabe.
      await geraet.getByRole('button', { name: 'Gerätemenü' }).click();
      await expect(geraet.getByRole('menuitem', { name: 'Handschuh ✓' })).toBeVisible();
      await geraet.getByRole('menuitem', { name: 'Gerät abmelden …' }).click();
      const rueckfrage = geraet.getByRole('dialog', { name: 'Gerät abmelden?' });
      await rueckfrage.getByRole('button', { name: 'Abmelden' }).click();
      await expect(geraet).toHaveURL(/\/koppeln$/);
    } finally {
      await kontext.close();
    }
  });

  test('Seite „Kopplung beendet“ nach dem Widerruf', async ({ page, browser }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const uhs = await demoUhs(page, demo.id);
    const k = await kopplungAnlegen(page, demo.id, {
      ansicht: 'uhs-tablet',
      stelle_id: uhs,
      bezeichnung: 'Tablet Eingang',
    });
    const { kontext, geraet } = await geraetOeffnen(browser);
    try {
      await koppeln(geraet, k.code.code);
      await fuelle(page, 'post', `/api/einsaetze/${demo.id}/geraete/${k.kopplung.id}/widerrufen`);
      // Ohne Neuladen: der Server schließt den Einsatzstrom, das Gerät prüft seine Sitzung.
      await expect(geraet).toHaveURL(/\/kopplung-beendet$/);
      const karte = geraet.locator('.login-karte');
      await expect(karte.getByRole('heading', { name: 'Kopplung beendet' })).toBeVisible();
      await fotografiere(karte, KAPITEL, 'kopplung-beendet');
      await karte.getByRole('button', { name: 'Neuen Code eingeben' }).click();
      await expect(geraet).toHaveURL(/\/koppeln$/);
    } finally {
      await kontext.close();
    }
  });
});
