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
  zeichenPlatzieren: null,
  onZeichenPlatzierenStart: vi.fn(),
  onZeichenPlatzierenAbbrechen: vi.fn(),
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
    freies_zeichen: true,
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
  kartenTheme: 'auto',
  onKartenThemeWechsel: vi.fn(),
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

  it('zeigt den Karten-Design-Umschalter nur im Offline-Modus und meldet die Wahl', () => {
    const onKartenThemeWechsel = vi.fn();
    const { rerender } = renderMitProviders(
      <Sidebar {...basisProps} basemap="online" onlineVerfuegbar onKartenThemeWechsel={onKartenThemeWechsel} />,
    );
    // Online: kein Karten-Design-Umschalter.
    expect(screen.queryByRole('radiogroup', { name: /Karten-Design/i })).not.toBeInTheDocument();
    // Offline: Umschalter da, Klick auf „Dunkel" meldet 'dark'.
    rerender(
      <Sidebar {...basisProps} basemap="offline" offlineVerfuegbar kartenTheme="auto" onKartenThemeWechsel={onKartenThemeWechsel} />,
    );
    fireEvent.click(screen.getByRole('radio', { name: /Dunkel/i }));
    expect(onKartenThemeWechsel).toHaveBeenCalledWith('dark');
  });

  it('schaltet den „Taktische Zeichen"-Ebenen-Toggle (LFH-170)', () => {
    const onLayerToggle = vi.fn();
    renderMitProviders(<Sidebar {...basisProps} onLayerToggle={onLayerToggle} />);
    const toggle = screen.getByText('Taktische Zeichen').closest('.ant-space')?.querySelector('button[role="switch"]');
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle as Element);
    expect(onLayerToggle).toHaveBeenCalledWith('freies_zeichen', false);
  });

  it('öffnet den Zeichen-Picker und startet das Platzieren mit der Entwurfs-Spec (LFH-170)', () => {
    const onZeichenPlatzierenStart = vi.fn();
    renderMitProviders(<Sidebar {...basisProps} onZeichenPlatzierenStart={onZeichenPlatzierenStart} />);
    // Picker ist zunächst geschlossen (kein Dauer-Combobox in der Sidebar).
    expect(screen.queryByLabelText('Grundzeichen')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Taktisches Zeichen platzieren' }));
    // Jetzt ist der Picker offen …
    expect(screen.getAllByLabelText('Grundzeichen').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Platzieren' }));
    expect(onZeichenPlatzierenStart).toHaveBeenCalledWith(
      expect.objectContaining({ grundzeichen: 'taktische-formation' }),
    );
  });

  it('zeigt im Platzier-Modus den Hinweis und meldet Abbrechen (LFH-170)', () => {
    const onZeichenPlatzierenAbbrechen = vi.fn();
    renderMitProviders(
      <Sidebar
        {...basisProps}
        zeichenPlatzieren={{ grundzeichen: 'taktische-formation' }}
        onZeichenPlatzierenAbbrechen={onZeichenPlatzierenAbbrechen}
      />,
    );
    expect(screen.getByText(/Auf Karte klicken zum Platzieren/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(onZeichenPlatzierenAbbrechen).toHaveBeenCalled();
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
