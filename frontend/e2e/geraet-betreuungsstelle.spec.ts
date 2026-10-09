import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Betreuungsstelle (LFH-1041; Spec `funktionsansichten`): ein Tablet bei 1024 × 768 nimmt eine
 * Person ohne Sichtung in die eigene Stelle auf, sieht sie unter „Betroffene“, meldet die
 * Belegung und schickt eine Meldung an die Einsatzleitung. Personen einer anderen Stelle sieht es
 * nicht.
 *
 * Seeding als Admin über die API, die Gerätesitzung in einem eigenen Kontext. Kein `networkidle`
 * (LFH-385).
 *
 * Mutationsprobe: in `geraetSicht.ts` `person-sichtung` für Geräte auf `true` → der Schritt
 * „keine Sichtung“ wird rot.
 */

async function senden<T = { id: number }>(
  page: Page,
  methode: 'post' | 'patch',
  pfad: string,
  data: unknown,
): Promise<T> {
  const antwort = await page.request[methode](pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return (await antwort.json()) as T;
}

async function stelleInBetrieb(page: Page, e: number, bezeichnung: string): Promise<number> {
  const stelle = await senden(page, 'post', `/api/einsaetze/${e}/betreuung/stellen`, {
    bezeichnung,
    art: 'notunterkunft',
    kapazitaet_personen: 80,
  });
  await senden(page, 'patch', `/api/einsaetze/${e}/betreuung/stellen/${stelle.id}`, {
    status: 'in_betrieb',
  });
  return stelle.id;
}

test('LFH-1041: Tablet der Betreuungsstelle nimmt auf, meldet die Belegung und meldet', async ({
  page,
  browser,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatz = await senden(page, 'post', '/api/einsaetze', {
    bezeichnung: `E2E Betreuung ${Date.now()}`,
  });
  const e = einsatz.id;
  const nord = await stelleInBetrieb(page, e, 'NU Turnhalle Nord');
  const sued = await stelleInBetrieb(page, e, 'NU Schule Süd');
  const fremd = await senden(page, 'post', `/api/einsaetze/${e}/personen`, { name: 'Südmann' });
  await senden(page, 'post', `/api/einsaetze/${e}/personen/${fremd.id}/verbleib`, {
    art: 'notunterkunft',
    betreuungsstelle_id: sued,
  });
  const kopplung = await senden<{ code: { code: string } }>(
    page,
    'post',
    `/api/einsaetze/${e}/geraete`,
    { ansicht: 'betreuungsstelle', stelle_id: nord, bezeichnung: 'Tablet NU' },
  );

  const kontext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const tablet = await kontext.newPage();
  try {
    await tablet.goto(`/koppeln#${kopplung.code.code}`);
    await tablet.getByRole('button', { name: 'Gerät koppeln' }).click();
    await expect(tablet).toHaveURL(new RegExp(`/geraet/${e}/betroffene$`));

    const nav = tablet.getByRole('navigation', { name: 'Gerätenavigation' });
    await expect(nav.getByRole('link')).toHaveText(['Betroffene', 'Aufnahme', 'Stelle']);
    await expect(tablet.getByText('Noch keine Betroffenen in dieser Stelle')).toBeVisible();
    await expect(tablet.getByText('Südmann')).toHaveCount(0);

    // Aufnahme ohne Sichtung; der Server bringt die Person in die eigene Stelle.
    await nav.getByRole('link', { name: 'Aufnahme' }).click();
    await expect(tablet).toHaveURL(new RegExp(`/geraet/${e}/betroffene/aufnahme$`));
    await expect(tablet.getByRole('radiogroup', { name: 'Sichtungskategorie' })).toHaveCount(0);
    await tablet.getByRole('button', { name: 'Weitere Angaben' }).click();
    await tablet.getByLabel('Name', { exact: true }).fill('Nordhoff');
    await tablet.getByRole('button', { name: 'Speichern und nächste' }).click();
    await expect(tablet.getByText(/Erfasst als R-\d{3} · untergebracht/)).toBeVisible();

    await nav.getByRole('link', { name: 'Betroffene' }).click();
    await expect(tablet.getByText('Nordhoff')).toBeVisible();
    await expect(tablet.getByText('Südmann')).toHaveCount(0);

    // Stelle: Belegung melden, dann eine Meldung an die Einsatzleitung.
    await nav.getByRole('link', { name: 'Stelle' }).click();
    await expect(tablet).toHaveURL(new RegExp(`/geraet/${e}/betreuung$`));
    await expect(tablet.getByText('NU Schule Süd')).toHaveCount(0);
    await tablet.getByRole('button', { name: 'Belegung melden' }).click();
    const dialog = tablet.getByRole('dialog');
    await dialog.getByLabel('Belegt gesamt (Personen)').fill('12');
    await dialog.getByRole('button', { name: 'Melden', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await tablet.getByRole('tab', { name: 'Meldungen' }).click();
    await expect(tablet.getByText('Noch keine Meldungen von dieser Stelle')).toBeVisible();
    await tablet.getByLabel('Inhalt').fill('Feldbetten werden knapp');
    await tablet.getByRole('button', { name: 'Meldung senden' }).click();
    await expect(tablet.getByText('Feldbetten werden knapp')).toBeVisible();

    // Die Einsatzleitung sieht die Belegung, die Person in der Stelle und die Meldung mit der
    // Stelle als Absender.
    const uebersicht = await page.request.get(`/api/einsaetze/${e}/betreuung`);
    const stellen = (
      (await uebersicht.json()) as { stellen: { id: number; belegung?: { belegt: number } }[] }
    ).stellen;
    expect(stellen.find((s) => s.id === nord)?.belegung?.belegt).toBe(12);
    const personen = (await (await page.request.get(`/api/einsaetze/${e}/personen`)).json()) as {
      name: string | null;
      aktuelle_verbleib_betreuungsstelle_id: number | null;
    }[];
    expect(personen.find((p) => p.name === 'Nordhoff')?.aktuelle_verbleib_betreuungsstelle_id).toBe(
      nord,
    );
    const meldungen = (await (await page.request.get(`/api/einsaetze/${e}/meldungen`)).json()) as {
      inhalt: string;
      absender: string;
    }[];
    expect(meldungen.find((m) => m.inhalt === 'Feldbetten werden knapp')?.absender).toBe(
      'NU Turnhalle Nord · Tablet NU',
    );
  } finally {
    await kontext.close();
  }
});
