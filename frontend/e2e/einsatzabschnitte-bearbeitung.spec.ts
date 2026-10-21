import { expect, test, type Page, type Request } from '@playwright/test';
import { waehleIn } from './auswahl-kern';
import { FUEKW, anlegen, anmelden, einsatzAnlegen, stelleDichte } from './trefflaeche-kern';

/**
 * Einsatzabschnitt in der Ansicht bearbeiten (LFH-1208, Spec `einsatzabschnitt-bearbeitung`):
 * die drei häufigen Handgriffe im laufenden Einsatz — Lagezustand ändern, Leiter setzen,
 * Abschnitt anlegen — am echten Backend, in `kompakt` und `handschuh`, beide am Fükw-Schirm.
 *
 * Belegt wird je Handgriff, dass genau EIN Feld hinausgeht: das Langformular schickte den ganzen
 * Stand vom Öffnen und überschrieb so still, was ein anderer Arbeitsplatz geändert hatte. Die
 * Treffflächen derselben Ziele misst C12 in `trefflaeche-pruefflaechen.spec.ts`.
 */

const DICHTEN = ['kompakt', 'handschuh'] as const;

/** Körper aller PATCH/POST an die Abschnitte dieses Einsatzes, in Reihenfolge. */
function recordWrites(page: Page, einsatzId: string) {
  const bodies: { methode: string; body: unknown }[] = [];
  const pattern = new RegExp(`/api/einsaetze/${einsatzId}/abschnitte(/\\d+)?$`);
  page.on('request', (r: Request) => {
    if ((r.method() === 'PATCH' || r.method() === 'POST') && pattern.test(r.url())) {
      bodies.push({ methode: r.method(), body: r.postDataJSON() });
    }
  });
  return bodies;
}

