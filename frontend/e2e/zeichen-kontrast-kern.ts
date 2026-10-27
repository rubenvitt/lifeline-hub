import { expect, type Locator } from '@playwright/test';
import { contrastSurface } from '@einsatzzeichen/core';
import { ZEICHEN_THEME_DUNKEL } from '../src/zeichen/zeichenTheme';

/**
 * Messkern „Zeichenkontrast“ für taktische Zeichen am Schirm (LLH-1409), geteilt von
 * `zeichen-kontrast.spec.ts` (Meldebild, Organigramm, in HTML) und
 * `fernmeldeskizze-ausstattung.spec.ts` (Skizze, als inneres SVG). Nachts zeichnet die Bibliothek
 * jedes Zeichen mit dem Render-Theme `dark` (`zeichen/zeichenTheme.ts`): eine Hinterlegung in
 * {@link HINTERLEGUNG} folgt eng der Kontur jedes malenden Blatts, kein helles Quadrat dahinter.
 *
 * Gemessen wird je Zeichen aus den berechneten Stilen:
 * - **Grund** ist, worauf das Zeichen steht. In HTML der Hintergrund des Zeichens und seiner
 *   Vorfahren bis zur ersten opaken Fläche; in der Skizze die Fläche des Kastens, sonst die
 *   komponierte HTML-Fläche unter der Skizze.
 * - **Hinterlegung** sind die Striche in der Farbe {@link HINTERLEGUNG}; sie stehen auf dem Grund.
 *   Dazu zählen auch weiße Linien, die das Theme direkt auf den Grund setzt (Fahrwerk).
 * - **Kontur** sind alle übrigen Striche. Trägt das Zeichen eine Hinterlegung, steht die Kontur
 *   auf ihr (das legt das Theme so an), sonst auf dem Grund.
 *
 * Füllungen und Schrift im Körper zählen nicht, sie stehen auf dem Körper. Deckkraft und Verläufe
 * sind nicht modelliert und ein Fehler.
 */
export const HINTERLEGUNG = contrastSurface(ZEICHEN_THEME_DUNKEL);

export interface ZeichenKontrast {
  /** In der Skizze `<element>` bzw. `<element>/<ausstattung>`, sonst die Beschreibung (`desc`). */
  name: string;
  /** Beschreibung des Zeichens aus der Bibliothek (`desc`). */
  beschreibung: string;
  /** Trägt das Zeichen eine Hinterlegung (Theme `dark`)? */
  hinterlegt: boolean;
  /** Schwächste Kontur gegen das, worauf sie steht (Hinterlegung, sonst Grund). */
  kontur: number;
  /** Schwächste Hinterlegung gegen den Grund, `null` ohne Hinterlegung. */
  hinterlegungGrund: number | null;
}

