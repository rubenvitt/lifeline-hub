import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { dichten, farbenDunkel } from '../../theme/tokens';
import ListenPaneel, { listenZeileStil } from './ListenPaneel';

const EINTRAEGE = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, text: `Auftrag ${i + 1}` }));

function rendere(
  eintraege: typeof EINTRAEGE,
  zustand: 'daten' | 'laden' | 'fehler' | 'gesperrt' = 'daten',
) {
  return renderMitProviders(
    <ListenPaneel
      titel="Offene Aufträge"
      zustand={zustand}
      eintraege={eintraege}
      max={3}
      schluessel={(e) => e.id}
      zeile={(e) => <span>{e.text}</span>}
      weitere={{ ziel: '/auftraege', name: 'offene Aufträge' }}
      leerText="Keine offenen Aufträge."
      gesperrtText="Modul Aufträge nicht freigegeben."
      onNeuladen={vi.fn()}
    />,
  );
}

describe('ListenPaneel', () => {
  it('zeigt höchstens `max` Einträge und darunter „n weitere ↗“ als Link', () => {
    rendere(EINTRAEGE);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    const weitere = screen.getByRole('link', { name: '2 weitere offene Aufträge' });
    expect(weitere).toHaveAttribute('href', '/auftraege');
    expect(weitere).toHaveTextContent('2 weitere');
  });

  it('kein „weitere“, wenn alles passt', () => {
    rendere(EINTRAEGE.slice(0, 3));
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('eine leere Liste mit Daten ist der Leerzustand', () => {
    rendere([]);
    expect(screen.getByText('Keine offenen Aufträge.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('Laden und Fehler sind kein Leerzustand; gesperrt nennt den Grund', () => {
    const { unmount } = rendere([], 'laden');
    expect(screen.queryByText('Keine offenen Aufträge.')).toBeNull();
    unmount();
    const r = rendere([], 'fehler');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    r.unmount();
    rendere(EINTRAEGE, 'gesperrt');
    expect(screen.getByText('Modul Aufträge nicht freigegeben.')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).toBeNull();
  });
});

const tokenFuer = (stufe: keyof typeof dichten) => ({
  controlHeight: dichten[stufe].zeilenhoehe,
  paddingSM: dichten[stufe].abstand.sm,
  padding: dichten[stufe].abstand.md,
});

// Früher `zeilenzielStil` im Führungsüberblick, mit dem Baustein gehoben (LLH-1140).
describe('listenZeileStil — handgebautes Bedienziel (LFH-365: zwei Angaben)', () => {
  it('trägt den Boden aus controlHeight — 30 / 48 / 72 px (Literale)', () => {
    expect(listenZeileStil(farbenDunkel, tokenFuer('kompakt')).minHeight).toBe(30);
    expect(listenZeileStil(farbenDunkel, tokenFuer('komfortabel')).minHeight).toBe(48);
    expect(listenZeileStil(farbenDunkel, tokenFuer('handschuh')).minHeight).toBe(72);
  });

  it('die Polsterung zieht über die Stufen mit, statt festzukleben', () => {
    const k = listenZeileStil(farbenDunkel, tokenFuer('kompakt'));
    const h = listenZeileStil(farbenDunkel, tokenFuer('handschuh'));
    expect(k.paddingBlock).toBeLessThan(h.paddingBlock as number);
    expect(k.paddingInline).toBeLessThan(h.paddingInline as number);
  });
});
