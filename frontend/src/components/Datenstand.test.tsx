import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import Datenstand, { formatiereDatenstand, gemeinsamerDatenstand } from './Datenstand';

/** Heute um hh:mm in der Browserzone — der Datenstand rechnet bewusst in Gerätezeit. */
function heuteUm(stunde: number, minute: number): number {
  const d = new Date();
  d.setHours(stunde, minute, 0, 0);
  return d.getTime();
}

describe('Datenstand', () => {
  it('formatiert dataUpdatedAt in der Rolle „kurz“, taktisch, in der Browserzone (LLH-1061)', () => {
    const zeit = heuteUm(14, 7);
    expect(formatiereDatenstand(zeit)).toBe('1407');
    renderMitProviders(<Datenstand dataUpdatedAt={zeit} />);
    expect(screen.getByText('Stand 1407')).toHaveAccessibleName('Datenstand 1407');
    // Der Titel trägt nur Minuten; `data-stand` ist der ms-genaue Anker für e2e.
    expect(screen.getByText('Stand 1407')).toHaveAttribute('data-stand', String(zeit));
  });

  it('nennt an einem anderen Tag den Tag und folgt „Datum und Uhrzeit“', () => {
    const d = new Date(heuteUm(14, 7));
    d.setDate(d.getDate() - 1);
    const gestern = d.getTime();
    const tag = String(new Date(gestern).getDate()).padStart(2, '0');
    const monat = String(new Date(gestern).getMonth() + 1).padStart(2, '0');
    expect(formatiereDatenstand(gestern)).toBe(`${tag}1407`);
    expect(formatiereDatenstand(gestern, { zeitdarstellung: 'datum_uhrzeit' })).toBe(
      `${tag}.${monat}. 14:07`,
    );
  });

  it('rendert vor dem ersten erfolgreichen Abruf nichts', () => {
    renderMitProviders(<Datenstand dataUpdatedAt={0} />);
    expect(screen.queryByText(/^Stand /)).not.toBeInTheDocument();
  });

  // LFH-373: im Seitenkopf erschien „Stand hh:mm" erst mit der Liste und brach auf 390 px in
  // eine neue Zeile um — alles darunter rückte 22–25 px (e2e `leisten-flaeche.spec.ts`,
  // „Laden ohne Sprung"). Der Platzhalter hält die Breite, sagt aber nichts.
  it('hält mit platzHalten vor dem ersten Abruf die Breite frei, unsichtbar und stumm', () => {
    const { container } = renderMitProviders(<Datenstand dataUpdatedAt={0} platzHalten />);
    const platz = container.querySelector('[data-lfh="datenstand-platzhalter"]') as HTMLElement;
    expect(platz).not.toBeNull();
    // Gleiche Zeichenzahl wie „Stand hhmm" — in Mono mit Tabellenziffern also gleich breit.
    expect(platz.textContent).toHaveLength('Stand 1407'.length);
    expect(platz.style.visibility).toBe('hidden');
    expect(platz).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByLabelText(/^Datenstand/)).not.toBeInTheDocument();
  });

  it('ersetzt den Platzhalter durch den Wert, sobald er da ist', () => {
    const zeit = heuteUm(14, 7);
    const { container } = renderMitProviders(<Datenstand dataUpdatedAt={zeit} platzHalten />);
    expect(container.querySelector('[data-lfh="datenstand-platzhalter"]')).toBeNull();
    expect(screen.getByText('Stand 1407')).toHaveAccessibleName('Datenstand 1407');
  });

  // LFH-723: ohne Verbindung steht der vorgehaltene Stand da — die Uhrzeit ist die der letzten
  // Server-Antwort, das Wort sagt, dass nichts nachkommt. Das Wort ist der zweite Kanal neben
  // der Farbe (WCAG 1.4.1) und gehört in den zugänglichen Namen.
  it('kennzeichnet einen Stand ohne Verbindung mit „offline", im Text und im Namen', () => {
    const zeit = heuteUm(14, 32);
    renderMitProviders(<Datenstand dataUpdatedAt={zeit} offline />);
    expect(screen.getByText('Stand 1432 · offline')).toHaveAccessibleName(
      'Datenstand 1432, offline',
    );
  });

  it('folgt ohne Prop dem Online-Zustand des Browsers', async () => {
    const zeit = heuteUm(14, 32);
    renderMitProviders(<Datenstand dataUpdatedAt={zeit} />);
    expect(screen.getByText('Stand 1432')).toBeInTheDocument();
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(await screen.findByText('Stand 1432 · offline')).toBeInTheDocument();
    onLine.mockRestore();
  });

  it('kennzeichnet ohne Datenstand nichts als offline', () => {
    renderMitProviders(<Datenstand dataUpdatedAt={0} offline />);
    expect(screen.queryByText(/offline/)).not.toBeInTheDocument();
  });

  it('nimmt bei zusammengesetzten Ansichten den ältesten geladenen Teil', () => {
    expect(gemeinsamerDatenstand(300, undefined, 100, 200)).toBe(100);
    expect(gemeinsamerDatenstand(0, undefined)).toBe(0);
  });
});