/** Misst jedes Zeichen des Locators (je ein `svg` der Bibliothek), eingeschwungen. */
export async function zeichenKontraste(zeichen: Locator): Promise<ZeichenKontrast[]> {
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
  return zeichen.evaluateAll((alle, hinterlegungCss) => {
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
    const gleich = (a: F, b: F) => a.every((w, i) => Math.abs(w - b[i]) < 1e-6);
    const hinterlegung = farbe(hinterlegungCss);

    /** HTML-Hintergründe von `start` aufwärts bis zur ersten opaken Fläche, komponiert. */
    function htmlGrund(start: Element): F {
      const lagen: F[] = [];
      for (let e: Element | null = start; e; e = e.parentElement) {
        const stil = getComputedStyle(e);
        if (stil.backgroundImage !== 'none' || Number(stil.opacity) !== 1)
          throw new Error(`Nicht unterstützte Komposition an ${e.tagName}`);
        const f = farbe(stil.backgroundColor);
        lagen.push(f);
        if (f[3] === 1) break;
      }
      const grund = lagen.reverse().reduce((h, v) => darueber(v, h), [0, 0, 0, 0] as F);
      if (grund[3] !== 1) throw new Error('Kein opaker Grund belegt');
      return grund;
    }

    return alle.map((svg) => {
      const beschreibung = svg.querySelector('desc')?.textContent ?? '?';
      const element = svg.closest('[data-lfh="skizze-element"]');
      let grund: F;
      let name = beschreibung;
      if (element) {
        // Skizze: das Zeichen ist ein inneres SVG und malt keinen Hintergrund.
        const flaecheSvg = element.closest('[data-lfh="skizze-flaeche"]')!.querySelector('svg')!;
        for (let e: Element | null = svg; e && e !== flaecheSvg; e = e.parentElement)
          if (Number(getComputedStyle(e).opacity) !== 1) throw new Error('Deckkraft am Zeichen');
        const html = htmlGrund(flaecheSvg.parentElement!);
        const kasten = element.querySelector('[data-teil="kasten"]');
        grund =
          kasten && getComputedStyle(kasten).display !== 'none'
            ? darueber(farbe(getComputedStyle(kasten).fill), html)
            : html;
        const ausstattung = svg.closest('[data-ausstattung]');
        name = ausstattung
          ? `${element.getAttribute('data-key')}/${ausstattung.getAttribute('data-ausstattung')}`
          : element.getAttribute('data-key')!;
      } else {
        grund = htmlGrund(svg);
      }

      const striche = Array.from(svg.querySelectorAll('*'))
        .map((e) => getComputedStyle(e))
        .filter((s) => s.stroke !== 'none' && parseFloat(s.strokeWidth) > 0)
        .map((s) => farbe(s.stroke));
      const halo = striche.filter((f) => gleich(f, hinterlegung));
      const kontur = striche.filter((f) => !gleich(f, hinterlegung));
      if (kontur.length === 0) throw new Error(`Zeichen ohne Kontur: ${name}`);
      const auflage = halo.length > 0 ? darueber(hinterlegung, grund) : grund;
      return {
        name,
        beschreibung,
        hinterlegt: halo.length > 0,
        kontur: Math.min(...kontur.map((f) => verhaeltnis(darueber(f, auflage), auflage))),
        hinterlegungGrund:
          halo.length > 0
            ? Math.min(...halo.map((f) => verhaeltnis(darueber(f, grund), grund)))
            : null,
      };
    });
  }, HINTERLEGUNG);
}

/** Die Messwerte als eine Zeile für `test.info().annotations`. */
export function messzeile(werte: readonly ZeichenKontrast[]): string {
  return werte
    .map(
      (w) =>
        `${w.name}: Kontur ${w.kontur.toFixed(2)}` +
        (w.hinterlegungGrund == null
          ? ''
          : `, Hinterlegung ${w.hinterlegungGrund.toFixed(2)} gegen Grund`),
    )
    .join(' · ');
}

/** Jede Kontur und jede Hinterlegung unter 3 : 1 (WCAG 1.4.11), als lesbare Befunde. */
export function unterDrei(werte: readonly ZeichenKontrast[]): string[] {
  return werte.flatMap((w) => [
    ...(w.kontur < 3 ? [`${w.name}: Kontur ${w.kontur.toFixed(2)}`] : []),
    ...(w.hinterlegungGrund != null && w.hinterlegungGrund < 3
      ? [`${w.name}: Hinterlegung ${w.hinterlegungGrund.toFixed(2)}`]
      : []),
  ]);
}

/**
 * Wie viele der Zeichen eine Hinterlegung tragen, ohne Grund (im Druck gibt es keinen opaken
 * Grund außer dem Papier).
 */
export async function hinterlegteZeichen(zeichen: Locator): Promise<number> {
  await expect(zeichen.first()).toBeAttached();
  return zeichen.evaluateAll((alle, hinterlegung) => {
    // Die Farbe so, wie `getComputedStyle` sie für `stroke` liefert.
    const probe = document.createElement('i');
    probe.style.color = hinterlegung;
    document.body.append(probe);
    const soll = getComputedStyle(probe).color;
    probe.remove();
    return alle.filter((svg) =>
      Array.from(svg.querySelectorAll('*')).some((e) => {
        const s = getComputedStyle(e);
        return s.stroke === soll && parseFloat(s.strokeWidth) > 0;
      }),
    ).length;
  }, HINTERLEGUNG);
}

/** Zeichen, die das Theme `dark` tragen (`true`) bzw. nicht tragen (`false`), nach Name. */
export function mitHinterlegung(werte: readonly ZeichenKontrast[], erwartet: boolean): string[] {
  return werte.filter((w) => w.hinterlegt === erwartet).map((w) => w.name);
}
