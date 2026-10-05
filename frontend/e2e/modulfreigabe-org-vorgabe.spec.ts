import { expect, test, type Page } from '@playwright/test';
import { anmeldenAlsAdmin, wechsleZuRolle } from './rollen-kern';

// Akzeptanz LFH-669 (Spec `modul-freigabe`): eine Org-Vorgabe `fuehrungskraft` sperrt ein Modul
// für ein normales Mitglied. Der Client kennt die Org-Vorgaben nicht; er folgt den Freigaben des
// Servers. Die Navigation zeigt das Modul gesperrt, die Lagekarte fragt dessen Liste nicht an, und
// es steht kein Ausfallhinweis da. Ein Deeplink in das Modul zeigt den Hinweis des Rahmens
// (LFH-888).
//
// Modul `lagemeldungen`: eine Quelle der Lagekarte, die kein anderer Spec mit einer
// Nicht-Admin-Rolle bedient. Die Org-Vorgabe gilt für JEDEN Einsatz der (einen) e2e-Organisation
// und damit auch für parallel laufende Specs — deshalb so kurz wie möglich und im `finally`
// zurückgesetzt.

interface KartenHaken {
  loaded(): boolean;
}

async function karteBereit(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __lfhKarte?: KartenHaken }).__lfhKarte?.loaded()),
    undefined,
    { timeout: 60_000 },
  );
}

async function orgVorgabe(page: Page, rolle: 'fuehrungskraft' | null) {
  const antwort = await page.request.put('/api/org-modul-einstellungen/lagemeldungen', {
    data: { benoetigte_rolle: rolle },
  });
  expect(antwort.ok(), `Org-Vorgabe: ${antwort.status()} ${await antwort.text()}`).toBe(true);
}

test('Org-Vorgabe sperrt „Lagemeldungen": gesperrt in der Navigation, kein Abruf, kein Ausfall', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await anmeldenAlsAdmin(page);
  const angelegt = await page.request.post('/api/einsaetze', {
    data: { bezeichnung: `E2E Freigabe ${Date.now()}` },
  });
  expect(angelegt.ok(), `Einsatz: ${angelegt.status()}`).toBe(true);
  const einsatzId = String(((await angelegt.json()) as { id: number }).id);

  await orgVorgabe(page, 'fuehrungskraft');
  try {
    await wechsleZuRolle(page, 'beobachter', einsatzId);

    const abrufe: string[] = [];
    page.on('request', (r) => {
      const pfad = new URL(r.url()).pathname;
      if (pfad.startsWith(`/api/einsaetze/${einsatzId}/`)) abrufe.push(pfad);
    });

    await page.goto(`/einsaetze/${einsatzId}/lagekarte`);
    await karteBereit(page);

    // Vorbedingung: freie Kartenquellen liefen — sonst wäre „kein Abruf" trivial.
    await expect.poll(() => abrufe.includes(`/api/einsaetze/${einsatzId}/schaeden`)).toBe(true);
    expect(abrufe).toContain(`/api/einsaetze/${einsatzId}/modul-freigaben`);

    // Navigation: das Modul steht da, gesperrt, mit Grund.
    const eintrag = page.locator('button[title="Keine Berechtigung"]', {
      hasText: 'Lagemeldungen',
    });
    await expect(eintrag).toBeVisible();
    await expect(eintrag).toBeDisabled();

    // Kein Abruf der gesperrten Liste und kein Ausfallhinweis.
    expect(abrufe).not.toContain(`/api/einsaetze/${einsatzId}/lage/meldungen`);
    await expect(page.getByTestId('lagebild-unvollstaendig')).toHaveCount(0);

    // Deeplink in das gesperrte Modul (LFH-888): der Rahmen zeigt den Hinweis statt der Seite,
    // die Liste wird nicht abgerufen, und der Rückweg führt in ein freies Modul.
    await page.goto(`/einsaetze/${einsatzId}/lagemeldungen`);
    const hinweis = page.getByRole('heading', { level: 1, name: 'Lagemeldungen' });
    await expect(hinweis).toBeVisible();
    await expect(page.getByText('Keine Berechtigung', { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText(/für deine Rolle in diesem Einsatz nicht freigegeben/),
    ).toBeVisible();
    expect(abrufe).not.toContain(`/api/einsaetze/${einsatzId}/lage/meldungen`);

    const rueckweg = page.getByRole('button', { name: / öffnen$/ });
    await rueckweg.click();
    await expect(page).not.toHaveURL(/\/lagemeldungen/);
    await expect(hinweis).toHaveCount(0);
    expect(abrufe).not.toContain(`/api/einsaetze/${einsatzId}/lage/meldungen`);
  } finally {
    // Zurück auf den Admin — nur er darf die Org-Vorgabe setzen.
    await page.request.post('/api/auth/logout');
    await anmeldenAlsAdmin(page);
    await orgVorgabe(page, null);
  }
});
