import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import Statusband from './Statusband';
import type { BandZelle } from './meldebildRaster';

function zelle(
  schluessel: string,
  ton: BandZelle['ton'],
  wert = 1,
  code: string | null = schluessel.toUpperCase(),
): BandZelle {
  return { schluessel, code, wert, wort: `Wort ${schluessel}`, ton };
}

const RUECKMELDUNG: BandZelle = {
  schluessel: 'rueckmeldung-keine',
  code: null,
  wert: 2,
  wort: 'keine Rückmeldung',
  ton: 'alarm',
};

const basis = { onNeuladen: () => undefined, rueckmeldungZiel: '/meldungen' };

/** Das Paneel einer Gruppe — ein `section`, benannt über seine Augenbraue. */
const paneel = (name: string) => screen.getByRole('region', { name });

/** Die Kennzahl in ihrer Region (Rückmeldung, Zulauf). */
const kennzahl = (name: string) =>
  paneel(name).querySelector('[data-lfh="kennzahl"]') as HTMLElement;

describe('Statusband (Verteilungspaneele, LLH-1140)', () => {
  it('Einheiten nach FMS-Status: je Status Code, Wort, Zahl und Balken; die Summe im Kopf', () => {
    const { container } = renderMitProviders(
      <Statusband
        {...basis}
        einheiten={[
          zelle('s3', 'achtung', 2),
          zelle('s4', 'achtung', 1),
          zelle('x', 'neutral', 1, null),
        ]}
        personal={[]}
        zustand="daten"
      />,
    );
    const p = paneel('Einheiten nach FMS-Status');
    expect(within(p).getByText('4 Einheiten')).toBeInTheDocument();
    const zeilen = within(p).getAllByRole('listitem');
    expect(zeilen.map((z) => z.textContent)).toEqual(['S3Wort s32', 'S4Wort s41', 'Wort x1']);
    // Der Balken ergänzt die Zahl, er ersetzt sie nicht: Anteil an der Summe.
    const balken = p.querySelectorAll<HTMLElement>('[data-lfh="statusband-einheit-anteil"]');
    expect([...balken].map((b) => b.style.width)).toEqual(['50%', '25%', '25%']);
    // Keine Füllkachel (Spec `kraeftebaum`, „Statusband ohne Füllkacheln“).
    expect(container.querySelectorAll('[data-lfh="meldebild-bandluecke"]')).toHaveLength(0);
  });

  it('Personal nach Status als eigenes Paneel', () => {
    renderMitProviders(
      <Statusband
        {...basis}
        einheiten={[]}
        personal={[zelle('p1', 'achtung', 12, null)]}
        zustand="daten"
      />,
    );
    const p = paneel('Personal nach Status');
    expect(within(p).getByText('12 Kräfte')).toBeInTheDocument();
    expect(p.querySelector('[data-lfh="statusband-personal-wert"]')).toHaveTextContent(/^12$/);
  });

  it.each([1440, 1024, 390])('bei %i px zwei Paneele, keine leere Kachel', (breite) => {
    setzeViewportBreite(breite);
    const { container } = renderMitProviders(
      <Statusband
        {...basis}
        einheiten={[zelle('s4', 'achtung', 3)]}
        personal={[zelle('p1', 'achtung', 12, null)]}
        zustand="daten"
      />,
    );
    expect(container.querySelectorAll('[data-lfh="paneel"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-lfh="meldebild-bandluecke"]')).toHaveLength(0);
  });

  it('„keine Rückmeldung“ als Kennzahl mit Sprung, nur wenn es sie gibt (LFH-610)', () => {
    const { rerender } = renderMitProviders(
      <Statusband
        {...basis}
        einheiten={[zelle('s4', 'achtung', 3)]}
        personal={[]}
        rueckmeldung={RUECKMELDUNG}
        zustand="daten"
      />,
    );
    const k = paneel('Einheiten ohne Rückmeldung').querySelector(
      '[data-lfh="kennzahl"]',
    ) as HTMLElement;
    expect(k).toHaveAttribute('data-ton', 'alarm');
    expect(k).toHaveTextContent('2');
    expect(k).toHaveTextContent('keine Rückmeldung');
    expect(k).toHaveAttribute('href', '/meldungen');
    rerender(
      <Statusband
        {...basis}
        einheiten={[zelle('s4', 'achtung', 3)]}
        personal={[]}
        zustand="daten"
      />,
    );
    expect(screen.queryByRole('region', { name: 'Einheiten ohne Rückmeldung' })).toBeNull();
  });

  it('ohne Ziel (Meldungen gesperrt) steht die Kennzahl ohne Link', () => {
    renderMitProviders(
      <Statusband
        onNeuladen={() => undefined}
        einheiten={[zelle('s4', 'achtung', 3)]}
        personal={[]}
        rueckmeldung={RUECKMELDUNG}
        zustand="daten"
      />,
    );
    const p = paneel('Einheiten ohne Rückmeldung');
    expect(within(p).queryByRole('link')).toBeNull();
  });

  it('der Hinweis zu Mittelfiltern steht als Marke im Kopf der Einheiten', () => {
    renderMitProviders(
      <Statusband
        {...basis}
        einheiten={[zelle('s4', 'achtung', 3)]}
        einheitenHinweis="ungefiltert"
        personal={[]}
        zustand="daten"
      />,
    );
    expect(
      paneel('Einheiten nach FMS-Status').querySelector('[data-lfh="statusband-hinweis"]'),
    ).toHaveTextContent(/^ungefiltert$/);
  });

  it('Zulauf aus Nachforderungen als eigene Kennzahl mit Ziel Board, nur wenn es ihn gibt (LLH-1384)', () => {
    const { rerender } = renderMitProviders(
      <Statusband
        {...basis}
        einheiten={[zelle('s4', 'achtung', 3)]}
        personal={[]}
        zulauf={{
          wert: 2,
          notiz: '+2 RTW, Eintreffen 15:30',
          ton: 'neutral',
          eintraege: [],
        }}
        zulaufZiel="/einsaetze/1/nachforderungen"
        zustand="daten"
      />,
      { route: '/einsaetze/1/kraefteuebersicht' },
    );
    const k = kennzahl('Zulauf aus Nachforderungen');
    expect(k.querySelector('[data-lfh="kennzahl-wert"]')).toHaveTextContent(/^2$/);
    expect(k).toHaveTextContent('+2 RTW, Eintreffen 15:30');
    expect(k.closest('a') ?? k.querySelector('a')).toHaveAttribute(
      'href',
      '/einsaetze/1/nachforderungen',
    );
    rerender(
      <Statusband
        {...basis}
        einheiten={[zelle('s4', 'achtung', 3)]}
        personal={[]}
        zustand="daten"
      />,
    );
    expect(screen.queryByRole('region', { name: 'Zulauf aus Nachforderungen' })).toBeNull();
  });

  it('überfälliger Zulauf tönt achtung, das Wort steht in der Notiz', () => {
    renderMitProviders(
      <Statusband
        {...basis}
        einheiten={[]}
        personal={[]}
        zulauf={{
          wert: 2,
          notiz: '+2 RTW, Eintreffen 13:30 überfällig',
          ton: 'achtung',
          eintraege: [],
        }}
        zustand="daten"
      />,
    );
    const k = kennzahl('Zulauf aus Nachforderungen');
    expect(k).toHaveAttribute('data-ton', 'achtung');
    expect(k).toHaveTextContent('überfällig');
  });

  it('leer: der Satz statt einer Null-Liste', () => {
    renderMitProviders(<Statusband {...basis} einheiten={[]} personal={[]} zustand="daten" />);
    expect(
      within(paneel('Einheiten nach FMS-Status')).getByText('Keine Einheiten gebildet.'),
    ).toBeInTheDocument();
    expect(
      within(paneel('Personal nach Status')).getByText('Kein Personal erfasst.'),
    ).toBeInTheDocument();
  });

  it('laden: benannter Ladezustand statt einer Null', () => {
    renderMitProviders(<Statusband {...basis} einheiten={[]} personal={[]} zustand="laden" />);
    expect(screen.getByLabelText('Einheiten nach FMS-Status wird geladen')).toBeInTheDocument();
    expect(screen.queryByText('Keine Einheiten gebildet.')).toBeNull();
  });

  it('Fehler: „Stand unbekannt“ und Neuladen, nie eine Null', () => {
    const onNeuladen = vi.fn();
    renderMitProviders(
      <Statusband onNeuladen={onNeuladen} einheiten={[]} personal={[]} zustand="fehler" />,
    );
    const alarme = screen.getAllByRole('alert');
    expect(alarme).toHaveLength(2);
    fireEvent.click(within(alarme[0]).getByRole('button', { name: 'Erneut abrufen' }));
    expect(onNeuladen).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('0')).toBeNull();
  });
});
