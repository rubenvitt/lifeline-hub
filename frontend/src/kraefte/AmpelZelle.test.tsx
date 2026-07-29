import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import AmpelZelle from './AmpelZelle';
import type { StatusVerteilung } from './kraeftebild';

function verteilung(v: Partial<StatusVerteilung> = {}): StatusVerteilung {
  return { verfuegbar: 0, gebunden: 0, nicht_verfuegbar: 0, ohne: 0, ...v };
}

describe('AmpelZelle', () => {
  it('trägt die Bezeichnung an der ZÄHLGRUPPE und blendet das Symbol für Vorleser aus', () => {
    /**
     * Die Auflösung des scheinbaren Widerspruchs „`aria-hidden`" gegen „`aria-label`":
     * es sind zwei verschiedene Knoten. Das Emoji ist Zierde und darf nicht der
     * alleinige Bedeutungsträger sein; die Bedeutung hängt am Etikett der Gruppe.
     */
    const { container } = render(
      <AmpelZelle bezeichnung="Personal" symbol="👤" verteilung={verteilung({ verfuegbar: 7 })} />,
    );
    expect(screen.getByRole('group', { name: 'Personal' })).toBeInTheDocument();
    expect(screen.getByLabelText('Personal')).toBeInTheDocument();
    const zierde = container.querySelector('[aria-hidden="true"]');
    expect(zierde).toHaveTextContent('👤');
  });

  it('jede Zahl trägt einen Kurztext — die Farbe ist Verstärkung, nicht Kanal', () => {
    /**
     * Kriterium 6 / WCAG 1.4.1. `.lfh-feld--alarm .lfh-zahl` codiert AUSSCHLIESSLICH über
     * Textfarbe; ohne den Kurztext daneben wäre „3" in Rot die einzige Aussage. Der
     * Volltext hängt zusätzlich als `title` am Feld.
     */
    const { container } = render(
      <AmpelZelle
        bezeichnung="Fahrzeuge"
        symbol="🚒"
        verteilung={verteilung({ verfuegbar: 7, gebunden: 3, nicht_verfuegbar: 2, ohne: 1 })}
      />,
    );
    const etiketten = [...container.querySelectorAll('.lfh-etikett')].map((e) => e.textContent);
    expect(etiketten).toEqual(['frei', 'geb.', 'n.v.', 'o.A.']);
    const zahlen = [...container.querySelectorAll('.lfh-zahl')].map((e) => e.textContent);
    expect(zahlen).toEqual(['7', '3', '2', '1']);
    const titel = [...container.querySelectorAll('.lfh-feld')].map((e) => e.getAttribute('title'));
    expect(titel).toEqual(['verfügbar', 'gebunden', 'nicht verfügbar', 'ohne Status']);
  });

  it('zeigt alle vier Felder, auch die mit 0 — Vergleichsspalten müssen fluchten', () => {
    const { container } = render(
      <AmpelZelle bezeichnung="Personal" symbol="👤" verteilung={verteilung({ gebunden: 4 })} />,
    );
    expect(container.querySelectorAll('.lfh-feld')).toHaveLength(4);
    expect(within(screen.getByRole('group', { name: 'Personal' })).getByText('4')).toBeInTheDocument();
  });

  it('eine 0 bekommt KEINE Stufenklasse, ein Wert > 0 die seiner Kategorie', () => {
    const { container } = render(
      <AmpelZelle
        bezeichnung="Personal"
        symbol="👤"
        verteilung={verteilung({ gebunden: 2, nicht_verfuegbar: 0 })}
      />,
    );
    // gebunden = 2 → achtung; nicht_verfuegbar = 0 → keine Klasse (rote 0 wäre Kriterium 7).
    expect(container.querySelectorAll('.lfh-feld--achtung')).toHaveLength(1);
    expect(container.querySelectorAll('.lfh-feld--alarm')).toHaveLength(0);
  });

  it('rendert bei fehlender Verteilung NICHTS — mittel-Zeilen haben keine', () => {
    const { container } = render(
      <AmpelZelle bezeichnung="Personal" symbol="👤" verteilung={null} />,
    );
    expect(container.querySelector('.lfh-feld')).toBeNull();
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('bringt KEIN Status-Etikett mit — sonst stünden hier wieder bis zu acht Tags', () => {
    // Regressionsanker gegen den Bestand (`verteilungTags`): vier `Space`-Tags je Achse,
    // acht in einer 220-px-Spalte, ohne `wrap`.
    const { container } = render(
      <AmpelZelle
        bezeichnung="Fahrzeuge"
        symbol="🚒"
        verteilung={verteilung({ verfuegbar: 1, gebunden: 1, nicht_verfuegbar: 1, ohne: 1 })}
      />,
    );
    expect(container.querySelector('.ant-tag')).toBeNull();
  });
});
