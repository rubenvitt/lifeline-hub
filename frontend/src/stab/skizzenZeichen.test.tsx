import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import {
  busBarMinLength,
  conditionSign,
  conditionSignWidth,
  sketchPictogram,
} from '@einsatzzeichen/core';
import {
  BEDINGUNGSZEICHEN_HOEHE,
  BereichsRahmen,
  Bedingungszeichen,
  KOMPONENTENARTEN,
  KomponentenZeichen,
  Leitung,
  SKIZZE_EINHEITEN_JE_MM,
  STRICH,
  STRICH_HERVORGEHOBEN,
  Sammelschiene,
  VERBINDUNGSARTEN,
  VerbindungsartZeichen,
  ZEICHENBREITE_EM,
  bedingungszeichenBreite,
  bedingungszeichenText,
  bedingungszeichenZusatz,
  kanalBedingung,
  komponentenPiktogramm,
  leitungsBeschreibung,
  sammelschienenMindestbreite,
  schaetzeTextbreite,
  verbindungsartPiktogramm,
  zeichenPrimitive,
} from './skizzenZeichen';

/** Die Bausteine sind SVG-Inhalt; im Test sitzen sie wie in der Skizze in einem `<svg>`. */
function zeichne(element: ReactElement) {
  return render(<svg viewBox="0 0 800 600">{element}</svg>);
}

/**
 * Kein Farb-only-Merkmal: Jeder Strich und jede Schrift steht in `currentColor`, jede Fläche auf
 * dem Skizzengrund. Ein Farbliteral (Hex, rgb, hsl) im Markup wäre eine Unterscheidung, die in
 * Graustufen verloren gehen kann.
 */
function farbliterale(container: HTMLElement): string[] {
  return container.innerHTML.match(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/gi) ?? [];
}

/** Die Polyzüge einer Linie: einer bei durchgezogen, einer je Strich bei gestrichelt. */
function linienStriche(wurzel: Element, teil = 'linie'): SVGPolylineElement[] {
  return [...wurzel.querySelectorAll<SVGPolylineElement>(`[data-teil="${teil}"] polyline`)];
}

function letzter<T>(liste: readonly T[]): T {
  return liste[liste.length - 1];
}

function punkte(el: Element): [number, number][] {
  return el
    .getAttribute('points')!
    .trim()
    .split(/\s+/)
    .map((p) => p.split(',').map(Number) as [number, number]);
}

function striche(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[stroke]')]
    .map((el) => el.getAttribute('stroke') ?? '')
    .filter((s) => s !== 'none');
}

describe('schaetzeTextbreite', () => {
  it('rechnet Zeichenzahl × Schriftgrad × Zeichenbreite', () => {
    expect(schaetzeTextbreite('TMO BN_BOS', 12)).toBeCloseTo(10 * 12 * ZEICHENBREITE_EM);
  });

  it('ist für leeren Text null und wächst mit dem Text', () => {
    expect(schaetzeTextbreite('', 12)).toBe(0);
    expect(schaetzeTextbreite('DMO 314_F*', 12)).toBeLessThan(
      schaetzeTextbreite('DMO 314_F* Gesundheit', 12),
    );
  });

  it('zählt Zeichen, nicht UTF-16-Einheiten', () => {
    expect(schaetzeTextbreite('Ü', 10)).toBeCloseTo(schaetzeTextbreite('U', 10));
  });
});

