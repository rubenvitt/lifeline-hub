import type { APIRequestContext } from '@playwright/test';
import { waehleIn } from '../auswahl-kern';
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
 * Bilder des Kapitels „Meldebild und Kräfte-Zeitachse“ (`docs/anwender/kapitel/meldebild.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep meldebild`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   meldebild.png             frontend/src/pages/KraefteuebersichtPage.tsx,
 *                             frontend/src/kraefte/Statusband.tsx
 *   zeitachse.png             frontend/src/kraefte/KraftZeitachse.tsx (in EinheitDetailPage.tsx)
 *   zeitachse-nachtragen.png  frontend/src/kraefte/KraftZeitachse.tsx (Dialog „Nachtragen“)
 *
 * Demo-Lücke (D3): die Demo-Daten tragen keine Ereignisse der Kräfte-Zeitachse. Die Spec trägt
 * für zwei Einheiten Alarmierung und Eintreffen nach und streicht ein falsches Eintreffen, damit
 * Spalte „Im Einsatz“ und die Zeitachse etwas zeigen.
 */

const KAPITEL = 'meldebild';

interface Einheit {
  id: number;
  name: string;
}
interface Zeitachse {
  ereignisse: { id: number; art: string; zeitpunkt_at: string }[];
}

/** Drahtformat des Servers: UTC ohne Zonenkennung. */
function draht(zeit: Date): string {
  return zeit.toISOString().slice(0, 19).replace('T', ' ');
}

function vor(basis: Date, minuten: number): Date {
  return new Date(basis.getTime() - minuten * 60_000);
}

async function einheitNamens(api: APIRequestContext, einsatzId: number, name: string) {
  const antwort = await api.get(`/api/einsaetze/${einsatzId}/einheiten`);
  expect(antwort.ok(), `Einheiten: ${antwort.status()}`).toBe(true);
  const einheit = ((await antwort.json()) as Einheit[]).find((e) => e.name === name);
  expect(einheit, `Einheit „${name}“ im Demo-Einsatz`).toBeDefined();
  return einheit!;
}

test.describe(KAPITEL, () => {
  test.beforeAll(async () => {
    const api = await apiAlsAdmin();
    try {
      const demo = await demoEinsatz(api);
      const jetzt = new Date();
      const nachtrag = (eid: number, art: string, zeit: Date, notiz?: string) =>
        fuelle<Zeitachse>(api, 'post', `/api/einsaetze/${demo.id}/einheiten/${eid}/zeitachse`, {
          art,
          zeitpunkt_at: draht(zeit),
          notiz,
        });

      const rettung = await einheitNamens(api, demo.id, 'Rettungsstaffel');
      await nachtrag(rettung.id, 'alarmierung', vor(jetzt, 287), 'Alarmierung über ILS');
      const falsch = await nachtrag(rettung.id, 'eintreffen', vor(jetzt, 262));
      const irrtum = falsch.ereignisse.find((e) => e.art === 'eintreffen');
      expect(irrtum, 'nachgetragenes Eintreffen').toBeDefined();
      await fuelle(
        api,
        'post',
        `/api/einsaetze/${demo.id}/einheiten/${rettung.id}/zeitachse/${irrtum!.id}/streichen`,
        { grund: 'Zeit verwechselt' },
      );
      await nachtrag(rettung.id, 'eintreffen', vor(jetzt, 271), 'per Funk gemeldet');

      const zug = await einheitNamens(api, demo.id, 'Sanitätszug Musterstadt');
      await nachtrag(zug.id, 'alarmierung', vor(jetzt, 288));
      await nachtrag(zug.id, 'eintreffen', vor(jetzt, 272));

      const uhs = await einheitNamens(api, demo.id, 'Sanitätsgruppe UHS');
      await nachtrag(uhs.id, 'eintreffen', vor(jetzt, 241));
    } finally {
      await api.dispose();
    }
  });

  test('Meldebild mit Statusband und Raster', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/kraefteuebersicht`);
    const raster = page.getByRole('table');
    await expect(raster.getByText('Rettungsstaffel')).toBeVisible();
    await expect(page.locator('[data-lfh="im-einsatz"]').first()).toBeVisible();
    await fotografiere(page, KAPITEL, 'meldebild');
  });

  test('Zeitachse einer Einheit', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const rettung = await einheitNamens(page.request, demo.id, 'Rettungsstaffel');
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einheiten/${rettung.id}`);
    const paneel = page.getByRole('region', { name: 'Zeitachse' });
    await expect(paneel.locator('[data-lfh="zeitachse-ereignis"]')).toHaveCount(3);
    await fotografiere(paneel, KAPITEL, 'zeitachse');
  });

  test('Dialog „Zeitachse nachtragen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const betreuung = await einheitNamens(page.request, demo.id, 'Betreuungsgruppe');
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/einheiten/${betreuung.id}`);
    const paneel = page.getByRole('region', { name: 'Zeitachse' });
    await paneel.getByRole('button', { name: 'Nachtragen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Zeitachse nachtragen: Betreuungsgruppe' });
    await waehleIn(dialog.getByRole('combobox', { name: 'Ereignis' }), 'Eintreffen');
    await dialog.getByLabel('Notiz (optional)').fill('per Funk gemeldet');
    await dialog.getByLabel('Notiz (optional)').blur();
    await page.mouse.move(0, 0);
    await fotografiere(dialog, KAPITEL, 'zeitachse-nachtragen');
  });
});
