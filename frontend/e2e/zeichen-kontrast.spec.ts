import { expect, test, type Locator, type Page } from '@playwright/test';
import { einsatzAnlegen } from './fernmeldeskizze-kern';
import { FUEKW, anmelden, post } from './fuehrungsorganisation-kern';

/**
 * Zeichenkontrast in Meldebild und Organigramm (LFH-1120): jedes taktische Zeichen hält am Schirm
 * in beiden Modi 3 : 1 gegen seinen Grund, im Druck steht es ohne Unterlage auf dem Papier.
 * Muster: „Zeichenkontrast“ der Fernmeldeskizze (`fernmeldeskizze-ausstattung.spec.ts`), dort im
 * SVG, hier in HTML. jsdom rechnet keine Farben und kennt kein `@media print`. Der Einsatz entsteht
 * über die API: der Test prüft den Anlegedialog nicht (`e2e/AGENTS.md`, LFH-1114).
 *
 * Mutationsprobe: ohne `unterlage` an `EinheitZeichen` bzw. im Organigramm hält der schwarze
 * Umriss eines Zeichens ohne Organisation im Nachtbetrieb 1,10 : 1, der Test wird rot (mit
 * Unterlage 21 : 1 in beiden Modi). Den Druck trägt keine eigene Regel des Zeichens, sondern
 * `druck/druck.css` (kein Hintergrund in der Druckwurzel); die Druckprobe belegt, dass beide
 * Seiten darunter fallen.
 */

/**
 * Ein Abschnitt mit zwei Einheiten: eine ohne Organisation (der schwarze Umriss, um den es geht)
 * und eine der Feuerwehr (Farbe nach DV 102 auf der Unterlage).
 */
async function seede(page: Page, einsatzId: string) {
  const abschnitt = await post(page, einsatzId, 'abschnitte', { name: 'Deich Nord' });
  await post(page, einsatzId, 'einheiten', {
    name: 'Gruppe ohne Organisation',
    abschnitt_id: abschnitt,
  });
  const fw = await post(page, einsatzId, 'einheiten', {
    name: 'Gruppe Feuerwehr',
    abschnitt_id: abschnitt,
  });
  const antwort = await page.request.patch(`/api/einsaetze/${einsatzId}/einheiten/${fw}/position`, {
    data: { tz_organisation: 'feuerwehr' },
  });
  expect(antwort.ok(), `Organisation: ${antwort.status()} ${await antwort.text()}`).toBeTruthy();
}

/**
 * Je Zeichen der schwächste Umriss gegen den Grund, auf dem es steht. Umriss sind alle Striche
 * des Zeichens (`stroke`), Füllungen und Schrift im Körper stehen auf dem Körper und zählen nicht.
 * Grund ist der Hintergrund des Zeichens selbst (die Unterlage), darunter die Hintergründe der
 * Vorfahren bis zur ersten opaken Fläche. Deckkraft und Verläufe sind nicht modelliert und ein
 * Fehler.
 */
