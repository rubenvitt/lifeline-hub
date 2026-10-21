import { expect, test, type Page } from '@playwright/test';
import { api } from './fernmeldeskizze-kern';
import { einsatzMitLage, grundlageOhneNetz, lagekarteBereit } from './lageplan-kern';
import { ADMIN, ADMIN_PW, anmeldenAls } from './rollen-kern';

/**
 * Lageplan als Anlage (LLH-1051, Spec `lagekarte-druck`): „Als Anlage an …“ legt den Ausschnitt
 * als PNG-Blatt (Kopf, Karte, Maßstab, Nordpfeil, Legende) an einen offenen Entwurf oder an einen
 * neuen Lagevortrag. Nur Chromium: der Upload-Weg ist derselbe wie bei der Fernmeldeskizze
 * (`dokument-anlage-druck.spec.ts`), neu ist nur die Aufnahme der Karte, die die Druck-Spec in
 * allen Engines prüft.
 *
 * Mutationsproben: Art `fernmeldeskizze` statt `lageplan` → die Anlage hat die falsche Art, rot;
 * neuer Lagevortrag ohne Navigation → die Seite bleibt auf der Karte, rot.
 */

const FUEKW = { width: 1366, height: 768 };

interface Anlage {
  id: number;
  nummer: number;
  art: string;
  titel: string;
  dateiname: string;
}

/** Maße und Papiergrund des abgelegten Bildes. */
async function bildDerAnlage(page: Page, pfad: string) {
  return page.evaluate(async (href) => {
    const blob = await (await fetch(href)).blob();
    const b = await createImageBitmap(blob);
    const leinwand = new OffscreenCanvas(b.width, b.height);
    const k = leinwand.getContext('2d')!;
    k.drawImage(b, 0, 0);
    // Die oberste Zeile gehört dem weißen Kopf des Blatts.
    const kopf = k.getImageData(0, 0, b.width, 1).data;
    let weiss = 0;
    for (let i = 0; i < kopf.length; i += 4) if (kopf[i] > 245 && kopf[i + 1] > 245) weiss++;
    return { typ: blob.type, breite: b.width, hoehe: b.height, kopfWeiss: weiss / b.width };
  }, pfad);
}

test('Als Anlage an …: an einen offenen Entwurf und an einen neuen Lagevortrag', async ({
  page,
}) => {
  test.skip(
    page.context().browser()?.browserType().name() !== 'chromium',
    'Upload-Weg wie die Fernmeldeskizze; die Aufnahme prüft die Druck-Spec in allen Engines',
  );
  test.setTimeout(120_000);
  await page.setViewportSize(FUEKW);
  await grundlageOhneNetz(page);
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzMitLage(page, `E2E Lageplan Anlage ${Date.now()}`);
  const a = api(page, einsatzId);
  const { id: entwurf } = await a.post('lageberichte', {
    vorlage: 'lagebericht',
    titel: 'Lage 1200',
  });
  await lagekarteBereit(page, einsatzId);

  // ── An den offenen Entwurf: der Dialog schließt, die Karte bleibt.
  await page.getByRole('button', { name: 'Als Anlage an …', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Lageplan als Anlage' });
  await dialog.getByRole('radio', { name: 'Lagebericht · Lage 1200' }).check();
  await dialog.getByRole('button', { name: 'Anfügen' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText('Lageplan an „Lagebericht · Lage 1200“ angefügt')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/lagekarte`));

  const [anlage] = await a.get<Anlage[]>(`lageberichte/${entwurf}/anlagen`);
  expect(anlage).toMatchObject({ nummer: 1, art: 'lageplan', titel: 'Lageplan' });
  const bild = await bildDerAnlage(
    page,
    `/api/einsaetze/${einsatzId}/lageberichte/${entwurf}/anlagen/${anlage.id}/datei`,
  );
  test.info().annotations.push({
    type: 'messwert',
    description: `Anlage ${bild.breite}×${bild.hoehe} px, Kopfzeile ${(bild.kopfWeiss * 100).toFixed(0)} % weiß`,
  });
  expect(bild.typ).toBe('image/png');
  expect(bild.kopfWeiss, 'Papiergrund im Kopf, auch im Nachtbetrieb').toBeGreaterThan(0.95);
  expect(bild.hoehe, 'Kopf und Legende unter und über der Karte').toBeGreaterThan(
    bild.breite * 0.4,
  );

  // ── Neuer Lagevortrag: angelegt, angefügt, geöffnet.
  await page.getByRole('button', { name: 'Als Anlage an …', exact: true }).click();
  await dialog.getByRole('radio', { name: 'Neuer Lagevortrag' }).check();
  await dialog.getByRole('button', { name: 'Anfügen' }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/lageberichte/\\d+$`), {
    timeout: 30_000,
  });
  const neuId = Number(new URL(page.url()).pathname.split('/').pop());
  expect(neuId).not.toBe(entwurf);
  await expect(page.getByRole('link', { name: 'Anlage 1: Lageplan herunterladen' })).toBeVisible();
  const berichte = await a.get<{ id: number; titel: string; vorlage: string }[]>('lageberichte');
  expect(berichte.find((b) => b.id === neuId)).toMatchObject({
    vorlage: 'lagebericht',
    titel: expect.stringMatching(/^Lageüberblick \d{4}$/),
  });
});
