import { expect, test, type Page } from '@playwright/test';
import { evakuierungsbezirkPfad } from '../src/routing/deeplinks';
import { farbenDunkel, farbenHell } from '../src/theme/tokens';
import { pruefe } from './kontrast-kern';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Roter Fehlertext außerhalb von Formularen, Tag und Nacht (LFH-874, Spec `textkontrast-rollen`):
 * `Typography` `danger` trägt über antds `colorErrorText` die Textrolle `alarmText`. Textboden aus
 * Kriterium 5 als Literal, Tag ≥ 7 : 1, Nacht ≥ 5 : 1. Gerechnet steht dasselbe in
 * `src/theme/fehlertextKontrast.test.ts`; hier zählt, was der Browser zeichnet.
 *
 * GEMESSEN:
 *  · „Gebiet konnte nicht geladen werden“ im Paneel „Gebiet“ eines Evakuierungsbezirks, dessen
 *    Zonenabruf mit 500 scheitert (LLH-1827, Change `a12ms7g9-seitenzustaende`, D6). Bis dahin
 *    stand hier „Befehl nicht gefunden.“ (vorher am Tag 5,67); ein unbekannter Befehl zeigt jetzt
 *    die neutrale Form „Diesen Befehl gibt es nicht (mehr)“.
 *  · „Überfällig“ auf der Karte eines offenen Auftrags mit abgelaufener Frist, also auf der
 *    alarmierten Kartenfläche. Vorher am Tag 5,52.
 *
 * Die Füllfarbe bleibt, wo sie keine Schrift ist: die linke Kante dieser Karte trägt weiter
 * `alarm` (Akzeptanz LFH-874).
 */

const TEXT = { light: 7, dark: 5 } as const;
const ROLLEN = { light: farbenHell, dark: farbenDunkel } as const;

function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

async function post(page: Page, pfad: string, data: unknown): Promise<number> {
  const antwort = await page.request.post(pfad, { data });
  expect(antwort.ok(), `Seeding ${pfad}: ${antwort.status()} ${await antwort.text()}`).toBe(true);
  return ((await antwort.json()) as { id: number }).id;
}

for (const modus of ['light', 'dark'] as const) {
  test(`roter Fehlertext hält den Textboden — ${modus}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.addInitScript((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
    await anmeldenAlsAdmin(page, { startseite: false });

    const einsatzId = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E 874 Fehlertext ${Date.now()}`,
    });
    await post(page, `/api/einsaetze/${einsatzId}/auftraege`, {
      auftrag_text: 'Deich sichern',
      empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: 'Abschnitt Nord' }],
      frist_at: '2026-06-01 10:00:00',
    });

    // Ein Bezirk mit einer Fläche: nur dann ruft das Paneel „Gebiet“ die Zonen ab.
    const bezirkId = await post(page, `/api/einsaetze/${einsatzId}/evakuierung/bezirke`, {
      bezeichnung: 'Uferstraße 12–40',
      plan_personen: 120,
      plan_erhebung: 'geschaetzt',
    });
    const [w, o, s, n] = [9.354, 9.358, 52.103, 52.105];
    await post(page, `/api/einsaetze/${einsatzId}/zonen`, {
      typ: 'evakuierungsbezirk',
      geometrie_typ: 'Polygon',
      geometrie: JSON.stringify({
        type: 'Polygon',
        coordinates: [
          [
            [w, s],
            [o, s],
            [o, n],
            [w, n],
            [w, s],
          ],
        ],
      }),
      evakuierungsbezirk_id: bezirkId,
    });
    // Der Abruf des Gebiets scheitert am Server; alles andere läuft echt.
    await page.route(`**/api/einsaetze/${einsatzId}/zonen`, (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Interner Fehler' }),
          })
        : route.continue(),
    );

    await page.goto(evakuierungsbezirkPfad(einsatzId, bezirkId));
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
    const gebietFehlt = page.getByText('Gebiet konnte nicht geladen werden', { exact: true });
    await expect(gebietFehlt).toHaveClass(/ant-typography-danger/);
    await pruefe(gebietFehlt, TEXT[modus], `${modus}/Gebiet konnte nicht geladen werden`);

    await page.goto(`/einsaetze/${einsatzId}/auftraege`);
    const karte = page.locator('[data-auftrag-id][data-ueberfaellig="true"]');
    await expect(karte).toHaveCount(1);
    const ueberfaellig = karte.locator('.ant-typography-danger').filter({ hasText: 'Überfällig' });
    await expect(ueberfaellig).toHaveCount(1);
    await pruefe(ueberfaellig, TEXT[modus], `${modus}/Überfällig auf der alarmierten Karte`);

    // Die Kante ist Füllfarbe, keine Schrift: sie bleibt `alarm`, nicht `alarmText`.
    await expect(karte).toHaveCSS('border-left-color', rgb(ROLLEN[modus].alarm));
  });
}
