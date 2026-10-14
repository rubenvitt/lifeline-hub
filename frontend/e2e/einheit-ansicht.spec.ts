import { expect, test, type Page, type Request } from '@playwright/test';
import { waehleIn } from './auswahl-kern';
import { wechsleZuRolle } from './rollen-kern';
import { FUEKW, anmelden, einsatzAnlegen, stelleDichte } from './trefflaeche-kern';

/**
 * Einheit-Ansicht (LLH-1036, Spec `einheit-ansicht`) am echten Backend, in `kompakt` und
 * `handschuh` am Fükw-Schirm: eine Angabe an ihrer Zeile ändern schickt genau ihr Feld, das
 * taktische Zeichen landet auch im Meldebild, und der Beobachter sieht nur die Ansicht.
 *
 * Belegt wird je Handgriff der Körper der Anfrage: das alte Formular schickte den ganzen Stand vom
 * Öffnen und überschrieb so still, was ein anderer Arbeitsplatz geändert hatte. Die Treffflächen
 * derselben Ziele misst `gate3-trefflaeche.spec.ts`, die Fokusverdeckung `fokus-verdeckung.spec.ts`.
 */

const DICHTEN = ['kompakt', 'handschuh'] as const;

/** Körper aller PATCH an diese Einheit (Angaben und Lageweg), in Reihenfolge. */
function recordWrites(page: Page, einsatzId: string, einheitId: number) {
  const bodies: { pfad: string; body: unknown }[] = [];
  const pattern = new RegExp(`/api/einsaetze/${einsatzId}/einheiten/${einheitId}(/position)?$`);
  page.on('request', (r: Request) => {
    if (r.method() === 'PATCH' && pattern.test(r.url())) {
      bodies.push({ pfad: new URL(r.url()).pathname, body: r.postDataJSON() });
    }
  });
  return bodies;
}

async function createEinheit(page: Page, einsatzId: string, name: string): Promise<number> {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/einheiten`, {
    data: { name },
  });
  expect(antwort.ok(), `Seeding Einheit: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return ((await antwort.json()) as { id: number }).id;
}

for (const dichte of DICHTEN) {
  test.describe(`Einheit-Ansicht (${dichte})`, () => {
    test.use({ viewport: FUEKW });

    test.beforeEach(async ({ page }) => {
      await anmelden(page);
    });

    test('Name an der Zeile ändern: genau `name` geht hinaus', async ({ page }) => {
      const einsatzId = await einsatzAnlegen(page, `E2E 1036 Name ${dichte} ${Date.now()}`);
      const einheitId = await createEinheit(page, einsatzId, '1. Zug');
      await page.goto(`/einsaetze/${einsatzId}/einheiten/${einheitId}`);
      await stelleDichte(page, dichte);
      const bodies = recordWrites(page, einsatzId, einheitId);

      const kopf = page.getByRole('region', { name: 'Kopfdaten' });
      // Ohne Klick kein Eingabefeld: die Angaben stehen als Werte da.
      await expect(kopf.getByRole('textbox')).toHaveCount(0);
      await kopf.getByRole('button', { name: 'Name bearbeiten' }).click();
      const feld = kopf.getByRole('textbox', { name: 'Name' });
      await expect(feld).toBeFocused();
      await feld.fill('1. Zug Nord');
      await feld.press('Enter');

      await expect(
        kopf.getByRole('button', { name: 'Name bearbeiten' }),
      ).toHaveAccessibleDescription('1. Zug Nord');
      await expect(page.getByRole('heading', { name: '1. Zug Nord', level: 1 })).toBeVisible();
      expect(bodies).toEqual([
        {
          pfad: `/api/einsaetze/${einsatzId}/einheiten/${einheitId}`,
          body: { name: '1. Zug Nord' },
        },
      ]);
    });

    test('Organisation des Zeichens setzen: genau `tz_organisation`, das Meldebild trägt sie', async ({
      page,
    }) => {
      const einsatzId = await einsatzAnlegen(page, `E2E 1036 Zeichen ${dichte} ${Date.now()}`);
      const einheitId = await createEinheit(page, einsatzId, '2. Zug');
      await page.goto(`/einsaetze/${einsatzId}/einheiten/${einheitId}`);
      await stelleDichte(page, dichte);
      const bodies = recordWrites(page, einsatzId, einheitId);

      const zeichen = page.getByRole('region', { name: 'Taktisches Zeichen' });
      await zeichen.getByRole('button', { name: 'Organisation eintragen' }).click();
      await waehleIn(zeichen.getByRole('combobox', { name: 'Organisation' }), 'THW');
      await zeichen.getByRole('button', { name: 'Organisation speichern' }).click();
      await expect(
        zeichen.getByRole('button', { name: 'Organisation bearbeiten' }),
      ).toHaveAccessibleDescription('THW');
      expect(bodies).toEqual([
        {
          pfad: `/api/einsaetze/${einsatzId}/einheiten/${einheitId}/position`,
          body: { tz_organisation: 'thw' },
        },
      ]);

      await page.goto(`/einsaetze/${einsatzId}/kraefteuebersicht`);
      const zeile = page.locator(`[data-row-key="eh-${einheitId}"]`);
      await expect(zeile.locator('[data-lfh="einheit-zeichen"] svg desc')).toContainText(
        'Organisation: Technisches Hilfswerk',
      );
    });

    test('Beobachter: keine Stifte, keine Aufforderung, kein Auflösen', async ({ page }) => {
      const einsatzId = await einsatzAnlegen(page, `E2E 1036 Beobachter ${dichte} ${Date.now()}`);
      const einheitId = await createEinheit(page, einsatzId, '3. Zug');
      await wechsleZuRolle(page, 'beobachter', einsatzId);
      await page.goto(`/einsaetze/${einsatzId}/einheiten/${einheitId}`);
      await stelleDichte(page, dichte);

      const main = page.getByRole('main');
      // Erst der Inhaltsanker, sonst wäre „fehlt“ auch im Ladezustand wahr.
      await expect(main.getByRole('region', { name: 'Kopfdaten' })).toContainText('3. Zug');
      await expect(main.getByRole('button', { name: /(bearbeiten|eintragen)$/ })).toHaveCount(0);
      await expect(main.getByRole('button', { name: /^Status von / })).toHaveCount(0);
      await expect(main.getByRole('region', { name: 'Einheit auflösen' })).toHaveCount(0);
      await expect(main.getByRole('button', { name: 'Einheit auflösen' })).toHaveCount(0);
    });
  });
}
