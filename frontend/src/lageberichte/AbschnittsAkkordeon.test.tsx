import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AbschnittsAkkordeon,
  befuellteAbschnitte,
  befuellungsKette,
  mengeAusKette,
} from './AbschnittsAkkordeon';
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
    // Namen ans ENDE gebunden: der Aufklapp-Pfeil ist ab antd 6.6 `aria-hidden`, den Zustand
    // trägt `aria-expanded`.
    expect(screen.getByRole('tab', { name: /Auftrag$/ })).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: /Anlass des Lagevortrags \(leer\)$/ }),
    ).toBeInTheDocument();
    // Unsere Ikonen sind dekorativ; auch der Pfeil ist verborgen, eine Kopfzeile trägt also gar
    // kein zugängliches `img`.
    expect(screen.queryByRole('img', { name: /check-circle|minus-circle/ })).toBeNull();
    for (const tab of screen.getAllByRole('tab'))
      expect(within(tab).queryAllByRole('img')).toHaveLength(0);
  });

  it('hält genau EINEN Abschnitt offen, rendert aber alle Editoren (forceRender)', () => {
    renderAkkordeon(new Set());
    const offen = screen
      .getAllByRole('tab')
      .filter((b) => b.getAttribute('aria-expanded') === 'true');
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
    expect(befuellteAbschnitte({ auftrag: '  ', anlass: 'x', titel: 'T' }, acht)).toEqual(
      new Set(['anlass']),
    );
    expect(befuellteAbschnitte(undefined, acht)).toEqual(new Set());
  });
});

/**
 * Die Memoisierung ist das Gate, nicht die Millisekunde: die Detailseite rendert über
 * `Form.useWatch([], form)` je Tastenanschlag neu, ohne Sperre laufen acht Editoren samt
 * `autoSize` mit. Ein Millisekunden-Deckel in e2e war auf dem CI-Runner nicht trennscharf;
 * hardwareunabhängig ist nur, ob der Teilbaum bei unveränderten Props neu rendert.
 */
describe('AbschnittsAkkordeon — Memoisierung (LFH-495 · N4)', () => {
  /** Zählt Aufrufe der `editor`-Render-Prop: einer je Abschnitt und Render des Akkordeons. */
  function zaehlend() {
    const aufrufe = { n: 0 };
    const editor = (a: { label: string }) => {
      aufrufe.n += 1;
      return <textarea aria-label={a.label} />;
    };
    return { aufrufe, editor };
  }

  it('rendert bei UNVERÄNDERTEN Props nicht neu', () => {
    const { aufrufe, editor } = zaehlend();
    // JE RENDER EIN NEUES ELEMENT mit gleichen Prop-Identitäten: bekommt `rerender` DASSELBE
    // Element-Objekt, überspringt React den Teilbaum selbst, und der Test wäre auch ohne `memo` grün.
    const props = {
      abschnitte: acht,
      befuellt: new Set<string>(),
      offen: 'auftrag',
      onOffen: vi.fn(),
      editor,
    };
    const { rerender } = render(<AbschnittsAkkordeon {...props} />);
    expect(aufrufe.n).toBe(8);
    rerender(<AbschnittsAkkordeon {...props} />);
    // Das ist die Aussage: der Elternteil rendert (je Anschlag), der Teilbaum nicht.
    expect(aufrufe.n).toBe(8);
  });

  it('rendert neu, sobald sich EINE Prop-Identität ändert (Gegenaussage)', () => {
    // Eine echte Änderung muss durchkommen. Deshalb müssen die Props identitätsstabil sein: ein
    // neues `Set` oder eine inline `editor`-Prop je Anschlag höbe die Sperre auf.
    const { aufrufe, editor } = zaehlend();
    const onOffen = vi.fn();
    const { rerender } = render(
      <AbschnittsAkkordeon
        abschnitte={acht}
        befuellt={new Set()}
        offen="auftrag"
        onOffen={onOffen}
        editor={editor}
      />,
    );
    expect(aufrufe.n).toBe(8);
    rerender(
      <AbschnittsAkkordeon
        abschnitte={acht}
        befuellt={new Set()}
        offen="auftrag"
        onOffen={onOffen}
        editor={editor}
      />,
    );
    expect(aufrufe.n).toBe(16);
  });
});

/**
 * Die Kette ist der Träger der Identitätsstabilität: als `useMemo`-Abhängigkeit hält sie
 * `befuellt` über Anschläge hinweg als DASSELBE `Set`.
 */
describe('befuellungsKette / mengeAusKette', () => {
  it('bleibt gleich, solange sich nur der TEXT ändert, nicht die Leere', () => {
    // Der eigentliche Zweck: vierzig Anschläge im selben Abschnitt ergeben eine Kette.
    const a = befuellungsKette({ auftrag: 'L' }, acht);
    const b = befuellungsKette({ auftrag: 'Lage unveraendert, Abschnitt fortgeschrieben' }, acht);
    expect(b).toBe(a);
  });

  it('kippt, wenn ein Abschnitt von leer auf befüllt geht', () => {
    const leer = befuellungsKette({}, acht);
    const eins = befuellungsKette({ auftrag: 'L' }, acht);
    expect(eins).not.toBe(leer);
    expect(eins[0]).toBe('1');
    expect(leer).toBe('0'.repeat(acht.length));
  });

  it('zählt Leerraum nicht als Text — gleichlautend mit `befuellteAbschnitte`', () => {
    expect(befuellungsKette({ auftrag: '   \n ' }, acht)).toBe('0'.repeat(acht.length));
  });

  it('ist die Umkehrung von `befuellteAbschnitte` (kein zweiter Wahrheitsbegriff)', () => {
    const werte = { auftrag: 'A', anlass: '  ', beurteilung_schadenlage: 'C' };
    const ausKette = mengeAusKette(befuellungsKette(werte, acht), acht);
    expect([...ausKette].sort()).toEqual([...befuellteAbschnitte(werte, acht)].sort());
  });
});
