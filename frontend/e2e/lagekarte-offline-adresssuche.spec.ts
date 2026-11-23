import { expect, test, type Page } from '@playwright/test';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zeigeLeistenAnsicht } from './leisten-kern';
import { anmeldenPerApi } from './anmelde-kern';
import { GEOCODER_LOOPBACK, setGeocoderUrl, writeOrgEinstellungen } from './geocoder-kern';

// Adresssuche ohne Internet aus der Offline-Karte (LLH-1119, Spec `lagekarte-ortssuche`,
// „Adresssuche aus der Offline-Karte“): Mit dem Adressindex der Region „Testgebiet“ im
// Kartenverzeichnis und einem Geocoder, der nicht antwortet, findet die Ortssuche
// „Hauptstraße 12, Musterstadt“, fliegt hin und nennt die Quelle.
//
// Anders als `lagekarte-ortssuche.spec.ts` fängt die Spec die Adresssuche NICHT am Frontend ab: die
// Antwort kommt vom Server, aus dem Fixture-Index (`tests/fixtures/adressindex/`). Den Geocoder der
// Organisation lenkt die Spec auf einen geschlossenen Port; danach stellt sie ihn zurück.

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** Musterstadt, Hauptstraße 12 im Fixture-Index. */
const ZIEL: [number, number] = [13.78, 52.62];

const FIXTURE = fileURLToPath(
  new URL('../../tests/fixtures/adressindex/testgebiet.adressen.sqlite', import.meta.url),
);

/** Kartenverzeichnis des e2e-Backends: `<Verzeichnis der Temp-DB>/karten` (`default_karten_dir`). */
function kartenVerzeichnis(): string {
  const lauf = process.env.LIFELINE_E2E_LAUF;
  if (!lauf) throw new Error('LIFELINE_E2E_LAUF fehlt — läuft der Test außerhalb der Suite?');
  const { datenbank } = JSON.parse(lauf) as { datenbank: string };
  return join(dirname(datenbank), 'karten');
}

interface MapHaken {
  loaded(): boolean;
  isMoving(): boolean;
  getCenter(): { lng: number; lat: number };
}

async function anmelden(page: Page, optionen?: { startseite?: boolean }) {
  await anmeldenPerApi(page, ADMIN, PW, optionen);
}

async function ruhe(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const k = (window as unknown as { __lfhKarte?: MapHaken }).__lfhKarte;
          return Boolean(k && k.loaded() && !k.isMoving());
        }),
      { timeout: 15_000, message: 'Karte kommt nicht zur Ruhe' },
    )
    .toBe(true);
}

async function mitte(page: Page): Promise<[number, number]> {
  return page.evaluate(() => {
    const c = (window as unknown as { __lfhKarte: MapHaken }).__lfhKarte.getCenter();
    return [Number(c.lng.toFixed(5)), Number(c.lat.toFixed(5))] as [number, number];
  });
}

test('ohne Netz: Ortssuche findet „Hauptstraße 12, Musterstadt“ aus der Offline-Karte', async ({
  page,
}) => {
  const seitenFehler: Error[] = [];
  page.on('pageerror', (f) => seitenFehler.push(f));

  const verzeichnis = kartenVerzeichnis();
  mkdirSync(verzeichnis, { recursive: true });
  const index = join(verzeichnis, 'e2e-testgebiet.adressen.sqlite');
  copyFileSync(FIXTURE, index);

  await anmelden(page, { startseite: false });
  const vorher = await setGeocoderUrl(page.request, GEOCODER_LOOPBACK);
  try {
    const einsatz = await page.request.post('/api/einsaetze', {
      data: { bezeichnung: `E2E Offline-Adresse ${Date.now()}` },
    });
    expect(einsatz.ok(), await einsatz.text()).toBeTruthy();
    const einsatzId = ((await einsatz.json()) as { id: number }).id;

    await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
    await ruhe(page);
    await zeigeLeistenAnsicht(page, 'Objekte');

    const feld = page.getByLabel('Kartenobjekte suchen');
    await feld.fill('Hauptstraße 12, Musterstadt');
    const antwort = page.waitForResponse((r) => r.url().includes('/karte/ort-suche?'));
    await feld.press('Enter');
    const json = (await (await antwort).json()) as {
      zustand: string;
      treffer: { name: string; quelle: string }[];
    };
    expect(json.zustand).toBe('ok');
    expect(json.treffer).toEqual([
      expect.objectContaining({
        name: 'Hauptstraße 12, 12345 Musterstadt',
        quelle: 'offline_karte',
      }),
    ]);

    // Die Gruppe „Adresse“ nennt die Quelle; genau ein Treffer fliegt ohne Klick hin.
    await expect(page.getByRole('heading', { name: 'Adresse' })).toBeVisible();
    const treffer = page.getByRole('button', { name: /^Hauptstraße 12, 12345 Musterstadt/ });
    await expect(treffer).toContainText('aus Offline-Karte');
    await expect(page.getByRole('region', { name: 'Suchnadel' })).toContainText(
      'Hauptstraße 12, 12345 Musterstadt',
    );
    await expect.poll(() => mitte(page), { timeout: 10_000 }).toEqual(ZIEL);

    // Die Suchnadel trägt die Adresse, nicht den Zusatz.
    await expect(page.getByRole('region', { name: 'Suchnadel' })).not.toContainText(
      'aus Offline-Karte',
    );
    expect(seitenFehler.map((f) => f.message)).toEqual([]);
  } finally {
    await writeOrgEinstellungen(page.request, vorher);
    rmSync(index, { force: true });
  }
});
