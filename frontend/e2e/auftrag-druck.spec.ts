import { expect, test, type Page } from '@playwright/test';
import { erwarteHandyBreite, mitHandy } from './druckansicht-mobil-kern';
import { ADMIN, ADMIN_PW, anmeldenAls, benutzerAnlegen, mitgliedEintragen } from './rollen-kern';
import { einsatzAnlegen } from './einsatz-kern';

/**
 * Druckansicht eines Auftrags gegen einen echten Server (LLH-1171, Change
 * `ianaw5k1-auftrag-drucken`): der Weg aus dem Detail ohne Schreibrecht (Spec `auftraege-befehle`,
 * „Beobachter druckt einen Auftrag“) und das Blatt am Handy (LFH-956,
 * `e2e/druckansicht-mobil-kern.ts`). Die Druckmechanik unter Druckmedium in drei Engines belegt
 * `e2e/druck-fluss.spec.ts`.
 *
 * Ein Freitext ohne Umbruchstelle (Kennung, Kennzeichen, kopierte Adresse) darf das Blatt nicht
 * verbreitern: am Handy weitete er den Layout-Viewport, auf Papier ragte er über den Rand.
 */

/** Ein Wort ohne Umbruchstelle, länger als die Breite des Handys. */
const LANGES_WORT = 'Sammelplatz'.repeat(8);

async function auftragSaeen(page: Page, einsatzId: string): Promise<number> {
  const r = await page.request.post(`/api/einsaetze/${einsatzId}/auftraege`, {
    data: {
      auftrag_text: 'Wasserversorgung von Hydrant H12 aufbauen',
      mittel: '2× B-Schlauch',
      weg: `über B 3 zum ${LANGES_WORT}`,
      prioritaet: 'dringend',
      empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: 'EA Nord' }],
    },
  });
  expect(r.ok(), `Auftrag: ${r.status()} ${await r.text()}`).toBe(true);
  return ((await r.json()) as { id: number }).id;
}

test('Beobachter öffnet die Druckansicht aus dem Detail; am Handy bleibt das Blatt bei 390 px', async ({
  page,
  browser,
  browserName,
}) => {
  await anmeldenAls(page, ADMIN, ADMIN_PW);
  const einsatzId = await einsatzAnlegen(page, `E2E Auftragsdruck ${Date.now()}`);
  const auftragId = await auftragSaeen(page, einsatzId);
  const beobachter = await benutzerAnlegen(page, 'beobachter');
  await mitgliedEintragen(page, einsatzId, beobachter.id, 'beobachter');

  // ── Ohne Schreibrecht: aus dem Detail in die Druckansicht und zurück.
  await anmeldenAls(page, beobachter.benutzername, beobachter.passwort);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/einsaetze/${einsatzId}/auftraege?auftrag=${auftragId}`);
  const detail = page.locator('[data-lfh="liste-detail-detail"]');
  await expect(detail).toContainText('Wasserversorgung von Hydrant H12 aufbauen');
  // Vorbedingung: wirklich ohne Schreibrecht, sonst belegte der Fall nichts.
  await expect(detail.getByRole('button', { name: 'Vollzug melden' })).toHaveCount(0);
  await detail.getByRole('link', { name: /Druckansicht/ }).click();
  await expect(page).toHaveURL(new RegExp(`/einsaetze/${einsatzId}/auftraege/${auftragId}/druck$`));
  await expect(page.getByRole('button', { name: 'Drucken / als PDF' })).toBeEnabled();
  const wurzel = page.locator('[data-lfh="druckwurzel"]');
  await expect(wurzel.getByRole('heading', { level: 3 })).toHaveText([
    'Auftrag',
    'Quittung',
    'Bearbeitung',
  ]);
  await expect(wurzel).toContainText('nicht quittiert');
  await page.getByRole('link', { name: 'Zurück zu Aufträge/Befehle' }).click();
  await expect(page).toHaveURL(new RegExp(`/auftraege\\?auftrag=${auftragId}$|/auftraege$`));
  await expect(detail).toContainText('Wasserversorgung von Hydrant H12 aufbauen');

  // ── Am Handy, als Admin und als Beobachter (LFH-956).
  for (const [wer, konto] of [
    ['Admin', { benutzername: ADMIN, passwort: ADMIN_PW }],
    ['Beobachter', beobachter],
  ] as const) {
    const { viewport, ergebnis } = await mitHandy(
      browser,
      browserName,
      konto,
      `/einsaetze/${einsatzId}/auftraege/${auftragId}/druck`,
      (p) =>
        p.evaluate(() => {
          const wurzel = document.querySelector('[data-lfh="druckwurzel"]')!;
          return { wurzelRechts: wurzel.getBoundingClientRect().right };
        }),
    );
    erwarteHandyBreite(wer, viewport);
    expect
      .soft(ergebnis.wurzelRechts, `${wer}: das Blatt ragt nicht über den Bildschirm`)
      .toBeLessThanOrEqual(viewport.innerWidth);
  }
});
