import { expect, test, type Page } from '@playwright/test';
import { eingeschwungen } from './kontrast-kern';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Registrierstelle der Betreuung (LLH-1612, Change `hitr91ob-registrierstelle-betreuung`, Spec
 * `betreuung-registrierung`): eine Familie an der Detailseite einer namentlich geführten Stelle
 * registrieren, am Desktop und bei 390 px ohne waagerechten Bildlauf (auch im Handschuh-Betrieb
 * mit Trefferhöhe); die Belegung der Stelle steigt aus der Registrierung, der Meldeverlauf nennt
 * die Herkunft; ein neues Zeitfenster der Verpflegung schlägt die Sonderkost vor.
 *
 * Seeding als Admin über die API, was nicht selbst geprüft wird. Kein `networkidle` (LFH-385);
 * geklickt, nicht nur sichtbar (`e2e/AGENTS.md`).
 */

const STELLE = 'Turnhalle Ost';
const DICHTE_SCHLUESSEL = 'lifeline-hub.dichte';
const HANDSCHIRM = { width: 390, height: 844 };

async function senden<T = { id: number }>(
  page: Page,
  methode: 'post' | 'patch',
  pfad: string,
  data?: unknown,
): Promise<T> {
  const r = await page.request[methode](pfad, data === undefined ? {} : { data });
  expect(r.ok(), `${methode} ${pfad}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()) as T;
}

/** Einsatz mit einer namentlich geführten Notunterkunft in Betrieb. */
async function saeStelle(page: Page): Promise<{ einsatzId: number; stelleId: number }> {
  await anmeldenAlsAdmin(page);
  const { id: einsatzId } = await senden(page, 'post', '/api/einsaetze', {
    bezeichnung: `Registrierung ${Date.now()}`,
  });
  const basis = `/api/einsaetze/${einsatzId}/betreuung`;
  const { id: stelleId } = await senden(page, 'post', `${basis}/stellen`, {
    bezeichnung: STELLE,
    art: 'notunterkunft',
    kapazitaet_personen: 150,
    belegungsart: 'namentlich',
  });
  await senden(page, 'patch', `${basis}/stellen/${stelleId}`, { status: 'in_betrieb' });
  return { einsatzId, stelleId };
}

test('Familie an der Stelle registrieren: Liste, Kostformen, Belegung aus der Registrierung', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { einsatzId, stelleId } = await saeStelle(page);
  await page.goto(`/einsaetze/${einsatzId}/betreuung/${stelleId}`);

  // Namentlich geführt: „Belegung melden“ gesperrt mit Grund.
  await expect(page.getByRole('button', { name: 'Belegung melden', exact: true })).toBeDisabled();
  await expect(page.getByText('Belegung kommt aus der Registrierung')).toBeVisible();

  const registrierung = page.getByRole('region', { name: 'Registrierung', exact: true });
  await registrierung.getByRole('button', { name: 'Registrieren', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Registrieren · ${STELLE}` });
  await expect(dialog).toBeVisible();

  // Nichts eingeklappt (Spec „Nichts eingeklappt“): kein Klappteil im Dialog.
  await expect(dialog.locator('.ant-collapse')).toHaveCount(0);

  await dialog
    .getByRole('textbox', { name: 'Herkunft / Adresse des Haushalts' })
    .fill('Lindenweg 3');
  await dialog.getByRole('textbox', { name: 'Nachname Person 1' }).fill('Weber');
  await dialog.getByRole('textbox', { name: 'Vorname Person 1' }).fill('Anna');
  await dialog
    .getByRole('radiogroup', { name: 'Kostform, Person 1' })
    .getByRole('radio', { name: 'vegetarisch' })
    .click();

  await dialog.getByRole('button', { name: 'Person hinzufügen', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Nachname Person 2' })).toHaveValue('Weber');
  await expect(dialog.getByRole('textbox', { name: 'Vorname Person 2' })).toBeFocused();
  await page.keyboard.type('Tom');

  await dialog.getByRole('button', { name: 'Person hinzufügen', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Vorname Person 3' })).toBeFocused();
  await page.keyboard.type('Lea');
  await dialog
    .getByRole('radiogroup', { name: 'Kostform, Person 3' })
    .getByRole('radio', { name: 'Säugling/Kleinkind' })
    .click();

  await dialog.getByRole('button', { name: 'Registrieren', exact: true }).click();
  await expect(dialog).toBeHidden();

  // Liste mit Band (Spec „Liste mit Band“).
  const band = registrierung.getByRole('group', { name: 'Kostformen' });
  await expect(band).toContainText('Normalkost1');
  await expect(band).toContainText('vegetarisch1');
  await expect(band).toContainText('Säugling/Kleinkind1');
  await registrierung.getByRole('button', { name: /^H-1 · Weber, Anna · 3 Personen/ }).click();
  await expect(
    registrierung.getByRole('list', { name: 'Personen in H-1' }).getByRole('listitem'),
  ).toHaveCount(3);

  // Die Belegung der namentlichen Stelle steigt aus der Registrierung (design.md D5).
  await expect(page.getByRole('group', { name: 'Belegung in Zahlen' })).toContainText('Belegt3');
  await expect(page.locator('[data-lfh="melde-verlauf"]')).toContainText('Herkunft Registrierung');
});

test('390 px, auch im Handschuh-Betrieb: Haushalt und erste Person untereinander, ohne waagerechten Bildlauf', async ({
  page,
}) => {
  const { einsatzId, stelleId } = await saeStelle(page);
  await page.setViewportSize(HANDSCHIRM);
  for (const dichte of ['kompakt', 'handschuh'] as const) {
    await page.evaluate(([k, w]) => localStorage.setItem(k, w), [DICHTE_SCHLUESSEL, dichte]);
    await page.goto(`/einsaetze/${einsatzId}/betreuung/${stelleId}`);
    const registrierung = page.getByRole('region', { name: 'Registrierung', exact: true });
    await registrierung.getByRole('button', { name: 'Registrieren', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Registrieren · ${STELLE}` });
    await expect(dialog).toBeVisible();
    // Schmal kein Spaltenkopf, sondern ein Block je Person.
    await expect(dialog.locator('[data-lfh="registrier-kopf"]')).toHaveCount(0);
    const nachname = dialog.getByRole('textbox', { name: 'Nachname Person 1' });
    await expect(nachname).toBeVisible();
    // Gemessen erst nach der Einblendung des Dialogs (Zoom), sonst liegen die Kästen verschoben.
    await eingeschwungen(nachname);

    const breiten = await dialog.evaluate((el) => ({
      seite: document.documentElement.scrollWidth,
      fenster: window.innerWidth,
      dialog: el.scrollWidth,
      dialogSichtbar: el.clientWidth,
    }));
    expect(breiten.seite, dichte).toBeLessThanOrEqual(breiten.fenster);
    expect(breiten.dialog, dichte).toBeLessThanOrEqual(breiten.dialogSichtbar);

    // Untereinander: die Adresse des Haushalts über dem Nachnamen der ersten Person.
    const adresse = await dialog
      .getByRole('textbox', { name: 'Herkunft / Adresse des Haushalts' })
      .boundingBox();
    const name = await nachname.boundingBox();
    expect(adresse!.y + adresse!.height, dichte).toBeLessThanOrEqual(name!.y);

    if (dichte === 'handschuh') {
      // Trefferhöhe im Handschuh-Betrieb für Felder und Flächen (Spec „Registrieren in der
      // Oberfläche“): 72 px.
      // Das Ziel ist die Hülle mit Zähler (`ant-input-affix-wrapper`), nicht das innere `input`.
      const huelle = await nachname
        .locator('xpath=ancestor::*[contains(@class, "ant-input-affix-wrapper")][1]')
        .boundingBox();
      expect(huelle!.height).toBeGreaterThanOrEqual(72);
      const flaeche = await dialog
        .getByRole('radiogroup', { name: 'Kostform, Person 1' })
        .getByRole('radio', { name: 'Normalkost' })
        .boundingBox();
      expect(flaeche!.height).toBeGreaterThanOrEqual(72);
    }
    await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await expect(dialog).toBeHidden();
  }
});

test('Zeitfenster anlegen schlägt die Sonderkost aus der Registrierung vor', async ({ page }) => {
  const { einsatzId, stelleId } = await saeStelle(page);
  await senden(
    page,
    'post',
    `/api/einsaetze/${einsatzId}/betreuung/stellen/${stelleId}/registrierungen`,
    {
      personen: [
        { name: 'Weber', vorname: 'Anna', kostform: 'vegetarisch' },
        { name: 'Weber', vorname: 'Tom', kostform: 'normal' },
        { name: 'Weber', vorname: 'Lea', kostform: 'saeugling_kleinkind' },
      ],
    },
  );

  await page.goto(`/einsaetze/${einsatzId}/verpflegung`);
  await page.getByRole('button', { name: 'Zeitfenster anlegen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Zeitfenster anlegen' });
  await expect(dialog).toBeVisible();
  // Zugeklappt nennt der Kopf die Vorbelegung.
  const klappe = dialog.getByRole('button', {
    name: /^Weitere Personen und Sonderkost · davon 1 vegetarisch, 1 Säugling\/Kleinkind/,
  });
  await klappe.click();
  await expect(dialog.getByLabel('vegetarisch', { exact: true })).toHaveValue('1');
  await expect(dialog.getByLabel('Säugling/Kleinkind', { exact: true })).toHaveValue('1');
  await expect(dialog.getByLabel('vegan', { exact: true })).toHaveValue('');
  await expect(dialog.getByText('Vorschlag: aus 3 Registrierten, Stand jetzt')).toBeVisible();
});
