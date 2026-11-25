import { expect, test, type Page } from '@playwright/test';
import { einsatzPerApi } from './einsatz-kern';
import { anmelden, seedeKraefte, seedKraeftebaum } from './meldebild-kern';

/**
 * Mono trägt nur Zahl, Zeit, Kennung und Funkrufname (ADR-0094, LLH-2084): in keinem Textknoten
 * in der Mono-Schrift steht ein Wort aus vier oder mehr Kleinbuchstaben. Ausgenommen sind Knoten
 * in `[data-schrift="kennung"]` (Funkrufnamen wie „Florian Musterstadt 46/11-1“; der Baustein
 * `Kennung` setzt das Attribut). Geprüft wird auf den Seiten, die am meisten Mono tragen, in der
 * Vorgabedichte `kompakt` bei 1366 px, mit gesäten Kräften, ETB-Einträgen und Betroffenen.
 */

/** Seiten unter `/einsaetze/<id>/`, auf denen der Wächter misst. */
const SEITEN = [
  'ueberblick',
  'etb',
  'einsatzdaten',
  'personen',
  'kraefteuebersicht',
  'fahrzeuge',
  'personal',
] as const;

async function saeen(page: Page): Promise<string> {
  const einsatzId = await einsatzPerApi(page, `E2E Mono ohne Worte ${Date.now()}`);
  await seedeKraefte(page, einsatzId, 2);
  await seedKraeftebaum(page, einsatzId);
  for (const [inhalt, von] of [
    ['Lagemeldung: Pegel steigt, Keller in der Hauptstraße überflutet', 'Florian Musterstadt 1'],
    ['Pumpe am Einsatzort in Betrieb genommen', 'ELW 1'],
  ] as const) {
    const r = await page.request.post(`/api/incidents/${einsatzId}/etb`, {
      data: { typ: 'meldung', inhalt, von, an: 'Einsatzleitung' },
    });
    expect(r.ok(), `Seeding ETB: ${r.status()} ${await r.text()}`).toBeTruthy();
  }
  const person = await page.request.post(`/api/incidents/${einsatzId}/persons`, {
    data: { name: 'Mustermann', vorname: 'Erika' },
  });
  expect(person.ok(), `Seeding Person: ${person.status()} ${await person.text()}`).toBeTruthy();
  return einsatzId;
}

/** Jeder sichtbare Textknoten in Mono außerhalb einer Kennung, der ein Wort trägt. */
async function worteInMono(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const funde: string[] = [];
    const lauf = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let knoten = lauf.nextNode(); knoten; knoten = lauf.nextNode()) {
      const text = knoten.textContent?.trim() ?? '';
      const wort = text.match(/\p{Ll}{4,}/u);
      if (!wort) continue;
      const element = knoten.parentElement;
      if (!element || element.closest('[data-schrift="kennung"]')) continue;
      const stil = getComputedStyle(element);
      if (!/^["']?LFH JetBrains Mono/.test(stil.fontFamily)) continue;
      const kasten = element.getBoundingClientRect();
      if (kasten.width === 0 || kasten.height === 0 || stil.visibility === 'hidden') continue;
      const anker = element.closest('[data-lfh]')?.getAttribute('data-lfh') ?? element.className;
      funde.push(`„${text.slice(0, 60)}“ (${anker || element.tagName.toLowerCase()})`);
    }
    return funde;
  });
}

test('kein Wort in Mono auf den Einsatzseiten (kompakt, 1366 px)', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await anmelden(page, { startseite: false });
  const einsatzId = await saeen(page);
  const funde: string[] = [];
  for (const seite of SEITEN) {
    await page.goto(`/einsaetze/${einsatzId}/${seite}`);
    await expect(page.getByRole('main')).toBeVisible();
    // Die Seite steht, wenn keine Ladeanzeige mehr läuft.
    await expect(page.locator('.ant-spin-spinning')).toHaveCount(0, { timeout: 15_000 });
    for (const fund of await worteInMono(page)) funde.push(`${seite}: ${fund}`);
  }
  expect(funde, `Wörter in Mono:\n${funde.join('\n')}`).toEqual([]);
});
