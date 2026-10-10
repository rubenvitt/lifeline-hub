import type { Browser, Page } from '@playwright/test';
import {
  kachelnBeantworten,
  kartenConfigBeantworten,
  vektorStilBeantworten,
} from '../kartenFixture';
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
 * Bilder des Kapitels „Lagemonitor“ (`docs/anwender/kapitel/lagemonitor.md`): ein Großbildschirm
 * im Kontext Lagemonitor (1920 × 1080), gekoppelt an den Demo-Einsatz in einem eigenen
 * Browserkontext wie in `e2e/geraet-kopplung.spec.ts`.
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep lagemonitor`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   lagemonitor.png    frontend/src/geraet/LagemonitorPage.tsx, frontend/src/geraet/LagemonitorKarte.tsx
 *   geraetemenue.png   frontend/src/geraet/LagemonitorPage.tsx (Gerätemenü nach langem Drücken)
 */

const KAPITEL = 'lagemonitor';
/** Musterstadt, wie die Fundorte der Demo-Personen. */
const EINSATZORT = { einsatzort_lat: 50.953, einsatzort_lon: 10.244 };
/** Die Turnhalle, ein Stück nordöstlich davon. */
const UHS_ORT = { lat: 50.957, lon: 10.252 };
const STIL_PFAD = '/api/karte/proxy/9/style.json';
const KACHEL_PRAEFIX = '/api/karte/proxy/9/tile/';

/** Kartengrundlage ohne Netz aus `e2e/kartenFixture.ts` (docs/anwender/AGENTS.md, „Bilder“). */
async function kartengrundlage(geraet: Page) {
  await kartenConfigBeantworten(geraet, {
    online_styles: [{ name: 'Kachel-Fixture', typ: 'vektor', url: STIL_PFAD }],
  });
  await vektorStilBeantworten(geraet, STIL_PFAD, {
    id: 'fixture',
    kachelVorlage: `${KACHEL_PRAEFIX}{z}/{x}/{y}.pbf`,
    layer: 'strassen',
  });
  await kachelnBeantworten(geraet, KACHEL_PRAEFIX, 'strassen');
}

/** Koppelt den Monitor, eigener Browserkontext, Uhr angehalten, Anzeige gestartet. */
async function monitor(page: Page, browser: Browser) {
  await anmelden(page);
  const demo = await demoEinsatz(page);
  // Der Demo-Einsatz trägt keinen verorteten Einsatzort; ohne ihn bliebe die Kartenkachel leer
  // („Kein Einsatzort verortet“). Teil-PATCH des Einsatzkopfs; `orteZuruecksetzen` räumt ihn
  // wieder ab, damit kein anderes Kapitel ihn sieht.
  await fuelle(page, 'patch', `/api/einsaetze/${demo.id}`, EINSATZORT);
  const uhs = await ersteUhs(page, demo.id);
  await fuelle(page, 'patch', `/api/einsaetze/${demo.id}/uhs/${uhs}`, UHS_ORT);
  const k = await fuelle<{ code: { code: string } }>(
    page,
    'post',
    `/api/einsaetze/${demo.id}/geraete`,
    { ansicht: 'lagemonitor', bezeichnung: 'Monitor Stab' },
  );
  const kontext = await browser.newContext({ viewport: KONTEXTE.lagemonitor });
  const geraet = await kontext.newPage();
  await uhrAnhalten(geraet);
  await kartengrundlage(geraet);
  await geraet.goto(`/koppeln#${k.code.code}`);
  await geraet.getByRole('button', { name: 'Gerät koppeln' }).click();
  await expect(geraet).toHaveURL(new RegExp(`/geraet/${demo.id}/monitor$`));
  await geraet.getByRole('button', { name: 'Anzeige starten' }).click();
  await expect(geraet.getByRole('button', { name: 'Anzeige starten' })).toHaveCount(0);
  await expect(geraet.locator('[data-lfh="monitor-verbindung"]')).toHaveAttribute(
    'data-zustand',
    'open',
  );
  await expect(geraet.locator('[data-lfh="monitor-uhs"]').first()).toBeVisible();
  return { kontext, geraet, einsatz: demo.id, uhs };
}

/** Die UHS des Demo-Einsatzes. */
async function ersteUhs(page: Page, einsatz: number): Promise<number> {
  const antwort = await page.request.get(`/api/einsaetze/${einsatz}/uhs`);
  expect(antwort.ok(), `UHS: ${antwort.status()}`).toBe(true);
  const [erste] = (await antwort.json()) as { id: number }[];
  expect(erste, 'der Demo-Einsatz hat eine UHS').toBeDefined();
  return erste.id;
}

/** Nimmt Einsatzort und UHS-Ort wieder heraus (Teil-PATCH mit `null`). */
async function orteZuruecksetzen(page: Page, einsatz: number, uhs: number) {
  await fuelle(page, 'patch', `/api/einsaetze/${einsatz}`, {
    einsatzort_lat: null,
    einsatzort_lon: null,
  });
  await fuelle(page, 'patch', `/api/einsaetze/${einsatz}/uhs/${uhs}`, { lat: null, lon: null });
}

test.describe(KAPITEL, () => {
  test('Großbild mit Karte, Kacheln und Statusleiste', async ({ page, browser }) => {
    const { kontext, geraet, einsatz, uhs } = await monitor(page, browser);
    try {
      // Gerendert heißt: Einsatzort und UHS stehen als Marken auf der Karte.
      await expect(geraet.locator('.maplibregl-marker')).toHaveCount(2);
      await geraet.mouse.move(0, 0);
      await fotografiere(geraet, KAPITEL, 'lagemonitor');
    } finally {
      await kontext.close();
      await orteZuruecksetzen(page, einsatz, uhs);
    }
  });

  test('Gerätemenü nach langem Drücken auf die Statusleiste', async ({ page, browser }) => {
    const { kontext, geraet, einsatz, uhs } = await monitor(page, browser);
    try {
      const leiste = geraet.locator('[data-lfh="monitor-statusleiste"]');
      const box = await leiste.boundingBox();
      expect(box, 'Statusleiste sichtbar').not.toBeNull();
      await geraet.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await geraet.mouse.down();
      const menue = geraet.getByRole('dialog', { name: 'Gerätemenü' });
      await expect(menue).toBeVisible({ timeout: 10_000 });
      await geraet.mouse.up();
      await expect(menue.getByRole('group', { name: 'Helligkeit' })).toBeVisible();
      await geraet.mouse.move(0, 0);
      await fotografiere(geraet, KAPITEL, 'geraetemenue');
      await menue.getByRole('button', { name: 'Schließen' }).click();
      await expect(menue).toHaveCount(0);
    } finally {
      await kontext.close();
      await orteZuruecksetzen(page, einsatz, uhs);
    }
  });
});
