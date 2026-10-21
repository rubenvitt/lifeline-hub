import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderMitProviders } from '../../test/utils';
import ModusBand from './ModusBand';
import type { PlatzierModus } from './PlatzierSteuerung';

/**
 * Modus-Band der Kartenleiste (LLH-1028): ab `lg` (`bedienung`) die ganze Bedienung des
 * Leistenmodus, unter `lg` nur Titel und Zusatzangaben — die Knöpfe stehen dann im Fuß-Band
 * (`PlatzierSteuerung.test.tsx`). Jedes „fehlt“ unter `lg` hat seine Gegenprobe ab `lg`.
 */

const platzieren: PlatzierModus = {
  art: 'platzieren',
  objekt: 'Einheit: Pumpe Ost',
  onAbbrechen: vi.fn(),
};
const zeichen = (anzahl: number): PlatzierModus => ({
  art: 'zeichen',
  serie: true,
  onSerieWechsel: vi.fn(),
  anzahl,
  onAbbrechen: vi.fn(),
  onFertig: vi.fn(),
});
const bild: PlatzierModus = {
  art: 'bild',
  name: 'Lageplan',
  griffModus: 'groesse',
  onGriffModus: vi.fn(),
  onFertig: vi.fn(),
};
const bildZusatz = (onMittelpunkt = vi.fn(), griffHinweis: string | null = null) => ({
  einsatzId: 1,
  griffHinweis,
  zentrum: { lat: 50, lon: 9 },
  onMittelpunkt,
});

