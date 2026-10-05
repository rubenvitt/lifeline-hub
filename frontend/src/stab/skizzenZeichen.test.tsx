import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import {
  BEDINGUNGSZEICHEN_HOEHE,
  BEDINGUNGSZEICHEN_SCHRIFT,
  BereichsRahmen,
  Bedingungszeichen,
  KOMPONENTENARTEN,
  KomponentenZeichen,
  Leitung,
  SELBST_GEZEICHNET,
  STRICHMUSTER_BEREICH,
  STRICHMUSTER_GEPLANT,
  Sammelschiene,
  VERBINDUNGSARTEN,
  VerbindungsartZeichen,
  ZEICHENBREITE_EM,
  bedingungszeichenBreite,
  bedingungszeichenText,
  komponentenPiktogramm,
  leitungsBeschreibung,
  sammelschienenMindestbreite,
  schaetzeTextbreite,
  verbindungsartPiktogramm,
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
    // Text plus beide Spitzen passt hinein.
    expect(lang).toBeGreaterThanOrEqual(
      schaetzeTextbreite('TMO BN_BOS Großschadenslage Nord', BEDINGUNGSZEICHEN_SCHRIFT) +
        BEDINGUNGSZEICHEN_HOEHE,
    );
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
    expect(Number(haupt.getAttribute('y'))).toBe(100);
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
    const linie = leitung.querySelector('[data-teil="linie"]')!;
    expect(linie.getAttribute('stroke-dasharray')).toBe(STRICHMUSTER_GEPLANT);
    expect(screen.getByText('geplant')).toBeInTheDocument();
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
    expect(leitung.querySelector('[data-teil="linie"]')!.hasAttribute('stroke-dasharray')).toBe(
      false,
    );
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
      const wert = Number(
        container.querySelector('[data-teil="linie"]')!.getAttribute('stroke-width'),
      );
      unmount();
      return wert;
    };
    expect(staerke(true)).toBeGreaterThan(staerke(false));
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
    expect(verbindungsartPiktogramm('melder', 'funk').quelle).toBe('eigen');
    expect(verbindungsartPiktogramm('sonstige', 'leitung').quelle).toBe('eigen');
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
    const rahmen = bereich.querySelector('rect')!;
    expect(rahmen.getAttribute('stroke-dasharray')).toBe(STRICHMUSTER_BEREICH);
    // Strich-Punkt: langer Strich, Lücke, kurzer Strich (Punkt), Lücke.
    expect(STRICHMUSTER_BEREICH.split(' ')).toHaveLength(4);
    expect(rahmen.getAttribute('fill')).toBe('none');
    expect(screen.getByText('Rückwärtiger Bereich')).toBeInTheDocument();
    expect(farbliterale(container)).toEqual([]);
  });

  it('unterscheidet sich im Strichmuster von einer geplanten Leitung', () => {
    expect(STRICHMUSTER_BEREICH).not.toBe(STRICHMUSTER_GEPLANT);
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

describe('Selbst gezeichnete Zeichen', () => {
  it('führt jedes Zeichen, das die Bibliotheken nicht haben (Folgeticket @einsatzzeichen)', () => {
    const eigene = new Set(SELBST_GEZEICHNET.map((z) => z.zeichen));
    for (const art of VERBINDUNGSARTEN) {
      for (const medium of ['funk', 'leitung'] as const) {
        if (verbindungsartPiktogramm(art, medium).quelle === 'eigen') {
          expect(eigene).toContain(`verbindungsart.${art}`);
        }
      }
    }
    expect(eigene).toContain('bedingungszeichen');
    expect(eigene).toContain('bereich');
  });
});
