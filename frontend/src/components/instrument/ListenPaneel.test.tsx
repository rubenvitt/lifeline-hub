import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { dichten, farbenDunkel } from '../../theme/tokens';
import ListenPaneel, { ListenAbschnitt, listenZeileStil } from './ListenPaneel';

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

// LLH-1145: ein Abschnitt eines Paneels („Offene Vorgänge“).
describe('ListenAbschnitt', () => {
  function abschnitt(
    props: Partial<Parameters<typeof ListenAbschnitt<(typeof EINTRAEGE)[number]>>[0]> = {},
  ) {
    return renderMitProviders(
      <ListenAbschnitt
        titel="Aufträge"
        zahl={12}
        notiz="2 überfällig"
        zustand="daten"
        eintraege={EINTRAEGE}
        schluessel={(e) => e.id}
        zeile={(e) => <span>{e.text}</span>}
        sprung={{ ziel: '/auftraege', name: 'Aufträge' }}
        gesperrtText="nicht freigegeben"
        onNeuladen={vi.fn()}
        {...props}
      />,
    );
  }

  it('Kopf als Überschrift mit Zahl und „alle ↗“, darunter höchstens drei Einträge', () => {
    abschnitt();
    expect(screen.getByRole('heading', { level: 3, name: 'Aufträge' })).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'alle Aufträge' })).toHaveAttribute(
      'href',
      '/auftraege',
    );
  });

  it('leer ist eine Zeile „keine“, keine leere Fläche', () => {
    abschnitt({ eintraege: [] });
    expect(screen.getByText('keine')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('gesperrt: „—“ mit Grund, ohne Liste und ohne Sprung', () => {
    abschnitt({ zustand: 'gesperrt', zahl: null });
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('nicht freigegeben')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('die Zahl steht auch, wenn die Liste fehlt; ohne Netz nie „keine“', () => {
    abschnitt({ zustand: 'offline', eintraege: [] });
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('ohne Netz nicht geladen')).toBeInTheDocument();
    expect(screen.queryByText('keine')).toBeNull();
  });

  it('Laden und Fehler sind kein „keine“; der Fehler bietet „Erneut abrufen“', async () => {
    const onNeuladen = vi.fn();
    const { unmount } = abschnitt({ zustand: 'laden', eintraege: [], zahl: null });
    expect(screen.queryByText('keine')).toBeNull();
    expect(screen.getByText('—')).toBeInTheDocument();
    unmount();
    abschnitt({ zustand: 'fehler', eintraege: [], onNeuladen });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    screen.getByRole('button', { name: 'Erneut abrufen' }).click();
    expect(onNeuladen).toHaveBeenCalled();
  });
});
