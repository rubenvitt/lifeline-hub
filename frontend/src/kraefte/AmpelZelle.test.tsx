import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import AmpelZelle from './AmpelZelle';
import type { StatusVerteilung } from './kraeftebild';

function verteilung(v: Partial<StatusVerteilung> = {}): StatusVerteilung {
  return { verfuegbar: 0, gebunden: 0, nicht_verfuegbar: 0, ohne: 0, ...v };
}

describe('AmpelZelle', () => {
  it('trägt die Bezeichnung an der ZÄHLGRUPPE und blendet die Zierde für Vorleser aus', () => {
    /**
     * `aria-hidden` und `aria-label` sind zwei Knoten: das Icon ist Zierde, die Bedeutung hängt am
     * Etikett der Gruppe.
     */
    const { container } = render(
      <AmpelZelle bezeichnung="Personal" verteilung={verteilung({ verfuegbar: 7 })} />,
    );
    const gruppe = screen.getByRole('group', { name: 'Personal' });
    expect(gruppe).toBeInTheDocument();
    expect(screen.getByLabelText('Personal')).toBeInTheDocument();
    // Ein antd-Icon bringt `role="img"` mit englischem `aria-label` mit; ohne `aria-hidden`-Hülle
    // stünde es in jeder Tabellenzeile als eigenes Ziel.
    expect(within(gruppe).queryByRole('img')).toBeNull();
    const zierde = container.querySelector('[aria-hidden="true"]');
    // Ein Icon des Satzes mit echtem SVG (Hülle `anticon`, LFH-595) — rot, wenn die Zierde
    // wieder als Zeichenkette käme ODER die Hülle fehlte.
    expect(zierde?.querySelector('.anticon svg')).not.toBeNull();
    expect(zierde?.textContent).toBe('');
  });

  it('jede Zahl trägt einen Kurztext — die Farbe ist Verstärkung, nicht Kanal', () => {
    /**
     * `.lfh-feld--alarm .lfh-zahl` codiert NUR über Textfarbe; ohne den Kurztext wäre „3" in Rot
     * die einzige Aussage. Der Volltext hängt zusätzlich als `title` am Feld.
     */
    const { container } = render(
      <AmpelZelle
        bezeichnung="Fahrzeuge"
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
      <AmpelZelle bezeichnung="Personal" verteilung={verteilung({ gebunden: 4 })} />,
    );
    expect(container.querySelectorAll('.lfh-feld')).toHaveLength(4);
    expect(
      within(screen.getByRole('group', { name: 'Personal' })).getByText('4'),
    ).toBeInTheDocument();
  });

  it('eine 0 bekommt KEINE Stufenklasse, ein Wert > 0 die seiner Kategorie', () => {
    const { container } = render(
      <AmpelZelle
        bezeichnung="Personal"
        verteilung={verteilung({ gebunden: 2, nicht_verfuegbar: 0 })}
      />,
    );
    // gebunden = 2 → achtung; nicht_verfuegbar = 0 → keine Klasse (eine rote 0 wäre falsch).
    expect(container.querySelectorAll('.lfh-feld--achtung')).toHaveLength(1);
    expect(container.querySelectorAll('.lfh-feld--alarm')).toHaveLength(0);
  });

  it('rendert bei fehlender Verteilung NICHTS — mittel-Zeilen haben keine', () => {
    const { container } = render(<AmpelZelle bezeichnung="Personal" verteilung={null} />);
    expect(container.querySelector('.lfh-feld')).toBeNull();
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('bringt KEIN Status-Etikett mit — sonst stünden hier wieder bis zu acht Tags', () => {
    const { container } = render(
      <AmpelZelle
        bezeichnung="Fahrzeuge"
        verteilung={verteilung({ verfuegbar: 1, gebunden: 1, nicht_verfuegbar: 1, ohne: 1 })}
      />,
    );
    expect(container.querySelector('.ant-tag')).toBeNull();
  });
});
