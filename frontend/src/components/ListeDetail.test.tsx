import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import KommKarte from '../kommunikation/KommKarte';
import ListeDetail, { AuswahlZiel, type ListeDetailProps } from './ListeDetail';
import { SeitenLeer } from './SeitenZustand';

interface Objekt {
  id: number;
  titel: string;
  gruppe?: string;
}

const A: Objekt = { id: 1, titel: 'Alpha', gruppe: 'a' };
const B: Objekt = { id: 2, titel: 'Bravo', gruppe: 'b' };
const C: Objekt = { id: 3, titel: 'Charlie', gruppe: 'a' };

type HarnessProps = Partial<ListeDetailProps<Objekt>> & {
  eintraege: readonly Objekt[];
  startWahl?: number | null;
  sprung?: { id: number; nr: number } | null;
};

/** Kontrollierter Abnehmer wie die Reiter: hält Wahl und Markierung. */
function Harness({
  eintraege,
  startWahl = null,
  sprung: startSprung = null,
  ...rest
}: HarnessProps) {
  const [gewaehlt, setGewaehlt] = useState<number | null>(startWahl);
  const [sprung, setSprung] = useState(startSprung);
  return (
    <ListeDetail<Objekt>
      bezeichnung="Objekte"
      eintraege={eintraege}
      schluessel={(o) => o.id}
      gewaehlt={gewaehlt}
      onWahl={(id) => {
        setGewaehlt(id);
        setSprung(null);
      }}
      sprung={sprung}
      karte={(o, z) => (
        <KommKarte gewaehlt={z.gewaehlt} hervorgehoben={z.hervorgehoben} data-objekt={o.id}>
          <AuswahlZiel {...z.auswahl} name={`Objekt ${o.id}: ${o.titel}`}>
            {o.titel}
          </AuswahlZiel>
          <Link to={`/ziel/${o.id}`}>Kennung {o.id}</Link>
        </KommKarte>
      )}
      detail={(o, { entfallen }) => (
        <div data-testid="detail">
          Detail {o.titel}
          {entfallen && ' · nicht mehr in der Liste'}
        </div>
      )}
      {...rest}
    />
  );
}

function rendere(ui: ReactNode) {
  return renderMitProviders(<>{ui}</>, { route: '/' });
}

const detail = () => screen.queryByTestId('detail');

