import { expect, test, type Page } from '@playwright/test';

// Eigene Führungsstelle auf der Lagekarte (LFH-1181, Spec `lagekarte-taktische-zeichen`,
// „Führungsstelle auf der Lagekarte“): mit Koordinate steht sie als lesender Marker in der festen
// Quelle des Einsatzorts, beschriftet mit ihrer Bezeichnung; ohne Koordinate fehlt sie. Geprüft
// wird die Quelle (`querySourceFeatures`), nicht das Bild.

const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

interface MapHaken {
  loaded(): boolean;
  jumpTo(o: { center: [number, number]; zoom: number }): void;
  querySourceFeatures(quelle: string): { properties: Record<string, unknown> | null }[];
}

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function senden(page: Page, methode: 'post' | 'patch', pfad: string, data: unknown) {
  const antwort = await page.request[methode](pfad, { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return (await antwort.json()) as { id: number };
}

async function anker(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(() => {
    const k = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
    if (!k || !k.loaded()) return [];
    return k.querySourceFeatures('marker-einsatzort').map((f) => f.properties ?? {});
  });
}

const ORT: [number, number] = [9.356, 52.103];
const ELW: [number, number] = [9.358, 52.104];

test.use({ viewport: { width: 1366, height: 768 } });

test('LFH-1181: Führungsstelle mit Koordinate als Marker, ohne Koordinate fort', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await anmelden(page);
  const { id } = await senden(page, 'post', '/api/einsaetze', {
    bezeichnung: `E2E Führungsstelle Karte ${Date.now()}`,
  });
  const basis = `/api/einsaetze/${id}`;
  await senden(page, 'patch', basis, {
    einsatzort: 'Weserufer',
    einsatzort_lat: ORT[1],
    einsatzort_lon: ORT[0],
  });
  await senden(page, 'patch', `${basis}/fuehrungsstelle`, {
    bezeichnung: 'ELW 2 Musterstadt',
    standort_lat: ELW[1],
    standort_lon: ELW[0],
  });

  await page.goto(`/einsaetze/${id}/lagekarte`);
  await page.waitForFunction(
    () => Boolean((window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte?.loaded()),
    undefined,
    { timeout: 60_000 },
  );
  await page.evaluate(
    (c) =>
      (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte.jumpTo({ center: c, zoom: 15 }),
    ELW,
  );

  await expect
    .poll(async () => (await anker(page)).find((p) => p.schluessel === 'fuehrungsstelle'), {
      timeout: 30_000,
    })
    .toMatchObject({ typ: 'fuehrungsstelle', beschriftung: 'ELW 2 Musterstadt' });
  // Die Ebene steht in der Leiste, gleich nach dem Einsatzort.
  await expect(page.getByRole('switch', { name: /^Führungsstelle/ })).toBeVisible();

  // Ohne Koordinate fehlt der Marker; die Karte bekommt das live über das Ereignis `einsatz`.
  await senden(page, 'patch', `${basis}/fuehrungsstelle`, {
    standort_lat: null,
    standort_lon: null,
  });
  await expect
    .poll(async () => (await anker(page)).map((p) => p.schluessel), { timeout: 30_000 })
    .toEqual(['einsatzort']);
});
