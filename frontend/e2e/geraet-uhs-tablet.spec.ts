import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * UHS-Tablet (LFH-892, Subtask LFH-1024; Spec `feldgeraet-bedienung` und `funktionsansichten`):
 * ein Tablet mit grobem Zeiger bei 1024 × 768 startet auf der Patientenliste seiner UHS, nimmt
 * einen Patienten in deren Wartebereich auf, sieht die Person der anderen UHS nicht, bedient den
 * Grundriss ohne Platzbearbeitung und zeigt nach dem Widerruf „Kopplung beendet“, ohne dass
 * jemand neu lädt: der Server schließt den Einsatzstrom, der Client prüft die Sitzung.
 *
 * Seeding als Admin über die API, die Gerätesitzung in einem eigenen Kontext (eigener
 * Cookie-Jar). Kein `networkidle` (LFH-385).
 *
 * Mutationsprobe: in `GeraeteLayout` `useEinsatzLiveStream` entfernt → der letzte Schritt bleibt
 * auf der Patientenliste stehen (rot).
 */

async function anlegen<T = { id: number }>(page: Page, pfad: string, data?: unknown): Promise<T> {
  const antwort = await page.request.post(pfad, data === undefined ? {} : { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return (await antwort.json()) as T;
}

/** Die Sichtungs-Auswahlfläche über ihre Beschriftung (wie `personen-aufnahme.spec.ts`). */
function skFlaeche(page: Page, label: string) {
  return page.locator('#sichtung').getByText(label, { exact: true });
}

test('LFH-1024: Tablet nimmt auf, kennt nur die eigene UHS und endet beim Widerruf', async ({
  page,
  browser,
}) => {
  await anmeldenAlsAdmin(page);
  const einsatz = await anlegen(page, '/api/einsaetze', {
    bezeichnung: `E2E Tablet ${Date.now()}`,
  });
  const e = einsatz.id;
  const nord = await anlegen(page, `/api/einsaetze/${e}/uhs`, {
    typ: 'behandlungsplatz',
    bezeichnung: 'UHS Nord',
  });
  const sued = await anlegen(page, `/api/einsaetze/${e}/uhs`, {
    typ: 'behandlungsplatz',
    bezeichnung: 'UHS Süd',
  });
  for (const u of [nord, sued]) {
    await anlegen(page, `/api/einsaetze/${e}/uhs/${u.id}/status`, { status: 'aktiv' });
  }
  // Eine Person der anderen UHS: das Tablet darf sie nicht sehen.
  await anlegen(page, `/api/einsaetze/${e}/personen`, {
    name: 'Fremdling',
    sichtung: 'sk3',
    uhs_id: sued.id,
  });
  const kopplung = await anlegen<{ kopplung: { id: number }; code: { code: string } }>(
    page,
    `/api/einsaetze/${e}/geraete`,
    { ansicht: 'uhs-tablet', uhs_id: nord.id, bezeichnung: 'Tablet 1' },
  );

  const kontext = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
  });
  const tablet = await kontext.newPage();
  try {
    await tablet.goto(`/koppeln#${kopplung.code.code}`);
    await tablet.getByRole('button', { name: 'Gerät koppeln' }).click();

    // Start: die Patientenliste der eigenen UHS, „Patient aufnehmen“ als Primäraktion.
    await expect(tablet).toHaveURL(new RegExp(`/geraet/${e}/patienten$`));
    expect(await tablet.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(true);
    await expect(tablet.getByRole('heading', { level: 1, name: 'Patienten' })).toBeVisible();
    await expect(tablet.getByRole('button', { name: 'Patient aufnehmen' })).toBeVisible();
    await expect(
      tablet.getByText('Noch keine Patienten in dieser Unfallhilfsstelle'),
    ).toBeVisible();
    await expect(tablet.getByText('Fremdling')).toHaveCount(0);

    // Aufnahme aus der Navigation am unteren Rand: landet im Wartebereich der eigenen UHS.
    const nav = tablet.getByRole('navigation', { name: 'Gerätenavigation' });
    await nav.getByRole('link', { name: 'Aufnahme' }).click();
    await expect(tablet).toHaveURL(new RegExp(`/geraet/${e}/aufnahme\\?uhs=${nord.id}$`));
    await skFlaeche(tablet, 'SK II').click();
    await tablet.getByRole('button', { name: 'Speichern und nächste' }).click();
    await expect(tablet.getByText(/Erfasst als R-\d{3} · SK II · im Wartebereich/)).toBeVisible();

    await nav.getByRole('link', { name: 'Patienten' }).click();
    await expect(tablet.getByText('Wartebereich').first()).toBeVisible();
    await expect(tablet.getByText('Fremdling')).toHaveCount(0);

    // Grundriss: belegen und Verfügbarkeit ja, Plätze bearbeiten und UHS verwalten nein.
    await nav.getByRole('link', { name: 'Grundriss' }).click();
    await expect(tablet).toHaveURL(new RegExp(`/geraet/${e}/uhs/${nord.id}$`));
    await expect(tablet.getByRole('heading', { level: 1, name: /UHS Nord/ })).toBeVisible();
    await expect(tablet.getByRole('button', { name: 'Plätze bearbeiten' })).toHaveCount(0);
    await expect(tablet.getByRole('button', { name: 'Auflösen' })).toHaveCount(0);
    await expect(tablet.getByRole('tablist')).toHaveCount(0);

    // Widerruf durch die Einsatzleitung: das Tablet endet von selbst, ohne Neuladen.
    await anlegen(page, `/api/einsaetze/${e}/geraete/${kopplung.kopplung.id}/widerrufen`);
    await expect(tablet).toHaveURL(/\/kopplung-beendet$/);
    await expect(tablet.getByRole('heading', { name: 'Kopplung beendet' })).toBeVisible();
    await expect(tablet.getByText('UHS Nord')).toHaveCount(0);
  } finally {
    await kontext.close();
  }
});
