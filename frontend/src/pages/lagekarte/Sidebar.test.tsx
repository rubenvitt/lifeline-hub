import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderMitProviders } from '../../test/utils';
import Sidebar from './Sidebar';
import type { SidebarProps } from './Sidebar';

const basisProps: SidebarProps = {
  einsatzId: 1,
  nichtVerortet: [],
  verortet: [],
  darfSchreiben: true,
  platzierungZiel: null,
  onPlatzierenStart: vi.fn(),
  onPlatzierenAbbrechen: vi.fn(),
  onAbschnittZeichnenStart: vi.fn(),
  onZoneZeichnenStart: vi.fn(),
  onKoordinateEingeben: vi.fn(),
  einsatzortVerortet: true,
  onEinsatzortPlatzieren: vi.fn(),
  layer: {
    einsatzort: true,
    uhs: true,
    schaden: true,
    einheit: true,
    fahrzeug: true,
    fuehrung: true,
    abschnitt: true,
    zone: true,
    lagemeldung: true,
  },
  onLayerToggle: vi.fn(),
  basemap: 'blind',
  onBasemapWechsel: vi.fn(),
  onMarkerWaehlen: vi.fn(),
  onlineVerfuegbar: false,
  offlineVerfuegbar: false,
  onlineStyles: [],
  onlineStilName: null,
  onOnlineStilWechsel: vi.fn(),
  fachebenenSichtbar: { nina: false, dwd: false, pegelonline: false, kritis: false },
  onFachebeneToggle: vi.fn(),
  fachebenenStatus: {},
  // Neue Bild-Props
  bilder: [],
  onBildUpload: vi.fn(),
  onBildToggle: vi.fn(),
  onBildOpazitaet: vi.fn(),
  onBildPlatzieren: vi.fn(),
  onBildPlatzierenFertig: vi.fn(),
  onBildLoeschen: vi.fn(),
  onBildZentrieren: vi.fn(),
  onBildUmbenennen: vi.fn(),
  onBildMittelpunkt: vi.fn(),
  bildPlatzierenId: null,
  bildPlatzierZentrum: null,
};

const bildLageplan = {
  id: 1,
  name: 'Lageplan',
  opazitaet: 80,
  sichtbar: true,
  einsatz_id: 7,
  mime: 'image/png',
  groesse: 1,
  ecken_json: '[]',
  reihenfolge: 0,
  hochgeladen_von: 1,
  erstellt_at: '',
  geaendert_at: '',
};

describe('Sidebar Bild-Hintergründe', () => {
  it('listet Bilder und schaltet Sichtbarkeit', () => {
    const onBildToggle = vi.fn();
    renderMitProviders(
      <Sidebar
        {...basisProps}
        darfSchreiben
        bilder={[{
          id: 1,
          name: 'Lageplan',
          opazitaet: 80,
          sichtbar: true,
          einsatz_id: 7,
          mime: 'image/png',
          groesse: 1,
          ecken_json: '[]',
          reihenfolge: 0,
          hochgeladen_von: 1,
          erstellt_at: '',
          geaendert_at: '',
        }]}
        onBildToggle={onBildToggle}
        bildPlatzierenId={null}
      />,
    );
    expect(screen.getByText('Lageplan')).toBeInTheDocument();
    const sw = screen.getByRole('switch', { name: /Lageplan/i });
    fireEvent.click(sw);
    expect(onBildToggle).toHaveBeenCalledWith(1, false);
  });

  it('ohne Schreibrecht kein Upload-Button', () => {
    renderMitProviders(
      <Sidebar
        {...basisProps}
        darfSchreiben={false}
        bilder={[]}
        bildPlatzierenId={null}
      />,
    );
    expect(screen.queryByText(/Bild hochladen/i)).not.toBeInTheDocument();
  });

  it('Zentrieren-Button fliegt die Karte auf das Bild (auch ohne Schreibrecht)', () => {
    const onBildZentrieren = vi.fn();
    renderMitProviders(
      <Sidebar
        {...basisProps}
        darfSchreiben={false}
        bilder={[bildLageplan]}
        onBildZentrieren={onBildZentrieren}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Lageplan zentrieren/i }));
    expect(onBildZentrieren).toHaveBeenCalledWith(1);
  });

  it('Platzier-Modus zeigt Mittelpunkt-Eingabe und beendet über „Fertig"', () => {
    const onBildPlatzierenFertig = vi.fn();
    renderMitProviders(
      <Sidebar
        {...basisProps}
        darfSchreiben
        bilder={[bildLageplan]}
        bildPlatzierenId={1}
        bildPlatzierZentrum={{ lat: 50, lon: 9 }}
        onBildPlatzierenFertig={onBildPlatzierenFertig}
      />,
    );
    // Hinweistext + „Mittelpunkt setzen" (zunächst disabled, kein Entwurf) erscheinen nur im Platzier-Modus.
    expect(screen.getByText(/frei strecken/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mittelpunkt setzen/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^Fertig$/i }));
    expect(onBildPlatzierenFertig).toHaveBeenCalled();
  });

  it('benennt ein Bild über die Inline-Bearbeitung um', () => {
    const onBildUmbenennen = vi.fn();
    renderMitProviders(
      <Sidebar
        {...basisProps}
        darfSchreiben
        bilder={[bildLageplan]}
        onBildUmbenennen={onBildUmbenennen}
      />,
    );
    // antd Typography editable: Edit-Auslöser hat aria-label „Umbenennen".
    fireEvent.click(screen.getByRole('button', { name: /Umbenennen/i }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Objektskizze' } });
    fireEvent.blur(input); // antd Editable committet bei Blur (und Enter-keyUp)
    expect(onBildUmbenennen).toHaveBeenCalledWith(1, 'Objektskizze');
  });
});
