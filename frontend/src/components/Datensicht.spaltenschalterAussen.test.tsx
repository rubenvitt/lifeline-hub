import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import { renderMitProviders as renderMitBasisProviders } from '../test/utils';
import Datensicht, { spaltenFuer, type Kartenplan } from './Datensicht';
import { SpaltenSchalter, useSpaltenSchalterZustand } from './SpaltenSchalter';

/**
 * Der Spaltenschalter bei der Seite (LLH-1417): die Seite hängt ihn in ihre eigene Werkzeugzeile
 * (Vorbild Meldebild), die `Datensicht` liest die Wahl über `spaltenSchalterAussen`. Getragen wird
 * vor allem die Zusicherung, dass sein Fokus die Zeilenschleuse NICHT schließt; die Gegenprobe ist
 * der eingebaute Schalter, dessen Fokus in der Sicht liegt und hält.
 */

interface Fahrzeug {
  id: number;
  funkrufname: string;
  fahrzeugtyp: string;
}

const F = (id: number, funkrufname: string): Fahrzeug => ({ id, funkrufname, fahrzeugtyp: 'LF' });
const DREI = [F(1, 'Florian 1'), F(2, 'Rotkreuz 2'), F(3, 'Florian 3')];
const VIER = [...DREI, F(4, 'Florian 4')];

const spalten = spaltenFuer<Fahrzeug>()([
  { key: 'funkrufname', title: 'Funkrufname', dataIndex: 'funkrufname', immerSichtbar: true },
  { key: 'typ', title: 'Typ', dataIndex: 'fahrzeugtyp' },
]);
type FahrzeugKey = (typeof spalten)[number]['key'];

const karte: Kartenplan<Fahrzeug, FahrzeugKey> = {
  art: 'plan',
  titel: { spalte: 'funkrufname', ziel: (f) => `/einsaetze/1/fahrzeuge?fahrzeug=${f.id}` },
};

function renderMitProviders(ui: ReactElement) {
  const ergebnis = renderMitBasisProviders(<CommandPaletteProvider>{ui}</CommandPaletteProvider>);
  return {
    ...ergebnis,
    rerender: (naechstes: ReactElement) =>
      ergebnis.rerender(<CommandPaletteProvider>{naechstes}</CommandPaletteProvider>),
  };
}

/** Eine Seite mit eigener Werkzeugzeile AUSSERHALB der Sicht, wie das Meldebild. */
function SeiteMitSchalter({ daten }: { daten: readonly Fahrzeug[] }) {
  const zustand = useSpaltenSchalterZustand<FahrzeugKey>();
  return (
    <>
      <div data-lfh="seiten-werkzeuge">
        <SpaltenSchalter bezeichnung="Fahrzeuge" spalten={spalten} {...zustand} />
      </div>
      <Datensicht<Fahrzeug, FahrzeugKey>
        bezeichnung="Fahrzeuge"
        form="tabelle"
        spalten={spalten}
        spaltenSchalterAussen={zustand}
        daten={daten}
        zeilenSchluessel="id"
        karte={karte}
      />
    </>
  );
}

function EingebauterSchalter({ daten }: { daten: readonly Fahrzeug[] }) {
  return (
    <Datensicht<Fahrzeug, FahrzeugKey>
      bezeichnung="Fahrzeuge"
      form="tabelle"
      spalten={spalten}
      daten={daten}
      zeilenSchluessel="id"
      karte={karte}
    />
  );
}

const zeilenZahl = (c: HTMLElement) => c.querySelectorAll('tr.ant-table-row').length;
const koepfe = (c: HTMLElement) =>
  [...c.querySelectorAll('th.ant-table-cell')].map((z) => z.textContent);
const spaltenKnopf = () => screen.getByRole('button', { name: /^Spalten/ });
const banner = () => screen.queryByRole('button', { name: /neuer Eintrag/ });
/** Das offene Menü des Schalters; antd lässt geschlossene Portale im Baum stehen. */
const spaltenMenue = () =>
  document.querySelector<HTMLElement>('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');

