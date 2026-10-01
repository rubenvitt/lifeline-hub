import { expect, test } from '@playwright/test';
import { kontrast } from './kontrast-kern';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Kontrast der Werkzeug-Links der Stabseite (LFH-695, Befund S4 der Prüfliste LFH-634):
 * „Nachforderung · Verpflegung · Material" und die übrigen Ziele je Sachgebietszeile maßen am
 * Tag 6,04 und nachts 4,75 : 1. Blauer Bedien-TEXT trägt `bedienText` (frontend/AGENTS.md,
 * Farbachsen; Spec `textkontrast-rollen`, „Linkfarbe ist die Textrolle Bedien").
 *
 * SCHRANKEN (Literale, nicht aus dem Produkt): Tag ≥ 7 : 1, Nacht ≥ 5 : 1 — in Ruhe UND unter
 * dem Zeiger, gegen den Grund, auf dem der Link wirklich steht (geteilter Messkern
 * `kontrast-kern.ts`). Unter dem Zeiger unterscheidet die Unterstreichung, nicht der Ton.
 *
 * Gemessen wird JEDER Link der Gruppen „Werkzeuge S…", nicht nur S4: die Zeilen teilen eine
 * Darstellung, und ein Link mit eigenem Stil fiele sonst durch.
 */

const TEXT = { light: 7, dark: 5 } as const;

for (const modus of ['light', 'dark'] as const) {
  test(`Stabseite: Werkzeug-Links halten den Textboden im Modus ${modus}`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await anmeldenAlsAdmin(page);
    const antwort = await page.request.post('/api/einsaetze', {
      data: { bezeichnung: `E2E 695 Stab-Kontrast ${Date.now()}` },
    });
    expect(antwort.ok(), `${antwort.status()} ${await antwort.text()}`).toBe(true);
    const { id: einsatzId } = (await antwort.json()) as { id: number };

    await page.evaluate((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
    await page.goto(`/einsaetze/${einsatzId}/stab`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);

    const besetzung = page.getByRole('region', { name: 'Besetzung S1–S6', exact: true });
    const s4 = besetzung.getByRole('group', { name: 'Werkzeuge S4', exact: true });
    // Anker: die Befundzeile steht vollständig, in der Reihenfolge der Prüfliste.
    await expect(s4.getByRole('link')).toHaveText(['Nachforderung', 'Verpflegung', 'Material']);
    const links = besetzung.getByRole('group', { name: /^Werkzeuge S\d$/ }).getByRole('link');
    const anzahl = await links.count();
    expect(anzahl, 'Werkzeug-Links gefunden').toBeGreaterThan(3);

    const messwerte: Record<string, unknown>[] = [];
    const messe = async (zustand: 'ruhe' | 'zeiger', index: number) => {
      const link = links.nth(index);
      const name = (await link.textContent())?.trim();
      // antd blendet die Linkfarbe über `transition: color` über; mitten im Übergang gemessen,
      // läge ein Zwischenton vor, den niemand stehen sieht (bei gleichem Ton ohne Wirkung).
      await link.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
      const m = await kontrast(link);
      messwerte.push({ modus, zustand, name, ...m });
      expect
        .soft(
          m.verhaeltnis,
          `${modus}, ${zustand}, „${name}": ${m.verhaeltnis.toFixed(2)} : 1 (Soll ≥ ${TEXT[modus]}) ${JSON.stringify(m)}`,
        )
        .toBeGreaterThanOrEqual(TEXT[modus]);
    };

    await page.mouse.move(0, 0);
    for (let i = 0; i < anzahl; i++) await messe('ruhe', i);

    for (let i = 0; i < anzahl; i++) {
      const link = links.nth(i);
      await link.hover();
      // Erst messen, wenn der Zeigerzustand gegriffen hat: die Unterstreichung ist sein Zeichen.
      await expect(link).toHaveCSS('text-decoration-line', 'underline');
      await messe('zeiger', i);
    }

    await test.info().attach('kontrastwerte.json', {
      body: JSON.stringify(messwerte, null, 2),
      contentType: 'application/json',
    });
  });
}