for (const dichte of DICHTEN) {
  test.describe(`Einsatzabschnitte bearbeiten (${dichte})`, () => {
    test.use({ viewport: FUEKW });

    test.beforeEach(async ({ page }) => {
      await anmelden(page);
    });

    test('Lagezustand ändern: ein Klick, genau ein Feld, ein ETB-Eintrag', async ({ page }) => {
      const einsatzId = await einsatzAnlegen(page, `E2E 1208 Lage ${dichte} ${Date.now()}`);
      await anlegen(
        page,
        einsatzId,
        'abschnitte',
        { name: 'Abschnitt Nord', lagezustand: 'angespannt' },
        'Abschnitt',
      );
      await page.goto(`/einsaetze/${einsatzId}/einsatzabschnitte`);
      await stelleDichte(page, dichte);
      const bodies = recordWrites(page, einsatzId);

      const detail = page.getByRole('region', { name: 'Abschnitt: Abschnitt Nord' });
      const bar = detail.getByRole('radiogroup', { name: 'Lagezustand' });
      await expect(bar.getByRole('radio', { name: 'angespannt' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await bar.getByRole('radio', { name: 'kritisch' }).click();

      await expect(bar.getByRole('radio', { name: 'kritisch' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await expect
        .poll(() => bodies)
        .toEqual([{ methode: 'PATCH', body: { lagezustand: 'kritisch' } }]);
      // Nur der Wechsel schreibt System-ETB (LFH-608).
      await expect
        .poll(async () =>
          JSON.stringify(await (await page.request.get(`/api/einsaetze/${einsatzId}/etb`)).json()),
        )
        .toContain('angespannt → kritisch');
    });

    test('Leiter setzen: an der Zeile, genau `leiter_id`', async ({ page }) => {
      const einsatzId = await einsatzAnlegen(page, `E2E 1208 Leiter ${dichte} ${Date.now()}`);
      await anlegen(page, einsatzId, 'abschnitte', { name: 'Abschnitt Nord' }, 'Abschnitt');
      await anlegen(page, einsatzId, 'personal', { adhoc: { name: 'Carla Christ' } }, 'Personal');
      await page.goto(`/einsaetze/${einsatzId}/einsatzabschnitte`);
      await stelleDichte(page, dichte);
      const bodies = recordWrites(page, einsatzId);

      const detail = page.getByRole('region', { name: 'Abschnitt: Abschnitt Nord' });
      await detail.getByRole('button', { name: 'Abschnittsleiter eintragen' }).click();
      await waehleIn(detail.getByRole('combobox', { name: 'Abschnittsleiter' }), 'Carla Christ');
      await detail.getByRole('button', { name: 'Abschnittsleiter speichern' }).click();

      await expect(
        detail.getByRole('button', { name: 'Abschnittsleiter bearbeiten' }),
      ).toHaveAccessibleDescription('Carla Christ');
      expect(bodies).toHaveLength(1);
      expect(Object.keys(bodies[0].body as object)).toEqual(['leiter_id']);
    });

    test('Abschnitt anlegen: drei Felder, Enter sendet, danach gewählt', async ({ page }) => {
      const einsatzId = await einsatzAnlegen(page, `E2E 1208 Anlegen ${dichte} ${Date.now()}`);
      await anlegen(page, einsatzId, 'abschnitte', { name: 'Abschnitt Nord' }, 'Abschnitt');
      await page.goto(`/einsaetze/${einsatzId}/einsatzabschnitte`);
      await stelleDichte(page, dichte);
      await expect(page.getByRole('region', { name: 'Abschnitt: Abschnitt Nord' })).toBeVisible();
      const bodies = recordWrites(page, einsatzId);

      await page.getByRole('button', { name: 'Abschnitt anlegen' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Abschnitt anlegen' });
      await expect(dialog.locator('.ant-form-item')).toHaveCount(3);
      const name = dialog.getByRole('textbox', { name: 'Name' });
      await expect(name).toBeFocused();
      await name.fill('Deichverteidigung');
      await name.press('Enter');

      await expect(
        page.getByRole('region', { name: 'Abschnitt: Deichverteidigung' }),
      ).toBeVisible();
      await expect(dialog).toBeHidden();
      expect(bodies).toEqual([
        {
          methode: 'POST',
          body: { name: 'Deichverteidigung', kurzbezeichnung: null, ueber_abschnitt_id: null },
        },
      ]);
    });
  });
}

/**
 * Sprung auf die Lagekarte (LLH-1349, Spec `lagekarte-abschnitt-fokus`, „Sprung von der
 * Abschnittsseite“): „Auf Karte zeigen ↗“ im Detail öffnet die Karte im Fokus auf den Abschnitt,
 * und die Karte räumt `?abschnitt=` aus der Adresse. Einmal, am Fükw-Schirm in `kompakt`.
 */
test.describe('Einsatzabschnitt auf der Karte zeigen', () => {
  test.use({ viewport: FUEKW });

  test('„Auf Karte zeigen ↗“ öffnet die Lagekarte im Fokus, der Parameter wird geräumt', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await anmelden(page);
    const einsatzId = await einsatzAnlegen(page, `E2E 1349 Karte ${Date.now()}`);
    await anlegen(page, einsatzId, 'abschnitte', { name: 'Abschnitt Nord' }, 'Abschnitt');
    const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/abschnitte`, {
      data: { name: 'Abschnitt Süd' },
    });
    expect(antwort.ok(), await antwort.text()).toBeTruthy();
    const sued = ((await antwort.json()) as { id: number }).id;
    await page.goto(`/einsaetze/${einsatzId}/einsatzabschnitte`);
    await page.getByRole('region', { name: 'Gliederung' }).getByText('Abschnitt Süd').click();
    const detail = page.getByRole('region', { name: 'Abschnitt: Abschnitt Süd' });
    const sprung = detail.getByRole('link', { name: 'Auf Karte zeigen' });
    await expect(sprung).toHaveAttribute(
      'href',
      `/einsaetze/${einsatzId}/lagekarte?abschnitt=${sued}`,
    );

    await sprung.click();
    await expect(page.getByTestId('kartenflaeche').locator('canvas.maplibregl-canvas')).toHaveCount(
      1,
      { timeout: 60_000 },
    );
    await expect(page.locator('[data-lfh="fokus-band"]')).toContainText('Abschnitt Süd');
    await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/lagekarte$`));
  });
});