describe('Bedingungszeichen', () => {
  it('setzt Betriebsart und Bezeichnung zusammen', () => {
    expect(bedingungszeichenText('TMO', 'BN_BOS')).toBe('TMO BN_BOS');
    // Dieselbe Regel wie Funkplan-Bericht und Einsatzdaten (LFH-884): kein „TMO TMO …“.
    expect(bedingungszeichenText('TMO', 'TMO 412_F_DRK')).toBe('TMO 412_F_DRK');
  });

  it('wächst mit dem Text und kürzt nie', () => {
    const kurz = bedingungszeichenBreite('TMO', '311');
    const lang = bedingungszeichenBreite('TMO', 'BN_BOS Großschadenslage Nord');
    expect(lang).toBeGreaterThan(kurz);
  });

  it('nimmt Breite und Höhe aus dem Paket, gemessen an Arimo', () => {
    const text = 'TMO BN_BOS Großschadenslage Nord';
    expect(bedingungszeichenBreite('TMO', 'BN_BOS Großschadenslage Nord')).toBeCloseTo(
      conditionSignWidth(text) * SKIZZE_EINHEITEN_JE_MM,
      5,
    );
    expect(BEDINGUNGSZEICHEN_HOEHE).toBe(24);
    expect(sammelschienenMindestbreite('TMO', 'BN_BOS Großschadenslage Nord')).toBeCloseTo(
      busBarMinLength(text) * SKIZZE_EINHEITEN_JE_MM,
      5,
    );
  });

  it('zeichnet das Langsechseck des Pakets', () => {
    zeichne(<Bedingungszeichen x={300} y={90} betriebsart="TMO" bezeichnung="BN_BOS" />);
    const sechseck = screen
      .getByRole('img', { name: 'Bedingungszeichen TMO BN_BOS' })
      .querySelector('polygon')!;
    const paket = conditionSign({ text: 'TMO BN_BOS', center: [100, 30] }).outline[0];
    if (paket.type !== 'polyline') throw new Error('Umriss ist ein Polyzug');
    const erwartet = paket.points.map(([x, y]) => [x * 3, y * 3]);
    punkte(sechseck).forEach(([x, y], i) => {
      expect(x).toBeCloseTo(erwartet[i][0], 5);
      expect(y).toBeCloseTo(erwartet[i][1], 5);
    });
  });

  it('zeichnet ein Langsechseck mit Betriebsart, Bezeichnung und Hinweis darunter', () => {
    const { container } = zeichne(
      <Bedingungszeichen
        x={200}
        y={100}
        betriebsart="DMO"
        bezeichnung="314_F*"
        hinweis="Gesundheit"
      />,
    );
    const zeichen = screen.getByRole('img', {
      name: 'Bedingungszeichen DMO 314_F*, Hinweis: Gesundheit',
    });
    const sechseck = zeichen.querySelector('polygon');
    expect(sechseck).not.toBeNull();
    expect(sechseck!.getAttribute('points')!.trim().split(/\s+/)).toHaveLength(6);
    const texte = [...zeichen.querySelectorAll('text')].map((t) => t.textContent);
    expect(texte).toEqual(['DMO 314_F*', 'Gesundheit']);
    // Der Hinweis steht unter dem Zeichen.
    const [haupt, hinweis] = [...zeichen.querySelectorAll('text')];
    expect(Number(hinweis.getAttribute('y'))).toBeGreaterThan(100 + BEDINGUNGSZEICHEN_HOEHE / 2);
    // Grundlinie unter der Mitte, Text in der Schrift des Pakets.
    expect(Number(haupt.getAttribute('y'))).toBeGreaterThan(100);
    expect(Number(haupt.getAttribute('y'))).toBeLessThan(100 + BEDINGUNGSZEICHEN_HOEHE / 2);
    expect(haupt.getAttribute('text-anchor')).toBe('middle');
    expect(haupt.getAttribute('style')).toContain('Arimo');
    expect(zeichen.querySelector('title')?.textContent).toBe(
      'Bedingungszeichen DMO 314_F*, Hinweis: Gesundheit',
    );
    expect(farbliterale(container)).toEqual([]);
  });

  it('wird breiter, wenn der Text länger wird', () => {
    const breite = (bezeichnung: string) => {
      const { container, unmount } = zeichne(
        <Bedingungszeichen x={0} y={0} betriebsart="TMO" bezeichnung={bezeichnung} />,
      );
      const xs = container
        .querySelector('polygon')!
        .getAttribute('points')!
        .trim()
        .split(/\s+/)
        .map((p) => Number(p.split(',')[0]));
      unmount();
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(breite('BN_BOS Großschadenslage')).toBeGreaterThan(breite('311'));
  });

  it('setzt Netz, Sicherheit und Hinweis in dieser Reihenfolge unter das Zeichen (LFH-1030)', () => {
    expect(
      bedingungszeichenZusatz({ netz: 'Gateway', sicherheit: 'E2E', hinweis: 'Gesundheit' }),
    ).toBe('Gateway · E2E · Gesundheit');
    expect(bedingungszeichenZusatz({ netz: ' ', sicherheit: 'E2E', hinweis: null })).toBe('E2E');
    expect(bedingungszeichenZusatz({ netz: 'Repeater' })).toBe('Repeater');
    expect(bedingungszeichenZusatz({ netz: null, sicherheit: '', hinweis: undefined })).toBeNull();
  });

  it('zeichnet Netz und Sicherheit unter das Zeichen und nennt sie, ohne es zu verbreitern', () => {
    const { container } = zeichne(
      <Bedingungszeichen
        x={200}
        y={100}
        betriebsart="DMO"
        bezeichnung="314_F*"
        netz="Gateway"
        sicherheit="E2E"
        hinweis="Gesundheit"
      />,
    );
    const name =
      'Bedingungszeichen DMO 314_F*, Netz: Gateway, Sicherheit: E2E, Hinweis: Gesundheit';
    const zeichen = screen.getByRole('img', { name });
    const texte = [...zeichen.querySelectorAll('text')].map((t) => t.textContent);
    expect(texte).toEqual(['DMO 314_F*', 'Gateway · E2E · Gesundheit']);
    const punkte = container.querySelector('polygon')!.getAttribute('points');
    const { container: ohne } = zeichne(
      <Bedingungszeichen x={200} y={100} betriebsart="DMO" bezeichnung="314_F*" />,
    );
    expect(ohne.querySelector('polygon')!.getAttribute('points')).toBe(punkte);
  });

  it('nennt die Bedingung eines Kanals für die Tabelle', () => {
    expect(kanalBedingung('TMO', 'Gateway', 'E2E')).toBe('TMO · Gateway · E2E');
    expect(kanalBedingung('DMO', null, ' ')).toBe('DMO');
    expect(kanalBedingung('TMO', undefined, 'E2E')).toBe('TMO · E2E');
  });

  it('lässt ohne Hinweis die zweite Zeile weg', () => {
    zeichne(<Bedingungszeichen x={0} y={0} betriebsart="TMO" bezeichnung="311" hinweis={null} />);
    const zeichen = screen.getByRole('img', { name: 'Bedingungszeichen TMO 311' });
    expect(zeichen.querySelectorAll('text')).toHaveLength(1);
  });
});

describe('Leitung', () => {
  it('beschreibt Art, Medium und Status in Worten', () => {
    expect(leitungsBeschreibung({ art: 'daten', medium: 'leitung', status: 'geplant' })).toBe(
      'Daten, leitergebunden, geplant',
    );
    expect(leitungsBeschreibung({ medium: 'funk', status: 'bestehend' })).toBe('Funk, bestehend');
    expect(
      leitungsBeschreibung({ medium: 'funk', status: 'geplant', bezug: 'Polizei an TMO SL AS' }),
    ).toBe('Polizei an TMO SL AS: Funk, geplant');
  });

  it('zeichnet geplant gestrichelt und mit dem Wort „geplant“', () => {
    const { container } = zeichne(
      <Leitung
        von={{ x: 10, y: 10 }}
        nach={{ x: 210, y: 10 }}
        medium="leitung"
        status="geplant"
        art="daten"
      />,
    );
    const leitung = screen.getByRole('img', { name: 'Daten, leitergebunden, geplant' });
    const strichs = linienStriche(leitung);
    expect(strichs.length).toBeGreaterThan(10);
    // Die Striche beginnen und enden an den Stellen der Leitung.
    expect(punkte(strichs[0])[0]).toEqual([10, 10]);
    expect(letzter(punkte(strichs[strichs.length - 1]))).toEqual([210, 10]);
    expect(screen.getByText('geplant')).toBeInTheDocument();
    // Das Wort steht unter der Linie und unter dem Zeichen der Verbindungsart.
    expect(Number(screen.getByText('geplant').getAttribute('y'))).toBeGreaterThan(10 + 16);
    expect(leitung.querySelector('[data-teil="art"]')).not.toBeNull();
    expect(farbliterale(container)).toEqual([]);
  });

  it('zeichnet bestehend durchgezogen und ohne Wort', () => {
    zeichne(
      <Leitung
        von={{ x: 10, y: 10 }}
        nach={{ x: 210, y: 10 }}
        medium="leitung"
        status="bestehend"
      />,
    );
    const leitung = screen.getByRole('img', { name: 'Leitergebunden, bestehend' });
    const strichs = linienStriche(leitung);
    expect(strichs).toHaveLength(1);
    expect(punkte(strichs[0])).toEqual([
      [10, 10],
      [210, 10],
    ]);
    expect(screen.queryByText('geplant')).toBeNull();
  });

  it('trägt bei Funk die Zickzack-Marke, leitergebunden bleibt glatt', () => {
    const { unmount } = zeichne(
      <Leitung von={{ x: 0, y: 0 }} nach={{ x: 0, y: 200 }} medium="funk" status="bestehend" />,
    );
    expect(
      screen.getByRole('img', { name: 'Funk, bestehend' }).querySelector('[data-teil="funk"]'),
    ).not.toBeNull();
    unmount();
    zeichne(
      <Leitung von={{ x: 0, y: 0 }} nach={{ x: 0, y: 200 }} medium="leitung" status="bestehend" />,
    );
    expect(
      screen
        .getByRole('img', { name: 'Leitergebunden, bestehend' })
        .querySelector('[data-teil="funk"]'),
    ).toBeNull();
  });

  it('unterscheidet geplant und bestehend nicht über Farbe', () => {
    const { container: geplant } = zeichne(
      <Leitung von={{ x: 0, y: 0 }} nach={{ x: 99, y: 0 }} medium="funk" status="geplant" />,
    );
    const { container: bestehend } = zeichne(
      <Leitung von={{ x: 0, y: 0 }} nach={{ x: 99, y: 0 }} medium="funk" status="bestehend" />,
    );
    expect(new Set(striche(geplant))).toEqual(new Set(['currentColor']));
    expect(new Set(striche(bestehend))).toEqual(new Set(['currentColor']));
  });

  it('zeigt die Hervorhebung über die Strichstärke', () => {
    const staerke = (hervorgehoben: boolean) => {
      const { container, unmount } = zeichne(
        <Leitung
          von={{ x: 0, y: 0 }}
          nach={{ x: 99, y: 0 }}
          medium="leitung"
          status="bestehend"
          hervorgehoben={hervorgehoben}
        />,
      );
      const wert = Number(linienStriche(container)[0].getAttribute('stroke-width'));
      unmount();
      return wert;
    };
    expect(staerke(false)).toBe(STRICH);
    expect(staerke(true)).toBe(STRICH_HERVORGEHOBEN);
  });

  it('zeichnet nichts, solange beide Enden auf einem Punkt liegen', () => {
    zeichne(<Leitung von={{ x: 5, y: 5 }} nach={{ x: 5, y: 5 }} medium="funk" status="geplant" />);
    const leitung = screen.getByRole('img', { name: 'Funk, geplant' });
    expect(leitung.querySelectorAll('polyline, polygon, text')).toHaveLength(0);
  });
});

describe('VerbindungsartZeichen', () => {
  it.each(VERBINDUNGSARTEN)('zeichnet „%s“ mit Namen und ohne Farbliteral', (art) => {
    const { container } = zeichne(
      <VerbindungsartZeichen art={art} medium="leitung" x={50} y={50} />,
    );
    const zeichen = screen.getByRole('img');
    expect(zeichen.getAttribute('aria-label')).toMatch(/^[A-ZÄÖÜ]/);
    expect(
      zeichen.querySelectorAll('line, polyline, path, rect, circle, text').length,
    ).toBeGreaterThan(0);
    expect(farbliterale(container)).toEqual([]);
  });

  it('nennt Art und Medium', () => {
    zeichne(<VerbindungsartZeichen art="daten" medium="funk" x={0} y={0} />);
    expect(screen.getByRole('img', { name: 'Daten, Funk' })).toBeInTheDocument();
  });

  it('unterscheidet Funk und leitergebunden in der Form', () => {
    const markup = (medium: 'funk' | 'leitung') => {
      const { container, unmount } = zeichne(
        <VerbindungsartZeichen art="daten" medium={medium} x={0} y={0} />,
      );
      const html = container.innerHTML;
      unmount();
      return html;
    };
    expect(markup('funk')).not.toBe(markup('leitung'));
  });

  it('nimmt die Zeichen der Bibliothek, wo sie welche hat', () => {
    expect(verbindungsartPiktogramm('daten', 'funk')).toEqual({
      quelle: 'einsatzzeichen',
      id: 'comms.data-transmission',
      variante: 'primary',
    });
    expect(verbindungsartPiktogramm('daten', 'leitung')).toEqual({
      quelle: 'einsatzzeichen',
      id: 'comms.data-transmission',
      variante: 'alternative',
    });
  });

  it('nimmt Melder, sonstige und Satellit aus der Kommunikationsskizze des Pakets', () => {
    expect(verbindungsartPiktogramm('melder', 'funk')).toEqual({
      quelle: 'skizze',
      id: 'sketch.messenger',
      variante: 'primary',
    });
    expect(verbindungsartPiktogramm('sonstige', 'leitung')).toEqual({
      quelle: 'skizze',
      id: 'sketch.other',
      variante: 'alternative',
    });
    // Satellit kennt nur die Schale, ohne Unterscheidung des Mediums.
    expect(verbindungsartPiktogramm('satellit', 'leitung')).toEqual({
      quelle: 'skizze',
      id: 'sketch.satellite',
      variante: 'primary',
    });
    expect(zeichenPrimitive(verbindungsartPiktogramm('melder', 'leitung'))).toEqual(
      sketchPictogram('sketch.messenger', 'alternative').primitives,
    );
  });
});

describe('KomponentenZeichen', () => {
  it.each(KOMPONENTENARTEN)('zeichnet „%s“ mit Namen und ohne Farbliteral', (art) => {
    const { container } = zeichne(<KomponentenZeichen art={art} x={50} y={50} />);
    const zeichen = screen.getByRole('img');
    expect(zeichen.getAttribute('aria-label')).toMatch(/^[A-ZÄÖÜ]/);
    expect(
      zeichen.querySelectorAll('line, polyline, path, rect, circle, text').length,
    ).toBeGreaterThan(0);
    expect(farbliterale(container)).toEqual([]);
    expect(komponentenPiktogramm(art).quelle).toBe('einsatzzeichen');
  });

  it('nennt Art und Bezeichnung und schreibt die Bezeichnung darunter', () => {
    zeichne(<KomponentenZeichen art="repeater" bezeichnung="RP Nord" x={50} y={50} />);
    const zeichen = screen.getByRole('img', { name: 'Repeater: RP Nord' });
    expect([...zeichen.querySelectorAll('text')].map((t) => t.textContent)).toContain('RP Nord');
  });
});

describe('BereichsRahmen', () => {
  it('zeichnet eine Strich-Punkt-Grenze mit Bezeichnung', () => {
    const { container } = zeichne(
      <BereichsRahmen x={10} y={20} breite={300} hoehe={200} bezeichnung="Rückwärtiger Bereich" />,
    );
    const bereich = screen.getByRole('img', { name: 'Bereich: Rückwärtiger Bereich' });
    const grenze = linienStriche(bereich, 'grenze');
    // Strich-Punkt: lange Striche und kurze Punkte wechseln sich ab.
    const laengen = grenze.map((g) => {
      const [[ax, ay], [bx, by]] = [punkte(g)[0], letzter(punkte(g))];
      return Math.hypot(bx - ax, by - ay);
    });
    expect(Math.max(...laengen)).toBeGreaterThan(3 * Math.min(...laengen));
    for (const g of grenze) expect(g.getAttribute('fill')).toBe('none');
    // Die Grenze läuft genau auf dem Rechteck.
    const alle = grenze.flatMap(punkte);
    expect(Math.min(...alle.map(([x]) => x))).toBeCloseTo(10, 5);
    expect(Math.max(...alle.map(([x]) => x))).toBeCloseTo(310, 5);
    expect(Math.min(...alle.map(([, y]) => y))).toBeCloseTo(20, 5);
    expect(Math.max(...alle.map(([, y]) => y))).toBeCloseTo(220, 5);
    expect(screen.getByText('Rückwärtiger Bereich')).toBeInTheDocument();
    expect(farbliterale(container)).toEqual([]);
  });

  it('unterscheidet sich im Strichmuster von einer geplanten Leitung', () => {
    const muster = (el: ReactElement, teil: string) => {
      const { container, unmount } = zeichne(el);
      const [erster] = linienStriche(container, teil);
      const [[ax, ay], [bx, by]] = [punkte(erster)[0], letzter(punkte(erster))];
      unmount();
      return Math.hypot(bx - ax, by - ay);
    };
    expect(
      muster(<BereichsRahmen x={0} y={0} breite={300} hoehe={200} bezeichnung="B" />, 'grenze'),
    ).not.toBeCloseTo(
      muster(
        <Leitung von={{ x: 0, y: 0 }} nach={{ x: 300, y: 0 }} medium="leitung" status="geplant" />,
        'linie',
      ),
      0,
    );
  });
});

describe('Sammelschiene', () => {
  it('zeichnet eine waagerechte Linie mit eingesetztem Bedingungszeichen', () => {
    const { container } = zeichne(
      <Sammelschiene x={100} y={300} breite={400} betriebsart="TMO" bezeichnung="BN_BOS" />,
    );
    const schiene = screen.getByRole('img', { name: 'Sammelschiene TMO BN_BOS' });
    const linie = schiene.querySelector('[data-teil="schiene"]')!;
    expect(linie.getAttribute('y1')).toBe('300');
    expect(linie.getAttribute('y2')).toBe('300');
    expect(Number(linie.getAttribute('x2')) - Number(linie.getAttribute('x1'))).toBe(400);
    expect(schiene.querySelector('polygon')).not.toBeNull();
    expect(screen.getByText('TMO BN_BOS')).toBeInTheDocument();
    expect(farbliterale(container)).toEqual([]);
  });

  it('wächst mindestens auf die Breite ihres Bedingungszeichens', () => {
    const mindest = sammelschienenMindestbreite('TMO', 'BN_BOS Großschadenslage Nord');
    expect(mindest).toBeGreaterThan(bedingungszeichenBreite('TMO', 'BN_BOS Großschadenslage Nord'));
    zeichne(
      <Sammelschiene
        x={0}
        y={0}
        breite={20}
        betriebsart="TMO"
        bezeichnung="BN_BOS Großschadenslage Nord"
      />,
    );
    const linie = screen
      .getByRole('img', { name: 'Sammelschiene TMO BN_BOS Großschadenslage Nord' })
      .querySelector('[data-teil="schiene"]')!;
    expect(Number(linie.getAttribute('x2')) - Number(linie.getAttribute('x1'))).toBe(mindest);
  });

  it('nennt den Hinweis und hebt über die Strichstärke hervor', () => {
    const { container } = zeichne(
      <Sammelschiene
        x={0}
        y={0}
        breite={400}
        betriebsart="DMO"
        bezeichnung="314_F*"
        hinweis="Gesundheit"
        hervorgehoben
      />,
    );
    expect(
      screen.getByRole('img', { name: 'Sammelschiene DMO 314_F*, Hinweis: Gesundheit' }),
    ).toBeInTheDocument();
    const { container: ruhig } = zeichne(
      <Sammelschiene x={0} y={0} breite={400} betriebsart="DMO" bezeichnung="314_F*" />,
    );
    const staerke = (c: HTMLElement) =>
      Number(c.querySelector('[data-teil="schiene"]')!.getAttribute('stroke-width'));
    expect(staerke(container)).toBeGreaterThan(staerke(ruhig));
  });
});

describe('Zeichen aus dem Paket', () => {
  it('hat für jede Verbindungsart und jedes Medium ein Zeichen aus @einsatzzeichen', () => {
    for (const art of VERBINDUNGSARTEN) {
      for (const medium of ['funk', 'leitung'] as const) {
        expect(zeichenPrimitive(verbindungsartPiktogramm(art, medium)).length).toBeGreaterThan(0);
      }
    }
  });
});
