import type { APIRequestContext } from '@playwright/test';
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
 * Bilder des Kapitels „Bereitstellungsräume“ (`docs/anwender/kapitel/bereitstellungsraeume.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep bereitstellungsraeume`, Mitänderungsregel in
 * `docs/anwender/AGENTS.md`):
 *   liste.png      frontend/src/pages/bereitstellungsraum/BereitstellungsraeumePage.tsx,
 *                  frontend/src/bereitstellungsraum/brZahlen.ts
 *   anlegen.png    frontend/src/pages/bereitstellungsraum/BrAnlegenDrawer.tsx,
 *                  frontend/src/components/AnlegenDrawer.tsx
 *   raum.png       frontend/src/pages/bereitstellungsraum/BrDetailPage.tsx,
 *                  frontend/src/pages/bereitstellungsraum/brBelegungKern.ts,
 *                  frontend/src/pages/bereitstellungsraum/KraefteOhneBrSidebar.tsx,
 *                  frontend/src/pages/bereitstellungsraum/freieKraefte.ts,
 *                  frontend/src/pages/bereitstellungsraum/BrSwitcher.tsx
 *   verlauf.png    frontend/src/pages/bereitstellungsraum/BrVerlauf.tsx,
 *                  frontend/src/pages/bereitstellungsraum/brBelegungKern.ts
 *   bearbeiten.png frontend/src/pages/bereitstellungsraum/BrBearbeitenModal.tsx,
 *                  frontend/src/components/Erfassung.tsx
 *   eintreffen.png frontend/src/pages/bereitstellungsraum/EintreffenDialog.tsx,
 *                  frontend/src/pages/bereitstellungsraum/eintreffenKern.ts
 *
 * Demo-Lücke (D3): der Demo-BR „Parkplatz Stadion Nord“ ist aktiv, aber leer. Die Spec lässt
 * dort den Sanitätszug ein- und wieder austreten (für den Verlauf), stellt zwei Einheiten bereit
 * und legt einen zweiten, geplanten BR an. Beide Einheiten tragen im Demo-Einsatz Fahrzeuge
 * (Rettungsstaffel RTW 1 und RTW 2, Betreuungsgruppe MTW), „Fahrzeuge“ in raum.png zählt sie mit
 * (LLH-1095). Die Uhr steht 48 Minuten nach der Belegung (`WARTEN`), damit Wartezeit und Folge
 * im Bild etwas zeigen; mit der Uhr „jetzt“ stünde überall „0 min“.
 */

const KAPITEL = 'bereitstellungsraeume';
const DEMO_BR = 'Parkplatz Stadion Nord';
const ZUG = 'Sanitätszug Musterstadt';
/**
 * Angezeigte Wartezeit in den Bildern: die Uhr steht 48 Minuten und 30 Sekunden hinter dem
 * frühesten „seit“ des Raums. Gerechnet vom Server-Stempel und nicht von `Date.now()` im Test,
 * sonst zeigte eine Minutengrenze zwischen Belegung und Bild „49 min“.
 */
const WARTEN = 48 * 60_000 + 30_000;

async function nachDerWartezeit(api: APIRequestContext, einsatzId: number, brId: number) {
  const antwort = await api.get(`/api/einsaetze/${einsatzId}/bereitstellungsraeume/${brId}`);
  expect(antwort.ok()).toBe(true);
  const { belegung } = (await antwort.json()) as { belegung: { laengste_seit_at?: string | null } };
  expect(belegung.laengste_seit_at, 'Belegung des Demo-BR').toBeTruthy();
  // UTC ohne Zone (wie `wartezeitMinuten`).
  return new Date(Date.parse(`${belegung.laengste_seit_at!.replace(' ', 'T')}Z`) + WARTEN);
}

interface Benannt {
  id: number;
  name?: string;
  bezeichnung?: string;
}

async function liste(api: APIRequestContext, pfad: string): Promise<Benannt[]> {
  const antwort = await api.get(pfad);
  expect(antwort.ok(), `${pfad}: ${antwort.status()}`).toBe(true);
  return (await antwort.json()) as Benannt[];
}

async function demoBr(api: APIRequestContext, einsatzId: number): Promise<Benannt> {
  const raeume = await liste(api, `/api/einsaetze/${einsatzId}/bereitstellungsraeume`);
  const br = raeume.find((r) => r.bezeichnung === DEMO_BR);
  expect(br, `BR „${DEMO_BR}“ im Demo-Einsatz`).toBeDefined();
  return br!;
}