describe('ModusBand: Platzieren', () => {
  it('ab lg: Titel, Koordinate und „Abbrechen“', () => {
    const onAbbrechen = vi.fn();
    renderMitProviders(
      <ModusBand
        modus={{ ...platzieren, onAbbrechen } as PlatzierModus}
        bedienung
        platzieren={{ einsatzId: 1, onKoordinate: vi.fn() }}
      />,
    );
    const band = document.querySelector('[data-lfh="platzieren-hinweis"]') as HTMLElement;
    expect(band).toHaveTextContent('Platzieren · Einheit: Pumpe Ost');
    expect(within(band).getByRole('button', { name: 'Übernehmen' })).toBeDisabled();
    fireEvent.click(within(band).getByRole('button', { name: 'Abbrechen' }));
    expect(onAbbrechen).toHaveBeenCalled();
  });

  it('unter lg: Titel und Koordinate, „Abbrechen“ steht im Fuß', () => {
    renderMitProviders(
      <ModusBand
        modus={platzieren}
        bedienung={false}
        platzieren={{ einsatzId: 1, onKoordinate: vi.fn() }}
      />,
    );
    expect(screen.getByText('Platzieren · Einheit: Pumpe Ost')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Übernehmen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abbrechen' })).not.toBeInTheDocument();
  });

  it('ungültige Koordinate sperrt „Übernehmen“ (LFH-517)', () => {
    const onKoordinate = vi.fn();
    renderMitProviders(
      <ModusBand modus={platzieren} bedienung platzieren={{ einsatzId: 1, onKoordinate }} />,
    );
    const feld = screen.getByPlaceholderText('Koordinate eingeben');
    const knopf = screen.getByRole('button', { name: 'Übernehmen' });
    fireEvent.focus(feld);
    fireEvent.change(feld, { target: { value: 'quatsch' } });
    fireEvent.blur(feld);
    expect(feld).toHaveValue('quatsch');
    expect(knopf).toBeDisabled();
    fireEvent.focus(feld);
    fireEvent.change(feld, { target: { value: '51.5, 10.25' } });
    fireEvent.click(knopf);
    expect(onKoordinate).toHaveBeenCalledWith(51.5, 10.25);
  });
});

describe('ModusBand: Taktisches Zeichen', () => {
  it('ab lg: Schalter „Weitere platzieren“, vor dem ersten Zeichen „Abbrechen“', () => {
    const modus = zeichen(0);
    renderMitProviders(<ModusBand modus={modus} bedienung />);
    expect(screen.getByText('Taktisches Zeichen')).toBeInTheDocument();
    const schalter = screen.getByRole('switch', { name: 'Weitere platzieren' });
    fireEvent.click(schalter);
    expect(modus.art === 'zeichen' && modus.onSerieWechsel).toHaveBeenCalledWith(
      false,
      expect.anything(),
    );
    expect(screen.queryByRole('button', { name: 'Fertig' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(modus.art === 'zeichen' && modus.onAbbrechen).toHaveBeenCalled();
  });

  it('ab lg: nach dem ersten Zeichen heißt Beenden „Fertig“ (LFH-332)', () => {
    const modus = zeichen(2);
    renderMitProviders(<ModusBand modus={modus} bedienung />);
    expect(screen.getByText('2 platziert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abbrechen' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Fertig' }));
    expect(modus.art === 'zeichen' && modus.onFertig).toHaveBeenCalled();
  });

  it('unter lg: kein Band — alles steht im Fuß', () => {
    renderMitProviders(<ModusBand modus={zeichen(2)} bedienung={false} />);
    expect(document.querySelector('[data-modus-band]')).toBeNull();
    // Kein Satz „Bedienung über der Karte“: das Band dort ist sichtbar (LFH-1083).
    expect(document.body).not.toHaveTextContent(/Bedienung über der Karte|Auf Karte klicken/);
  });
});

describe('ModusBand: Bild einpassen', () => {
  it('ab lg: Griffwahl, Mittelpunkt und „Fertig“', () => {
    renderMitProviders(<ModusBand modus={bild} bedienung bild={bildZusatz()} />);
    expect(screen.getByText('Bild einpassen · Lageplan')).toBeInTheDocument();
    const gruppe = screen.getByRole('radiogroup', { name: 'Griffe auf der Karte' });
    expect(within(gruppe).getByRole('radio', { name: 'Größe' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(within(gruppe).getByRole('radio', { name: 'Drehen' }));
    expect(bild.art === 'bild' && bild.onGriffModus).toHaveBeenCalledWith('drehen');
    expect(screen.getByRole('button', { name: /Mittelpunkt setzen/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^Fertig$/ }));
    expect(bild.art === 'bild' && bild.onFertig).toHaveBeenCalled();
  });

  it('unter lg: ohne Griffwahl und „Fertig“, die Mittelpunkt-Eingabe bleibt', () => {
    renderMitProviders(<ModusBand modus={bild} bedienung={false} bild={bildZusatz()} />);
    expect(screen.queryByRole('radiogroup', { name: 'Griffe auf der Karte' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Fertig$/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Mittelpunkt setzen/ })).toBeInTheDocument();
  });

  // LFH-517: eine ungültige Eingabe ist kein Mittelpunkt.
  it('ungültiger Mittelpunkt sperrt „Mittelpunkt setzen“ und bleibt stehen', () => {
    const onMittelpunkt = vi.fn();
    renderMitProviders(<ModusBand modus={bild} bedienung bild={bildZusatz(onMittelpunkt)} />);
    const feld = screen.getByPlaceholderText('Koordinate eingeben');
    const knopf = screen.getByRole('button', { name: /Mittelpunkt setzen/ });
    fireEvent.focus(feld);
    fireEvent.change(feld, { target: { value: '50.2 9.1' } });
    fireEvent.blur(feld);
    expect(feld).toHaveValue('50.2 9.1');
    expect(knopf).toBeDisabled();
    fireEvent.focus(feld);
    fireEvent.change(feld, { target: { value: '50.2, 9.1' } });
    fireEvent.click(knopf);
    expect(onMittelpunkt).toHaveBeenCalledWith(50.2, 9.1);
  });

  it('sagt, wenn die Karte Kantengriffe mangels Platz ausblendet (LFH-764)', () => {
    const { rerender } = renderMitProviders(
      <ModusBand
        modus={bild}
        bedienung
        bild={bildZusatz(vi.fn(), 'Kanten ausgeblendet · näher heranzoomen')}
      />,
    );
    const hinweis = () => document.querySelector('[data-lfh="bildgriff-hinweis"]')?.textContent;
    expect(hinweis()).toBe('Kanten ausgeblendet · näher heranzoomen');
    rerender(<ModusBand modus={bild} bedienung bild={bildZusatz()} />);
    expect(hinweis()).toBeUndefined();
  });
});

describe('ModusBand: Rückmeldung nach dem Verorten', () => {
  const verortet: PlatzierModus = {
    art: 'verortet',
    meldung: { kennung: 'R-005', onZurueck: vi.fn(), onBleiben: vi.fn() },
  };

  it('ab lg im Band', () => {
    renderMitProviders(<ModusBand modus={verortet} bedienung />);
    const band = document.querySelector('[data-lfh="verortet-hinweis"]') as HTMLElement;
    expect(band).toHaveTextContent('R-005 verortet');
    expect(within(band).getByRole('button', { name: 'Zurück zu R-005' })).toBeInTheDocument();
  });

  it('unter lg nicht — sie steht im Fuß', () => {
    renderMitProviders(<ModusBand modus={verortet} bedienung={false} />);
    expect(document.querySelector('[data-modus-band]')).toBeNull();
  });
});