describe('ListeDetail — Anordnung und Wahl (Spec `liste-detail`)', () => {
  it('ab lg ist ohne Wahl das erste Objekt gewählt und steht im Detail', () => {
    rendere(<Harness eintraege={[A, B, C]} />);
    expect(detail()).toHaveTextContent('Detail Alpha');
    expect(screen.getByRole('button', { name: 'Objekt 1: Alpha' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('ab lg meldet genau ein Auswahlziel den Zustand „aktuell“', () => {
    rendere(<Harness eintraege={[A, B, C]} />);
    const aktuelle = screen
      .getAllByRole('button', { name: /^Objekt / })
      .filter((b) => b.getAttribute('aria-current') === 'true');
    expect(aktuelle).toHaveLength(1);
  });

  it('ab lg steht das Detail neben der Liste, nicht zwischen den Karten', () => {
    rendere(<Harness eintraege={[A, B, C]} />);
    const liste = screen.getByRole('list', { name: 'Objekte' });
    expect(within(liste).queryByTestId('detail')).toBeNull();
    expect(detail()).not.toBeNull();
  });

  it('ein Wechsel der Wahl zeigt nur noch das neue Objekt', () => {
    rendere(<Harness eintraege={[A, B, C]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Objekt 2: Bravo' }));
    expect(detail()).toHaveTextContent('Detail Bravo');
    expect(screen.getByRole('button', { name: 'Objekt 1: Alpha' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('Enter und Leertaste wählen über das Auswahlziel (nativer Knopf)', () => {
    rendere(<Harness eintraege={[A, B, C]} />);
    const ziel = screen.getByRole('button', { name: 'Objekt 3: Charlie' });
    expect(ziel.tagName).toBe('BUTTON');
    expect(ziel).toHaveAttribute('type', 'button');
    fireEvent.click(ziel);
    expect(detail()).toHaveTextContent('Detail Charlie');
  });

  it('ein Klick auf freie Kartenfläche wählt, ein Kennungs-Link nicht', () => {
    const { container } = rendere(<Harness eintraege={[A, B, C]} />);
    fireEvent.click(screen.getByRole('link', { name: 'Kennung 3' }));
    expect(detail()).toHaveTextContent('Detail Alpha');
    fireEvent.click(container.querySelector('[data-objekt="2"]')!);
    expect(detail()).toHaveTextContent('Detail Bravo');
  });

  it('die gewählte Karte trägt die Auswahl, keine Markierung', () => {
    const { container } = rendere(<Harness eintraege={[A, B]} />);
    const karte = container.querySelector('[data-objekt="1"]')!;
    expect(karte).toHaveAttribute('data-gewaehlt', 'true');
    expect(karte).not.toHaveAttribute('data-hervorgehoben');
  });
});

describe('ListeDetail — Handschirm', () => {
  it('ohne Wahl ist nichts aufgeklappt', () => {
    setzeViewportBreite(390);
    rendere(<Harness eintraege={[A, B, C]} />);
    expect(detail()).toBeNull();
    expect(screen.getByRole('button', { name: 'Objekt 1: Alpha' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('die Wahl klappt das Detail direkt unter der Karte auf', () => {
    setzeViewportBreite(390);
    const { container } = rendere(<Harness eintraege={[A, B, C]} />);
    const ziel = screen.getByRole('button', { name: 'Objekt 2: Bravo' });
    fireEvent.click(ziel);
    expect(ziel).toHaveAttribute('aria-expanded', 'true');
    const region = document.getElementById(ziel.getAttribute('aria-controls')!)!;
    expect(region).toHaveTextContent('Detail Bravo');
    // DOM-Folge: Karte 2, ihr Detail, dann Karte 3.
    const karte2 = container.querySelector('[data-objekt="2"]')!;
    const karte3 = container.querySelector('[data-objekt="3"]')!;
    expect(karte2.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region.compareDocumentPosition(karte3) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('eine erneute Wahl der aufgeklappten Karte klappt zu', () => {
    setzeViewportBreite(390);
    rendere(<Harness eintraege={[A, B, C]} />);
    const ziel = screen.getByRole('button', { name: 'Objekt 2: Bravo' });
    fireEvent.click(ziel);
    fireEvent.click(ziel);
    expect(detail()).toBeNull();
    expect(ziel).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('ListeDetail — Zustände', () => {
  it('bei der ersten Lieferung steht ein Skelett, kein Leerzustand', () => {
    rendere(<Harness eintraege={[]} ladend leer={<SeitenLeer titel="Keine Objekte" />} />);
    expect(screen.queryByText('Keine Objekte')).toBeNull();
    expect(screen.getByLabelText('Inhalt wird geladen')).toHaveAttribute('aria-busy', 'true');
  });

  it('leer steht der Leerzustand des Aufrufers mit seiner Aktion', () => {
    const anlegen = vi.fn();
    rendere(
      <Harness
        eintraege={[]}
        leer={
          <SeitenLeer
            titel="Keine Objekte"
            aktion={{ label: 'Objekt anlegen', onClick: anlegen }}
          />
        }
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Objekt anlegen' }));
    expect(anlegen).toHaveBeenCalledOnce();
    expect(detail()).toBeNull();
  });

  it('ein Fehler ohne Bestand zeigt Ursache und „Erneut versuchen“', () => {
    const wiederholen = vi.fn();
    rendere(
      <Harness
        eintraege={[]}
        fehler={{
          ursache: new Error('Netz weg'),
          text: 'Objekte nicht geladen',
          onWiederholen: wiederholen,
        }}
      />,
    );
    expect(screen.getByText('Objekte nicht geladen')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Erneut abrufen/ }));
    expect(wiederholen).toHaveBeenCalledOnce();
  });

  it('ein gescheiterter Abgleich lässt den Bestand stehen und meldet den alten Stand', () => {
    rendere(
      <Harness
        eintraege={[A, B]}
        fehler={{ ursache: new Error('x'), text: 'Objekte nicht geladen', onWiederholen: () => {} }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Objekt 1: Alpha' })).toBeInTheDocument();
    expect(screen.getByText(/Stand womöglich veraltet/)).toBeInTheDocument();
  });
});

describe('ListeDetail — Deeplink', () => {
  it('ein Sprung wählt, markiert und holt die Karte in den Blick', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { container } = rendere(
      <Harness eintraege={[A, B, C]} startWahl={3} sprung={{ id: 3, nr: 1 }} />,
    );
    const karte = container.querySelector('[data-objekt="3"]')!;
    expect(karte).toHaveAttribute('data-hervorgehoben', 'true');
    expect(detail()).toHaveTextContent('Detail Charlie');
    expect(scroll).toHaveBeenCalledOnce();
  });

  it('eine Wahl von Hand räumt die Markierung', () => {
    Element.prototype.scrollIntoView = vi.fn();
    const { container } = rendere(
      <Harness eintraege={[A, B, C]} startWahl={3} sprung={{ id: 3, nr: 1 }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Objekt 1: Alpha' }));
    expect(container.querySelector('[data-hervorgehoben="true"]')).toBeNull();
  });
});

describe('ListeDetail — Zufluss', () => {
  it('ein neuer Eintrag unter dem Zeiger wartet hinter dem Banner', () => {
    const { rerender } = rendere(<Harness eintraege={[A, B]} />);
    fireEvent.pointerMove(screen.getByRole('list', { name: 'Objekte' }), { pointerType: 'mouse' });
    rerender(<Harness eintraege={[C, A, B]} />);
    expect(screen.queryByRole('button', { name: 'Objekt 3: Charlie' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '1 neuer Eintrag — anzeigen' }));
    expect(screen.getByRole('button', { name: 'Objekt 3: Charlie' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /neuer Eintrag/ })).toBeNull();
  });

  it('ohne Zeiger und Fokus steht Neues sofort, ohne Banner', () => {
    const { rerender } = rendere(<Harness eintraege={[A, B]} />);
    rerender(<Harness eintraege={[C, A, B]} />);
    expect(screen.getByRole('button', { name: 'Objekt 3: Charlie' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /neuer Eintrag/ })).toBeNull();
  });

  it('Touch hält nicht an', () => {
    const { rerender } = rendere(<Harness eintraege={[A, B]} />);
    fireEvent.pointerMove(screen.getByRole('list', { name: 'Objekte' }), { pointerType: 'touch' });
    rerender(<Harness eintraege={[C, A, B]} />);
    expect(screen.getByRole('button', { name: 'Objekt 3: Charlie' })).toBeInTheDocument();
  });
});

describe('ListeDetail — gewähltes Objekt entfällt', () => {
  it('das Detail bleibt mit Hinweis stehen, bis eine andere Wahl fällt', () => {
    const { rerender } = rendere(<Harness eintraege={[A, B]} startWahl={2} />);
    expect(detail()).toHaveTextContent('Detail Bravo');
    rerender(<Harness eintraege={[A]} startWahl={2} />);
    expect(detail()).toHaveTextContent('Detail Bravo · nicht mehr in der Liste');
    expect(screen.queryByRole('button', { name: 'Objekt 2: Bravo' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Objekt 1: Alpha' }));
    expect(detail()).toHaveTextContent('Detail Alpha');
    expect(detail()).not.toHaveTextContent('nicht mehr');
  });
});

describe('ListeDetail — Gruppen und Ausschnitt', () => {
  it('Gruppen stehen mit Etikett in der Reihenfolge des Aufrufers', () => {
    rendere(
      <Harness
        eintraege={[A, C, B]}
        gruppen={{
          von: (o) => o.gruppe ?? '',
          etikett: (g, n) => `${g === 'a' ? 'Gruppe A' : 'Gruppe B'} (${n})`,
          reihenfolge: ['b', 'a'],
        }}
      />,
    );
    const koepfe = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(koepfe).toEqual(['Gruppe B (1)', 'Gruppe A (2)']);
    // Vorauswahl folgt der gezeigten Folge: zuerst steht Bravo.
    expect(detail()).toHaveTextContent('Detail Bravo');
  });

  it('ab der Schwelle rendert die Liste ihren Ausschnitt und hält die tiefe Wahl samt Detail', async () => {
    setzeViewportBreite(390);
    Element.prototype.scrollIntoView = vi.fn();
    const viele = Array.from({ length: 120 }, (_, i) => ({ id: i + 1, titel: `Nr ${i + 1}` }));
    rendere(<Harness eintraege={viele} fenster startWahl={90} sprung={{ id: 90, nr: 1 }} />);
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Objekt 90: Nr 90' })).toBeInTheDocument();
    expect(detail()).toHaveTextContent('Detail Nr 90');
    expect(screen.getAllByRole('button', { name: /^Objekt / }).length).toBeLessThan(120);
  });
});
