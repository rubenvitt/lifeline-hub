import { expect, test, type Page } from '@playwright/test';
import { pruefe } from './kontrast-kern';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Sichtung an der Personenmarke und Wartebereich nach Dringlichkeit (LLH-1135,
 * `frontend/src/pages/uhs/dringlichkeit.ts`): ein SK I steht im Wartebereich vor einem SK III,
 * der schon länger wartet; jede Marke trägt die Sichtung mit Farbfeld und Wort. Die Schrift der
 * Sichtung hält den Textboden auf der Marke (Tag ≥ 7 : 1, Nacht ≥ 5 : 1, wie
 * `betroffene-kontrast.spec.ts`).
 *
 * Seeding als Admin über die API: `POST …/personen` mit `uhs_id` legt die Person in den
 * Wartebereich, die Anlagefolge ist die Folge der Eintritte. Kein `networkidle` (LFH-385).
 *
 * Mutationsprobe: in `Grundriss.tsx` `nachDringlichkeit` am Wartebereich entfernt → SK III steht
 * vorn (rot).
 */

// Drei-Spalten-Form: der Wartebereich steht neben der Fläche (`dreiSpaltenPassen`).
test.use({ viewport: { width: 1920, height: 900 } });

async function anlegen<T = { id: number }>(page: Page, pfad: string, data?: unknown): Promise<T> {
  const antwort = await page.request.post(pfad, data === undefined ? {} : { data });
  expect(antwort.ok(), `${pfad}: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
  return (await antwort.json()) as T;
}

for (const modus of ['light', 'dark'] as const) {
  const minimum = modus === 'light' ? 7 : 5;

  test(`${modus}: SK I vor SK III im Wartebereich, die Marke trägt die Sichtung`, async ({
    page,
  }) => {
    await page.addInitScript((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
    await anmeldenAlsAdmin(page);
    const e = (
      await anlegen(page, '/api/einsaetze', { bezeichnung: `E2E Dringlichkeit ${Date.now()}` })
    ).id;
    const uhs = await anlegen(page, `/api/einsaetze/${e}/uhs`, {
      typ: 'behandlungsplatz',
      bezeichnung: 'BHP Dringlichkeit',
    });
    await anlegen(page, `/api/einsaetze/${e}/uhs/${uhs.id}/status`, { status: 'aktiv' });
    // Zuerst der SK III: er wartet länger und stünde nach Zeit vorn.
    await anlegen(page, `/api/einsaetze/${e}/personen`, {
      name: 'Gruen',
      sichtung: 'sk3',
      uhs_id: uhs.id,
    });
    await anlegen(page, `/api/einsaetze/${e}/personen`, {
      name: 'Rot',
      sichtung: 'sk1',
      uhs_id: uhs.id,
    });

    await page.goto(`/einsaetze/${e}/unfallhilfsstellen/${uhs.id}`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
    // Der Zeiger steht außerhalb: die Schleuse des Wartebereichs ist offen.
    await page.mouse.move(0, 0);
    const wartebereich = page.getByRole('region', { name: /Wartebereich/ });
    const zeilen = wartebereich.getByTestId('personen-zeile');
    await expect(zeilen).toHaveCount(2);
    await expect(zeilen.nth(0)).toContainText('SK I');
    await expect(zeilen.nth(0)).toContainText('Rot');
    await expect(zeilen.nth(1)).toContainText('SK III');
    await expect(zeilen.nth(1)).toContainText('Gruen');

    // Farbfeld und Wort an der Marke; das Wort hält den Textboden auf ihrem Grund.
    const sk1 = zeilen.nth(0).locator('[data-lfh="personenkarte"] [data-sichtung="sk1"]');
    await expect(sk1).toHaveText('SK I');
    await expect(sk1.locator('[aria-hidden="true"]')).toHaveCount(1);
    await pruefe(sk1, minimum, `${modus}/Marke/SK I`);
    await pruefe(
      zeilen.nth(0).locator('[data-lfh="wartezeit"]'),
      minimum,
      `${modus}/Marke/Wartezeit`,
    );
  });
}
