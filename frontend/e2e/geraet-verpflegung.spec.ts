import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Verpflegung (LFH-1044; Spec `funktionsansichten`): ein Tablet bei 1024 × 768, einsatzweit
 * ohne Stelle, bucht Portionen auf ein Zeitfenster und meldet die Fehlmenge an die
 * Einsatzleitung. Zeitfenster anlegen, Bedarf ändern, löschen und Nachfordern gibt es auf dem
 * Gerät nicht; nach dem Widerruf endet es ohne Neuladen.
 *
 * Seeding als Admin über die API, die Gerätesitzung in einem eigenen Kontext. Kein `networkidle`
 * (LFH-385).
 *
 * Mutationsprobe: in `geraetSicht.ts` `verpflegung-planen` für Geräte auf `true` → der Schritt
 * „kein Zeitfenster anlegen“ wird rot.
 */

async function anlegen<T = { id: number }>(page: Page, pfad: string, data?: unknown): Promise<T> {
  const antwort = await page.request.post(pfad, data === undefined ? {} : { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return (await antwort.json()) as T;
}

test('LFH-1044: Verpflegungsgerät bucht Portionen und meldet die Fehlmenge', async ({
  page,
  browser,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatz = await anlegen(page, '/api/einsaetze', {
    bezeichnung: `E2E Verpflegung ${Date.now()}`,
  });
  const e = einsatz.id;
  const jetzt = Date.now();
  const zeit = (minuten: number) => new Date(jetzt + minuten * 60_000).toISOString();
  await anlegen(page, `/api/einsaetze/${e}/verpflegung/zeitfenster`, {
    bezeichnung: 'Mittag Deich',
    von_at: zeit(-30),
    bis_at: zeit(90),
    bedarf_kraefte: 60,
    bedarf_betreute: 20,
  });
  const kopplung = await anlegen<{ kopplung: { id: number }; code: { code: string } }>(
    page,
    `/api/einsaetze/${e}/geraete`,
    { ansicht: 'verpflegung', bezeichnung: 'Ausgabe Deich' },
  );

  const kontext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const tablet = await kontext.newPage();
  try {
    await tablet.goto(`/koppeln#${kopplung.code.code}`);
    await tablet.getByRole('button', { name: 'Gerät koppeln' }).click();
    await expect(tablet).toHaveURL(new RegExp(`/geraet/${e}/verpflegung$`));

    const nav = tablet.getByRole('navigation', { name: 'Gerätenavigation' });
    await expect(nav.getByRole('link')).toHaveText(['Verpflegung', 'Melden']);
    const karte = tablet.getByRole('article', { name: /^Zeitfenster Mittag Deich/ });
    await expect(karte).toBeVisible();

    // Planen bleibt bei der Führung: kein Anlegen, kein Bedarf, kein Nachfordern.
    await expect(tablet.getByRole('button', { name: 'Zeitfenster anlegen' })).toHaveCount(0);
    await expect(tablet.getByRole('button', { name: /^Bedarf bearbeiten/ })).toHaveCount(0);
    await expect(tablet.getByRole('button', { name: /^Aktionen zu/ })).toHaveCount(0);
    await expect(tablet.getByText('Nachfordern')).toHaveCount(0);

    await karte.getByRole('button', { name: /^Ausgabe erfassen zu/ }).click();
    const dialog = tablet.getByRole('dialog', { name: /Ausgabe erfassen/ });
    await dialog.getByLabel('Menge (EP)').fill('50');
    await dialog.getByRole('button', { name: 'Erfassen' }).click();
    await expect(dialog).toHaveCount(0);
    // Die eigene Buchung lässt sich zurücknehmen (Rücknahme gehört zur Ansicht).
    await expect(karte.getByRole('button', { name: /^Zurücknehmen: Ausgabe 50 EP/ })).toBeVisible();

    // 80 Bedarf, 50 ausgegeben: die Fehlmenge geht als Meldung an die Einsatzleitung.
    await karte.getByRole('button', { name: /^Fehlmenge melden zu/ }).click();
    await expect(tablet).toHaveURL(new RegExp(`/geraet/${e}/meldungen$`));
    const inhalt = tablet.getByLabel('Inhalt');
    await expect(inhalt).toHaveValue(
      /^Fehlmenge Verpflegung ‚Mittag Deich‘ .+: 30 EP \(Bedarf 80, ausgegeben 50\)\.$/,
    );
    await tablet.getByRole('button', { name: 'Meldung senden' }).click();
    // Auf die Quittung warten, nicht auf den Text: der stünde auch im Feld (e2e-Falle textarea).
    await expect(tablet.getByLabel('Inhalt')).toHaveValue('');
    await expect(tablet.getByText(/^Fehlmenge Verpflegung ‚Mittag Deich‘/)).toBeVisible();

    // Die Einsatzleitung sieht die Ausgabe in der Deckung und die Meldung mit dem Gerät als
    // Absender.
    const verpflegung = await page.request.get(`/api/einsaetze/${e}/verpflegung`);
    const zf = ((await verpflegung.json()) as { zeitfenster: { ausgegeben: { gesamt: number } }[] })
      .zeitfenster[0];
    expect(zf.ausgegeben.gesamt).toBe(50);
    const meldungen = await page.request.get(`/api/einsaetze/${e}/meldungen`);
    const liste = (await meldungen.json()) as { inhalt: string; absender: string }[];
    expect(liste.find((m) => m.inhalt.startsWith('Fehlmenge Verpflegung'))?.absender).toBe(
      'Verpflegung · Ausgabe Deich',
    );

    // Widerruf durch die Einsatzleitung: das Gerät endet von selbst, ohne Neuladen.
    await anlegen(page, `/api/einsaetze/${e}/geraete/${kopplung.kopplung.id}/widerrufen`);
    await expect(tablet).toHaveURL(/\/kopplung-beendet$/);
    await expect(tablet.getByRole('heading', { name: 'Kopplung beendet' })).toBeVisible();
  } finally {
    await kontext.close();
  }
});
