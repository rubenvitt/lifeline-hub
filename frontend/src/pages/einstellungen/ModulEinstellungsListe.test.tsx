import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import ModulEinstellungsListe from './ModulEinstellungsListe';

/** Basis-Props der Einsatz-Ebene (drei Spalten, mit Sichtbar-Schalter). */
function einsatzProps() {
  return {
    rollenSpalte: 'Benötigte Rolle',
    darfVerwalten: true,
    laeuft: false,
    rolleVon: () => '',
    aufRolle: vi.fn(),
    sichtbarSpalte: {
      titel: 'Sichtbar',
      sichtbarVon: () => true,
      aufSichtbar: vi.fn(),
    },
  };
}

describe('ModulEinstellungsListe', () => {
  it('rendert mit Sichtbar-Spalte einen Switch je Modul', () => {
    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} />);

    expect(screen.getByText('Sichtbar')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Sichtbar: ETB' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Benötigte Rolle: ETB' })).toBeInTheDocument();
  });

  it('rendert ohne Sichtbar-Spalte gar keinen Switch (Org-Ebene kennt nur die Rolle)', () => {
    renderMitProviders(
      <ModulEinstellungsListe
        {...einsatzProps()}
        sichtbarSpalte={undefined}
        rollenSpalte="Benötigte Rolle (Default)"
      />,
    );

    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByText('Benötigte Rolle (Default)')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Benötigte Rolle: ETB' })).toBeInTheDocument();
  });

  it('meldet den Sichtbar-Schalter mit Modul-Key und neuem Zustand', async () => {
    const props = einsatzProps();
    renderMitProviders(<ModulEinstellungsListe {...props} />);

    fireEvent.click(screen.getByRole('switch', { name: 'Sichtbar: ETB' }));

    await waitFor(() =>
      expect(props.sichtbarSpalte.aufSichtbar).toHaveBeenCalledWith('etb', false),
    );
  });

  it('meldet die gewählte Rolle mit Modul-Key', async () => {
    const props = einsatzProps();
    renderMitProviders(<ModulEinstellungsListe {...props} />);

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Benötigte Rolle: ETB' }));
    fireEvent.click(await screen.findByText('Admin'));

    await waitFor(() => expect(props.aufRolle).toHaveBeenCalledWith('etb', 'admin'));
  });

  it('sperrt nicht-ausblendbare Module auch bei Verwaltungsrecht', () => {
    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} />);

    // 'einsatzdaten'/'einsatz-einstellungen' sind NICHT_AUSBLENDBARE_MODULE.
    expect(screen.getByRole('switch', { name: 'Sichtbar: Einsatzdaten' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Benötigte Rolle: Einsatzdaten' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Benötigte Rolle: ETB' })).not.toBeDisabled();
  });

  it('sperrt alles ohne Verwaltungsrecht und während einer laufenden Mutation', () => {
    const { unmount } = renderMitProviders(
      <ModulEinstellungsListe {...einsatzProps()} darfVerwalten={false} />,
    );
    expect(screen.getByRole('combobox', { name: 'Benötigte Rolle: ETB' })).toBeDisabled();
    unmount();

    renderMitProviders(<ModulEinstellungsListe {...einsatzProps()} laeuft />);
    expect(screen.getByRole('combobox', { name: 'Benötigte Rolle: ETB' })).toBeDisabled();
  });

  it('zeigt den Org-Erb-Hinweis unter dem Select, wenn einer geliefert wird', () => {
    renderMitProviders(
      <ModulEinstellungsListe
        {...einsatzProps()}
        hinweisVon={(key) => (key === 'etb' ? 'Org: Führungskraft' : undefined)}
      />,
    );

    expect(screen.getByText('Org: Führungskraft')).toBeInTheDocument();
  });

  it('zeigt den aktuellen Wert je Modul an (Rolle und Sichtbarkeit kommen von außen)', () => {
    renderMitProviders(
      <ModulEinstellungsListe
        {...einsatzProps()}
        rolleVon={(key) => (key === 'etb' ? 'fuehrungskraft' : '')}
        sichtbarSpalte={{
          titel: 'Sichtbar',
          sichtbarVon: (key) => key !== 'etb',
          aufSichtbar: vi.fn(),
        }}
      />,
    );

    expect(screen.getByRole('switch', { name: 'Sichtbar: ETB' })).not.toBeChecked();
    expect(screen.getByTitle('Führungskraft')).toBeInTheDocument();
  });
});
