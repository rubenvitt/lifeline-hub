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
    // Namen per Regex ans ENDE gebunden: antds Aufklapp-Pfeil trägt selbst `role="img"`
    // mit `aria-label="expanded"`/`"collapsed"` und steht am Anfang des Namens (gemessen:
    // „expanded Auftrag"). Das ist antds eigene Zustandsansage, nicht unsere Marke.
    expect(screen.getByRole('tab', { name: /Auftrag$/ })).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: /Anlass des Lagevortrags \(leer\)$/ }),
    ).toBeInTheDocument();
    // UNSERE Ikonen sind dekorativ — kein eigenes Vorleseziel je Zeile. Der einzige `img`
    // je Kopfzeile ist antds Pfeil.
    expect(screen.queryByRole('img', { name: /check-circle|minus-circle/ })).toBeNull();
    for (const tab of screen.getAllByRole('tab'))
      expect(within(tab).getAllByRole('img')).toHaveLength(1);
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
 * ── DIE MEMOISIERUNG IST DAS GATE, NICHT DIE MILLISEKUNDE (LFH-495 · N4) ───────────────────
 *
 * Die Detailseite rendert über `Form.useWatch([], form)` je Tastenanschlag neu; ohne Sperre
 * laufen acht Editoren samt `autoSize`-Nachmessung mit. Gemessen hat das p90 der Verzögerung
 * Anschlag-bis-Bild von 73 auf 43–48 ms gesenkt (`e2e/lagebericht-tippen.spec.ts`).
 *
 * WARUM DIE ZUSICHERUNG HIER STEHT UND NICHT ALS ZEITSCHWELLE IN DER e2e-SUITE: ein absoluter
 * Millisekunden-Deckel ist hardwareabhängig. Auf dem GitHub-Runner (2 vCPU, zwei
 * Playwright-Worker auf zwei Kernen) maß derselbe Stand p90 83,4 ms und im Wiederholversuch
 * 62,5 ms — ein Deckel von 60 ms war dort rot, obwohl die Memoisierung drin ist. Auch das
 * VERHÄLTNIS zur Kontrolle trägt nicht: 2,56 in einem Lauf, 1,74 im nächsten, während der
 * Stand OHNE Memoisierung im ruhigen Container bei 2,35 lag — die Bereiche überlappen, ein
 * Schwellwert darauf könnte richtig und falsch nicht trennen. Das ist die Lage, für die
 * CLAUDE.md „ein rot geborenes Gate wird abgeschaltet statt befolgt" schreibt.
 *
 * Was hardwareunabhängig IST: ob der Teilbaum bei unveränderten Props überhaupt neu rendert.
 * Das zählt dieser Test, deterministisch und ohne Uhr.
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
    // JE RENDER EIN NEUES ELEMENT mit gleichen Prop-IDENTITÄTEN — und das ist der Kern des
    // Tests, nicht Beiwerk: reicht man `rerender` DASSELBE Element-Objekt, überspringt React
    // den Teilbaum von sich aus (Bailout auf Element-Referenz), und der Test bliebe auch
    // ohne `memo` grün. Per Mutationsprobe gemessen: mit dem wiederverwendeten Element war
    // „memo entfernt" nicht von „memo drin" zu unterscheiden.
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
    // Die Sperre darf nicht alles verschlucken — eine echte Änderung muss durchkommen, und
    // genau darum ist die Identitätsstabilität der vier Props Pflicht: ein neues `Set` oder
    // eine inline `editor`-Prop je Anschlag hebt die Sperre auf, ohne etwas kaputt zu machen.
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
 * Die Kette ist der Träger der Identitätsstabilität: sie wird zur `useMemo`-Abhängigkeit der
 * Seite, damit `befuellt` über Anschläge hinweg DASSELBE `Set` bleibt.
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
