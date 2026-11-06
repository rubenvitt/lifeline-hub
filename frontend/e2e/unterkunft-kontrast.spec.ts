import { expect, test, type Locator, type Page } from '@playwright/test';
import { kontrast } from './kontrast-kern';
import { anmeldenAlsAdmin } from './rollen-kern';

/**
 * Kriterium 5 der Prüfliste für den Unterkunftsrechner (LLH-1525, nachgeholt für LLH-1520):
 * Kontrast der ZUSAMMENGESETZTEN Paare in Tag und Nacht, gemessen mit dem geteilten Messkern
 * (`kontrast-kern.ts`), ohne Farbwerte aus dem Produkt.
 *
 * GEMESSEN: „Unterkunft planen“ mit Seitenkopf und Inhalt (Rechner mit Tag „Annahme“ im Ergebnis,
 * Reiter „Richtwerte“ mit Herkunft „Vorgabe“ und „Einsatz · …“), drei Sperrgründe am Kopf
 * („entspricht der Kapazität“, „nur aus Räumen, Fläche oder Zelten“, „kein Bedarf“), der Dialog
 * „Nachforderungen anlegen“ und als Stichprobe JEDE Zeile der Richtwerte-Listen in Stammdaten und
 * Einsatz-Einstellungen. „Organisation“ als Herkunft steht im selben Stil wie „Einsatz“ und wird
 * nicht eigens gesät: ein Wert der Organisation gälte für alle parallelen Läufe.
 *
 * SCHRANKEN (Literale): Text Tag ≥ 7 : 1, Nacht ≥ 5 : 1 für JEDEN sichtbaren Text, über den
 * Textbaum gefunden und gegen den Grund gemessen, auf dem er WIRKLICH steht. Text in gesperrten
 * Knöpfen zählt gegen den Gesperrt-Boden 4,5 : 1 (Spec `textstufen-kontrast`).
 */

const TEXT = { light: 7, dark: 5 } as const;
const GESPERRT_BODEN = 4.5;
const STELLE = 'Turnhalle Kontrastweg';