describe('Datensicht · Spaltenschalter bei der Seite (LLH-1417)', () => {
  it('steht nur in der Werkzeugzeile der Seite; die der Sicht bleibt als Standzeile', () => {
    const { container } = renderMitProviders(<SeiteMitSchalter daten={DREI} />);
    const seite = container.querySelector<HTMLElement>('[data-lfh="seiten-werkzeuge"]')!;
    const sicht = container.querySelector<HTMLElement>('[data-lfh="datensicht-werkzeuge"]');
    expect(within(seite).getByRole('button', { name: /^Spalten/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Spalten/ })).toHaveLength(1);
    expect(sicht, 'die Standzeile des Sammelbanners fehlt').not.toBeNull();
    expect(within(sicht!).queryByRole('button', { name: /^Spalten/ })).toBeNull();
  });

  it('der Fokus auf „Spalten“ friert die Tabelle nicht ein', () => {
    const { container, rerender } = renderMitProviders(<SeiteMitSchalter daten={DREI} />);
    spaltenKnopf().focus();
    expect(document.activeElement).toBe(spaltenKnopf());

    rerender(<SeiteMitSchalter daten={VIER} />);
    expect(zeilenZahl(container)).toBe(4);
    expect(banner()).toBeNull();
  });

  it('Gegenprobe: der Fokus auf einer Zeile hält die Sicht weiter', () => {
    const { container, rerender } = renderMitProviders(<SeiteMitSchalter daten={DREI} />);
    screen.getByRole('link', { name: 'Florian 1' }).focus();

    rerender(<SeiteMitSchalter daten={VIER} />);
    expect(zeilenZahl(container)).toBe(3);
    expect(banner()).toBeInTheDocument();
  });

  it('Gegenprobe: der Fokus auf dem eingebauten Schalter hält die Sicht', () => {
    // Darum muss der Schalter für eine Seitenwerkzeugzeile aus der Sicht heraus.
    const { container, rerender } = renderMitProviders(<EingebauterSchalter daten={DREI} />);
    spaltenKnopf().focus();

    rerender(<EingebauterSchalter daten={VIER} />);
    expect(zeilenZahl(container)).toBe(3);
    expect(banner()).toBeInTheDocument();
  });

  it('die Wahl am Schalter der Seite blendet in der Sicht aus und zählt', async () => {
    const { container } = renderMitProviders(<SeiteMitSchalter daten={DREI} />);
    expect(koepfe(container)).toContain('Typ');

    await userEvent.click(spaltenKnopf());
    const menue = await waitFor(() => {
      const m = spaltenMenue();
      expect(m).not.toBeNull();
      return m!;
    });
    await userEvent.click(within(menue).getByRole('checkbox', { name: 'Typ' }));

    await waitFor(() => expect(koepfe(container)).not.toContain('Typ'));
    expect(spaltenKnopf()).toHaveTextContent('Spalten · 1 ausgeblendet');
  });

  it('eine Umschaltung bei gehaltener Sicht ist eine Benutzeraktion und gibt den Zufluss frei', async () => {
    const { container, rerender } = renderMitProviders(<SeiteMitSchalter daten={DREI} />);

    // Menü öffnen, BEVOR eingefroren wird: antd zieht den Fokus nachgelagert ins Menü.
    await userEvent.click(spaltenKnopf());
    const menue = await waitFor(() => {
      const m = spaltenMenue();
      expect(m).not.toBeNull();
      return m!;
    });
    await waitFor(() => expect(menue.contains(document.activeElement)).toBe(true));

    screen.getByRole('link', { name: 'Florian 1' }).focus();
    rerender(<SeiteMitSchalter daten={VIER} />);
    expect(zeilenZahl(container)).toBe(3);
    expect(banner()).toBeInTheDocument();

    // `fireEvent`: der Fokus bleibt in der Sicht, gehalten wird also weiter.
    fireEvent.click(within(menue).getByRole('checkbox', { name: 'Typ' }));
    await waitFor(() => expect(koepfe(container)).not.toContain('Typ'));
    expect(zeilenZahl(container)).toBe(4);
    expect(banner()).toBeNull();
  });
});
