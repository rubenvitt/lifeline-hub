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
  // Serienmodus (LFH-332): der Zähler steht hier auf 0 — die Basis ist der Zustand VOR dem
  // ersten gesetzten Zeichen, in dem Beenden noch „Abbrechen" heißt. Den Gegenzustand baut
  // der eigene Block unten explizit auf.
  zeichenSerie: true,
  onZeichenSerieWechsel: vi.fn(),
  zeichenSerieAnzahl: 0,
  onZeichenPlatzierenFertig: vi.fn(),
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
  ansichtDirty: false,
  ansichtSpeichert: false,
  onAnsichtSpeichern: vi.fn(),
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
  onBildVerschieben: vi.fn(),
  onBildZentrieren: vi.fn(),
  onBildUmbenennen: vi.fn(),
  onBildMittelpunkt: vi.fn(),
  bildPlatzierenId: null,
  bildPlatzierZentrum: null,
  ansichten: [],
  aktiveAnsichtId: undefined,
  onAnsichtWaehlen: vi.fn(),
  onAnsichtNeu: vi.fn(),
  onAnsichtUmbenennen: vi.fn(),
  onAnsichtStandard: vi.fn(),
  onAnsichtLoeschen: vi.fn(),
  ansichtBusy: false,
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

  /**
   * Serienmodus (LFH-332/M76). Die beiden Fälle sind ein Paar: erst nachdem gezeigt ist,
   * dass VOR dem ersten Zeichen „Abbrechen" steht (Fall oben, `zeichenSerieAnzahl: 0`),
   * sagt das Auftauchen von „Fertig" etwas aus. Sonst wäre es nur ein Knopf, der da ist.
   */
  it('Serienmodus: Schalter „Weitere platzieren" meldet das Umlegen (LFH-332)', () => {
    const onZeichenSerieWechsel = vi.fn();
    renderMitProviders(
      <Sidebar
        {...basisProps}
        zeichenPlatzieren={{ grundzeichen: 'taktische-formation' }}
        zeichenSerie
        onZeichenSerieWechsel={onZeichenSerieWechsel}
      />,
    );
    const schalter = screen.getByRole('switch', { name: 'Weitere platzieren' });
    expect(schalter).toBeChecked();
    fireEvent.click(schalter);
    expect(onZeichenSerieWechsel).toHaveBeenCalledWith(false, expect.anything());
  });

  it('Serienmodus: ab dem ersten gesetzten Zeichen heißt Beenden „Fertig" (LFH-332)', () => {
    const onZeichenPlatzierenFertig = vi.fn();
    renderMitProviders(
      <Sidebar
        {...basisProps}
        zeichenPlatzieren={{ grundzeichen: 'taktische-formation' }}
        zeichenSerie
        zeichenSerieAnzahl={2}
        onZeichenPlatzierenFertig={onZeichenPlatzierenFertig}
      />,
    );
    expect(screen.getByText('2 platziert')).toBeInTheDocument();
    // „Abbrechen" wäre hier die Unwahrheit: die zwei gesetzten Zeichen bleiben stehen.
    expect(screen.queryByRole('button', { name: 'Abbrechen' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fertig' }));
    expect(onZeichenPlatzierenFertig).toHaveBeenCalled();
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

/**
 * Fehler-Slots je Sektion (LFH-331 · B3).
 *
 * Jedes Paar hier ist eine AK4-Klammer: die „nicht im DOM"-Hälfte allein belegte nichts,
 * weil der Text im selben Umbau entstanden ist. Erst die Partnerhälfte mit dem BYTE-GLEICHEN
 * Literal macht daraus eine Aussage über die Zustandsweiche.
 */
describe('Sidebar Fehler-Slots', () => {
  const slot = { text: 'Objektlisten konnten nicht geladen werden', onWiederholen: vi.fn() };

  it('„Nicht verortet": Fehler-Slot statt der Erfolgsmeldung', () => {
    renderMitProviders(
      <Sidebar {...basisProps} nichtVerortet={[]} sektionFehler={{ nichtVerortet: slot }} />,
    );
    expect(screen.getByText('Objektlisten konnten nicht geladen werden')).toBeInTheDocument();
    // Der Kern der Sache: „Alles verortet" ist eine ERFOLGS-Aussage. Sie darf nicht stehen,
    // wenn niemand weiß, ob überhaupt etwas geladen wurde.
    expect(screen.queryByText('Alles verortet')).not.toBeInTheDocument();
  });

  it('„Nicht verortet": ohne Fehler die Erfolgsmeldung und keinen Slot', () => {
    const { container } = renderMitProviders(<Sidebar {...basisProps} nichtVerortet={[]} />);
    expect(screen.getByText('Alles verortet')).toBeInTheDocument();
    expect(screen.queryByText('Objektlisten konnten nicht geladen werden')).not.toBeInTheDocument();
    /**
     * Getauscht ist der Knoten, nicht der Wortlaut (LFH-331 · B3). „Alles verortet" ist
     * ein ERFOLGS-, kein Leerzustand: er bekommt deshalb keine Primäraktion — es gibt
     * nichts anzulegen, wenn alles verortet ist.
     */
    expect(container.querySelector('.ant-empty')).toBeNull();
  });

  /**
   * Der Kern von D3/D5: **ein Fehler ersetzt Inhalt nur, wenn es keinen Inhalt gibt.**
   *
   * Die Zeilen unter „Nicht verortet" tragen die EINZIGE Bedienung zum Verorten
   * („Platzieren" / „Fläche zeichnen"). Fällt eine der elf Lagebild-Quellen aus, während
   * die übrigen zehn Zeilen im Zwischenspeicher stehen, nähme ein Vollersatz der Sektion
   * der Einsatzkraft die Fähigkeit weg, ein Objekt zu verorten — wegen eines Fehlers, der
   * dieses Objekt gar nicht betrifft.
   *
   * Deshalb steht der Fehler hier als D5-Banner ÜBER den Zeilen, nicht an ihrer Stelle.
   */
  it('„Nicht verortet": mit Zeilen im Zwischenspeicher bleibt die Liste samt Bedienung stehen', () => {
    const onPlatzierenStart = vi.fn();
    renderMitProviders(
      <Sidebar
        {...basisProps}
        darfSchreiben
        nichtVerortet={[{ typ: 'uhs', id: 42, label: 'UHS Nord' }]}
        sektionFehler={{ nichtVerortet: slot }}
        onPlatzierenStart={onPlatzierenStart}
      />,
    );
    // Der Fehler wird gemeldet — aber als Banner, das den Stand als alt kennzeichnet.
    expect(screen.getByText(/nicht aktualisiert werden/i)).toBeInTheDocument();
    // Die Zeile aus dem Zwischenspeicher steht weiter da …
    expect(screen.getByText(/UHS: UHS Nord/)).toBeInTheDocument();
    // … und die einzige Bedienung zum Verorten ist bedienbar geblieben.
    fireEvent.click(screen.getByRole('button', { name: 'Platzieren' }));
    expect(onPlatzierenStart).toHaveBeenCalledWith({ typ: 'uhs', id: 42 });
  });

  it('„Bild-Hintergründe": Fehler-Slot, der Upload bleibt bedienbar', () => {
    renderMitProviders(
      <Sidebar
        {...basisProps}
        darfSchreiben
        bilder={[]}
        sektionFehler={{ bilder: { text: 'Bild-Hintergründe konnten nicht geladen werden', onWiederholen: vi.fn() } }}
      />,
    );
    expect(screen.getByText('Bild-Hintergründe konnten nicht geladen werden')).toBeInTheDocument();
    // Der Upload hängt nicht an der Leseliste — ihn mit auszublenden nähme eine Fähigkeit weg,
    // die intakt ist.
    expect(screen.getByText(/Bild hochladen/i)).toBeInTheDocument();
  });

  it('„Bild-Hintergründe": ohne Fehler kein Slot', () => {
    renderMitProviders(<Sidebar {...basisProps} darfSchreiben bilder={[]} />);
    expect(screen.queryByText('Bild-Hintergründe konnten nicht geladen werden')).not.toBeInTheDocument();
    expect(screen.getByText(/Bild hochladen/i)).toBeInTheDocument();
  });

  /**
   * Dieselbe Regel an der zweiten Stelle — hier mit einer eigenen Schärfe: die Bild-Overlays
   * liegen weiterhin sichtbar auf der KARTE. Verschwindet nur ihre Bedienleiste, bleibt das
   * Bild liegen und lässt sich nicht mehr abschalten — der Fehler nähme die Fähigkeit weg,
   * seine eigene Folge zu beheben.
   */
  it('„Bild-Hintergründe": mit Bildern im Zwischenspeicher bleibt die Liste bedienbar', () => {
    const onBildToggle = vi.fn();
    renderMitProviders(
      <Sidebar
        {...basisProps}
        darfSchreiben
        bilder={[bildLageplan]}
        onBildToggle={onBildToggle}
        sektionFehler={{ bilder: { text: 'Bild-Hintergründe konnten nicht geladen werden', onWiederholen: vi.fn() } }}
      />,
    );
    expect(screen.getByText('Bild-Hintergründe konnten nicht geladen werden')).toBeInTheDocument();
    // Der Schalter, der das Overlay von der Karte nimmt, ist der Punkt der Sache.
    fireEvent.click(screen.getByRole('switch', { name: /Lageplan/i }));
    expect(onBildToggle).toHaveBeenCalledWith(1, false);
  });

  it('Ansichts-Switcher: Fehler-Slot statt eines stumm leeren Kopfes', () => {
    // `AnsichtSwitcher` liefert bei leerer Liste `null` — ein gescheiterter Abruf ist heute
    // von „noch nicht geladen" nicht zu unterscheiden und damit unsichtbar.
    renderMitProviders(
      <Sidebar
        {...basisProps}
        ansichten={[]}
        sektionFehler={{ ansichten: { text: 'Kartenansichten konnten nicht geladen werden', onWiederholen: vi.fn() } }}
      />,
    );
    expect(screen.getByText('Kartenansichten konnten nicht geladen werden')).toBeInTheDocument();
  });

  it('Ansichts-Switcher: ohne Fehler kein Slot', () => {
    renderMitProviders(<Sidebar {...basisProps} ansichten={[]} />);
    expect(screen.queryByText('Kartenansichten konnten nicht geladen werden')).not.toBeInTheDocument();
  });

  /**
   * Die Karte „Verortet" bekommt bewusst KEINEN eigenen Fehlerkasten (siehe
   * `SidebarSektionFehler`), aber ihre Zahlen dürfen trotzdem nicht lügen: „UHS (0)" ist im
   * Fehlerfall eine Behauptung über die Lage, die niemand geprüft hat.
   */
  it('„Verortet": die Zählungen zeigen im Fehlerfall keinen Nullwert', () => {
    renderMitProviders(
      <Sidebar {...basisProps} verortet={[]} sektionFehler={{ nichtVerortet: slot }} />,
    );
    expect(screen.getByText('UHS (—)')).toBeInTheDocument();
    expect(screen.getByText('Schäden (—)')).toBeInTheDocument();
    expect(screen.queryByText('UHS (0)')).not.toBeInTheDocument();
  });

  it('„Verortet": ohne Fehler zählen sie wie bisher', () => {
    renderMitProviders(<Sidebar {...basisProps} verortet={[]} />);
    expect(screen.getByText('UHS (0)')).toBeInTheDocument();
    expect(screen.queryByText('UHS (—)')).not.toBeInTheDocument();
  });

  it('der Slot bietet den erneuten Abruf unter dem einen Wortlaut an', () => {
    const onWiederholen = vi.fn();
    renderMitProviders(
      <Sidebar
        {...basisProps}
        nichtVerortet={[]}
        sektionFehler={{ nichtVerortet: { text: 'Objektlisten konnten nicht geladen werden', onWiederholen } }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Erneut abrufen' }));
    expect(onWiederholen).toHaveBeenCalled();
  });
});