async function senden<T = { id: number }>(
  page: Page,
  methode: 'post' | 'put',
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
  test(`Unterkunftsrechner (LLH-1525): Text, Annahme, Sperrgründe und Herkunft im Modus ${modus}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1366, height: 900 });
    await anmeldenAlsAdmin(page);
    const { id: einsatzId } = await senden(page, 'post', '/api/einsaetze', {
      bezeichnung: `E2E 1525 Kontrast ${Date.now()}`,
    });
    const basis = `/api/einsaetze/${einsatzId}`;
    // Kapazität 50 = 200 m² zu 4 m²: „Kapazität übernehmen“ steht gesperrt mit Grund.
    const { id: stelleId } = await senden(page, 'post', `${basis}/betreuung/stellen`, {
      bezeichnung: STELLE,
      art: 'notunterkunft',
      kapazitaet_personen: 50,
    });
    // Ein Wert des Einsatzes, belegt (kein „Annahme“), ohne Folge für die Posten.
    await senden(page, 'put', `${basis}/unterkunft-richtwerte/abfall_je_person_l`, { wert: 4 });

    const messwerte: Record<string, unknown>[] = [];
    const gemessen: [string, string][] = [];
    const messeTexte = async (wurzel: Locator, flaeche: string) => {
      await page.mouse.move(0, 0);
      const knoten = await textknoten(wurzel);
      expect(knoten.length, `${flaeche}: Texte gefunden`).toBeGreaterThan(0);
      // Ein Dialog blendet mit Opacity ein; erst messen, wenn der erste Knoten steht.
      await expect(async () => {
        await kontrast(knoten[0].ziel);
      }).toPass({ timeout: 10_000 });
      for (const { ziel, text } of knoten) {
        const m = await kontrast(ziel);
        const gesperrt = await ziel.evaluate((el) => el.closest('button[disabled]') != null);
        const schranke = gesperrt ? GESPERRT_BODEN : TEXT[modus];
        messwerte.push({ modus, flaeche, wortlaut: text, gesperrt, ...m });
        gemessen.push([flaeche, text]);
        expect
          .soft(
            m.verhaeltnis,
            `${modus}, ${flaeche}, „${text}"${gesperrt ? ' (gesperrt)' : ''}: ${m.verhaeltnis.toFixed(2)} : 1 (Schranke ≥ ${schranke}) ${JSON.stringify(m)}`,
          )
          .toBeGreaterThanOrEqual(schranke);
      }
    };

    await page.evaluate((m) => localStorage.setItem('lifeline-hub.theme', m), modus);
    await page.goto(`/einsaetze/${einsatzId}/betreuung/${stelleId}/unterkunft`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
    const kopf = page.locator('[data-lfh="seitenkopf"]');
    const inhalt = page.locator('[data-lfh="seiten-inhalt"]');
    const grundlage = page.getByRole('region', { name: 'Grundlage', exact: true });

    // (1) Rechner mit Ergebnis: 200 m² ⇒ 50 Plätze, Kapazität gleich ⇒ Sperrgrund.
    await grundlage.getByLabel('Länge Raum 1 (m)').fill('20');
    await grundlage.getByLabel('Breite Raum 1 (m)').fill('10');
    await expect(kopf.getByText('entspricht der Kapazität', { exact: true })).toBeVisible();
    await expect(page.locator('[data-lfh="annahme"]').first()).toBeVisible();
    await messeTexte(kopf, 'kopf');
    await messeTexte(inhalt, 'rechner');

    // (2) Dialog „Nachforderungen anlegen“.
    await kopf.getByRole('button', { name: 'Nachforderungen anlegen', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Nachforderungen für ${STELLE}` });
    await expect(dialog).toBeVisible();
    await expect(page.locator('.ant-zoom-appear, .ant-zoom-enter')).toHaveCount(0);
    await messeTexte(dialog, 'dialog');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // (3) Weg „Personen“ ohne Zahl: zwei weitere Sperrgründe im Kopf.
    await grundlage.getByRole('radio', { name: 'Personen', exact: true }).click();
    await expect(
      kopf.getByText('nur aus Räumen, Fläche oder Zelten', { exact: true }),
    ).toBeVisible();
    await expect(kopf.getByText('kein Bedarf', { exact: true })).toBeVisible();
    await messeTexte(kopf, 'kopf-personen');

    // (4) Reiter „Richtwerte“: Herkunft je Zeile.
    await page.getByRole('tab', { name: 'Richtwerte' }).click();
    await expect(page.locator('[data-schluessel="abfall_je_person_l"]')).toContainText('Einsatz ·');
    await messeTexte(inhalt, 'richtwerte');

    // (5) Stichprobe Richtwerte-Listen: jede Zeile in Einsatz-Einstellungen und Stammdaten.
    for (const [flaeche, pfad] of [
      ['einstellungen', `/einsaetze/${einsatzId}/einstellungen/unterkunft`],
      ['stammdaten', '/admin/stammdaten/unterkunft'],
    ] as const) {
      await page.goto(pfad);
      await expect(
        page.getByRole('spinbutton', { name: 'Schlaffläche je Person (m²)' }),
      ).toBeEnabled();
      const zeilen = page.locator('[data-schluessel]');
      const anzahl = await zeilen.count();
      expect(anzahl, `${flaeche}: Richtwert-Zeilen`).toBeGreaterThanOrEqual(20);
      for (let i = 0; i < anzahl; i += 1) await messeTexte(zeilen.nth(i), flaeche);
    }

    // Die Probe hat die tragenden Texte wirklich gesehen — sonst wäre Grün trivial wahr.
    for (const [flaeche, pflicht] of [
      ['kopf', 'Unterkunft planen'],
      ['kopf', 'entspricht der Kapazität'],
      ['kopf', 'Kapazität übernehmen'],
      ['kopf', 'Nachforderungen anlegen'],
      ['kopf-personen', 'nur aus Räumen, Fläche oder Zelten'],
      ['kopf-personen', 'kein Bedarf'],
      ['rechner', 'Annahme'],
      ['rechner', 'Männer und Frauen getrennt'],
      ['rechner', 'Feldbetten'],
      ['dialog', `Nachforderungen für ${STELLE}`],
      ['dialog', 'Adressat'],
      ['richtwerte', 'Annahme'],
      ['richtwerte', 'Vorgabe'],
      ['richtwerte', /^Einsatz · /],
      ['einstellungen', /^Einsatz · /],
      ['einstellungen', 'Vorgabe'],
      ['einstellungen', 'Annahme'],
      ['stammdaten', 'Vorgabe'],
      ['stammdaten', 'Annahme'],
    ] as const) {
      const treffer = gemessen.filter(
        ([f, t]) =>
          f === flaeche && (typeof pflicht === 'string' ? t === pflicht : pflicht.test(t)),
      );
      expect(treffer.length, `Text ${String(pflicht)} in ${flaeche} gemessen`).toBeGreaterThan(0);
    }

    const kleinster = (f: (w: Record<string, unknown>) => boolean) =>
      Math.min(
        ...messwerte.filter(f).map((w) => (w as { verhaeltnis: number }).verhaeltnis),
      ).toFixed(2);
    test.info().annotations.push({
      type: 'messwert',
      description:
        `${modus}: ${messwerte.length} Texte, kleinster ${kleinster((w) => !w.gesperrt)} : 1, ` +
        `gesperrt ${kleinster((w) => w.gesperrt === true)} : 1, ` +
        `„Annahme“ ${kleinster((w) => w.wortlaut === 'Annahme')} : 1, ` +
        `Sperrgründe ${kleinster((w) => ['entspricht der Kapazität', 'nur aus Räumen, Fläche oder Zelten', 'kein Bedarf'].includes(w.wortlaut as string))} : 1, ` +
        `Herkunft ${kleinster((w) => w.wortlaut === 'Vorgabe' || /^Einsatz · /.test(w.wortlaut as string))} : 1`,
    });
    await testInfo.attach(`kontrastwerte-${modus}.json`, {
      body: JSON.stringify(messwerte, null, 2),
      contentType: 'application/json',
    });
  });
}
