import { expect, test, type Locator, type Page } from '@playwright/test';
import { grafikKontrast, kontrast } from './kontrast-kern';
import {
  anmeldenAlsAdmin,
  benachrichtigungenQuittieren,
  benutzerAnlegen,
  mitgliedEintragen,
  wechsleZu,
} from './rollen-kern';

/**
 * Kriterium 5 der Prüfliste für die Detailseite einer Betreuungsstelle
 * `/einsaetze/:id/betreuung/:stelleId` (LLH-1044, nachgeholt mit LLH-1347): Kontrast der
 * ZUSAMMENGESETZTEN Paare in Tag und Nacht, gemessen mit dem geteilten Messkern
 * (`kontrast-kern.ts`), ohne Farbwerte aus dem Produkt.
 *
 * GESÄT: eine Stelle in Betrieb mit Kapazität, zwei Belegungsmeldungen („fast voll“, damit das
 * Auslastungswort in der Rolle Achtung steht, und die Stufenlinie entsteht) und eine Person mit
 * Verbleib „Notunterkunft“ an der Stelle (Zeile unter „Betroffene hier“).
 *
 * SCHRANKEN (Literale): Text Tag ≥ 7 : 1, Nacht ≥ 5 : 1 für JEDEN sichtbaren Text in Seitenkopf
 * und Inhalt, über den Textbaum gefunden. Die Beschriftung der Stufenlinie ist `aria-hidden` (das
 * Bild trägt die Aussage) und wird deshalb ausdrücklich gemessen. Strich, Punkte und die
 * gestrichelte Kapazität der Linie ≥ 3 : 1 gegen die Paneelfläche (WCAG 1.4.11).
 *
 * ROLLEN (`e2e/AGENTS.md`, LFH-435): als Admin (alle Handlungen) und als Beobachter (Rechtehinweis
 * „Nur Ansicht“, keine Kopf-Handlungen).
 */

const TEXT = { light: 7, dark: 5 } as const;
const GRAFIK = 3;
const STELLE = 'Grundschule Kontrast';