async function zeichenUmrisse(zeichen: Locator) {
  await expect(zeichen.first()).toBeVisible();
  // Eingeschwungen messen (`e2e/AGENTS.md`, „Kontrast misst eingeschwungen“): ein abklingender
  // Zeilen-Hover ergäbe sonst einen Zwischenwert.
  await zeichen.first().evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  return zeichen.evaluateAll((alle) => {
    type F = [number, number, number, number];
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    function farbe(css: string): F {
      if (!CSS.supports('color', css)) throw new Error(`Nicht auflösbare Farbe: ${css}`);
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    }
    function darueber(vorne: F, hinten: F): F {
      const a = vorne[3] + hinten[3] * (1 - vorne[3]);
      if (a === 0) return [0, 0, 0, 0];
      return [0, 1, 2]
        .map((i) => (vorne[i] * vorne[3] + hinten[i] * hinten[3] * (1 - vorne[3])) / a)
        .concat(a) as F;
    }
    function luminanz(f: F) {
      const l = f.slice(0, 3).map((n) => {
        const s = n / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return l[0] * 0.2126 + l[1] * 0.7152 + l[2] * 0.0722;
    }
    const verhaeltnis = (a: F, b: F) => {
      const [x, y] = [luminanz(a), luminanz(b)].sort((p, q) => p - q);
      return (y + 0.05) / (x + 0.05);
    };
    return alle.map((svg) => {
      const lagen: F[] = [];
      for (let e: Element | null = svg; e; e = e.parentElement) {
        const stil = getComputedStyle(e);
        if (stil.backgroundImage !== 'none' || Number(stil.opacity) !== 1)
          throw new Error(`Nicht unterstützte Komposition an ${e.tagName}`);
        const f = farbe(stil.backgroundColor);
        lagen.push(f);
        if (f[3] === 1) break;
      }
      const grund = lagen.reverse().reduce((h, v) => darueber(v, h), [0, 0, 0, 0] as F);
      if (grund[3] !== 1) throw new Error('Kein opaker Grund belegt');
      const striche = Array.from(svg.querySelectorAll('*'))
        .map((e) => getComputedStyle(e))
        .filter((s) => s.stroke !== 'none' && parseFloat(s.strokeWidth) > 0)
        .map((s) => darueber(farbe(s.stroke), grund));
      if (striche.length === 0) throw new Error('Zeichen ohne Umriss');
      return {
        name: svg.querySelector('desc')?.textContent ?? '?',
        verhaeltnis: Math.min(...striche.map((f) => verhaeltnis(f, grund))),
      };
    });
  });
}

/** Im Druck steht kein Zeichen auf einer Unterlage: jedes Zeichen ohne eigenen Hintergrund. */
async function hintergruendeImDruck(page: Page, zeichen: Locator) {
  await page.emulateMedia({ media: 'print' });
  const werte = await zeichen.evaluateAll((alle) =>
    alle.map((svg) => getComputedStyle(svg).backgroundColor),
  );
  await page.emulateMedia({ media: null });
  return werte;
}

const SEITEN = [
  {
    name: 'Meldebild',
    pfad: (id: string) => `/einsaetze/${id}/kraefteuebersicht`,
    zeichen: (page: Page) => page.locator('[data-lfh="einheit-zeichen"] svg'),
    // Beide Einheiten; der Abschnitt trägt im Meldebild kein Zeichen.
    anzahl: 2,
  },
  {
    name: 'Organigramm',
    pfad: (id: string) => `/einsaetze/${id}/einsatzabschnitte?ansicht=organigramm`,
    zeichen: (page: Page) => page.locator('[data-lfh="org-zeichen"] svg'),
    // Abschnitt und beide Einheiten.
    anzahl: 3,
  },
] as const;

for (const modus of ['dark', 'light'] as const) {
  test(`Zeichenkontrast: jedes taktische Zeichen in Meldebild und Organigramm hält am Schirm im Modus ${modus} 3 : 1 gegen seinen Grund, im Druck ohne Unterlage`, async ({
    page,
  }) => {
    await page.setViewportSize(FUEKW);
    await anmelden(page);
    const einsatzId = await einsatzAnlegen(page, `E2E Zeichenkontrast ${modus} ${Date.now()}`);
    await seede(page, einsatzId);
    await page.evaluate((m) => localStorage.setItem('lifeline-hub.theme', m), modus);

    for (const seite of SEITEN) {
      await page.goto(seite.pfad(einsatzId));
      // Der Zeiger stünde sonst womöglich über einer Zeile (Hover-Tönung).
      await page.mouse.move(0, 0);
      await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
      const zeichen = seite.zeichen(page);
      // Datenanker: im Organigramm kommen Abschnitte und Einheiten aus getrennten Abfragen, das
      // Zeichen des Abschnitts steht vor denen der Einheiten.
      await expect(zeichen, `${seite.name}: Zeichen`).toHaveCount(seite.anzahl);

      const umrisse = await zeichenUmrisse(zeichen);
      test.info().annotations.push({
        type: 'messwert',
        description: `${seite.name} ${modus}: ${umrisse.map((u) => `${u.name} ${u.verhaeltnis.toFixed(2)}`).join(' · ')}`,
      });
      // Vorbedingung: ein Zeichen ohne Organisation steht da, sonst misst der Test nichts.
      expect(
        umrisse.some((u) => !u.name.includes('Organisation:')),
        `${seite.name}: Zeichen ohne Organisation`,
      ).toBe(true);
      expect(
        umrisse
          .filter((u) => u.verhaeltnis < 3)
          .map((u) => `${u.name}: ${u.verhaeltnis.toFixed(2)}`),
        `${seite.name}: Umriss unter 3 : 1 (${modus})`,
      ).toEqual([]);

      expect(
        (await hintergruendeImDruck(page, zeichen)).filter((f) => f !== 'rgba(0, 0, 0, 0)'),
        `${seite.name}: Unterlage im Druck`,
      ).toEqual([]);
    }
  });
}
