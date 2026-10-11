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
function schreibMitschnitt(page: Page, einsatzId: string) {
  const koerper: { methode: string; body: unknown }[] = [];
  const muster = new RegExp(`/api/einsaetze/${einsatzId}/abschnitte(/\\d+)?$`);
  page.on('request', (r: Request) => {
    if ((r.method() === 'PATCH' || r.method() === 'POST') && muster.test(r.url())) {
      koerper.push({ methode: r.method(), body: r.postDataJSON() });
    }
  });
  return koerper;
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
      const koerper = schreibMitschnitt(page, einsatzId);

      const detail = page.getByRole('region', { name: 'Abschnitt: Abschnitt Nord' });
      const leiste = detail.getByRole('radiogroup', { name: 'Lagezustand' });
      await expect(leiste.getByRole('radio', { name: 'angespannt' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await leiste.getByRole('radio', { name: 'kritisch' }).click();

      await expect(leiste.getByRole('radio', { name: 'kritisch' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await expect
        .poll(() => koerper)
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
      const koerper = schreibMitschnitt(page, einsatzId);

      const detail = page.getByRole('region', { name: 'Abschnitt: Abschnitt Nord' });
      await detail.getByRole('button', { name: 'Abschnittsleiter eintragen' }).click();
      await waehleIn(detail.getByRole('combobox', { name: 'Abschnittsleiter' }), 'Carla Christ');
      await detail.getByRole('button', { name: 'Abschnittsleiter speichern' }).click();

      await expect(
        detail.getByRole('button', { name: 'Abschnittsleiter bearbeiten' }),
      ).toHaveAccessibleDescription('Carla Christ');
      expect(koerper).toHaveLength(1);
      expect(Object.keys(koerper[0].body as object)).toEqual(['leiter_id']);
    });

    test('Abschnitt anlegen: drei Felder, Enter sendet, danach gewählt', async ({ page }) => {
      const einsatzId = await einsatzAnlegen(page, `E2E 1208 Anlegen ${dichte} ${Date.now()}`);
      await anlegen(page, einsatzId, 'abschnitte', { name: 'Abschnitt Nord' }, 'Abschnitt');
      await page.goto(`/einsaetze/${einsatzId}/einsatzabschnitte`);
      await stelleDichte(page, dichte);
      await expect(page.getByRole('region', { name: 'Abschnitt: Abschnitt Nord' })).toBeVisible();
      const koerper = schreibMitschnitt(page, einsatzId);

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
      expect(koerper).toEqual([
        {
          methode: 'POST',
          body: { name: 'Deichverteidigung', kurzbezeichnung: null, ueber_abschnitt_id: null },
        },
      ]);
    });
  });
}
