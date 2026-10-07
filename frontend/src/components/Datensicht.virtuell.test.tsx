import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import { renderMitProviders as renderMitBasisProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import Datensicht, {
  DATENSICHT_SCHWELLE,
  HERVORGEHOBEN,
  spaltenFuer,
  type Kartenplan,
} from './Datensicht';

/**
 * Virtualisierung großer Listen (LFH-949, Entscheidung Ruben 07.10.2026): ab 201 Zeilen rendert
 * `Datensicht` nur den Sichtbereich plus Überhang, Platzhalter tragen die übrige Höhe. jsdom hat kein
 * Layout: alle Rechtecke liegen bei 0, das Fenster ist 768 px hoch. Der Bildlauf wird über das
 * Rechteck des oberen Platzhalters vorgetäuscht.
 */

function renderMitProviders(ui: ReactElement) {
  const ergebnis = renderMitBasisProviders(<CommandPaletteProvider>{ui}</CommandPaletteProvider>);
  return {
    ...ergebnis,
    rerender: (naechstes: ReactElement) =>
      ergebnis.rerender(<CommandPaletteProvider>{naechstes}</CommandPaletteProvider>),
  };
}

interface Person {
  id: number;
  name: string;
  gruppe: string;
}

const P = (id: number): Person => ({
  id,
  name: `Person ${id}`,
  gruppe: id % 2 ? 'ungerade' : 'gerade',
});
const viele = (n: number, ab = 0) => Array.from({ length: n }, (_, i) => P(ab + i));

const spalten = spaltenFuer<Person>()([
  { key: 'name', title: 'Name', dataIndex: 'name', immerSichtbar: true, suchText: (p) => p.name },
  { key: 'gruppe', title: 'Gruppe', dataIndex: 'gruppe' },
]);
type SpaltenKey = (typeof spalten)[number]['key'];
const karte: Kartenplan<Person, SpaltenKey> = {
  art: 'plan',
  titel: { spalte: 'name' },
  sekundaer: ['gruppe'],
};

function Sicht(props: {
  daten: readonly Person[];
  form?: 'tabelle' | 'karte';
  hervorgehoben?: number;
  gruppiert?: boolean;
}) {
  return (
    <Datensicht<Person, SpaltenKey>
      bezeichnung="Personen"
      spalten={spalten}
      daten={props.daten}
      zeilenSchluessel="id"
      karte={karte}
      form={props.form ?? 'tabelle'}
      suche={{ platzhalter: 'Name' }}
      gruppen={
        props.gruppiert
          ? { schluessel: (p) => p.gruppe, etikett: (w) => w, unterEbene: 2 }
          : undefined
      }
      zeilenKlasse={(p) => (p.id === props.hervorgehoben ? HERVORGEHOBEN : undefined)}
    />
  );
}

const zeilen = () => document.querySelectorAll('tbody tr[data-row-key]');
const karten = () => document.querySelectorAll('[data-lfh="datensicht-karte"]');
const platzhalter = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-lfh="datensicht-platzhalter"]'));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Datensicht virtualisiert große Listen (LFH-949)', () => {
  it('die Schwelle liegt bei 200 Zeilen', () => {
    expect(DATENSICHT_SCHWELLE).toBe(200);
  });

  it('Tabelle mit 1 000 Zeilen: nur ein Ausschnitt im DOM, Platzhalter tragen den Rest', () => {
    setzeViewportBreite(1440);
    renderMitProviders(<Sicht daten={viele(1000)} />);
    const n = zeilen().length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(100);
    expect(zeilen()[0].getAttribute('data-row-key')).toBe('0');
    const [oben, unten] = platzhalter();
    expect(oben).toBeDefined();
    expect(parseFloat(unten.querySelector('td')!.style.height)).toBeGreaterThan(0);
    // Vorlesen: Zeile x von 1 000. Die stehende Kopfzeile ist eine eigene Tabelle, gezählt werden
    // die Datenzeilen.
    expect(document.querySelector('table[aria-rowcount="1000"]')).not.toBeNull();
    expect(zeilen()[0].getAttribute('aria-rowindex')).toBe('1');
  });

  it('bis 200 Zeilen bleibt alles wie bisher: alle Zeilen, kein Platzhalter', () => {
    setzeViewportBreite(1440);
    renderMitProviders(<Sicht daten={viele(200)} />);
    expect(zeilen()).toHaveLength(200);
    expect(platzhalter()).toHaveLength(0);
    expect(document.querySelector('table[aria-rowcount]')).toBeNull();
  });

  it('Karten mit 1 000 Zeilen: nur ein Ausschnitt, auch gruppiert; Köpfe zählen die ganze Gruppe', () => {
    setzeViewportBreite(390);
    renderMitProviders(<Sicht daten={viele(1000)} form="karte" gruppiert />);
    expect(karten().length).toBeGreaterThan(0);
    expect(karten().length).toBeLessThan(100);
    expect(platzhalter()).toHaveLength(2);
    expect(screen.getByText('500 gerade')).toBeInTheDocument();
  });

  it('der Bildlauf verschiebt den Ausschnitt', async () => {
    setzeViewportBreite(1440);
    renderMitProviders(<Sicht daten={viele(1000)} />);
    const rechteck = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const echt = rechteck.call(this);
      // Der obere Platzhalter liegt 30 000 px über der Fensterkante: so weit ist gerollt.
      return this.matches('[data-lfh="datensicht-platzhalter"]:first-of-type')
        ? ({ ...echt, top: -30_000, bottom: -30_000, y: -30_000 } as DOMRect)
        : echt;
    });
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    await waitFor(() => expect(zeilen()[0].getAttribute('data-row-key')).not.toBe('0'));
    const erste = Number(zeilen()[0].getAttribute('data-row-key'));
    expect(erste).toBeGreaterThan(200);
    expect(zeilen()[0].getAttribute('aria-rowindex')).toBe(String(erste + 1));
    expect(parseFloat(platzhalter()[0].querySelector('td')!.style.height)).toBeGreaterThan(0);
  });

  it('die Schleuse hält Zuwachs auch im virtualisierten Bereich zurück', () => {
    setzeViewportBreite(1440);
    const { rerender } = renderMitProviders(<Sicht daten={viele(1000)} />);
    fireEvent.focus(screen.getByRole('searchbox', { name: 'Suche in Personen' }));
    rerender(<Sicht daten={[P(5000), ...viele(1000)]} />);
    expect(zeilen()[0].getAttribute('data-row-key')).toBe('0');
    expect(screen.getByRole('button', { name: /1 neuer Eintrag/ })).toBeInTheDocument();
  });

  it('ein Deeplink weit unten rendert seine Zeile', async () => {
    setzeViewportBreite(1440);
    renderMitProviders(<Sicht daten={viele(1000)} hervorgehoben={700} />);
    await waitFor(() => expect(document.querySelector('tr[data-row-key="700"]')).not.toBeNull());
    expect(document.querySelector('tr[data-row-key="0"]')).toBeNull();
  });
});
