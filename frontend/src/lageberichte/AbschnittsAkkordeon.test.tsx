import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AbschnittsAkkordeon, befuellteAbschnitte } from './AbschnittsAkkordeon';
import { vorlage } from './vorlagen';

const acht = vorlage('lagebeurteilung')!.abschnitte;

function renderAkkordeon(befuellt: Set<string>, onOffen = vi.fn()) {
  return render(
    <AbschnittsAkkordeon
      abschnitte={acht}
      befuellt={befuellt}
      offen="auftrag"
      onOffen={onOffen}
      editor={(a) => <textarea aria-label={a.label} />}
    />,
  );
}

describe('AbschnittsAkkordeon', () => {
  // rc-collapse gibt den Kopfzeilen im Akkordeon-Modus die Rolle `tab` (sonst `button`).
  it('listet alle acht Abschnitte des Lagevortrags zur Entscheidung als Kopfzeilen', () => {
    renderAkkordeon(new Set());
    const koepfe = screen.getAllByRole('tab');
    expect(koepfe).toHaveLength(8);
  });

  it('markiert leere Abschnitte im Klartext, nicht nur farbig (WCAG 1.4.1)', () => {
    renderAkkordeon(new Set(['auftrag']));
    // Namen per Regex ans ENDE gebunden: antds Aufklapp-Pfeil trägt selbst `role="img"`
    // mit `aria-label="expanded"`/`"collapsed"` und steht am Anfang des Namens (gemessen:
    // „expanded Auftrag"). Das ist antds eigene Zustandsansage, nicht unsere Marke.
    expect(screen.getByRole('tab', { name: /Auftrag$/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Anlass des Lagevortrags \(leer\)$/ })).toBeInTheDocument();
    // UNSERE Ikonen sind dekorativ — kein eigenes Vorleseziel je Zeile. Der einzige `img`
    // je Kopfzeile ist antds Pfeil.
    expect(screen.queryByRole('img', { name: /check-circle|minus-circle/ })).toBeNull();
    for (const tab of screen.getAllByRole('tab')) expect(within(tab).getAllByRole('img')).toHaveLength(1);
  });

  it('hält genau EINEN Abschnitt offen, rendert aber alle Editoren (forceRender)', () => {
    renderAkkordeon(new Set());
    const offen = screen.getAllByRole('tab').filter((b) => b.getAttribute('aria-expanded') === 'true');
    expect(offen).toHaveLength(1);
    expect(within(offen[0]).getByText('Auftrag (leer)')).toBeInTheDocument();
    // Alle acht Textfelder stehen im DOM — sonst fehlten `Form` die Werte der
    // zugeklappten Abschnitte, und ein Speichern schickte sie leer.
    expect(screen.getAllByRole('textbox', { hidden: true })).toHaveLength(8);
  });

  it('meldet den angeklickten Abschnitt und nicht das Zuklappen', async () => {
    const onOffen = vi.fn();
    renderAkkordeon(new Set(), onOffen);
    await userEvent.click(screen.getByRole('tab', { name: /Entschlussvorschläge \(leer\)$/ }));
    expect(onOffen).toHaveBeenLastCalledWith('entschlussvorschlaege');
    await userEvent.click(screen.getByRole('tab', { name: /Auftrag \(leer\)$/ }));
    // Der offene Abschnitt (kontrolliert weiterhin „auftrag") zugeklappt → kein Aufruf.
    expect(onOffen).toHaveBeenCalledTimes(1);
  });
});

describe('befuellteAbschnitte', () => {
  it('zählt nur Text mit Inhalt', () => {
    expect(befuellteAbschnitte({ auftrag: '  ', anlass: 'x', titel: 'T' }, acht)).toEqual(new Set(['anlass']));
    expect(befuellteAbschnitte(undefined, acht)).toEqual(new Set());
  });
});
