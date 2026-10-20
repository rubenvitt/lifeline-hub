import { beforeEach, describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../../test/utils';
import Sidebar, {
  bedienzielStil,
  ebenenZeileStil,
  filtereNichtVerortet,
  leistenZeileStil,
  loeschDialogBild,
  namensteilStil,
  NICHT_VERORTET_SUCHE_AB,
  platzierObjekt,
} from './Sidebar';
import type { NichtVerortet } from './marker';
import { AusgangUnbekannt, NetzFehler } from '../../api/client';
import type { SidebarProps } from './Sidebar';
import { dichten, fachebeneFarbenHell } from '../../theme/tokens';
import { hochwasserKlasse } from '../../theme/statusFarben';
import { FACHEBENEN, fachebeneKeys } from './fachebenen';
import { hochwasserRadius } from './hochwasserStil';
import { FREIE_SKIZZE_VORGABEFARBE } from './zonenStil';

const basisProps: SidebarProps = {
  einsatzId: 1,
  nichtVerortet: [],
  verortet: [],
  suchbar: [],
  darfSchreiben: true,
  platzierungZiel: null,
  onPlatzierenStart: vi.fn(),
  onPlatzierenAbbrechen: vi.fn(),
  onAbschnittZeichnenStart: vi.fn(),
  onZoneZeichnenStart: vi.fn(),
  zeichenPlatzieren: null,
  onZeichenPlatzierenStart: vi.fn(),
  onZeichenPlatzierenAbbrechen: vi.fn(),
  // Serienmodus: der Zähler steht auf 0, der Zustand vor dem ersten Zeichen, in dem Beenden noch
  // „Abbrechen" heißt. Den Gegenzustand baut der eigene Block unten auf.
  zeichenSerie: true,
  onZeichenSerieWechsel: vi.fn(),
  zeichenSerieAnzahl: 0,
  onZeichenPlatzierenFertig: vi.fn(),
  onKoordinateEingeben: vi.fn(),
  einsatzortVerortet: true,
  onEinsatzortPlatzieren: vi.fn(),
  layer: {
    einsatzort: true,
    fuehrungsstelle: true,
    uhs: true,
    schaden: true,
    einheit: true,
    fahrzeug: true,
    fuehrung: true,
    abschnitt: true,
    zone: true,
    lagemeldung: true,
    freies_zeichen: true,
    person: false,
    betreuungsstelle: true,
    bereitstellungsraum: true,
    tier: true,
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
  // Bewusst ausgeschrieben statt `defaultFachebenenSichtbar()`: eine neue Fachebene soll hier den
  // Typcheck brechen und so zum Blick auf die Sidebar zwingen.
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
  griffModus: 'groesse',
  griffKantenAus: 'keine',
  onGriffModus: vi.fn(),
  ansichten: [],
  aktiveAnsichtId: undefined,
  onAnsichtWaehlen: vi.fn(),
  onAnsichtNeu: vi.fn(),
  onAnsichtUmbenennen: vi.fn(),
  onAnsichtStandard: vi.fn(),
  onAnsichtLoeschen: vi.fn(),
  ansichtBusy: false,
  // Die meisten Blöcke prüfen Paneele der Ansicht „Objekte“; die Ebenen prüfen `ebenenProps`.
  ansicht: 'objekte',
  onAnsichtWechsel: vi.fn(),
};

/** Dieselbe Leiste mit der Ansicht „Ebenen“ vorn (Ebenenbaum, Fachebenen, Bilder, Grundlage). */
const ebenenProps: SidebarProps = { ...basisProps, ansicht: 'ebenen' };

/**
 * Fachebenen und Hintergrund starten im Ebenenbaum zugeklappt (`BAUM_KLAPP_VORGABE`). Die Blöcke
 * hier prüfen deren Inhalt; Zuklappen und Öffnen belegt „Sidebar: einklappbare Paneele" unten.
 */
function paneeleOffen() {
  localStorage.setItem(
    'lfh:lagekarte:ebenen-gruppen',
    JSON.stringify({
      betroffene: true,
      fachebenen: true,
      warnungen: true,
      wasser: true,
      umwelt: true,
      verkehr: true,
      hintergrund: true,
      grundlage: true,
      bilder: true,
    }),
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
        {...ebenenProps}
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

  it('zeigt den Upload-Fortschritt und sperrt den Knopf, solange er läuft (LFH-1021)', () => {
    renderMitProviders(
      <Sidebar
        {...ebenenProps}
        darfSchreiben
        bilder={[]}
        bildUpload={{ laeuft: true, stand: { phase: 'senden', anteil: 0.4 }, fehler: null }}
      />,
    );
    const balken = screen.getByRole('progressbar', { name: 'Wird hochgeladen · 40 %' });
    expect(balken).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByRole('button', { name: /Bild hochladen/ })).toHaveClass('ant-btn-loading');
  });

  it('Zeitlimit nach dem letzten Byte: „Ablage unklar“, nicht „nicht abgeschickt“ (LFH-1021)', () => {
    renderMitProviders(
      <Sidebar
        {...ebenenProps}
        darfSchreiben
        bilder={[]}
        bildUpload={{ laeuft: false, stand: null, fehler: new AusgangUnbekannt() }}
      />,
    );
    const alarm = screen.getByRole('alert');
    expect(alarm).toHaveTextContent('Ablage unklar');
    expect(alarm).toHaveTextContent(/Liste prüfen/);
    expect(alarm).not.toHaveTextContent(/NICHT abgeschickt/);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('Abbruch vor dem letzten Byte: „Nicht abgelegt“ (LFH-1021)', () => {
    renderMitProviders(
      <Sidebar
        {...ebenenProps}
        darfSchreiben
        bilder={[]}
        bildUpload={{ laeuft: false, stand: null, fehler: new NetzFehler() }}
      />,
    );
    const alarm = screen.getByRole('alert');
    expect(alarm).toHaveTextContent('Nicht abgelegt');
    expect(alarm).toHaveTextContent('NICHT abgeschickt');
  });

  it('ohne Schreibrecht kein Upload-Button', () => {
    renderMitProviders(
      <Sidebar {...ebenenProps} darfSchreiben={false} bilder={[]} bildPlatzierenId={null} />,
    );
    expect(screen.queryByText(/Bild hochladen/i)).not.toBeInTheDocument();
  });

  /**
   * Bild-Aktionen: gebündelt statt aufgereiht. Die beiden Fälle sind ein Paar: erst die Gegenprobe
   * (mit Schreibrecht ist der direkte Knopf weg und ein Auslöser da) macht die Bündelung prüfbar.
   *
   * Zugriff über das offene Portal — antd lässt die Portale geschlossener Dropdowns stehen.
   * Einträge per Teilstring: antds Icons tragen ein eigenes `aria-label`, der Name des `menuitem`
   * heißt „delete Bild entfernen …". Die Beschriftung prüft der `textContent`-Vergleich exakt.
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
        {...ebenenProps}
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
    renderMitProviders(<Sidebar {...ebenenProps} darfSchreiben bilder={[bildLageplan]} />);
    // Der direkte Zentrieren-Knopf ist weg — sonst wäre die Bündelung nur eine Ergänzung.
    expect(screen.queryByRole('button', { name: /Lageplan zentrieren/i })).not.toBeInTheDocument();
    const menue = await oeffneBildMenue('Aktionen zu Lageplan');
    expect(
      within(menue)
        .getAllByRole('menuitem')
        .map((e) => e.textContent),
    ).toEqual(['Auf Bild zentrieren', 'Auf der Karte platzieren', 'Bild entfernen …']);
  });

  /**
   * Die Trennung zwischen destruktiver und harmloser Aktion ist im Menü der Trenner — geprüft wird,
   * dass er unmittelbar vor dem Entfernen sitzt.
   */
  it('der Trenner steht unmittelbar vor „Bild entfernen"', async () => {
    renderMitProviders(<Sidebar {...ebenenProps} darfSchreiben bilder={[bildLageplan]} />);
    const menue = await oeffneBildMenue('Aktionen zu Lageplan');
    const trenner = menue.querySelectorAll('.ant-dropdown-menu-item-divider');
    expect(trenner).toHaveLength(1);
    expect(trenner[0].nextElementSibling?.textContent).toBe('Bild entfernen …');
  });

  it('der zugängliche Name trägt die Bild-Kennung — zwei Bilder, zwei unterscheidbare Auslöser', () => {
    renderMitProviders(
      <Sidebar
        {...ebenenProps}
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
        {...ebenenProps}
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
   * Das Entfernen wird bestätigt, und der Bestätigungsknopf ist rot. Der Aufruf darf erst nach der
   * Bestätigung kommen — die Zwischenprüfung unterscheidet „fragt nach" von „fragt zum Schein".
   */
  it('Entfernen fragt nach und bestätigt mit einem roten Knopf', async () => {
    const onBildLoeschen = vi.fn();
    renderMitProviders(
      <Sidebar
        {...ebenenProps}
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
        {...ebenenProps}
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
        {...ebenenProps}
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
        {...ebenenProps}
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

  it('im Einpassen zeigt die Zeile nur den Zustand — Griffwahl und „Fertig“ stehen im Band', () => {
    renderMitProviders(
      <Sidebar
        {...ebenenProps}
        darfSchreiben
        bilder={[bildLageplan]}
        bildPlatzierenId={1}
        platzierModus={{
          art: 'bild',
          name: 'Lageplan',
          griffModus: 'groesse',
          onGriffModus: vi.fn(),
          onFertig: vi.fn(),
        }}
      />,
    );
    const zeile = screen.getByRole('switch', { name: 'Lageplan' }).parentElement!.parentElement!;
    expect(within(zeile).getByText('wird eingepasst')).toBeInTheDocument();
    expect(within(zeile).queryByRole('button', { name: /^Fertig$/ })).toBeNull();
    // Je Handlung genau ein Knopf: Griffwahl und „Fertig“ im Modus-Band.
    expect(screen.getAllByRole('radiogroup', { name: 'Griffe auf der Karte' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Fertig$/ })).toHaveLength(1);
  });

  it('zeigt den Karten-Design-Umschalter nur im Offline-Modus und meldet die Wahl', () => {
    const onKartenThemeWechsel = vi.fn();
    const { rerender } = renderMitProviders(
      <Sidebar
        {...ebenenProps}
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
        {...ebenenProps}
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
    renderMitProviders(<Sidebar {...ebenenProps} onLayerToggle={onLayerToggle} />);
    // Die Ebenen-Zeile ist selbst der Schalter: Farbfeld · Name · Anzahl.
    const toggle = screen.getByRole('switch', { name: 'Taktische Zeichen' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    expect(onLayerToggle).toHaveBeenCalledWith('freies_zeichen', false);
  });

  it('nennt den Geltungsbereich der Autobahn-Ebene als sichtbare Zeile (LFH-80)', () => {
    renderMitProviders(<Sidebar {...ebenenProps} />);
    // Die Einschränkung „nur BAB" steht sichtbar da, nicht erst beim Hovern (Tablet).
    expect(screen.getByText(/nur Bundesautobahnen/i)).toBeVisible();
    // Gegenaussage: keine der Bestandsebenen behauptet plötzlich eine Einschränkung.
    expect(screen.getByText('Autobahn-Lage (BAB)')).toBeInTheDocument();
    expect(screen.getAllByText(/nur Bundesautobahnen/i)).toHaveLength(1);
  });

  it('schaltet die Autobahn-Ebene über ihren eigenen Schalter (LFH-80)', () => {
    const onFachebeneToggle = vi.fn();
    renderMitProviders(<Sidebar {...ebenenProps} onFachebeneToggle={onFachebeneToggle} />);
    // Über den Namen am Schalter selbst, nicht über die antd-Hülle der Zeile.
    fireEvent.click(screen.getByRole('switch', { name: 'Autobahn-Lage (BAB)' }));
    expect(onFachebeneToggle).toHaveBeenCalledWith('autobahn', true);
  });

  it('gibt jedem Fachebenen-Schalter den Ebenennamen als zugänglichen Namen (LFH-631)', () => {
    renderMitProviders(<Sidebar {...ebenenProps} />);
    // Jeder Schalter einer Zeile, nicht nur die, die ein Name trifft: ein namenloser Schalter
    // fiele bei `getByRole(…, { name })` sonst einfach durch.
    const schalter = [...document.querySelectorAll<HTMLElement>('[data-fachebene]')].map((zeile) =>
      within(zeile).getByRole('switch'),
    );
    expect(schalter).toHaveLength(fachebeneKeys().length);
    for (const key of fachebeneKeys()) {
      expect(screen.getByRole('switch', { name: FACHEBENEN[key].label }), `Schalter ${key}`).toBe(
        within(document.querySelector<HTMLElement>(`[data-fachebene="${key}"]`)!).getByRole(
          'switch',
        ),
      );
    }
  });

  // Zeile einer Fachebene: die Zeile um Schalter, Label und Hinweis (`data-fachebene`).
  const fachebenenZeile = (label: string) =>
    screen.getByText(label).closest<HTMLElement>('[data-fachebene]')!;

  it('zeigt den Zoom-Hinweis an der Energie-Zeile, auch wenn KRITIS aus ist (LFH-81)', () => {
    renderMitProviders(
      <Sidebar
        {...ebenenProps}
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
        {...ebenenProps}
        fachebenenSichtbar={{ ...basisProps.fachebenenSichtbar, kritis: true }}
        zoomZuKlein={{ kritis: true }}
      />,
    );
    expect(
      within(fachebenenZeile('KRITIS / sensible Objekte')).getByText('näher heranzoomen'),
    ).toBeInTheDocument();
  });

  describe('Alter des Stands (LFH-591)', () => {
    const vor = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

    it('zeigt den Stand in der Zeile jeder zugeschalteten Ebene, ohne Klick', () => {
      paneeleOffen();
      renderMitProviders(
        <Sidebar
          {...ebenenProps}
          fachebenenSichtbar={{ ...basisProps.fachebenenSichtbar, hochwasser: true, dwd: true }}
          fachebenenStatus={{ hochwasser: 'ok', dwd: 'leer' }}
          fachebenenAbgerufen={{ hochwasser: vor(5), dwd: vor(5) }}
        />,
      );
      const zeile = fachebenenZeile('Hochwasser-Meldeklassen (LHP)');
      expect(within(zeile).getByText(/^Stand/)).toBeInTheDocument();
      expect(within(zeile).queryByText(/veraltet/)).not.toBeInTheDocument();
      // `leer` hat auch einen Stand: „keine Daten, Stand 1430“ ist eine Aussage.
      const dwd = fachebenenZeile('Wetterwarnungen (DWD)');
      expect(within(dwd).getByText('keine Daten')).toBeInTheDocument();
      expect(within(dwd).getByText(/^Stand/)).toBeInTheDocument();
    });

    it('kennzeichnet einen Stand jenseits der Schwelle als veraltet', () => {
      paneeleOffen();
      renderMitProviders(
        <Sidebar
          {...ebenenProps}
          fachebenenSichtbar={{ ...basisProps.fachebenenSichtbar, hochwasser: true }}
          fachebenenStatus={{ hochwasser: 'ok' }}
          fachebenenAbgerufen={{ hochwasser: vor(40 * 60) }}
        />,
      );
      expect(
        within(fachebenenZeile('Hochwasser-Meldeklassen (LHP)')).getByText(/veraltet/),
      ).toBeInTheDocument();
    });

    it('eine ausgeschaltete Ebene zeigt keinen Stand', () => {
      paneeleOffen();
      renderMitProviders(<Sidebar {...ebenenProps} fachebenenAbgerufen={{ hochwasser: vor(5) }} />);
      expect(screen.queryByText(/^Stand/)).not.toBeInTheDocument();
    });

    it('offline ohne Stand: nur „offline“', () => {
      paneeleOffen();
      renderMitProviders(
        <Sidebar
          {...ebenenProps}
          fachebenenSichtbar={{ ...basisProps.fachebenenSichtbar, nina: true }}
          fachebenenStatus={{ nina: 'offline' }}
          fachebenenAbgerufen={{}}
        />,
      );
      const zeile = fachebenenZeile('Amtliche Warnungen (NINA)');
      expect(within(zeile).getByText('offline')).toBeInTheDocument();
      expect(within(zeile).queryByText(/^Stand/)).not.toBeInTheDocument();
    });

    it('offline mit gehaltenem Stand (eigener Server weg): „offline“ und der Stand', () => {
      paneeleOffen();
      renderMitProviders(
        <Sidebar
          {...ebenenProps}
          fachebenenSichtbar={{ ...basisProps.fachebenenSichtbar, autobahn: true }}
          fachebenenStatus={{ autobahn: 'offline' }}
          fachebenenAbgerufen={{ autobahn: vor(90) }}
        />,
      );
      const zeile = fachebenenZeile('Autobahn-Lage (BAB)');
      expect(within(zeile).getByText('offline')).toBeInTheDocument();
      expect(within(zeile).getByText(/veraltet/)).toBeInTheDocument();
    });
  });

  it('eine ausgeschaltete Ebene zeigt keinen Zoom-Hinweis', () => {
    renderMitProviders(<Sidebar {...ebenenProps} zoomZuKlein={{ energie: true }} />);
    expect(screen.queryByText('näher heranzoomen')).not.toBeInTheDocument();
  });

  // Inline gesetzte Farben einer Zeile, wie jsdom sie normalisiert — `color` des Ebenenpunkts und
  // `background` der Legendenpunkte.
  const farbenIn = (el: HTMLElement) =>
    [el, ...el.querySelectorAll<HTMLElement>('*')].flatMap((e) =>
      [e.style.color, e.style.background, e.style.backgroundColor, e.style.borderColor].filter(
        Boolean,
      ),
    );
  const normiert = (farbe: string) => {
    const probe = document.createElement('span');
    probe.style.color = farbe;
    return probe.style.color;
  };

  it('keine klassenabhängige Ebene zeigt ihren Rückfallton im Panel, ein- wie ausgeschaltet (LFH-592)', () => {
    const klassig = fachebeneKeys().filter((k) => FACHEBENEN[k].klassenfarben);
    expect(klassig.length).toBeGreaterThan(0);
    for (const an of [false, true]) {
      const sichtbar = { ...basisProps.fachebenenSichtbar };
      for (const k of klassig) sichtbar[k] = an;
      const { unmount } = renderMitProviders(
        <Sidebar {...ebenenProps} fachebenenSichtbar={sichtbar} />,
      );
      for (const k of klassig) {
        const zeile = document.querySelector<HTMLElement>(`[data-fachebene="${k}"]`)!;
        // Die Karte zeichnet diese Ebene nie in ihrer Ebenenfarbe (`hochwasserStil.ts` & Co. backen die
        // Rollenfarbe je Feature ein) — also steht der Ton auch im Panel nirgends.
        // Die Tests rendern ohne unser Theme, also im Tagmodus (`fachebeneFarbe`, LFH-593).
        expect(farbenIn(zeile)).not.toContain(normiert(fachebeneFarbenHell[k]));
        // Das Farbfeld steht trotzdem (Zustand an/aus, Bündigkeit der Namen), nur neutral.
        expect(zeile.querySelector('[data-lfh="ebenen-farbfeld"]')).not.toBeNull();
      }
      unmount();
    }
  });

  it('eingeschaltete Hochwasserebene erklärt jede Meldeklasse mit Punkt und Wort (LFH-592)', () => {
    renderMitProviders(
      <Sidebar
        {...ebenenProps}
        fachebenenSichtbar={{ ...basisProps.fachebenenSichtbar, hochwasser: true }}
      />,
    );
    const zeile = fachebenenZeile('Hochwasser-Meldeklassen (LHP)');
    const legende = within(zeile).getByRole('list', {
      name: 'Legende: Hochwasser-Meldeklassen (LHP)',
    });
    const eintraege = within(legende).getAllByRole('listitem');
    // Wort und Rolle aus dem Vertrag, in seiner Reihenfolge — ablesbar ohne Klick auf einen Pegel.
    expect(eintraege.map((e) => e.textContent)).toEqual(
      Object.values(hochwasserKlasse).map((d) => d.label),
    );
    expect(
      eintraege.map((e) => e.querySelector<HTMLElement>('[data-rolle]')?.dataset.rolle),
    ).toEqual(Object.values(hochwasserKlasse).map((d) => d.rolle));
    // Der Punkt trägt den Durchmesser der Karte (zweiter Kanal neben der Farbe).
    const punkt = eintraege[eintraege.length - 1].querySelector<HTMLElement>('[data-rolle]')!;
    expect(punkt.style.width).toBe(`${2 * hochwasserRadius('sehr_gross')}px`);
  });

  it('ausgeschaltet zeigt eine klassenabhängige Ebene keine Legende — sie zeichnet ja nichts (LFH-592)', () => {
    renderMitProviders(<Sidebar {...ebenenProps} />);
    expect(screen.queryByRole('list', { name: /^Legende: / })).not.toBeInTheDocument();
  });

  it('eine einfarbige Ebene behält ihren Ebenenpunkt in der Kartenfarbe (LFH-592)', () => {
    renderMitProviders(
      <Sidebar
        {...ebenenProps}
        fachebenenSichtbar={{ ...basisProps.fachebenenSichtbar, nina: true }}
      />,
    );
    const zeile = fachebenenZeile('Amtliche Warnungen (NINA)');
    const feld = zeile.querySelector<HTMLElement>('[data-lfh="ebenen-farbfeld"]')!;
    expect(feld.style.borderColor).toBe(normiert(fachebeneFarbenHell.nina));
    expect(within(zeile).queryByRole('list')).not.toBeInTheDocument();
  });

  it('öffnet den Zeichen-Picker und startet das Platzieren mit der Entwurfs-Spec (LFH-170)', () => {
    const onZeichenPlatzierenStart = vi.fn();
    renderMitProviders(
      <Sidebar {...basisProps} onZeichenPlatzierenStart={onZeichenPlatzierenStart} />,
    );
    // Der Picker ist zunächst geschlossen (kein Dauer-Combobox in der Leiste).
    expect(screen.queryByLabelText('Grundzeichen')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Taktisches Zeichen platzieren' }));
    // Jetzt ist der Picker offen …
    expect(screen.getAllByLabelText('Grundzeichen').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Platzieren' }));
    // Startentwurf ist die taktische Formation, gesendet als Zeichenbeschreibung (LFH-836).
    expect(onZeichenPlatzierenStart).toHaveBeenCalledWith(
      expect.objectContaining({ zeichen_spec: '{"v":1,"spec":{"kind":"formation"}}' }),
    );
  });

  it('sperrt „Platzieren“ nach „Kein Grundzeichen“, bis ein Symbol gewählt ist (LFH-836)', () => {
    const onZeichenPlatzierenStart = vi.fn();
    renderMitProviders(
      <Sidebar {...basisProps} onZeichenPlatzierenStart={onZeichenPlatzierenStart} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Taktisches Zeichen platzieren' }));
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Grundzeichen' })).getByRole('radio', {
        name: 'Kein Grundzeichen',
      }),
    );
    const knopf = screen.getByRole('button', { name: 'Platzieren' });
    expect(knopf).toBeDisabled();
    fireEvent.click(knopf);
    expect(onZeichenPlatzierenStart).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Symbol' })).getByRole('radio', {
        name: 'Angeschlagen',
      }),
    );
    expect(knopf).toBeEnabled();
    fireEvent.click(knopf);
    expect(onZeichenPlatzierenStart).toHaveBeenCalledWith(
      expect.objectContaining({
        zeichen_spec: '{"v":1,"freestanding":{"kind":"state","state":"damaged"}}',
      }),
    );
  });

  it('startet das Platzieren per Enter im Picker wie der Knopf und schließt den Picker (LFH-716)', () => {
    const onZeichenPlatzierenStart = vi.fn();
    renderMitProviders(
      <Sidebar {...basisProps} onZeichenPlatzierenStart={onZeichenPlatzierenStart} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Taktisches Zeichen platzieren' }));
    const kachel = within(screen.getByRole('radiogroup', { name: 'Grundzeichen' })).getByRole(
      'radio',
      { name: 'Person' },
    );
    kachel.focus();
    fireEvent.keyDown(kachel, { key: 'Enter' });
    // Die Spec der Enter-Kachel, nicht der Entwurf von vorher.
    expect(onZeichenPlatzierenStart).toHaveBeenCalledWith(
      expect.objectContaining({ zeichen_spec: '{"v":1,"spec":{"kind":"person"}}' }),
    );
    expect(screen.queryByRole('radiogroup', { name: 'Grundzeichen' })).not.toBeInTheDocument();
  });

  it('im laufenden Zeichen zeigt das Paneel nur den Zustand — bedient wird im Band', () => {
    renderMitProviders(
      <Sidebar
        {...basisProps}
        zeichenPlatzieren={{ zeichen_spec: '{"v":1,"spec":{"kind":"formation"}}' }}
      />,
    );
    const paneel = document.querySelector('section[data-paneel="zeichnen"]') as HTMLElement;
    expect(within(paneel).getByText('wird platziert')).toBeInTheDocument();
    expect(within(paneel).queryByRole('button', { name: 'Abbrechen' })).toBeNull();
    expect(within(paneel).queryByRole('switch', { name: 'Weitere platzieren' })).toBeNull();
  });

  it('benennt ein Bild über die Inline-Bearbeitung um', () => {
    const onBildUmbenennen = vi.fn();
    renderMitProviders(
      <Sidebar
        {...ebenenProps}
        darfSchreiben
        bilder={[bildLageplan]}
        onBildUmbenennen={onBildUmbenennen}
      />,
    );
    // antd Typography editable: Edit-Auslöser hat aria-label „Umbenennen".
    fireEvent.click(screen.getByRole('button', { name: /Umbenennen/i }));
    // In der Leiste steht auch das benannte Suchfeld; das Bearbeitungsfeld ist das namenlose
    // Textfeld. `getByDisplayValue` träfe zusätzlich antds Messkopie.
    const input = screen.getByRole('textbox', { name: '' });
    fireEvent.change(input, { target: { value: 'Objektskizze' } });
    fireEvent.blur(input); // antd Editable committet bei Blur (und Enter-keyUp)
    expect(onBildUmbenennen).toHaveBeenCalledWith(1, 'Objektskizze');
  });
});

/**
 * Fehler-Slots je Sektion. Jedes Paar hier klammert: die „nicht im DOM"-Hälfte allein belegte
 * nichts, erst die Partnerhälfte mit dem byte-gleichen Literal macht eine Aussage über die
 * Zustandsweiche.
 */
describe('Sidebar Fehler-Slots', () => {
  const slot = { text: 'Objektlisten konnten nicht geladen werden', onWiederholen: vi.fn() };

  it('„Nicht verortet": Fehler-Slot statt der Erfolgsmeldung', () => {
    renderMitProviders(
      <Sidebar {...basisProps} nichtVerortet={[]} sektionFehler={{ nichtVerortet: slot }} />,
    );
    expect(screen.getByText('Objektlisten konnten nicht geladen werden')).toBeInTheDocument();
    // „Alles verortet" ist eine Erfolgsaussage und darf nicht stehen, wenn niemand weiß, ob
    // überhaupt etwas geladen wurde.
    expect(screen.queryByText('Alles verortet')).not.toBeInTheDocument();
  });

  it('„Nicht verortet": ohne Fehler die Erfolgsmeldung und keinen Slot', () => {
    const { container } = renderMitProviders(<Sidebar {...basisProps} nichtVerortet={[]} />);
    expect(screen.getByText('Alles verortet')).toBeInTheDocument();
    expect(screen.queryByText('Objektlisten konnten nicht geladen werden')).not.toBeInTheDocument();
    /** „Alles verortet" ist ein Erfolgs-, kein Leerzustand: er bekommt keine Primäraktion. */
    expect(container.querySelector('.ant-empty')).toBeNull();
  });

  /**
   * Ein Fehler ersetzt Inhalt nur, wenn es keinen Inhalt gibt. Die Zeilen unter „Nicht verortet"
   * tragen die einzige Bedienung zum Verorten; fällt eine Lagebild-Quelle aus, während die übrigen
   * Zeilen im Zwischenspeicher stehen, steht der Fehler als Banner darüber, nicht an ihrer Stelle.
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
    expect(screen.getByText(/Aktualisierung fehlgeschlagen/)).toBeInTheDocument();
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
    // Positivkontrolle: die Knöpfe stehen und wirken — sonst wäre die Abwesenheit unten auch grün,
    // wenn die Zeilen gar nicht gerendert würden.
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
        {...ebenenProps}
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
    // Der Upload hängt nicht an der Leseliste und bleibt bedienbar.
    expect(screen.getByText(/Bild hochladen/i)).toBeInTheDocument();
  });

  it('„Bild-Hintergründe": ohne Fehler kein Slot', () => {
    paneeleOffen();
    renderMitProviders(<Sidebar {...ebenenProps} darfSchreiben bilder={[]} />);
    expect(
      screen.queryByText('Bild-Hintergründe konnten nicht geladen werden'),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Bild hochladen/i)).toBeInTheDocument();
  });

  /**
   * Dieselbe Regel für die Bilder, mit eigener Schärfe: die Overlays liegen weiter auf der Karte.
   * Verschwände nur ihre Bedienleiste, ließe sich ein Bild nicht mehr abschalten.
   */
  it('„Bild-Hintergründe": mit Bildern im Zwischenspeicher bleibt die Liste bedienbar', () => {
    const onBildToggle = vi.fn();
    renderMitProviders(
      <Sidebar
        {...ebenenProps}
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
    // `AnsichtSwitcher` liefert bei leerer Liste `null` — ohne Fehler-Slot wäre ein gescheiterter
    // Abruf unsichtbar.
    renderMitProviders(
      <Sidebar
        {...ebenenProps}
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
    renderMitProviders(<Sidebar {...ebenenProps} ansichten={[]} />);
    expect(
      screen.queryByText('Kartenansichten konnten nicht geladen werden'),
    ).not.toBeInTheDocument();
  });

  /**
   * „Verortet" hat keinen eigenen Fehlerkasten, aber seine Zahlen dürfen nicht lügen: im Fehlerfall
   * wären sie eine ungeprüfte Behauptung über die Lage.
   */
  const uhsNord = {
    schluessel: 'uhs-7',
    typ: 'uhs' as const,
    id: 7,
    lat: 50,
    lon: 8,
    label: 'UHS Nord',
    farbe: '#1677ff',
  };

  it('„Verortet": die Zählungen zeigen im Fehlerfall keinen Wert, und die Leere wird nicht behauptet', () => {
    const { unmount } = renderMitProviders(
      <Sidebar {...basisProps} suchbar={[uhsNord]} sektionFehler={{ nichtVerortet: slot }} />,
    );
    expect(screen.getByText('Unfallhilfsstelle (—)')).toBeInTheDocument();
    expect(screen.queryByText('Unfallhilfsstelle (1)')).not.toBeInTheDocument();
    unmount();
    renderMitProviders(
      <Sidebar {...basisProps} suchbar={[]} sektionFehler={{ nichtVerortet: slot }} />,
    );
    expect(screen.queryByText('Nichts verortet')).not.toBeInTheDocument();
  });

  it('„Verortet": ohne Fehler zählen sie wie bisher', () => {
    renderMitProviders(<Sidebar {...basisProps} suchbar={[uhsNord]} />);
    expect(screen.getByText('Unfallhilfsstelle (1)')).toBeInTheDocument();
    expect(screen.queryByText('Unfallhilfsstelle (—)')).not.toBeInTheDocument();
  });

  it('„Verortet" durchsucht die übergebene Suchquelle über alle Objektarten (LFH-716)', async () => {
    const onMarkerWaehlen = vi.fn();
    renderMitProviders(
      <Sidebar
        {...basisProps}
        // `verortet` bleibt leer: die Suche liest `suchbar`, nicht die Ebenen-Quelle.
        suchbar={[
          uhsNord,
          { ...uhsNord, schluessel: 'einheit-3', typ: 'einheit', id: 3, label: 'Florian Nord 1' },
          { ...uhsNord, schluessel: 'fahrzeug-4', typ: 'fahrzeug', id: 4, label: 'RTW Süd' },
        ]}
        onMarkerWaehlen={onMarkerWaehlen}
      />,
    );
    await userEvent.type(screen.getByLabelText('Kartenobjekte suchen'), 'nord');
    expect(screen.queryByRole('button', { name: 'RTW Süd' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Florian Nord 1' }));
    expect(onMarkerWaehlen).toHaveBeenCalledWith('einheit-3');
  });

  it('wählt einen verorteten Marker mit Space über die Auswahlzeile', async () => {
    const user = userEvent.setup();
    const onMarkerWaehlen = vi.fn();
    renderMitProviders(
      <Sidebar {...basisProps} suchbar={[uhsNord]} onMarkerWaehlen={onMarkerWaehlen} />,
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
 * Trefflächenboden der handgebauten Bedienziele. Geprüft wird die reine Funktion gegen die
 * Dichtestufen (nacktes `ConfigProvider` in `test/utils.tsx`, kein Layout in jsdom). Die Böden
 * stehen als Literale da, sonst prüfte der Token sich selbst.
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
   * Der Wert zieht mit — erst die Ungleichheit über die Stufen ließe eine falsche Quelle
   * auffliegen.
   */
  it('wächst über die Dichtestufen, statt auf einer Stufe zu kleben', () => {
    const hoehen = (['kompakt', 'komfortabel', 'handschuh'] as const).map(
      (s) => bedienzielStil(tokenFuer(s)).minHeight,
    );
    expect(hoehen[0]).toBeLessThan(hoehen[1]);
    expect(hoehen[1]).toBeLessThan(hoehen[2]);
  });

  /**
   * Zwei Angaben: die Polsterung allein trägt den Boden nicht (Handschuh grob 54 statt 72 px), muss
   * aber mitziehen, sonst klebt der Text an der Kante.
   */
  it('trägt neben der Höhe eine mitziehende Polsterung', () => {
    expect(bedienzielStil(tokenFuer('kompakt')).padding).toBe('7px 11px');
    expect(bedienzielStil(tokenFuer('handschuh')).padding).toBe('16px 26px');
  });
});

/**
 * Schalterzeilen dürfen umbrechen: der Kippschalter ist im Handschuh 144 px breit, die Leiste 300
 * px. Ob der Umbruch greift, misst `e2e/lagekarte-leiste-dichte.spec.ts`; hier stehen seine zwei
 * Voraussetzungen als Literale.
 */
describe('Sidebar: Umbruchregel der Schalterzeilen (LFH-380)', () => {
  const tokenFuer = (stufe: keyof typeof dichten) => ({
    controlHeight: dichten[stufe].zeilenhoehe,
    marginXS: dichten[stufe].abstand.xs,
  });

  it('die Zeile bricht um, statt über die Leiste hinauszulaufen', () => {
    expect(leistenZeileStil(tokenFuer('handschuh')).flexWrap).toBe('wrap');
  });

  it('der Namensteil reserviert Name plus ein Bedienziel der Stufe, bei Basis 0', () => {
    // Basis 0: sonst entschiede die Inhaltsbreite über den Umbruch, nicht der Boden.
    expect(namensteilStil(tokenFuer('kompakt')).flex).toBe('1 1 0');
    expect(namensteilStil(tokenFuer('kompakt')).minWidth).toBe('calc(6em + 30px)');
    expect(namensteilStil(tokenFuer('handschuh')).minWidth).toBe('calc(6em + 72px)');
  });
});

/**
 * Nebenläufigkeit an der Löschbestätigung: die Bildliste kommt live und kann sich ändern, während
 * die Rückfrage offen steht. Hing der Dialog an `loeschBildId != null`, blieb er stehen, mit leerem
 * Titel und einem DELETE auf ein verschwundenes Objekt.
 *
 * Geprüft wird die reine Funktion: antd schließt ein Modal über `transitionend`, das in jsdom nie
 * feuert — die DOM-Zusicherung wäre rot, obwohl die Härtung greift.
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
    // Derselbe Zustand nach einem Live-Update, das genau dieses Bild entfernt hat:
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
 * Die rechte Leiste: Ebenen (Farbfeld · Name · Anzahl, Klick schaltet), Ausgewählt, und die
 * einklappbaren Paneele.
 */
describe('Sidebar: Paneel „Ebenen"', () => {
  // Alle Gruppen offen: „Betroffene & Versorgung“ startet zu.
  beforeEach(paneeleOffen);
  /** Die schaltbaren Zeilen der eigenen Ebenen über alle Gruppen. */
  const eigeneZeilen = () =>
    ['Kräfte', 'Lage', 'Betroffene & Versorgung'].flatMap((g) =>
      within(screen.getByRole('group', { name: g })).queryAllByRole('switch'),
    );
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
    renderMitProviders(<Sidebar {...ebenenProps} verortet={[uhs(1), uhs(2)]} zonenAnzahl={4} />);
    expect(screen.getByRole('switch', { name: 'UHS' })).toHaveTextContent('UHS2');
    expect(screen.getByRole('switch', { name: 'Zonen' })).toHaveTextContent('Zonen4');
    expect(screen.getByRole('switch', { name: 'Schäden' })).toHaveTextContent('Schäden0');
  });

  it('zeigt im Fehlerfall „—" statt einer Null — an jeder Zeile', () => {
    renderMitProviders(
      <Sidebar
        {...ebenenProps}
        verortet={[uhs(1)]}
        sektionFehler={{ nichtVerortet: { text: 'Objektlisten konnten nicht geladen werden' } }}
      />,
    );
    const zeilen = eigeneZeilen();
    // Zehn Ebenen und die Führungsstelle (LFH-1181).
    expect(zeilen).toHaveLength(11);
    for (const z of zeilen) expect(z).toHaveTextContent('—');
    expect(screen.getByRole('switch', { name: 'UHS' })).not.toHaveTextContent('1');
  });

  // Ebene „Betroffene" — die Zeile folgt dem Zugriff, gepaart gegen die Vorgabe.
  it('„Betroffene" frei: zwölfte schaltbare Zeile mit Anzahl; ohne Angabe bleibt es bei elf', () => {
    const { unmount } = renderMitProviders(<Sidebar {...ebenenProps} />);
    expect(eigeneZeilen()).toHaveLength(11);
    expect(screen.queryByRole('switch', { name: 'Betroffene' })).toBeNull();
    unmount();

    const onLayerToggle = vi.fn();
    renderMitProviders(
      <Sidebar
        {...ebenenProps}
        onLayerToggle={onLayerToggle}
        personen={{ zugriff: 'frei', anzahl: 3 }}
      />,
    );
    expect(eigeneZeilen()).toHaveLength(12);
    const zeile = screen.getByRole('switch', { name: 'Betroffene' });
    expect(zeile).toHaveTextContent('Betroffene3');
    expect(zeile).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(zeile);
    expect(onLayerToggle).toHaveBeenCalledWith('person', true);
  });

  it('„Betroffene" gesperrt: nicht schaltbar, Grund statt Zahl, Schloss ohne eigenes Vorleseziel', () => {
    const onLayerToggle = vi.fn();
    renderMitProviders(
      <Sidebar
        {...ebenenProps}
        layer={{ ...basisProps.layer, person: true }}
        onLayerToggle={onLayerToggle}
        personen={{ zugriff: 'gesperrt', anzahl: 7 }}
      />,
    );
    // Kein Schalter — eine gesperrte Ebene hat keinen Zustand, den man umlegen könnte.
    expect(screen.queryByRole('switch', { name: /Betroffene/ })).toBeNull();
    const zeile = screen.getByRole('button', { name: 'Betroffene – Keine Berechtigung' });
    expect(zeile).toBeDisabled();
    expect(within(zeile).getByText('Keine Berechtigung')).toBeInTheDocument();
    // Keine Zahl: sie wäre die Menge, die der Benutzer nicht sehen darf.
    expect(zeile.textContent).not.toMatch(/\d/);
    // Das Schloss ist Dekoration (aria-hidden-Hülle), kein englisches „lock" im Vorlesebaum.
    expect(within(zeile).queryByRole('img')).toBeNull();
    fireEvent.click(zeile);
    expect(onLayerToggle).not.toHaveBeenCalled();
    // Eingeschaltet in der geteilten Ansicht — trotzdem keine Legende.
    expect(screen.queryByRole('list', { name: 'Sichtungslegende' })).toBeNull();
  });

  it('„Betroffene" im Rückblick: Grund „Nicht in gesicherten Lageständen"', () => {
    renderMitProviders(
      <Sidebar {...ebenenProps} personen={{ zugriff: 'rueckblick', anzahl: 0 }} />,
    );
    expect(
      screen.getByRole('button', { name: 'Betroffene – Nicht in gesicherten Lageständen' }),
    ).toBeDisabled();
  });

  it('Sichtungslegende nur bei eingeschalteter, freier Ebene', () => {
    const { rerender } = renderMitProviders(
      <Sidebar {...ebenenProps} personen={{ zugriff: 'frei', anzahl: 1 }} />,
    );
    expect(screen.queryByRole('list', { name: 'Sichtungslegende' })).toBeNull();
    rerender(
      <Sidebar
        {...ebenenProps}
        layer={{ ...basisProps.layer, person: true }}
        personen={{ zugriff: 'frei', anzahl: 1 }}
      />,
    );
    expect(screen.getByRole('list', { name: 'Sichtungslegende' })).toBeInTheDocument();
  });

  it('trägt den Zustand als Wort (aria-checked), nicht nur am Farbfeld', () => {
    const onLayerToggle = vi.fn();
    renderMitProviders(
      <Sidebar
        {...ebenenProps}
        layer={{ ...basisProps.layer, schaden: false }}
        onLayerToggle={onLayerToggle}
      />,
    );
    const schaden = screen.getByRole('switch', { name: 'Schäden' });
    expect(schaden).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(schaden);
    expect(onLayerToggle).toHaveBeenCalledWith('schaden', true);
    // Aus: Farbfeld leer, an: gefüllt — der zweite Kanal ist sichtbar.
    const feldAus = schaden.querySelector('[data-lfh="ebenen-farbfeld"]') as HTMLElement;
    const feldAn = screen
      .getByRole('switch', { name: 'UHS' })
      .querySelector('[data-lfh="ebenen-farbfeld"]') as HTMLElement;
    expect(feldAus.style.background).toBe('transparent');
    // Die Füllung „an" ist ein `color-mix(…)`, den jsdom still verwirft. Der Rahmen trägt in jsdom:
    // an in der Ebenenfarbe, aus in der Steuerrahmen-Rolle.
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
  it('sagt ohne Auswahl nur „Nichts gewählt“, keine Anleitung (LFH-1083)', () => {
    renderMitProviders(<Sidebar {...basisProps} />);
    const paneel = screen.getByRole('region', { name: 'Ausgewählt' });
    expect(paneel).toHaveTextContent(/Nichts gewählt/);
    expect(paneel).not.toHaveTextContent(/antippen|Verortet/);
  });

  it('zeigt den übergebenen Inspector-Inhalt statt des Hinweises', () => {
    renderMitProviders(<Sidebar {...basisProps} auswahl={<div>Inspector-Inhalt</div>} />);
    const paneel = screen.getByRole('region', { name: 'Ausgewählt' });
    expect(within(paneel).getByText('Inspector-Inhalt')).toBeInTheDocument();
    expect(paneel).not.toHaveTextContent(/Nichts gewählt/);
  });
});

describe('Sidebar: einklappbare Paneele', () => {
  it('Vorgabe: Kräfte und Lage offen, die übrigen Gruppen zu', () => {
    renderMitProviders(<Sidebar {...ebenenProps} />);
    const kopf = (name: RegExp) => screen.getByRole('button', { name });
    expect(kopf(/^Kräfte/)).toHaveAttribute('aria-expanded', 'true');
    expect(kopf(/^Lage/)).toHaveAttribute('aria-expanded', 'true');
    expect(kopf(/^Betroffene & Versorgung/)).toHaveAttribute('aria-expanded', 'false');
    expect(kopf(/^Fachebenen/)).toHaveAttribute('aria-expanded', 'false');
    expect(kopf(/^Hintergrund/)).toHaveAttribute('aria-expanded', 'false');
  });

  it('klappt Einmal-Einstellungen zu Beginn zu und öffnet sie auf Klick', () => {
    renderMitProviders(<Sidebar {...ebenenProps} bilder={[bildLageplan]} />);
    const kopf = screen.getByRole('button', { name: /^Hintergrund/ });
    expect(kopf).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Lageplan')).not.toBeInTheDocument();
    fireEvent.click(kopf);
    expect(kopf).toHaveAttribute('aria-expanded', 'true');
    // Die Untergruppe steht in der Vorgabe offen: ein Griff weniger.
    expect(screen.getByText('Lageplan')).toBeInTheDocument();
  });

  it('merkt sich die Wahl über ein Neuladen hinweg', () => {
    const { unmount } = renderMitProviders(<Sidebar {...ebenenProps} />);
    fireEvent.click(screen.getByRole('button', { name: /^Fachebenen/ }));
    unmount();
    renderMitProviders(<Sidebar {...ebenenProps} />);
    expect(screen.getByRole('button', { name: /^Fachebenen/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('hält ein Paneel mit Fehler offen — ein zugeklappter Fehler sähe aus wie „nichts da"', () => {
    localStorage.setItem(
      'lfh:lagekarte:ebenen-gruppen',
      JSON.stringify({ hintergrund: false, bilder: false }),
    );
    renderMitProviders(
      <Sidebar
        {...ebenenProps}
        sektionFehler={{ bilder: { text: 'Bild-Hintergründe konnten nicht geladen werden' } }}
      />,
    );
    expect(screen.getByRole('button', { name: /^Hintergrund/ })).toHaveAttribute(
      'aria-expanded',
      'true',
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

  it('startet die freie Skizze mit der gemeinsamen Vorgabefarbe (LFH-825)', () => {
    localStorage.setItem('lfh:lagekarte:paneele', JSON.stringify({ zeichnen: true }));
    const onZoneZeichnenStart = vi.fn();
    renderMitProviders(<Sidebar {...basisProps} onZoneZeichnenStart={onZoneZeichnenStart} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fläche' }));
    fireEvent.click(screen.getByRole('button', { name: 'Linie' }));
    expect(onZoneZeichnenStart.mock.calls).toEqual([
      [{ typ: 'freie_skizze', modus: 'polygon', farbe: FREIE_SKIZZE_VORGABEFARBE }],
      [{ typ: 'freie_skizze', modus: 'linie', farbe: FREIE_SKIZZE_VORGABEFARBE }],
    ]);
  });

  it('ohne Schreibrecht gibt es kein Paneel „Zeichnen"', () => {
    renderMitProviders(<Sidebar {...basisProps} darfSchreiben={false} />);
    expect(screen.queryByRole('button', { name: 'Zeichnen' })).not.toBeInTheDocument();
  });
});

/**
 * Suchfeld über „Nicht verortet": in einer realen Lage ist die Liste lang, die Leiste nur 300 px
 * breit — ab fünf Einträgen ist Tippen schneller als Scrollen.
 */
describe('Sidebar „Nicht verortet": Suche (LFH-360)', () => {
  const fuenf: NichtVerortet[] = [
    { typ: 'uhs', id: 1, label: 'UHS Nord' },
    { typ: 'fahrzeug', id: 2, label: 'ELW 1' },
    { typ: 'einheit', id: 3, label: '1. Zug' },
    { typ: 'einheit', id: 4, label: '2. Zug' },
    { typ: 'fuehrung', id: 5, label: 'Meyer' },
  ];
  const feld = () => screen.queryByRole('textbox', { name: 'Nicht verortete Objekte durchsuchen' });

  it('Schwelle: ab fünf Einträgen, also bei mehr als vier', () => {
    expect(NICHT_VERORTET_SUCHE_AB).toBe(5);
  });

  it('bei vier Einträgen kein Suchfeld — die Leiste wächst im Normalfall nicht zu', () => {
    renderMitProviders(<Sidebar {...basisProps} nichtVerortet={fuenf.slice(0, 4)} />);
    // Positivkontrolle: die Liste selbst steht, sonst belegte die Abwesenheit nichts.
    expect(screen.getByText('UHS: UHS Nord')).toBeInTheDocument();
    expect(feld()).not.toBeInTheDocument();
  });

  it('bei fünf Einträgen steht das Suchfeld, und Tippen filtert live', async () => {
    renderMitProviders(<Sidebar {...basisProps} nichtVerortet={fuenf} />);
    const eingabe = feld();
    expect(eingabe).toBeInTheDocument();
    await userEvent.type(eingabe!, 'elw');
    expect(screen.getByText('Fahrzeug: ELW 1')).toBeInTheDocument();
    expect(screen.queryByText('UHS: UHS Nord')).not.toBeInTheDocument();
    expect(screen.queryByText('Einheit: 1. Zug')).not.toBeInTheDocument();
  });

  it('das Suchfeld trägt keine kleine Stufe — die Höhe kommt aus der Dichte-Staffel', () => {
    renderMitProviders(<Sidebar {...basisProps} nichtVerortet={fuenf} />);
    const eingabe = feld()!;
    // Die Klasse kann am Feld selbst oder an seiner Affix-Hülle (allowClear) sitzen.
    expect(eingabe).not.toHaveClass('ant-input-sm');
    expect(eingabe.closest('.ant-input-affix-wrapper')).not.toHaveClass(
      'ant-input-affix-wrapper-sm',
    );
  });

  it('der Knopfname „Nicht verortet N" nennt weiter die Gesamtzahl, nicht die Trefferzahl', async () => {
    renderMitProviders(<Sidebar {...basisProps} nichtVerortet={fuenf} />);
    await userEvent.type(feld()!, 'elw');
    // Paar: gefiltert auf EINEN Treffer — und der Kopf sagt weiter fünf.
    expect(screen.getAllByRole('button', { name: 'Platzieren' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Nicht verortet 5' })).toBeInTheDocument();
    // Die Trefferzahl steht als zweite, eigene Angabe im Körper.
    expect(screen.getByRole('status')).toHaveTextContent('1 von 5');
  });

  /**
   * Eine Live-Region meldet nur Änderungen an Inhalt, der schon da war — erschiene sie erst mit dem
   * ersten Treffer, hörte ein Vorleser den ersten Stand nicht.
   */
  it('die Trefferzeile steht mit dem Feld, ohne Suchbegriff leer', () => {
    renderMitProviders(<Sidebar {...basisProps} nichtVerortet={fuenf} />);
    expect(screen.getByRole('status')).toHaveTextContent(/^$/);
  });

  it('ohne Feld auch keine Trefferzeile', () => {
    renderMitProviders(<Sidebar {...basisProps} nichtVerortet={fuenf.slice(0, 4)} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('kein Treffer: eigene Meldung, und „Alles verortet" steht NICHT da', async () => {
    renderMitProviders(<Sidebar {...basisProps} nichtVerortet={fuenf} />);
    await userEvent.type(feld()!, 'xyz');
    expect(screen.getByText('Keine Treffer für „xyz"')).toBeInTheDocument();
    // Auch der Vorleser erfährt es: die Fokusstelle bleibt im Feld, die Region sagt es an.
    expect(screen.getByRole('status')).toHaveTextContent('0 von 5');
    expect(screen.queryByText('Alles verortet')).not.toBeInTheDocument();
    // Der Ausweg ist das Leeren am Feld — die Meldung bringt keinen eigenen Knopf mit.
    expect(screen.queryByRole('button', { name: /Treffer/ })).not.toBeInTheDocument();
    expect(feld()).toBeInTheDocument();
  });

  it('fällt die Liste unter die Schwelle, verschwindet der Filter mit dem Feld', async () => {
    const { rerender } = renderMitProviders(<Sidebar {...basisProps} nichtVerortet={fuenf} />);
    await userEvent.type(feld()!, 'elw');
    expect(screen.queryByText('UHS: UHS Nord')).not.toBeInTheDocument();

    // Das Fahrzeug ist verortet — vier bleiben, das Feld geht. Ohne Reset verschluckte ein
    // unsichtbarer Filter alle vier.
    const vier = fuenf.filter((o) => o.typ !== 'fahrzeug');
    rerender(<Sidebar {...basisProps} nichtVerortet={vier} />);
    expect(feld()).not.toBeInTheDocument();
    expect(screen.getByText('UHS: UHS Nord')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Platzieren' })).toHaveLength(4);

    // Wächst die Liste wieder, steht das Feld LEER da — der alte Begriff kommt nicht zurück.
    rerender(
      <Sidebar
        {...basisProps}
        nichtVerortet={[...vier, { typ: 'schaden', id: 9, label: 'S-009' }]}
      />,
    );
    expect(feld()).toHaveValue('');
    expect(screen.getAllByRole('button', { name: 'Platzieren' })).toHaveLength(5);
  });

  it('die Zeile im laufenden Platzier-Modus bleibt stehen — sie zeigt, was platziert wird', async () => {
    renderMitProviders(
      <Sidebar {...basisProps} nichtVerortet={fuenf} platzierungZiel={{ typ: 'uhs', id: 1 }} />,
    );
    await userEvent.type(feld()!, 'elw');
    // Positivkontrolle: der Filter wirkt auf die übrigen Zeilen …
    expect(screen.queryByText('Einheit: 1. Zug')).not.toBeInTheDocument();
    expect(screen.getByText('Fahrzeug: ELW 1')).toBeInTheDocument();
    // … aber die aktive Zeile steht samt ihrem Zustand.
    expect(screen.getByText('UHS: UHS Nord')).toBeInTheDocument();
    expect(screen.getByText('wird platziert')).toBeInTheDocument();
    // Gezählt werden nur echte Treffer: zwei Zeilen stehen, eine davon trifft.
    expect(screen.getByRole('status')).toHaveTextContent('1 von 5');
  });

  it('trifft nichts außer dem laufenden Ziel: „0 von N", die Zeile steht, keine Leermeldung', async () => {
    renderMitProviders(
      <Sidebar {...basisProps} nichtVerortet={fuenf} platzierungZiel={{ typ: 'uhs', id: 1 }} />,
    );
    await userEvent.type(feld()!, 'xyz');
    expect(screen.getByRole('status')).toHaveTextContent('0 von 5');
    expect(screen.getByText('UHS: UHS Nord')).toBeInTheDocument();
    expect(screen.getByText('wird platziert')).toBeInTheDocument();
    // Eine Leermeldung neben einer stehenden Zeile widerspräche sich selbst.
    expect(screen.queryByText('Keine Treffer für „xyz"')).not.toBeInTheDocument();
  });
});

describe('filtereNichtVerortet (LFH-360)', () => {
  const liste: NichtVerortet[] = [
    { typ: 'fahrzeug', id: 1, label: 'ELW 1' },
    { typ: 'einheit', id: 2, label: '1. Zug' },
    { typ: 'einheit', id: 3, label: '2. Zug' },
    { typ: 'fuehrung', id: 4, label: 'Meyer' },
    { typ: 'abschnitt', id: 5, label: 'EA Süd' },
  ];
  const ids = (r: NichtVerortet[]) => r.map((o) => o.id);

  it('leerer oder nur aus Leerzeichen bestehender Begriff lässt alles stehen', () => {
    expect(filtereNichtVerortet(liste, '', null)).toBe(liste);
    expect(filtereNichtVerortet(liste, '   ', null)).toBe(liste);
  });

  it('trifft das Label als Teilstring, Groß-/Kleinschreibung egal', () => {
    expect(ids(filtereNichtVerortet(liste, 'elw', null))).toEqual([1]);
    expect(ids(filtereNichtVerortet(liste, 'süd', null))).toEqual([5]);
  });

  it('trifft das Typ-Präfix — „einheit" findet alle Einheiten', () => {
    expect(ids(filtereNichtVerortet(liste, 'EINHEIT', null))).toEqual([2, 3]);
  });

  it('das Präfix ist das ANGEZEIGTE Wort: Führung heißt dort „Personal"', () => {
    expect(ids(filtereNichtVerortet(liste, 'personal', null))).toEqual([4]);
    expect(ids(filtereNichtVerortet(liste, 'fuehrung', null))).toEqual([]);
  });

  it('Leerzeichen am Rand zählen nicht mit', () => {
    expect(ids(filtereNichtVerortet(liste, '  zug ', null))).toEqual([2, 3]);
  });

  it('das laufende Platzierungsziel überlebt jeden Begriff', () => {
    expect(ids(filtereNichtVerortet(liste, 'elw', { typ: 'einheit', id: 3 }))).toEqual([1, 3]);
    // Gleiche id, anderer Typ: kein Treffer — die Kennung ist das Paar.
    expect(ids(filtereNichtVerortet(liste, 'elw', { typ: 'uhs', id: 3 }))).toEqual([1]);
  });
});

/**
 * Leistenmodi (LLH-1028, Spec „Modusbedienung ab lg im Modus-Band der Leiste“): die Bedienung steht
 * im Band unter der Segmentleiste (ab `lg`) bzw. im Fuß-Band (unter `lg`, LFH-765); die Zeilen der
 * Ansichten zeigen auf jeder Breite nur den Zustand. Je Breite genau ein Knopf je Handlung — auch
 * nach einem Wechsel der Ansicht. Inhalt des Bands im Einzelnen: `ModusBand.test.tsx`.
 */
describe('Sidebar: Leistenmodi im Modus-Band', () => {
  const einheit: NichtVerortet = { typ: 'einheit', id: 4, label: 'Pumpe Ost' };
  const platzieren = (onAbbrechen = vi.fn()) =>
    ({
      art: 'platzieren',
      objekt: 'Einheit: Pumpe Ost',
      onAbbrechen,
    }) as const;

  it('Platzieren aus „Nicht verortet": die Zeile sagt „wird platziert", das Band trägt „Abbrechen"', () => {
    const onAbbrechen = vi.fn();
    renderMitProviders(
      <Sidebar
        {...basisProps}
        nichtVerortet={[einheit]}
        platzierungZiel={{ typ: 'einheit', id: 4 }}
        platzierModus={platzieren(onAbbrechen)}
      />,
    );
    expect(screen.getByText('wird platziert')).toBeInTheDocument();
    const band = document.querySelector('[data-lfh="platzieren-hinweis"]') as HTMLElement;
    expect(band).toHaveTextContent('Platzieren · Einheit: Pumpe Ost');
    expect(screen.getAllByRole('button', { name: 'Abbrechen' })).toHaveLength(1);
    fireEvent.click(within(band).getByRole('button', { name: 'Abbrechen' }));
    expect(onAbbrechen).toHaveBeenCalled();
    expect(within(band).getByRole('button', { name: 'Übernehmen' })).toBeInTheDocument();
  });

  it('Abbrechen aus der anderen Ansicht: das Band bleibt, es gibt keinen zweiten Knopf', () => {
    renderMitProviders(
      <Sidebar
        {...ebenenProps}
        nichtVerortet={[einheit]}
        platzierungZiel={{ typ: 'einheit', id: 4 }}
        platzierModus={platzieren()}
      />,
    );
    expect(screen.getAllByRole('button', { name: 'Abbrechen' })).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Abbrechen' }).closest('[data-modus-band]'),
    ).not.toBeNull();
  });

  it('unter lg: Titel und Koordinate im Band, „Abbrechen" steht im Fuß', () => {
    renderMitProviders(
      <Sidebar
        {...basisProps}
        nichtVerortet={[einheit]}
        platzierungZiel={{ typ: 'einheit', id: 4 }}
        platzierModus={platzieren()}
        modusBedienung="fuss"
      />,
    );
    expect(screen.getByText('Platzieren · Einheit: Pumpe Ost')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Übernehmen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abbrechen' })).not.toBeInTheDocument();
  });

  it('Einsatzort: das Paneel sagt „wird platziert", ohne eigenes „Abbrechen"', () => {
    renderMitProviders(
      <Sidebar
        {...basisProps}
        platzierungZiel={{ typ: 'einsatzort', id: 0 }}
        platzierModus={{ art: 'platzieren', objekt: 'Einsatzort', onAbbrechen: vi.fn() }}
      />,
    );
    const paneel = document.querySelector('section[data-paneel="einsatzort"]') as HTMLElement;
    expect(within(paneel).getByText('wird platziert')).toBeInTheDocument();
    expect(within(paneel).queryByRole('button', { name: 'Abbrechen' })).toBeNull();
  });

  it('ohne Schreibrecht steht kein Band', () => {
    renderMitProviders(
      <Sidebar {...basisProps} darfSchreiben={false} platzierModus={platzieren()} />,
    );
    expect(document.querySelector('[data-modus-band]')).toBeNull();
  });
});

/**
 * Ansichten der Leiste (LLH-1028, Spec „Die Leiste gliedert sich in Ansichten“): Tabliste
 * „Ebenen“ · „Objekte“, beide Flächen montiert, nur die gewählte sichtbar.
 */
describe('Sidebar: Ansichten', () => {
  it('Tabliste mit zwei Segmenten, die ihre Fläche steuern', () => {
    renderMitProviders(<Sidebar {...ebenenProps} />);
    const liste = screen.getByRole('tablist', { name: 'Ansicht der Leiste' });
    const tabs = within(liste).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Ebenen', 'Objekte']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    const flaeche = document.getElementById(tabs[0].getAttribute('aria-controls')!)!;
    expect(flaeche).toHaveAttribute('role', 'tabpanel');
    expect(flaeche).not.toHaveAttribute('hidden');
    expect(document.getElementById(tabs[1].getAttribute('aria-controls')!)).toHaveAttribute(
      'hidden',
    );
  });

  it('ein Tipp auf „Objekte" meldet den Wechsel', () => {
    const onAnsichtWechsel = vi.fn();
    renderMitProviders(<Sidebar {...ebenenProps} onAnsichtWechsel={onAnsichtWechsel} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Objekte' }));
    expect(onAnsichtWechsel).toHaveBeenCalledWith('objekte');
  });

  it('der Suchbegriff der verborgenen Ansicht überlebt den Wechsel', () => {
    const { rerender } = renderMitProviders(<Sidebar {...ebenenProps} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Ebene suchen' }), {
      target: { value: 'pegel' },
    });
    rerender(<Sidebar {...basisProps} />);
    expect(screen.queryByRole('textbox', { name: 'Ebene suchen' })).toBeNull();
    rerender(<Sidebar {...ebenenProps} />);
    expect(screen.getByRole('textbox', { name: 'Ebene suchen' })).toHaveValue('pegel');
  });

  it('„Ausgewählt" steht über beiden Ansichten', () => {
    const { rerender } = renderMitProviders(<Sidebar {...ebenenProps} />);
    expect(screen.getByRole('heading', { name: 'Ausgewählt' })).toBeInTheDocument();
    rerender(<Sidebar {...basisProps} />);
    expect(screen.getByRole('heading', { name: 'Ausgewählt' })).toBeInTheDocument();
  });
});

/** Ebenenbaum (LLH-1028, Spec „Ebenenbaum“, „Gruppenschalter“, „Ebene suchen“). */
describe('Sidebar: Ebenenbaum', () => {
  beforeEach(paneeleOffen);

  it('ordnet die eigenen Ebenen ihren Gruppen zu und zählt an/gesamt im Kopf', () => {
    renderMitProviders(
      <Sidebar
        {...ebenenProps}
        layer={{ ...basisProps.layer, fahrzeug: false }}
        br={{ zugriff: 'frei' }}
        betreuung={{ zugriff: 'frei' }}
        personen={{ zugriff: 'frei', anzahl: 0 }}
      />,
    );
    const namen = (g: string) =>
      within(screen.getByRole('group', { name: g }))
        .getAllByRole('switch')
        .map((z) => z.getAttribute('aria-label'));
    expect(namen('Kräfte')).toEqual([
      'Einheiten',
      'Fahrzeuge',
      'Personal',
      'Abschnitte',
      'Bereitstellungsräume',
    ]);
    expect(namen('Lage')).toEqual([
      'Einsatzort',
      'Führungsstelle',
      'Zonen',
      'Schäden',
      'Lagemeldungen',
      'Taktische Zeichen',
    ]);
    expect(namen('Betroffene & Versorgung')).toEqual(['Betroffene', 'UHS', 'Betreuungsstellen']);
    expect(screen.getByRole('button', { name: 'Kräfte 4/5' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /^Kartengrundlage/ })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: /^Bild-Hintergründe/ }),
    ).toBeInTheDocument();
  });

  it('Gruppenschalter: „teilweise" als mixed, ein Tipp schaltet alle an', () => {
    const onLayerToggle = vi.fn();
    renderMitProviders(
      <Sidebar
        {...ebenenProps}
        layer={{ ...basisProps.layer, fahrzeug: false, fuehrung: false }}
        onLayerToggle={onLayerToggle}
      />,
    );
    const schalter = screen.getByRole('checkbox', { name: 'Kräfte: alle Ebenen' });
    expect(schalter).toHaveAttribute('aria-checked', 'mixed');
    fireEvent.click(schalter);
    expect(onLayerToggle.mock.calls).toEqual([
      ['fahrzeug', true],
      ['fuehrung', true],
    ]);
  });

  it('Gruppenschalter: an schaltet alle aus', () => {
    const onLayerToggle = vi.fn();
    renderMitProviders(<Sidebar {...ebenenProps} onLayerToggle={onLayerToggle} />);
    const schalter = screen.getByRole('checkbox', { name: 'Lage: alle Ebenen' });
    expect(schalter).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(schalter);
    expect(onLayerToggle).toHaveBeenCalledTimes(6);
    expect(onLayerToggle.mock.calls.every(([, an]) => an === false)).toBe(true);
  });

  it('Gruppenschalter lässt eine gesperrte Ebene aus — sie bleibt gesperrt mit Grund', () => {
    const onLayerToggle = vi.fn();
    renderMitProviders(
      <Sidebar
        {...ebenenProps}
        layer={{ ...basisProps.layer, uhs: false, betreuungsstelle: false }}
        personen={{ zugriff: 'gesperrt', anzahl: 3 }}
        betreuung={{ zugriff: 'frei' }}
        onLayerToggle={onLayerToggle}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Betroffene & Versorgung: alle Ebenen' }));
    expect(onLayerToggle.mock.calls).toEqual([
      ['uhs', true],
      ['betreuungsstelle', true],
    ]);
    expect(screen.getByRole('button', { name: 'Betroffene – Keine Berechtigung' })).toBeDisabled();
  });

  it('keinen Gruppenschalter an „Fachebenen" als Ganzem und an „Hintergrund"', () => {
    renderMitProviders(<Sidebar {...ebenenProps} />);
    const namen = screen.getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'));
    expect(namen).toEqual([
      'Kräfte: alle Ebenen',
      'Lage: alle Ebenen',
      'Betroffene & Versorgung: alle Ebenen',
      'Warnungen: alle Ebenen',
      'Wasser: alle Ebenen',
      'Umwelt: alle Ebenen',
      'Verkehr & Infrastruktur: alle Ebenen',
    ]);
  });

  it('Untergruppe der Fachebenen schaltet ihre Quellen', () => {
    const onFachebeneToggle = vi.fn();
    renderMitProviders(<Sidebar {...ebenenProps} onFachebeneToggle={onFachebeneToggle} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Wasser: alle Ebenen' }));
    expect(onFachebeneToggle.mock.calls).toEqual([
      ['pegelonline', true],
      ['hochwasser', true],
    ]);
  });

  it('eine Fachebene ist eine Zeile wie jede Ebene: die Zeile ist der Schalter', () => {
    const onFachebeneToggle = vi.fn();
    renderMitProviders(
      <Sidebar
        {...ebenenProps}
        fachebenenSichtbar={{ ...basisProps.fachebenenSichtbar, dwd: true }}
        fachebenenStatus={{ dwd: 'offline' }}
        onFachebeneToggle={onFachebeneToggle}
      />,
    );
    const zeile = screen.getByRole('switch', { name: FACHEBENEN.dwd.label });
    expect(zeile.tagName).toBe('BUTTON');
    expect(zeile).toHaveAttribute('aria-checked', 'true');
    // Der Zustand ist Teil der Beschreibung der Zeile.
    expect(zeile).toHaveAccessibleDescription(/offline/);
    expect(
      zeile.closest('[data-fachebene="dwd"]')!.querySelectorAll('[role="switch"]'),
    ).toHaveLength(1);
    fireEvent.click(zeile);
    expect(onFachebeneToggle).toHaveBeenCalledWith('dwd', false);
  });

  it('„Ebene suchen" öffnet Gruppen mit Treffern, ohne den gemerkten Zustand zu ändern', () => {
    localStorage.removeItem('lfh:lagekarte:ebenen-gruppen');
    renderMitProviders(<Sidebar {...ebenenProps} />);
    const feld = screen.getByRole('textbox', { name: 'Ebene suchen' });
    fireEvent.change(feld, { target: { value: 'pegel' } });
    expect(screen.getByRole('switch', { name: FACHEBENEN.pegelonline.label })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Wasser/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    // Nur die Treffer stehen; andere Gruppen fallen weg.
    expect(screen.queryByRole('button', { name: /^Kräfte/ })).toBeNull();
    fireEvent.change(feld, { target: { value: '' } });
    expect(screen.getByRole('button', { name: /^Fachebenen/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('„Ebene suchen": ein Gruppenname lässt die ganze Gruppe stehen', () => {
    renderMitProviders(<Sidebar {...ebenenProps} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Ebene suchen' }), {
      target: { value: 'kräfte' },
    });
    expect(
      within(screen.getByRole('group', { name: 'Kräfte' })).getAllByRole('switch'),
    ).toHaveLength(4);
  });

  it('„Ebene suchen" ohne Treffer: genau ein Leerzustand mit dem Begriff', () => {
    renderMitProviders(<Sidebar {...ebenenProps} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Ebene suchen' }), {
      target: { value: 'xyz' },
    });
    expect(screen.getAllByText('Keine Ebene zu „xyz“')).toHaveLength(1);
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  it('die Kartenansicht steht im Kopf der Ebenen', () => {
    renderMitProviders(<Sidebar {...ebenenProps} ansichtDirty />);
    const kopf = document.querySelector('section[data-paneel="ansicht"]') as HTMLElement;
    expect(within(kopf).getByRole('button', { name: 'In dieser Ansicht speichern' })).toBeVisible();
    // Kein Klappkopf: die Kartenansicht ist kein Abschnitt zwischen den Ebenen.
    expect(within(kopf).queryByRole('button', { expanded: false })).toBeNull();
  });
});

describe('platzierObjekt (LFH-765)', () => {
  const liste: NichtVerortet[] = [{ typ: 'einheit', id: 4, label: 'Pumpe Ost' }];

  it('nennt Typ und Namen wie die Zeile in „Nicht verortet"', () => {
    expect(platzierObjekt({ typ: 'einheit', id: 4 }, liste)).toBe('Einheit: Pumpe Ost');
  });

  it('fällt ohne Eintrag auf den Typnamen zurück', () => {
    expect(platzierObjekt({ typ: 'uhs', id: 9 }, liste)).toBe('UHS');
    expect(platzierObjekt({ typ: 'person', id: 3 }, liste)).toBe('Betroffene Person');
    expect(platzierObjekt({ typ: 'einsatzort', id: 0 }, liste)).toBe('Einsatzort');
  });
});
