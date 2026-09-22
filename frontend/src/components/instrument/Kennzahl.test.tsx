import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { dichten, farbenDunkel, farbenHell } from '../../theme/tokens';
import {
  Kennzahl,
  Kennzahlenband,
  kennzahlStil,
  kennzahlenbandStil,
  punktFarbe,
  zahlFarbe,
} from './Kennzahl';

const tokenFuer = (stufe: keyof typeof dichten) => ({
  controlHeight: dichten[stufe].zeilenhoehe,
  padding: dichten[stufe].abstand.md,
  paddingLG: dichten[stufe].abstand.lg,
  marginXS: dichten[stufe].abstand.xs,
});

describe('Kennzahl — Datenzustände (Semantik des Lage-Dashboards)', () => {
  it('Daten: Zahl, Einheit und Notiz', () => {
    renderMitProviders(
      <Kennzahl titel="Betroffene" wert={248} einheit="Pers." notiz="seit 08:00" />,
    );
    expect(screen.getByText('248')).toBeInTheDocument();
    expect(screen.getByText('Pers.')).toBeInTheDocument();
    expect(screen.getByText('seit 08:00')).toBeInTheDocument();
  });

  it('Laden: „····" mit aria-busy und „wird abgerufen" — keine Behauptung über die Menge', () => {
    renderMitProviders(<Kennzahl titel="Betroffene" wert={248} notiz="x" zustand="laden" />);
    expect(screen.getByText('····')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('wird abgerufen')).toBeInTheDocument();
    expect(screen.queryByText('248')).toBeNull();
  });

  it('Fehler: „?" mit title und „Stand unbekannt" — Fehler sieht nicht aus wie leer', () => {
    renderMitProviders(<Kennzahl titel="Warnstufe" wert={0} einheit="E" zustand="fehler" />);
    expect(screen.getByText('?')).toHaveAttribute('title', 'Stand unbekannt');
    expect(screen.getByText('Stand unbekannt')).toBeInTheDocument();
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText('E')).toBeNull();
  });

  it('eine Null ist ein Wert, kein Zustand', () => {
    renderMitProviders(<Kennzahl titel="Vermisst" wert={0} />);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText('Stand unbekannt')).toBeNull();
  });
});

describe('Kennzahl — Ton und zweiter Kanal', () => {
  it('Alarm und Achtung haben verschieden breite Kanten, neutral keine', () => {
    const alarm = kennzahlStil(farbenHell, tokenFuer('kompakt'), 'alarm', 'daten');
    const achtung = kennzahlStil(farbenHell, tokenFuer('kompakt'), 'achtung', 'daten');
    const neutral = kennzahlStil(farbenHell, tokenFuer('kompakt'), 'neutral', 'daten');
    expect(alarm.boxShadow).toBe(`inset 6px 0 0 0 ${farbenHell.alarm}`);
    expect(achtung.boxShadow).toBe(`inset 3px 0 0 0 ${farbenHell.achtung}`);
    expect(neutral.boxShadow).toBeUndefined();
  });

  it('außerhalb von `daten` gibt es weder Tonfarbe noch Kante — ein rotes „?" behauptete eine Lage', () => {
    expect(zahlFarbe(farbenDunkel, 'alarm', 'fehler')).toBe(farbenDunkel.text);
    expect(zahlFarbe(farbenDunkel, 'alarm', 'laden')).toBe(farbenDunkel.text);
    expect(zahlFarbe(farbenDunkel, 'alarm', 'daten')).toBe(farbenDunkel.alarm);
    expect(
      kennzahlStil(farbenHell, tokenFuer('kompakt'), 'alarm', 'fehler').boxShadow,
    ).toBeUndefined();
  });

  it('nachts steht die Zahl in der Tonfarbe — alle fünf Töne (Entwurf S6)', () => {
    expect(zahlFarbe(farbenDunkel, 'normal', 'daten')).toBe(farbenDunkel.normalText);
    expect(zahlFarbe(farbenDunkel, 'bedien', 'daten')).toBe(farbenDunkel.bedienText);
    expect(zahlFarbe(farbenDunkel, 'achtung', 'daten')).toBe(farbenDunkel.achtung);
    expect(zahlFarbe(farbenDunkel, 'alarm', 'daten')).toBe(farbenDunkel.alarm);
    expect(zahlFarbe(farbenDunkel, 'neutral', 'daten')).toBe(farbenDunkel.text);
  });

  it('tags ist auch die achtung-/alarm-Zahl getönt — über die Textrollen (LFH-618)', () => {
    expect(zahlFarbe(farbenHell, 'achtung', 'daten')).toBe(farbenHell.achtungText);
    expect(zahlFarbe(farbenHell, 'alarm', 'daten')).toBe(farbenHell.alarmText);
    // Die Füllfarbe als Zahl fiele unter den Tagesboden — deshalb die eigene Rolle.
    expect(zahlFarbe(farbenHell, 'achtung', 'daten')).not.toBe(farbenHell.achtung);
    expect(zahlFarbe(farbenHell, 'alarm', 'daten')).not.toBe(farbenHell.text);
    expect(zahlFarbe(farbenHell, 'normal', 'daten')).toBe(farbenHell.normalText);
    expect(zahlFarbe(farbenHell, 'bedien', 'daten')).toBe(farbenHell.bedienText);
  });

  it('normal und bedien setzen keine Kante — die Kante trennt nur die Eskalationsstufen', () => {
    for (const ton of ['normal', 'bedien'] as const) {
      expect(
        kennzahlStil(farbenHell, tokenFuer('kompakt'), ton, 'daten').boxShadow,
      ).toBeUndefined();
    }
  });

  it('trägt den wirksamen Ton als Marke — außerhalb von `daten` neutral', () => {
    const { rerender } = renderMitProviders(<Kennzahl titel="S4" wert={3} ton="bedien" />);
    expect(screen.getByText('3').closest('[data-lfh="kennzahl"]')).toHaveAttribute(
      'data-ton',
      'bedien',
    );
    rerender(<Kennzahl titel="S4" wert={3} ton="bedien" zustand="laden" />);
    expect(document.querySelector('[data-lfh="kennzahl"]')).toHaveAttribute('data-ton', 'neutral');
  });

  it('die Schrift der Zahl ändert sich mit dem Ton NICHT (kein Zeilensprung)', () => {
    renderMitProviders(
      <>
        <Kennzahl titel="A" wert="1" ton="bedien" />
        <Kennzahl titel="B" wert="2" />
      </>,
    );
    const [a, b] = screen
      .getAllByText(/^[12]$/)
      .map((e) => e.closest('[data-lfh="kennzahl-wert"]') as HTMLElement);
    expect(a.style.fontSize).toBe(b.style.fontSize);
    expect(a.style.fontWeight).toBe(b.style.fontWeight);
    expect(a.style.color).not.toBe(b.style.color);
  });
});

