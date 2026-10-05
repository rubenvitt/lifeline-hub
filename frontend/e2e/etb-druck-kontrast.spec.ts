import { expect, test, type Page } from '@playwright/test';
import { kontrast } from './kontrast-kern';

/**
 * Kontrast der ETB-Druckansicht AM BILDSCHIRM (LFH-730, Folge aus LFH-22, Prüfliste
 * Kriterium 5). Die Vorschau unter `/einsaetze/:id/etb/druck` zeigt das Papier vorab, aber im
 * Farbmodus der Anwendung — nachts also hell auf dunkel. Auf Papier ist sie immer hell
 * (`druck/druck.css`); das deckt `etb-druck.spec.ts`, nicht diese Spec.
 *
 * SCHRANKEN (Literale, nicht aus dem Produkt, LFH-618): Tag ≥ 7 : 1, Nacht ≥ 5 : 1, gegen den
 * Grund, auf dem der Text wirklich steht (geteilter Messkern `kontrast-kern.ts`, transparente
 * Vorfahren eingerechnet).
 *
 * Gemessen wird JEDES Element der Druckwurzel, das selbst Text trägt — Druckkopf, Tabellenkopf,
 * Zellen, Hinweiszeilen, gerendertes Markdown —, nicht eine Auswahl: ein neuer Stil in der
 * Vorschau fiele sonst durch. Damit die Menge nicht still schrumpft, muss jede Stilart unten in
 * `FUNDSTELLEN` unter den Messwerten stehen.
 *
 * Nicht gemessen: Zitate (`> …`) im Markdown. `Markdown.css` dimmt sie per `opacity`, und das
 * modelliert der Messkern nicht (er lehnt ab, statt zu schätzen). Nachzug: LFH-911.
 */

const TEXT = { light: 7, dark: 5 } as const;

/** Texte, deren Element unter den Messwerten stehen muss — je Stilart der Vorschau einer. */
const FUNDSTELLEN = [
  'Einsatztagebuch', // Titel des Druckkopfs (`h2`)
  'Gedruckt von', // Etikett im Druckkopf (`colorTextSecondary`)
  'Inhalt', // Tabellenkopf
  'Meldung', // Typwort in der Zelle
  'Funk', // Meldeweg (Hinweisstil)
  'nachgetragen um', // Nachtragsvermerk (Hinweisstil, Monospace-Zelle)
  'berichtigt durch', // Berichtigungsvermerk (Hinweisstil)
  'Deich Nord', // Fettung im Markdown
  'Pegel', // Inline-Code im Markdown (eigene Fläche)
  'Lagekarte', // Link im Markdown (eigene Farbe)
] as const;

async function anmelden(page: Page, modus: 'light' | 'dark') {
  await page.addInitScript((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill(process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function post(page: Page, pfad: string, data: unknown): Promise<{ id: number }> {
  const r = await page.request.post(pfad, { data });
  expect(r.ok(), `${pfad}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return r.json();
}

for (const modus of ['light', 'dark'] as const) {
  test(`ETB-Druckansicht am Bildschirm hält den Textboden im Modus ${modus}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await anmelden(page, modus);
    const { id: einsatzId } = await post(page, '/api/einsaetze', {
      bezeichnung: `E2E 730 ETB-Druck-Kontrast ${modus} ${Date.now()}`,
    });
    const etb = `/api/einsaetze/${einsatzId}/etb`;
    const grund = await post(page, etb, {
      typ: 'meldung',
      inhalt:
        '**Deich Nord** gesichert, `Pegel` 4,20 m\n\n- Sandsäcke verbaut\n- [Lagekarte](https://example.org/karte) aktualisiert',
      von: 'Florian 1',
      an: 'ELW',
      meldeweg: 'funk',
    });
    await post(page, etb, {
      typ: 'anordnung',
      von: 'ELW 1',
      an: 'Leitstelle',
      inhalt: 'Nachgetragene Anordnung',
      ereigniszeit: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    await post(page, etb, {
      typ: 'berichtigung',
      von: 'ELW 1',
      an: 'Leitstelle',
      inhalt: 'Berichtigung: Deich Süd, nicht Nord',
      berichtigt_eintrag_id: grund.id,
    });

    await page.goto(`/einsaetze/${einsatzId}/etb/druck`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
    // Anker: erst ist alles geladen, dann gibt es eine Druckwurzel mit allen drei Zeilen.
    await expect(page.getByRole('button', { name: 'Drucken / als PDF' })).toBeEnabled({
      timeout: 30_000,
    });
    const wurzel = page.locator('[data-lfh="druckwurzel"]');
    await expect(wurzel.locator('[data-lfh="etb-druck-tabelle"] tbody tr')).toHaveCount(3);
    await page.mouse.move(0, 0);

    // Jedes Element mit eigenem, nicht leerem Textknoten.
    const traeger = wurzel.locator('xpath=.//*[text()[normalize-space()]]');
    const anzahl = await traeger.count();
    expect(anzahl, 'Textträger in der Druckwurzel gefunden').toBeGreaterThan(20);

    const messwerte: { text: string; verhaeltnis: number }[] = [];
    for (let i = 0; i < anzahl; i++) {
      const element = traeger.nth(i);
      const text = (await element.evaluate((el) => el.textContent ?? '')).trim();
      const m = await kontrast(element);
      messwerte.push({ text, verhaeltnis: m.verhaeltnis });
      expect
        .soft(
          m.verhaeltnis,
          `${modus}, „${text}": ${m.verhaeltnis.toFixed(2)} : 1 (Soll ≥ ${TEXT[modus]}) ${JSON.stringify(m)}`,
        )
        .toBeGreaterThanOrEqual(TEXT[modus]);
    }

    for (const fundstelle of FUNDSTELLEN) {
      expect
        .soft(
          messwerte.some((w) => w.text.startsWith(fundstelle)),
          `Stilart „${fundstelle}" fehlt unter den Messwerten`,
        )
        .toBe(true);
    }

    await test.info().attach('kontrastwerte.json', {
      body: JSON.stringify(messwerte, null, 2),
      contentType: 'application/json',
    });
  });
}