async function senden<T = { id: number }>(
  page: Page,
  methode: 'post' | 'patch',
  pfad: string,
  data?: unknown,
): Promise<T> {
  const r = await page.request[methode](pfad, { data });
  expect(r.ok(), `${methode} ${pfad}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()) as T;
}

interface Textknoten {
  ziel: Locator;
  text: string;
}

/** Jedes SICHTBARE Element unter `wurzel` mit eigenem Text (Muster `betreuung-pruefliste`). */
async function textknoten(wurzel: Locator): Promise<Textknoten[]> {
  const funde = await wurzel.evaluate((w) => {
    for (const alt of document.querySelectorAll('[data-kontrastprobe]'))
      alt.removeAttribute('data-kontrastprobe');
    const liste: { text: string }[] = [];
    for (const el of [w, ...w.querySelectorAll('*')]) {
      if (el.closest('[aria-hidden="true"]')) continue;
      if (!el.checkVisibility()) continue;
      const eigen = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!eigen) continue;
      el.setAttribute('data-kontrastprobe', String(liste.length));
      liste.push({ text: eigen });
    }
    return liste;
  });
  return funde.map((f, i) => ({ ...f, ziel: wurzel.locator(`[data-kontrastprobe="${i}"]`) }));
}

for (const modus of ['light', 'dark'] as const) {
  test(`Detailseite der Betreuungsstelle: Text und Belegungslinie im Modus ${modus}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await anmeldenAlsAdmin(page);
    const { id: einsatzId } = await senden(page, 'post', '/api/einsaetze', {
      bezeichnung: `E2E 1347 Kontrast ${Date.now()}`,
    });
    const basis = `/api/einsaetze/${einsatzId}`;
    const { id: stelleId } = await senden(page, 'post', `${basis}/betreuung/stellen`, {
      bezeichnung: STELLE,
      art: 'notunterkunft',
      kapazitaet_personen: 120,
    });
    await senden(page, 'patch', `${basis}/betreuung/stellen/${stelleId}`, {
      status: 'in_betrieb',
    });
    const meldung = (belegt: number, vorMin: number) =>
      senden(page, 'post', `${basis}/betreuung/stellen/${stelleId}/belegungen`, {
        belegt,
        zeitpunkt_at: new Date(Date.now() - vorMin * 60_000)
          .toISOString()
          .slice(0, 19)
          .replace('T', ' '),
      });
    await meldung(40, 90);
    await meldung(115, 10);
    const { id: personId } = await senden(page, 'post', `${basis}/personen`, {});
    await senden(page, 'post', `${basis}/personen/${personId}/sichtung`, { kategorie: 'sk3' });
    await senden(page, 'post', `${basis}/personen/${personId}/verbleib`, {
      art: 'notunterkunft',
      ziel: STELLE,
      betreuungsstelle_id: stelleId,
    });
    const beobachter = await benutzerAnlegen(page, 'beobachter');
    await mitgliedEintragen(page, String(einsatzId), beobachter.id, 'beobachter');
    await benachrichtigungenQuittieren(beobachter);

    const messwerte: Record<string, unknown>[] = [];
    const gemessen: string[] = [];

    const messeSeite = async (rolle: 'admin' | 'beobachter') => {
      await page.evaluate((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
      await page.goto(`/einsaetze/${einsatzId}/betreuung/${stelleId}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
      const linie = page.locator('[data-lfh="stelle-belegungslinie"]');
      // Eingeschwungen: Linie, Liste und Betroffene stehen.
      await expect(linie.getByRole('img', { name: /^Belegung von 40 .* auf 115 / })).toBeVisible();
      await expect(page.getByText('115 untergebracht', { exact: true })).toBeVisible();
      await expect(
        page.getByRole('region', { name: 'Betroffene hier' }).getByRole('link'),
      ).toHaveCount(1);
      if (rolle === 'beobachter') await expect(page.getByText(/Nur Ansicht/)).toBeVisible();
      await page.mouse.move(0, 0);

      // Der Rechtehinweis steht zwischen Kopf und Inhalt, in keinem der beiden Bäume.
      const hinweis = page.getByRole('status').filter({ hasText: 'Nur Ansicht' });
      for (const [flaeche, wurzel] of [
        ['kopf', page.locator('[data-lfh="seitenkopf"]')],
        ['inhalt', page.locator('[data-lfh="seiten-inhalt"]')],
        ...(rolle === 'beobachter' ? ([['hinweis', hinweis]] as const) : []),
      ] as const) {
        for (const { ziel, text } of await textknoten(wurzel)) {
          const m = await kontrast(ziel);
          messwerte.push({ modus, rolle, flaeche, art: 'text', wortlaut: text, ...m });
          gemessen.push(text);
          expect
            .soft(
              m.verhaeltnis,
              `${modus}, ${rolle}, ${flaeche}, „${text}": ${m.verhaeltnis.toFixed(2)} : 1 (Schranke ≥ ${TEXT[modus]}) ${JSON.stringify(m)}`,
            )
            .toBeGreaterThanOrEqual(TEXT[modus]);
        }
      }

      // Die Beschriftung der Linie ist `aria-hidden`: ausdrücklich messen.
      const beschriftung = linie.locator('figcaption > span');
      await expect(beschriftung).toHaveCount(3);
      for (const ziel of await beschriftung.all()) {
        const text = (await ziel.textContent())?.trim() ?? '';
        const m = await kontrast(ziel);
        messwerte.push({ modus, rolle, art: 'linienbeschriftung', wortlaut: text, ...m });
        gemessen.push(text);
        expect
          .soft(m.verhaeltnis, `${modus}, ${rolle}, Beschriftung „${text}" ${JSON.stringify(m)}`)
          .toBeGreaterThanOrEqual(TEXT[modus]);
      }

      const strich = await grafikKontrast(linie.locator('[data-lfh="standlinie-stufen"]'));
      messwerte.push({ modus, rolle, art: 'stufenstrich', ...strich });
      expect
        .soft(strich.verhaeltnis, `${modus}, ${rolle}, Stufenstrich ${JSON.stringify(strich)}`)
        .toBeGreaterThanOrEqual(GRAFIK);
      const punkte = linie.locator('circle');
      await expect(punkte).toHaveCount(2);
      for (const punkt of await punkte.all()) {
        const m = await grafikKontrast(punkt, 'fill');
        messwerte.push({ modus, rolle, art: 'meldepunkt', ...m });
        expect
          .soft(m.verhaeltnis, `${modus}, ${rolle}, Meldepunkt ${JSON.stringify(m)}`)
          .toBeGreaterThanOrEqual(GRAFIK);
      }
      const bezug = await grafikKontrast(linie.locator('[data-lfh="standlinie-bezug"]'));
      messwerte.push({ modus, rolle, art: 'kapazitaetslinie', ...bezug });
      expect
        .soft(bezug.verhaeltnis, `${modus}, ${rolle}, Kapazitätslinie ${JSON.stringify(bezug)}`)
        .toBeGreaterThanOrEqual(GRAFIK);
    };

    await messeSeite('admin');
    await wechsleZu(page, beobachter);
    await messeSeite('beobachter');

    // Die Probe hat die tragenden Texte wirklich gesehen — sonst wäre Grün trivial wahr.
    for (const pflicht of [
      STELLE,
      'Belegung melden',
      'fast voll',
      'Meldeverlauf',
      '115 untergebracht',
      '40 untergebracht',
      'Kapazität 120',
      'Betroffene hier',
      /Nur Ansicht/,
    ]) {
      const treffer = gemessen.filter((t) =>
        typeof pflicht === 'string' ? t.includes(pflicht) : pflicht.test(t),
      );
      expect(treffer.length, `Text ${String(pflicht)} gemessen`).toBeGreaterThan(0);
    }

    await test.info().attach('kontrastwerte.json', {
      body: JSON.stringify(messwerte, null, 2),
      contentType: 'application/json',
    });
  });
}
