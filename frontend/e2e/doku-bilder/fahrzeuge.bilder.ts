import type { APIRequestContext } from '@playwright/test';
import { anmelden, demoEinsatz, expect, fotografiere, fuelle, test, uhrAnhalten } from './kern';

/**
 * Bilder des Kapitels „Fahrzeuge und FMS“ (`docs/anwender/kapitel/fahrzeuge.md`).
 *
 * Gezeigte Ansichten — wer sie umbaut, erzeugt die Bilder neu
 * (`pnpm doku:bilder --grep fahrzeuge`, Mitänderungsregel in `docs/anwender/AGENTS.md`):
 *   fahrzeuge.png    frontend/src/pages/FahrzeugePage.tsx (Ansicht „Liste“),
 *                    frontend/src/components/Datensicht.tsx
 *   besatzung.png    frontend/src/pages/FahrzeugePage.tsx (`BesatzungsBlock`)
 *   fms-tableau.png  frontend/src/kraefte/FmsTableau.tsx, frontend/src/kraefte/fmsTableauKern.ts
 *
 * Demo-Lücke (D3): die Demo-Fahrzeuge haben keine Besatzung. Die Spec setzt Anna und Paul Probe
 * (Rettungsstaffel) und Lena Beispiel (andere Einheit) auf den RTW „83-1“.
 */

const KAPITEL = 'fahrzeuge';

interface Fahrzeug {
  id: number;
  funkrufname: string;
}
interface Person {
  id: number;
  name: string;
}

async function liste<T>(api: APIRequestContext, pfad: string): Promise<T[]> {
  const antwort = await api.get(pfad);
  expect(antwort.ok(), `${pfad}: ${antwort.status()}`).toBe(true);
  return (await antwort.json()) as T[];
}

test.describe(KAPITEL, () => {
  test('Fahrzeuge im Einsatz', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/fahrzeuge?ansicht=liste`);
    await expect(page.locator('[data-lfh="besatzung-urteil"]').first()).toBeVisible();
    await expect(page.getByText(/83-1/).first()).toBeVisible();
    await fotografiere(page, KAPITEL, 'fahrzeuge');
  });

  test('Besatzung eines Fahrzeugs', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    // Erst hier gefüllt: mit Besatzung wird die Liste breiter als die Fläche, das Listenbild
    // davor zeigt den Stand der Demo-Daten.
    const fahrzeuge = await liste<Fahrzeug>(page.request, `/api/einsaetze/${demo.id}/fahrzeuge`);
    const rtw = fahrzeuge.find((f) => f.funkrufname.endsWith('83-1'));
    expect(rtw, 'RTW 83-1 im Demo-Einsatz').toBeDefined();
    const personal = await liste<Person>(page.request, `/api/einsaetze/${demo.id}/personal`);
    for (const name of ['Anna Probe', 'Paul Probe', 'Lena Beispiel']) {
      const person = personal.find((p) => p.name === name);
      expect(person, `${name} im Demo-Einsatz`).toBeDefined();
      await fuelle(
        page,
        'put',
        `/api/einsaetze/${demo.id}/fahrzeuge/${rtw!.id}/besatzung/${person!.id}`,
      );
    }
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/fahrzeuge?ansicht=liste`);
    await page.getByRole('button', { name: /^Besatzung zu .*83-1$/ }).click();
    const block = page.locator('[data-lfh="besatzung-block"]');
    await expect(block.getByText('andere Einheit')).toBeVisible();
    await page.mouse.move(0, 0);
    await fotografiere(block, KAPITEL, 'besatzung');
  });

  test('FMS-Tableau', async ({ page }) => {
    await anmelden(page);
    const demo = await demoEinsatz(page);
    await uhrAnhalten(page);
    await page.goto(`/einsaetze/${demo.id}/fahrzeuge?ansicht=tableau`);
    const tableau = page.getByRole('region', { name: 'FMS-Tableau' });
    await expect(tableau.locator('[data-lfh="fms-kachel"]').first()).toBeVisible();
    await fotografiere(tableau, KAPITEL, 'fms-tableau');
  });
});