describe('Kennzahl — klickbar', () => {
  it('mit Ziel ist die ganze Zelle ein Link', () => {
    renderMitProviders(<Kennzahl titel="Betroffene" wert={248} ziel="/einsaetze/1/personen" />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/einsaetze/1/personen');
    expect(link).toHaveTextContent('248');
  });

  it('ohne Ziel kein Link', () => {
    renderMitProviders(<Kennzahl titel="Betroffene" wert={248} />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('trägt den Boden aus controlHeight — 30 / 48 / 72 px — plus Polsterung', () => {
    const hoehe = (s: keyof typeof dichten) =>
      kennzahlStil(farbenHell, tokenFuer(s), 'neutral', 'daten').minHeight;
    expect(hoehe('kompakt')).toBe(30);
    expect(hoehe('komfortabel')).toBe(48);
    expect(hoehe('handschuh')).toBe(72);
    const polster = (['kompakt', 'handschuh'] as const).map(
      (s) => kennzahlStil(farbenHell, tokenFuer(s), 'neutral', 'daten').paddingBlock,
    );
    expect(polster[0]).not.toBe(polster[1]);
  });
});

describe('Kennzahlenband', () => {
  it('Fugenraster: gap 1 px auf linie', () => {
    expect(kennzahlenbandStil(farbenHell, 5)).toMatchObject({
      gap: 1,
      background: farbenHell.linie,
      gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
    });
    expect(String(kennzahlenbandStil(farbenHell).gridTemplateColumns)).toMatch(/auto-fit/);
  });

  it('ist mit Beschriftung eine benannte Gruppe', () => {
    renderMitProviders(
      <Kennzahlenband beschriftung="Lage in Zahlen">
        <Kennzahl titel="A" wert={1} />
      </Kennzahlenband>,
    );
    expect(screen.getByRole('group', { name: 'Lage in Zahlen' })).toBeInTheDocument();
  });

  it('zeigt eine Aufgliederung nur im Zustand `daten`', () => {
    const seg = { segmente: [{ label: 'SK I', wert: 2, farbe: 'red' }], titel: 'Sichtung' };
    const { rerender } = renderMitProviders(<Kennzahl titel="A" wert={2} aufgliederung={seg} />);
    expect(screen.getByRole('img', { name: 'Sichtung: SK I 2' })).toBeInTheDocument();
    rerender(<Kennzahl titel="A" wert={2} aufgliederung={seg} zustand="laden" />);
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('Kennzahl — Statuspunkt vor der Augenbraue (S6)', () => {
  it('setzt den Punkt nur auf Wunsch, als Dekoration vor dem Stufenwort', () => {
    const { container, rerender } = renderMitProviders(<Kennzahl titel="S4" wert={17} />);
    expect(container.querySelector('[data-lfh="kennzahl-punkt"]')).toBeNull();
    rerender(<Kennzahl titel="S4" wert={17} punkt="bedien" />);
    const punkt = container.querySelector<HTMLElement>('[data-lfh="kennzahl-punkt"]')!;
    expect(punkt).toHaveAttribute('aria-hidden', 'true');
    expect(punkt).toHaveAttribute('data-ton', 'bedien');
    // VOR der Augenbraue, im selben Zeilenkopf.
    expect(punkt.nextElementSibling).toHaveTextContent('S4');
  });

  it('färbt nur im Zustand daten — laden/fehler stehen neutral am selben Platz', () => {
    const { container, rerender } = renderMitProviders(
      <Kennzahl titel="S6" wert={2} punkt="alarm" zustand="fehler" />,
    );
    expect(container.querySelector('[data-lfh="kennzahl-punkt"]')).toHaveAttribute(
      'data-ton',
      'neutral',
    );
    rerender(<Kennzahl titel="S6" wert={2} punkt="alarm" />);
    expect(container.querySelector('[data-lfh="kennzahl-punkt"]')).toHaveAttribute(
      'data-ton',
      'alarm',
    );
  });

  it('nimmt die Kantenfarbe der Statusfläche — dieselbe Rolle wie der Rand der StatusZelle', () => {
    expect(punktFarbe(farbenDunkel, 'alarm', 'daten')).toBe(farbenDunkel.alarm);
    expect(punktFarbe(farbenHell, 'normal', 'daten')).toBe(farbenHell.normal);
    expect(punktFarbe(farbenHell, 'alarm', 'laden')).toBe(farbenHell.schwach);
  });
});