test.describe(KAPITEL, () => {
  test.beforeAll(async () => {
    const api = await apiAlsAdmin();
    try {
      const demo = await demoEinsatz(api);
      const br = await demoBr(api, demo.id);
      const einheiten = await liste(api, `/api/einsaetze/${demo.id}/einheiten`);
      const belegung = `/api/einsaetze/${demo.id}/bereitstellungsraeume/${br.id}/belegung`;
      const id = (name: string) => {
        const einheit = einheiten.find((e) => e.name === name);
        expect(einheit, `Einheit „${name}“`).toBeDefined();
        return einheit!.id;
      };
      // Der Zug tritt ein und wieder aus: verlauf.png zeigt einen Austritt, raum.png den Zug
      // wieder frei in „Kräfte ohne BR“.
      const zug = id(ZUG);
      await fuelle(api, 'post', belegung, {
        objekt_typ: 'einheit',
        objekt_id: zug,
        art: 'eintritt',
      });
      await fuelle(api, 'post', belegung, {
        objekt_typ: 'einheit',
        objekt_id: zug,
        art: 'austritt',
      });
      for (const name of ['Betreuungsgruppe', 'Rettungsstaffel']) {
        await fuelle(api, 'post', belegung, {
          objekt_typ: 'einheit',
          objekt_id: id(name),
          art: 'eintritt',
        });
      }
      await fuelle(api, 'post', `/api/einsaetze/${demo.id}/bereitstellungsraeume`, {
        bezeichnung: 'BR Ost',
        standort: 'Sportplatz Ost, Zufahrt Parkstraße',
      });
    } finally {
      await api.dispose();
    }
  });

  test('Liste der Bereitstellungsräume', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const br = await demoBr(page.request, demo.id);
    await uhrAnhalten(page, await nachDerWartezeit(page.request, demo.id, br.id));
    await page.goto(`/einsaetze/${demo.id}/bereitstellungsraeume/liste`);
    await expect(page.getByRole('link', { name: 'BR Ost' })).toBeVisible();
    await expect(page.getByRole('link', { name: DEMO_BR })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(DEMO_BR) })).toContainText('48 min');
    await fotografiere(page.locator('.ant-table-wrapper').first(), KAPITEL, 'liste');
  });

  test('Drawer „Bereitstellungsraum anlegen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/bereitstellungsraeume/liste`);
    await page.getByRole('button', { name: 'Neu', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Bereitstellungsraum anlegen' });
    await drawer.getByLabel('Bezeichnung').fill('BR Süd');
    await drawer.getByLabel('Standort (optional)').fill('Festplatz, Einfahrt Mühlenweg');
    await drawer.getByLabel('Notiz (optional)').fill('Platz für 10 Fahrzeuge');
    await drawer.getByLabel('Notiz (optional)').blur();
    await page.mouse.move(0, 0);
    await fotografiere(drawer, KAPITEL, 'anlegen');
  });

  test('Bereitstellungsraum mit Kräften', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const br = await demoBr(page.request, demo.id);
    await uhrAnhalten(page, await nachDerWartezeit(page.request, demo.id, br.id));
    await page.goto(`/einsaetze/${demo.id}/bereitstellungsraeume/${br.id}`);
    await expect(page.getByText('Rettungsstaffel').first()).toBeVisible();
    await expect(page.getByTestId('br-summe')).toContainText(/Fahrzeuge\s*3/);
    await expect(page.getByTestId('br-summe')).toContainText(/Längste Wartezeit\s*48 min/);
    // Der Zug steht im Demo-Einsatz in einem Abschnitt: „Im Einsatz“ (LLH-1075), zugeklappt.
    await page.getByRole('button', { name: /^Im Einsatz/ }).click();
    await expect(page.getByRole('button', { name: `${ZUG} zuweisen` })).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(page, KAPITEL, 'raum');
  });

  test('Dialog „Eintreffen buchen“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const br = await demoBr(page.request, demo.id);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/bereitstellungsraeume/${br.id}`);
    await page.getByRole('button', { name: 'Eintreffen buchen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Eintreffen buchen' });
    // Nur geöffnet, nichts gebucht: raum.png zeigt den Raum wie im Demo-Einsatz.
    await expect(dialog.getByRole('region', { name: 'Im Einsatz' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: `Eintreffen ${ZUG}` })).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(dialog, KAPITEL, 'eintreffen');
  });

  test('Verlauf eines Bereitstellungsraums', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const br = await demoBr(page.request, demo.id);
    await uhrAnhalten(page, await nachDerWartezeit(page.request, demo.id, br.id));
    await page.goto(`/einsaetze/${demo.id}/bereitstellungsraeume/${br.id}`);
    await page.getByRole('button', { name: `Verlauf des Bereitstellungsraums ${DEMO_BR}` }).click();
    const verlauf = page.getByRole('list', { name: 'Verlauf' });
    await expect(verlauf.getByRole('listitem')).toHaveCount(4);
    await expect(verlauf.getByRole('listitem').nth(2)).toContainText(`Austritt${ZUG}`);
    await page.mouse.move(0, 0);
    await fotografiere(page.locator('[data-lfh="br-verlauf"]'), KAPITEL, 'verlauf');
  });

  test('Dialog „Bereitstellungsraum bearbeiten“', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    const br = await demoBr(page.request, demo.id);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/bereitstellungsraeume/${br.id}`);
    await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Bereitstellungsraum bearbeiten' });
    await expect(dialog.getByLabel('Bezeichnung')).toHaveValue(DEMO_BR);
    // Nur im Dialog, nicht gespeichert: das Bild „raum.png“ zeigt den Raum wie im Demo-Einsatz.
    await dialog.getByLabel('Notiz (optional)').fill('Zufahrt über Tor 3, Platz für 15 Fahrzeuge');
    await dialog.getByLabel('Notiz (optional)').blur();
    await page.mouse.move(0, 0);
    await fotografiere(dialog, KAPITEL, 'bearbeiten');
  });
});
