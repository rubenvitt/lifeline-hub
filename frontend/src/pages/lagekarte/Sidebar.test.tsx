import { beforeEach, describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../../test/utils';
import Sidebar, { bedienzielStil, ebenenZeileStil, loeschDialogBild } from './Sidebar';
import type { SidebarProps } from './Sidebar';
import { dichten } from '../../theme/tokens';

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
  zonenAnzahl: 0,
  basemap: 'blind',
  onMarkerWaehlen: vi.fn(),
  onlineVerfuegbar: false,
  offlineVerfuegbar: false,
  kartenTheme: 'auto',
  onKartenThemeWechsel: vi.fn(),
  ansichtDirty: false,
  ansichtSpeichert: false,
  onAnsichtSpeichern: vi.fn(),
  // BEWUSST ausgeschrieben statt `defaultFachebenenSichtbar()`: eine neue Fachebene soll
  // hier den Typcheck brechen und damit jemanden zwingen, die Sidebar anzusehen. (LFH-80
  // ist genau so aufgelaufen — der Import von `defaultFachebenenSichtbar` ist deshalb
  // wieder weg.)
  fachebenenSichtbar: {
    nina: false,
    dwd: false,
    pegelonline: false,
    hochwasser: false,
    luftqualitaet: false,
    odl: false,
    kritis: false,
    energie: false,
    autobahn: false,
  },
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

/**
 * Die Leiste klappt Bild-Hintergründe, Fachebenen und Kartengrundlage zu Beginn ZU
 * (`PANEEL_VORGABE`, Neuentwurf S5). Die Blöcke hier prüfen deren INHALT; dass die Paneele
 * zu sind und sich öffnen lassen, belegt der eigene Block „Sidebar: Paneele" weiter unten.
 */
function paneeleOffen() {
  localStorage.setItem(
    'lfh:lagekarte:paneele',
    JSON.stringify({ bilder: true, fachebenen: true, grundlage: true }),
  );
}

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
  beforeEach(paneeleOffen);
  it('listet Bilder und schaltet Sichtbarkeit', () => {
    const onBildToggle = vi.fn();
    renderMitProviders(
      <Sidebar
        {...basisProps}
        darfSchreiben
        bilder={[
          {
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
          },
        ]}
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
      <Sidebar {...basisProps} darfSchreiben={false} bilder={[]} bildPlatzierenId={null} />,
    );
    expect(screen.queryByText(/Bild hochladen/i)).not.toBeInTheDocument();
  });

  /**
   * Bild-Aktionen: gebündelt statt aufgereiht (LFH-366 · B5f).
   *
   * Die beiden Fälle sind ein PAAR und nur zusammen eine Aussage. Der Zentrieren-Test allein
   * belegt bloß, dass es den Knopf irgendwo gibt — er bliebe auch grün, wenn die Bündelung gar
   * nicht griffe oder ein zweiter Zentrieren-Knopf danebenstünde. Erst die Gegenprobe („mit
   * Schreibrecht ist der direkte Knopf WEG und ein Auslöser da") macht die Bündelung prüfbar.
   *
   * Der Zugriff aufs Menü läuft über das OFFENE Portal: antd lässt die Portale geschlossener
   * Dropdowns im Baum stehen, und hier liegt je Bild eines herum (CLAUDE.md, gemessene Falle
   * aus LFH-365).
   *
   * Die Einträge werden per TEILSTRING gegriffen, nicht per exaktem Namen: antds Icons tragen
   * ein eigenes `aria-label` (`role="img"`), das in den zugänglichen Namen des `menuitem`
   * einfließt — der heißt gemessen „delete Bild entfernen …", nicht „Bild entfernen …". Das ist
   * das Verhalten im ganzen Bestand (`AnsichtSwitcher`, `OfflineKartenVerwaltung`) und wird hier
   * nicht einseitig geändert. Die Beschriftung selbst prüft der `textContent`-Vergleich unten
   * exakt.
   */
  async function oeffneBildMenue(name: string | RegExp): Promise<HTMLElement> {
    await userEvent.click(screen.getByRole('button', { name }));
    const offen = document.querySelector<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    );
    if (!offen) throw new Error(`Das Menü „${String(name)}" ließ sich nicht öffnen`);
    return offen;
  }

  it('ohne Schreibrecht bleibt Zentrieren ein direkter Knopf — eine Aktion braucht kein Menü', () => {
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
    // Die Gegenrichtung: kein Auslöser, wo es nichts zu bündeln gibt.
    expect(screen.queryByRole('button', { name: 'Aktionen zu Lageplan' })).not.toBeInTheDocument();
  });

  it('mit Schreibrecht liegen alle drei Aktionen im Menü — und nicht mehr in der Icon-Reihe', async () => {
    renderMitProviders(<Sidebar {...basisProps} darfSchreiben bilder={[bildLageplan]} />);
    // Der direkte Zentrieren-Knopf ist weg: sonst wäre die Bündelung nur eine Ergänzung.
    expect(screen.queryByRole('button', { name: /Lageplan zentrieren/i })).not.toBeInTheDocument();
    const menue = await oeffneBildMenue('Aktionen zu Lageplan');
    expect(
      within(menue)
        .getAllByRole('menuitem')
        .map((e) => e.textContent),
    ).toEqual(['Auf Bild zentrieren', 'Auf der Karte platzieren', 'Bild entfernen …']);
  });

  /**
   * AK2, erste Hälfte: die räumliche Trennung zwischen destruktiver und harmloser Aktion. Im
   * Menü ist sie der Trenner — geprüft wird nicht bloß, DASS einer da ist, sondern dass er vor
   * dem Entfernen sitzt. Ein Trenner an beliebiger Stelle trennte nichts.
   */
  it('der Trenner steht unmittelbar vor „Bild entfernen"', async () => {
    renderMitProviders(<Sidebar {...basisProps} darfSchreiben bilder={[bildLageplan]} />);
    const menue = await oeffneBildMenue('Aktionen zu Lageplan');
    const trenner = menue.querySelectorAll('.ant-dropdown-menu-item-divider');
    expect(trenner).toHaveLength(1);
    expect(trenner[0].nextElementSibling?.textContent).toBe('Bild entfernen …');
  });

  it('der zugängliche Name trägt die Bild-Kennung — zwei Bilder, zwei unterscheidbare Auslöser', () => {
    renderMitProviders(
      <Sidebar
        {...basisProps}
        darfSchreiben
        bilder={[bildLageplan, { ...bildLageplan, id: 2, name: 'Übersicht' }]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Aktionen zu Lageplan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aktionen zu Übersicht' })).toBeInTheDocument();
  });

  it('Zentrieren aus dem Menü fliegt die Karte auf das Bild', async () => {
    const onBildZentrieren = vi.fn();
    renderMitProviders(
      <Sidebar
        {...basisProps}
        darfSchreiben
        bilder={[bildLageplan]}
        onBildZentrieren={onBildZentrieren}
      />,
    );
    const menue = await oeffneBildMenue('Aktionen zu Lageplan');
    await userEvent.click(within(menue).getByRole('menuitem', { name: /Auf Bild zentrieren/ }));
    expect(onBildZentrieren).toHaveBeenCalledWith(1);
  });

  /**
   * AK2, zweite Hälfte: das Entfernen wird bestätigt, und der Bestätigungsknopf ist rot. Ohne
   * die Farb-Zusicherung bestätigte man das Löschen mit einem blauen Knopf — genau der Fall,
   * den LFH-363 als eigene Festlegung aufgeschrieben hat.
   *
   * Der Aufruf darf ERST nach der Bestätigung kommen; die Zwischenprüfung ist deshalb kein
   * Beiwerk, sondern der Unterschied zwischen „fragt nach" und „fragt zum Schein".
   */
  it('Entfernen fragt nach und bestätigt mit einem roten Knopf', async () => {
    const onBildLoeschen = vi.fn();
    renderMitProviders(
      <Sidebar
        {...basisProps}
        darfSchreiben
        bilder={[bildLageplan]}
        onBildLoeschen={onBildLoeschen}
      />,
    );
    const menue = await oeffneBildMenue('Aktionen zu Lageplan');
    await userEvent.click(within(menue).getByRole('menuitem', { name: /Bild entfernen/ }));
    expect(screen.getByText('Bild „Lageplan" entfernen?')).toBeInTheDocument();
    expect(onBildLoeschen).not.toHaveBeenCalled();

    const bestaetigen = screen.getByRole('button', { name: 'Entfernen' });
    expect(bestaetigen).toHaveClass('ant-btn-dangerous');
    await userEvent.click(bestaetigen);
    expect(onBildLoeschen).toHaveBeenCalledWith(1);
  });

  it('Abbrechen entfernt nichts', async () => {
    const onBildLoeschen = vi.fn();
    renderMitProviders(
      <Sidebar
        {...basisProps}
        darfSchreiben
        bilder={[bildLageplan]}
        onBildLoeschen={onBildLoeschen}
      />,
    );
    const menue = await oeffneBildMenue('Aktionen zu Lageplan');
    await userEvent.click(within(menue).getByRole('menuitem', { name: /Bild entfernen/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(onBildLoeschen).not.toHaveBeenCalled();
  });

  it('Platzieren aus dem Menü heißt im laufenden Modus „beenden" und beendet ihn', async () => {
    const onBildPlatzieren = vi.fn();
    const onBildPlatzierenFertig = vi.fn();
    const { rerender } = renderMitProviders(
      <Sidebar
        {...basisProps}
        darfSchreiben
        bilder={[bildLageplan]}
        bildPlatzierenId={null}
        onBildPlatzieren={onBildPlatzieren}
        onBildPlatzierenFertig={onBildPlatzierenFertig}
      />,
    );
    let menue = await oeffneBildMenue('Aktionen zu Lageplan');
    await userEvent.click(
      within(menue).getByRole('menuitem', { name: /Auf der Karte platzieren/ }),
    );
    expect(onBildPlatzieren).toHaveBeenCalledWith(1);

    // Im laufenden Modus wechselt derselbe Eintrag Beschriftung UND Wirkung.
    rerender(
      <Sidebar
        {...basisProps}
        darfSchreiben
        bilder={[bildLageplan]}
        bildPlatzierenId={1}
        onBildPlatzieren={onBildPlatzieren}
        onBildPlatzierenFertig={onBildPlatzierenFertig}
      />,
    );
    menue = await oeffneBildMenue('Aktionen zu Lageplan');
    await userEvent.click(within(menue).getByRole('menuitem', { name: /Platzieren beenden/ }));
    expect(onBildPlatzierenFertig).toHaveBeenCalled();
    expect(onBildPlatzieren).toHaveBeenCalledTimes(1);
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
      <Sidebar
        {...basisProps}
        basemap="online"
        onlineVerfuegbar
        onKartenThemeWechsel={onKartenThemeWechsel}
      />,
    );
    // Online: kein Karten-Design-Umschalter.
    expect(screen.queryByRole('radiogroup', { name: /Karten-Design/i })).not.toBeInTheDocument();
    // Offline: Umschalter da, Klick auf „Dunkel" meldet 'dark'.
    rerender(
      <Sidebar
        {...basisProps}
        basemap="offline"
        offlineVerfuegbar
        kartenTheme="auto"
        onKartenThemeWechsel={onKartenThemeWechsel}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: /Dunkel/i }));
    expect(onKartenThemeWechsel).toHaveBeenCalledWith('dark');
  });

  it('schaltet den „Taktische Zeichen"-Ebenen-Toggle (LFH-170)', () => {
    const onLayerToggle = vi.fn();
    renderMitProviders(<Sidebar {...basisProps} onLayerToggle={onLayerToggle} />);
    // Die Ebenen-Zeile ist selbst der Schalter (Neuentwurf S5): Farbfeld · Name · Anzahl.
    const toggle = screen.getByRole('switch', { name: 'Taktische Zeichen' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    expect(onLayerToggle).toHaveBeenCalledWith('freies_zeichen', false);
  });

  it('nennt den Geltungsbereich der Autobahn-Ebene als sichtbare Zeile (LFH-80)', () => {
    renderMitProviders(<Sidebar {...basisProps} />);
    // AK „Limitation (nur BAB) im UI transparent": der Satz steht DA, nicht erst beim Hovern —
    // auf einem Führungs-Tablet gäbe es kein Hovern.
    expect(screen.getByText(/nur Bundesautobahnen/i)).toBeVisible();
    // Gegenaussage: keine der Bestandsebenen behauptet plötzlich eine Einschränkung.
    expect(screen.getByText('Autobahn-Lage (BAB)')).toBeInTheDocument();
    expect(screen.getAllByText(/nur Bundesautobahnen/i)).toHaveLength(1);
  });

  it('schaltet die Autobahn-Ebene über ihren eigenen Schalter (LFH-80)', () => {
    const onFachebeneToggle = vi.fn();
    renderMitProviders(<Sidebar {...basisProps} onFachebeneToggle={onFachebeneToggle} />);
    const toggle = screen
      .getByText('Autobahn-Lage (BAB)')
      .closest('.ant-space')
      ?.querySelector('button[role="switch"]');
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle as Element);
    expect(onFachebeneToggle).toHaveBeenCalledWith('autobahn', true);
  });

  // Zeile einer Fachebene: äußere Space-Zeile um Schalter, Label und Hinweis.
  const fachebenenZeile = (label: string) =>
    screen
      .getByText(label)
      .closest('.ant-space')!
      .parentElement!.closest<HTMLElement>('.ant-space')!;

  it('zeigt den Zoom-Hinweis an der Energie-Zeile, auch wenn KRITIS aus ist (LFH-81)', () => {
    renderMitProviders(
      <Sidebar
        {...basisProps}
        fachebenenSichtbar={{ ...basisProps.fachebenenSichtbar, energie: true }}
        zoomZuKlein={{ energie: true }}
      />,
    );
    expect(
      within(fachebenenZeile('Energieanlagen')).getByText('näher heranzoomen'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('näher heranzoomen')).toHaveLength(1);
  });

  it('zeigt den Zoom-Hinweis an der KRITIS-Zeile weiterhin', () => {
    renderMitProviders(
      <Sidebar
        {...basisProps}
        fachebenenSichtbar={{ ...basisProps.fachebenenSichtbar, kritis: true }}
        zoomZuKlein={{ kritis: true }}
      />,
    );
    expect(
      within(fachebenenZeile('KRITIS / sensible Objekte')).getByText('näher heranzoomen'),
    ).toBeInTheDocument();
  });

  it('eine ausgeschaltete Ebene zeigt keinen Zoom-Hinweis', () => {
    renderMitProviders(<Sidebar {...basisProps} zoomZuKlein={{ energie: true }} />);
    expect(screen.queryByText('näher heranzoomen')).not.toBeInTheDocument();
  });

  it('öffnet den Zeichen-Picker und startet das Platzieren mit der Entwurfs-Spec (LFH-170)', () => {
    const onZeichenPlatzierenStart = vi.fn();
    renderMitProviders(
      <Sidebar {...basisProps} onZeichenPlatzierenStart={onZeichenPlatzierenStart} />,
    );
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

  it('„Nicht verortet": Zeilenaktionen sind sekundär — keine Reihe gefüllter Primärknöpfe', () => {
    const onPlatzierenStart = vi.fn();
    const onAbschnittZeichnenStart = vi.fn();
    renderMitProviders(
      <Sidebar
        {...basisProps}
        darfSchreiben
        nichtVerortet={[
          { typ: 'uhs', id: 1, label: 'UHS Nord' },
          { typ: 'schaden', id: 2, label: 'S-004' },
          { typ: 'abschnitt', id: 3, label: 'EA Süd' },
        ]}
        onPlatzierenStart={onPlatzierenStart}
        onAbschnittZeichnenStart={onAbschnittZeichnenStart}
      />,
    );
    const platzieren = screen.getAllByRole('button', { name: 'Platzieren' });
    const zeichnen = screen.getByRole('button', { name: 'Fläche zeichnen' });
    // Positivkontrolle: die Knöpfe stehen und wirken — sonst wäre die Abwesenheit unten
    // auch dann grün, wenn die Zeilen gar nicht mehr gerendert würden.
    expect(platzieren).toHaveLength(2);
    fireEvent.click(platzieren[1]);
    expect(onPlatzierenStart).toHaveBeenCalledWith({ typ: 'schaden', id: 2 });
    fireEvent.click(zeichnen);
    expect(onAbschnittZeichnenStart).toHaveBeenCalledWith(3);
    for (const knopf of [...platzieren, zeichnen]) {
      expect(knopf).not.toHaveClass('ant-btn-primary');
      expect(knopf).toHaveClass('ant-btn-default');
    }
  });

  it('„Bild-Hintergründe": Fehler-Slot, der Upload bleibt bedienbar', () => {
    renderMitProviders(
      <Sidebar
        {...basisProps}
        darfSchreiben
        bilder={[]}
        sektionFehler={{
          bilder: {
            text: 'Bild-Hintergründe konnten nicht geladen werden',
            onWiederholen: vi.fn(),
          },
        }}
      />,
    );
    expect(screen.getByText('Bild-Hintergründe konnten nicht geladen werden')).toBeInTheDocument();
    // Der Upload hängt nicht an der Leseliste — ihn mit auszublenden nähme eine Fähigkeit weg,
    // die intakt ist.
    expect(screen.getByText(/Bild hochladen/i)).toBeInTheDocument();
  });

  it('„Bild-Hintergründe": ohne Fehler kein Slot', () => {
    paneeleOffen();
    renderMitProviders(<Sidebar {...basisProps} darfSchreiben bilder={[]} />);
    expect(
      screen.queryByText('Bild-Hintergründe konnten nicht geladen werden'),
    ).not.toBeInTheDocument();
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
        sektionFehler={{
          bilder: {
            text: 'Bild-Hintergründe konnten nicht geladen werden',
            onWiederholen: vi.fn(),
          },
        }}
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
        sektionFehler={{
          ansichten: {
            text: 'Kartenansichten konnten nicht geladen werden',
            onWiederholen: vi.fn(),
          },
        }}
      />,
    );
    expect(screen.getByText('Kartenansichten konnten nicht geladen werden')).toBeInTheDocument();
  });

  it('Ansichts-Switcher: ohne Fehler kein Slot', () => {
    renderMitProviders(<Sidebar {...basisProps} ansichten={[]} />);
    expect(
      screen.queryByText('Kartenansichten konnten nicht geladen werden'),
    ).not.toBeInTheDocument();
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

  it('wählt einen verorteten Marker mit Space über die Auswahlzeile', async () => {
    const user = userEvent.setup();
    const onMarkerWaehlen = vi.fn();
    renderMitProviders(
      <Sidebar
        {...basisProps}
        verortet={[
          {
            schluessel: 'uhs-7',
            typ: 'uhs',
            id: 7,
            lat: 50,
            lon: 8,
            label: 'UHS Nord',
            farbe: '#1677ff',
          },
        ]}
        onMarkerWaehlen={onMarkerWaehlen}
      />,
    );

    const zeile = screen.getByRole('button', { name: 'UHS Nord' });
    zeile.focus();
    await user.keyboard(' ');

    expect(onMarkerWaehlen).toHaveBeenCalledWith('uhs-7');
    expect(onMarkerWaehlen).toHaveBeenCalledTimes(1);
  });

  it('der Slot bietet den erneuten Abruf unter dem einen Wortlaut an', () => {
    const onWiederholen = vi.fn();
    renderMitProviders(
      <Sidebar
        {...basisProps}
        nichtVerortet={[]}
        sektionFehler={{
          nichtVerortet: { text: 'Objektlisten konnten nicht geladen werden', onWiederholen },
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Erneut abrufen' }));
    expect(onWiederholen).toHaveBeenCalled();
  });
});

/**
 * Trefflächenboden der handgebauten Bedienziele (LFH-366 · B5f).
 *
 * Geprüft wird der INLINE-STYLE, nicht ein Pixel: jsdom rechnet kein Layout, und
 * `test/utils.tsx` montiert ein nacktes `ConfigProvider` OHNE unser Theme — eine gerenderte
 * Höhe belegte antd-Vorgaben, nicht die Staffel. Deshalb die reine Funktion gegen die
 * Dichtestufen aus `theme/tokens.ts`.
 *
 * Die Böden stehen als LITERALE da. Aus dem Token zurückgelesen prüften sie den Token gegen
 * sich selbst und blieben grün, egal welche Zahl dort steht.
 */
describe('Sidebar: Bedienziel-Boden der klickbaren Listeneinträge', () => {
  const tokenFuer = (stufe: keyof typeof dichten) => ({
    controlHeight: dichten[stufe].zeilenhoehe,
    paddingSM: dichten[stufe].abstand.sm,
    padding: dichten[stufe].abstand.md,
  });

  it('trägt den Boden aus controlHeight — 30 / 48 / 72 px', () => {
    expect(bedienzielStil(tokenFuer('kompakt')).minHeight).toBe(30);
    expect(bedienzielStil(tokenFuer('komfortabel')).minHeight).toBe(48);
    expect(bedienzielStil(tokenFuer('handschuh')).minHeight).toBe(72);
  });

  /**
   * Die eigentliche Aussage: der Wert ZIEHT MIT. Ein festgenagelter Stil bestünde die
   * Literal-Prüfung oben nicht, ein aus einer Konstante gelesener aber schon — die Ungleichheit
   * über die Stufen ist das, was eine Verwechslung der Quelle auffliegen ließe.
   */
  it('wächst über die Dichtestufen, statt auf einer Stufe zu kleben', () => {
    const hoehen = (['kompakt', 'komfortabel', 'handschuh'] as const).map(
      (s) => bedienzielStil(tokenFuer(s)).minHeight,
    );
    expect(hoehen[0]).toBeLessThan(hoehen[1]);
    expect(hoehen[1]).toBeLessThan(hoehen[2]);
  });

  /**
   * ZWEI Angaben, nicht eine (Konvention aus LFH-365): die Polsterung allein trägt den Boden
   * nicht — sie kommt im Handschuh-Betrieb auf grob 54 px gegen die geforderten 72. Sie muss
   * trotzdem da sein und ebenfalls mitziehen, sonst klebt der Text an der Kante.
   */
  it('trägt neben der Höhe eine mitziehende Polsterung', () => {
    expect(bedienzielStil(tokenFuer('kompakt')).padding).toBe('7px 11px');
    expect(bedienzielStil(tokenFuer('handschuh')).padding).toBe('16px 26px');
  });
});

/**
 * Nebenläufigkeit an der Löschbestätigung (Review-Fund G2 zu LFH-366).
 *
 * Die Bildliste kommt über den SSE-Fan-out und kann sich ändern, WÄHREND die Rückfrage
 * offensteht — ein zweiter Bediener entfernt dasselbe Bild. Hing die Sichtbarkeit des Dialogs
 * an `loeschBildId != null`, blieb er stehen, sein Titel fiel auf `Bild „" entfernen?` zurück,
 * und „Entfernen" bot ein DELETE auf ein Objekt an, das es nicht mehr gab.
 *
 * Geprüft wird die REINE FUNKTION, nicht das gerenderte Modal — die Begründung steht bei
 * `loeschDialogBild`: antd löst die Schliess-Animation über `transitionend` auf, das in jsdom
 * nie feuert, also bliebe der Knopf gemessen im Baum und die naheliegende DOM-Zusicherung wäre
 * rot, obwohl die Härtung greift.
 */
describe('Sidebar: die Löschbestätigung überlebt ihr Bild nicht', () => {
  const bilder = [
    { id: 1, name: 'Lageplan' },
    { id: 2, name: 'Übersicht' },
  ];

  it('findet das Bild zur Kennung — Titel und Sichtbarkeit aus einer Quelle', () => {
    expect(loeschDialogBild(bilder, 2)?.name).toBe('Übersicht');
  });

  it('liefert null, sobald das Bild aus der Liste fällt', () => {
    expect(loeschDialogBild(bilder, 1)).not.toBeNull();
    // Derselbe Zustand nach einem SSE-Update, das genau dieses Bild entfernt hat:
    expect(
      loeschDialogBild(
        bilder.filter((b) => b.id !== 1),
        1,
      ),
    ).toBeNull();
  });

  it('liefert null, wenn gar keine Rückfrage offensteht', () => {
    expect(loeschDialogBild(bilder, null)).toBeNull();
  });
});

/**
 * Neuentwurf S5 — die rechte Leiste: Ebenen (Farbfeld · Name · Anzahl, Klick schaltet),
 * Ausgewählt, und die einklappbaren Paneele für alles, was die alte Leiste trug.
 */
describe('Sidebar: Paneel „Ebenen"', () => {
  const uhs = (id: number) => ({
    schluessel: `uhs-${id}`,
    typ: 'uhs' as const,
    id,
    lat: 50,
    lon: 8,
    label: `UHS ${id}`,
    farbe: '#1677ff',
  });

  it('zeigt je Ebene Name und Anzahl der verorteten Objekte', () => {
    renderMitProviders(<Sidebar {...basisProps} verortet={[uhs(1), uhs(2)]} zonenAnzahl={4} />);
    expect(screen.getByRole('switch', { name: 'UHS' })).toHaveTextContent('UHS2');
    expect(screen.getByRole('switch', { name: 'Zonen' })).toHaveTextContent('Zonen4');
    expect(screen.getByRole('switch', { name: 'Schäden' })).toHaveTextContent('Schäden0');
  });

  it('zeigt im Fehlerfall „—" statt einer Null — an jeder Zeile', () => {
    renderMitProviders(
      <Sidebar
        {...basisProps}
        verortet={[uhs(1)]}
        sektionFehler={{ nichtVerortet: { text: 'Objektlisten konnten nicht geladen werden' } }}
      />,
    );
    const zeilen = within(
      screen.getByRole('group', { name: 'Ebenen ein- und ausblenden' }),
    ).getAllByRole('switch');
    expect(zeilen).toHaveLength(10);
    for (const z of zeilen) expect(z).toHaveTextContent('—');
    expect(screen.getByRole('switch', { name: 'UHS' })).not.toHaveTextContent('1');
  });

  it('trägt den Zustand als Wort (aria-checked), nicht nur am Farbfeld', () => {
    const onLayerToggle = vi.fn();
    renderMitProviders(
      <Sidebar
        {...basisProps}
        layer={{ ...basisProps.layer, schaden: false }}
        onLayerToggle={onLayerToggle}
      />,
    );
    const schaden = screen.getByRole('switch', { name: 'Schäden' });
    expect(schaden).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(schaden);
    expect(onLayerToggle).toHaveBeenCalledWith('schaden', true);
    // Aus: Farbfeld leer. An: gefüllt. Der Zweitkanal ist sichtbar, nicht nur vorgelesen.
    const feldAus = schaden.querySelector('[data-lfh="ebenen-farbfeld"]') as HTMLElement;
    const feldAn = screen
      .getByRole('switch', { name: 'UHS' })
      .querySelector('[data-lfh="ebenen-farbfeld"]') as HTMLElement;
    expect(feldAus.style.background).toBe('transparent');
    // Die Füllung „an" ist ein `color-mix(…)`, den jsdom nicht kennt und still verwirft —
    // eine Aussage darauf wäre trivial grün. Der Rahmen dagegen trägt in jsdom: an in der
    // Ebenenfarbe, aus in der Steuerrahmen-Rolle.
    expect(feldAn.style.borderColor).not.toBe('');
    expect(feldAn.style.borderColor).not.toBe(feldAus.style.borderColor);
  });
});

describe('Sidebar: Ebenen-Zeile als Bedienziel', () => {
  const tokenFuer = (stufe: keyof typeof dichten) => ({
    controlHeight: dichten[stufe].zeilenhoehe,
    paddingSM: dichten[stufe].abstand.sm,
    padding: dichten[stufe].abstand.md,
    marginSM: dichten[stufe].abstand.md,
  });

  it('trägt den Boden aus controlHeight — 30 / 48 / 72 px — plus Polsterung', () => {
    expect(ebenenZeileStil(tokenFuer('kompakt')).minHeight).toBe(30);
    expect(ebenenZeileStil(tokenFuer('komfortabel')).minHeight).toBe(48);
    expect(ebenenZeileStil(tokenFuer('handschuh')).minHeight).toBe(72);
    expect(ebenenZeileStil(tokenFuer('kompakt')).padding).toBe('7px 11px');
    expect(ebenenZeileStil(tokenFuer('handschuh')).padding).toBe('16px 26px');
  });
});

describe('Sidebar: Paneel „Ausgewählt"', () => {
  it('sagt ohne Auswahl, wie man etwas wählt', () => {
    renderMitProviders(<Sidebar {...basisProps} />);
    const paneel = screen.getByRole('region', { name: 'Ausgewählt' });
    expect(paneel).toHaveTextContent(/Nichts gewählt/);
  });

  it('zeigt den übergebenen Inspector-Inhalt statt des Hinweises', () => {
    renderMitProviders(<Sidebar {...basisProps} auswahl={<div>Inspector-Inhalt</div>} />);
    const paneel = screen.getByRole('region', { name: 'Ausgewählt' });
    expect(within(paneel).getByText('Inspector-Inhalt')).toBeInTheDocument();
    expect(paneel).not.toHaveTextContent(/Nichts gewählt/);
  });
});

describe('Sidebar: einklappbare Paneele', () => {
  it('klappt Einmal-Einstellungen zu Beginn zu und öffnet sie auf Klick', () => {
    renderMitProviders(<Sidebar {...basisProps} bilder={[bildLageplan]} />);
    const kopf = screen.getByRole('button', { name: /^Bild-Hintergründe/ });
    expect(kopf).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Lageplan')).not.toBeInTheDocument();
    fireEvent.click(kopf);
    expect(kopf).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Lageplan')).toBeInTheDocument();
  });

  it('merkt sich die Wahl über ein Neuladen hinweg', () => {
    const { unmount } = renderMitProviders(<Sidebar {...basisProps} />);
    fireEvent.click(screen.getByRole('button', { name: /^Fachebenen/ }));
    unmount();
    renderMitProviders(<Sidebar {...basisProps} />);
    expect(screen.getByRole('button', { name: /^Fachebenen/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('hält ein Paneel mit Fehler offen — ein zugeklappter Fehler sähe aus wie „nichts da"', () => {
    renderMitProviders(
      <Sidebar
        {...basisProps}
        sektionFehler={{ bilder: { text: 'Bild-Hintergründe konnten nicht geladen werden' } }}
      />,
    );
    expect(screen.getByRole('button', { name: /^Bild-Hintergründe/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('Bild-Hintergründe konnten nicht geladen werden')).toBeInTheDocument();
  });

  it('öffnet „Zeichnen" auf Anfrage des Zeichnen-Knopfs über der Karte', () => {
    localStorage.setItem('lfh:lagekarte:paneele', JSON.stringify({ zeichnen: false }));
    const { rerender } = renderMitProviders(<Sidebar {...basisProps} zeichnenAnfrage={0} />);
    expect(
      screen.queryByRole('button', { name: 'Gefahrengebiet zeichnen' }),
    ).not.toBeInTheDocument();
    rerender(<Sidebar {...basisProps} zeichnenAnfrage={1} />);
    expect(screen.getByRole('button', { name: 'Gefahrengebiet zeichnen' })).toBeInTheDocument();
  });

  it('ohne Schreibrecht gibt es kein Paneel „Zeichnen"', () => {
    renderMitProviders(<Sidebar {...basisProps} darfSchreiben={false} />);
    expect(screen.queryByRole('button', { name: 'Zeichnen' })).not.toBeInTheDocument();
  });
});
