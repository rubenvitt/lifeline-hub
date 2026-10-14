import { expect, type Page } from '@playwright/test';

/**
 * Hilfen der Meldebild-Specs, geteilt von `meldebild-tabelle.spec.ts` und
 * `meldebild-druck.spec.ts` (LFH-915) — Muster `rollen-kern.ts`: wer einen Helfer braucht, nimmt
 * ihn von hier statt einer Kopie.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

/** Subpixel-Spielraum für JEDEN Maßvergleich. */
export const SUBPIXEL = 0.5;

export async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

export { einsatzAnlegen } from './einsatz-kern';

/**
 * Ad-hoc-Kräfte ohne Einheit erzeugen die Sammelzeile „Ohne Einheit" mit n Kindern — eine
 * Aufklapp-Ebene aus einem einzigen Endpunkt. ABSICHTLICH LANGE WERTE: die
 * Bezeichnungsspalte wächst mit dem Inhalt, sonst hätte die fixierte Spalte keinen
 * Bildlaufweg zu halten.
 */
export async function seedeKraefte(page: Page, einsatzId: string, anzahl: number) {
  for (let i = 0; i < anzahl; i += 1) {
    const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/personal`, {
      data: {
        adhoc: {
          name: `Kirchgassner-Wohlfahrt, Maximiliane ${i}`,
          funktion: 'Abschnittsleitung Technische Hilfeleistung',
          traegerorganisation: 'Freiwillige Feuerwehr Musterstadt-Nordwest',
        },
      },
    });
    expect(
      antwort.ok(),
      `Seeding Kraft ${i}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
  }
}

/** Die Kennungen eines gesäten Kräftebaums. */
export interface GesaeterBaum {
  zug: number;
  gruppe: number;
  fahrzeug: number;
  fuehrer: number;
  helfer: number;
}

/**
 * Ein kleiner Kräftebaum über die API (LLH-1025): Zug mit Untergruppe, am Zug ein HLF mit dem
 * Zugführer als Besatzung, in der Gruppe eine Kraft ohne Fahrzeug. Ohne Unterstellung und
 * Besatzung zeigte das Meldebild nur flache Zeilen — jede Baum-Messung wäre grün durch Nichtstun.
 */
export async function seedKraeftebaum(page: Page, einsatzId: string): Promise<GesaeterBaum> {
  const basis = `/api/einsaetze/${einsatzId}`;
  const neu = async (pfad: string, data: unknown) => {
    const antwort = await page.request.post(`${basis}${pfad}`, { data });
    expect(
      antwort.ok(),
      `Seeding ${pfad}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
    return ((await antwort.json()) as { id: number }).id;
  };
  const setze = async (pfad: string) => {
    const antwort = await page.request.put(`${basis}${pfad}`);
    expect(
      antwort.ok(),
      `Zuordnung ${pfad}: ${antwort.status()} ${await antwort.text()}`,
    ).toBeTruthy();
  };
  const zug = await neu('/einheiten', { name: '1. Zug Musterstadt-Nordwest' });
  const gruppe = await neu('/einheiten', {
    name: '1. Gruppe Musterstadt-Nordwest',
    ueber_einheit_id: zug,
  });
  const fahrzeug = await neu('/fahrzeuge', {
    adhoc: { funkrufname: 'Florian Musterstadt 1/46-1', fahrzeugtyp: 'HLF 20' },
  });
  const fuehrer = await neu('/personal', {
    adhoc: { name: 'Zugführerin Berger', funktion: 'Zugführerin', staerke_position: 'fuehrer' },
  });
  const helfer = await neu('/personal', {
    adhoc: { name: 'Helfer Okafor', staerke_position: 'mannschaft' },
  });
  await setze(`/einheiten/${zug}/fahrzeug/${fahrzeug}`);
  await setze(`/einheiten/${zug}/personal/${fuehrer}`);
  await setze(`/fahrzeuge/${fahrzeug}/besatzung/${fuehrer}`);
  await setze(`/einheiten/${gruppe}/personal/${helfer}`);
  return { zug, gruppe, fahrzeug, fuehrer, helfer };
}
