import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { dichten, farbenDunkel } from '../theme/tokens';
import ModulPanel, {
  modulBeschreibungStil,
  modulListenStil,
  modulMarkeStil,
  modulZeilenStil,
  sprungLinieStil,
} from './ModulPanel';
import { modulRegistry, type ModulEintrag } from './modulRegistry';
import { sprungmarkenNachKategorie, type Sprungmarke } from './sprungmarken';
import type { ModulFreigaben } from '../api/types';
import { freigabenFixture } from '../test/fixtures';
import { queryNavEintrag } from './navEintragTest';

/**
 * Freigaben wie vom Server (LFH-669). Die Liste unten trägt eigene Schlüssel (`sach`, `geheim`),
 * die die Registry nicht kennt — `freigabenFixture` nimmt jeden Schlüssel aus `abweichend` auf.
 * `geheim` ist gesperrt: das, was früher der Registry-Default `benoetigteRolle` ausrechnete,
 * sagt jetzt der Server.
 */
const freigaben = (abweichend: Parameters<typeof freigabenFixture>[0] = {}): ModulFreigaben =>
  freigabenFixture({ geheim: { zugriff: false }, ...abweichend });

const basis = (over: Partial<ModulEintrag>): ModulEintrag => ({
  key: 'k',
  kategorie: 'erfassung',
  label: 'L',
  icon: () => null,
  route: 'k',
  status: 'geplant',
  ...over,
});

const module: ModulEintrag[] = [
  basis({ key: 'etb', label: 'ETB', route: 'etb', status: 'fertig' }),
  basis({ key: 'sach', label: 'Sachschäden', route: 'sach', status: 'wip' }),
  basis({ key: 'geheim', label: 'Geheim', route: 'geheim' }),
];

describe('ModulPanel', () => {
  it('listet Module, markiert WIP, sperrt vom Server gesperrte', () => {
    renderMitProviders(
      <ModulPanel
        einsatzId={1}
        titel="Erfassung"
        module={module}
        freigaben={freigaben()}
        aktiverModulKey="etb"
        onModulKlick={() => {}}
      />,
    );
    expect(screen.getByText('Erfassung')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ETB/ })).toBeEnabled();
    expect(screen.getByRole('link', { name: /Sachschäden/ })).toBeEnabled();
    // Am Titel der Hülle greifen, nicht am Zeichen: der Glyph ist austauschbar, die Aussage ist der Titel.
    expect(screen.getByTitle('In Arbeit')).toBeInTheDocument();
    const geheim = screen.getByRole('button', { name: /Geheim/ });
    expect(geheim).toBeDisabled();
    // Das Schloss trägt bewusst KEINEN Titel (er verdrängte den des Knopfes), deshalb der
    // antd-Klassenselektor.
    expect(geheim.querySelector('[data-lfh-icon="schloss"]')).not.toBeNull();
  });

  // Der WIP-Marker ist Dekoration und darf nicht im Accessible Name des Knopfes landen,
  // wie das ↗ daneben (LFH-328).
  it('haelt den WIP-Marker aus dem Accessible Name heraus', () => {
    renderMitProviders(
      <ModulPanel
        einsatzId={1}
        titel="Erfassung"
        module={module}
        freigaben={freigaben()}
        aktiverModulKey={null}
        onModulKlick={() => {}}
      />,
    );
    expect(screen.getByRole('link', { name: 'Sachschäden' })).toBeInTheDocument();
    expect(screen.getByTitle('In Arbeit')).toBeInTheDocument();
    // Dasselbe gilt für das Schloss: die Sperre trägt `disabled` + `title`.
    expect(screen.getByRole('button', { name: 'Geheim' })).toBeDisabled();
  });

  it('markiert ein Deep-Link-Modul mit Hinweis-Symbol', () => {
    renderMitProviders(
      <ModulPanel
        einsatzId={1}
        titel="Lage"
        module={[
          basis({
            key: 'gefahrenzonen',
            label: 'Gefahren-/Absperrzonen',
            route: 'gefahrenzonen',
            status: 'fertig',
            verweistAuf: 'lagekarte',
          }),
        ]}
        freigaben={freigaben()}
        aktiverModulKey={null}
        onModulKlick={() => {}}
      />,
    );
    expect(screen.getByTitle('Lagekarte')).toBeInTheDocument();
  });

  it('blendet ein ausgeblendetes Modul nicht in der Liste ein (LFH-132)', () => {
    renderMitProviders(
      <ModulPanel
        einsatzId={1}
        titel="Erfassung"
        module={module}
        freigaben={freigaben({ sach: { sichtbar: false, zugriff: false } })}
        aktiverModulKey="etb"
        onModulKlick={() => {}}
      />,
    );
    expect(screen.getByRole('link', { name: /ETB/ })).toBeInTheDocument();
    expect(queryNavEintrag(/Sachschäden/)).not.toBeInTheDocument();
  });

  it('zeigt Module ungesperrt, solange die Freigaben unbekannt sind (LFH-669, D3)', () => {
    // Sonst blinkte beim Öffnen jedes Modul kurz als gesperrt; ein Klick in dieser Lücke führt
    // höchstens auf den 403-Zustand der Modulseite.
    renderMitProviders(
      <ModulPanel
        einsatzId={1}
        titel="Erfassung"
        module={module}
        aktiverModulKey={null}
        onModulKlick={() => {}}
      />,
    );
    expect(screen.getByRole('link', { name: /ETB/ })).toBeEnabled();
    expect(screen.getByRole('link', { name: /Sachschäden/ })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Geheim' })).toBeEnabled();
  });

  it('sperrt ein Modul, dem der Server den Zugriff verweigert (LFH-132/LFH-669)', () => {
    renderMitProviders(
      <ModulPanel
        einsatzId={1}
        titel="Erfassung"
        module={module}
        freigaben={freigaben({ etb: { zugriff: false } })}
        aktiverModulKey={null}
        onModulKlick={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /ETB/ })).toBeDisabled();
  });

  it('meldet Klick auf ein freies Modul', async () => {
    const onKlick = vi.fn();
    renderMitProviders(
      <ModulPanel
        einsatzId={1}
        titel="Erfassung"
        module={module}
        freigaben={freigaben()}
        aktiverModulKey={null}
        onModulKlick={onKlick}
      />,
    );
    await userEvent.click(screen.getByRole('link', { name: /ETB/ }));
    expect(onKlick).toHaveBeenCalledWith(expect.objectContaining({ key: 'etb' }));
  });

  it('zeigt einen neutralen Zähler und nimmt seine Bedeutung in den Accessible Name auf', () => {
    renderMitProviders(
      <ModulPanel
        einsatzId={1}
        titel="Kommunikation"
        module={[
          basis({
            key: 'meldungen',
            label: 'Meldungen',
            route: 'meldungen',
            status: 'fertig',
            zaehlerQuelle: 'meldungen',
          }),
        ]}
        freigaben={freigaben()}
        aktiverModulKey={null}
        onModulKlick={() => {}}
        zaehler={{ meldungen: { wert: 5, beschreibung: '5 offene Meldungen, davon 2 ungesehen' } }}
      />,
    );
    const knopf = screen.getByRole('link', {
      name: 'Meldungen, 5 offene Meldungen, davon 2 ungesehen',
    });
    const zahl = knopf.querySelector('[data-lfh="modul-zaehler"]');
    expect(zahl).not.toBeNull();
    expect(zahl!.textContent).toBe('5');
    expect(knopf.querySelector('.ant-badge')).toBeNull();
    expect(screen.getByTitle('5 offene Meldungen, davon 2 ungesehen')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('zeigt die Unwetterwarnungen am Modul „Wetter & Pegel" neutral mit Bedeutung (LFH-663)', () => {
    const wetter = modulRegistry.find((m) => m.key === 'wetter-pegel')!;
    renderMitProviders(
      <ModulPanel
        einsatzId={1}
        titel="Lage"
        module={[wetter]}
        freigaben={freigaben()}
        aktiverModulKey={null}
        onModulKlick={() => {}}
        zaehler={{
          'wetter-pegel': {
            wert: 2,
            beschreibung: '2 Unwetterwarnungen für den Einsatzort, davon 1 angekündigt',
          },
        }}
      />,
    );
    const knopf = screen.getByRole('link', {
      name: 'Wetter & Pegel, 2 Unwetterwarnungen für den Einsatzort, davon 1 angekündigt',
    });
    expect(knopf.querySelector('[data-lfh="modul-zaehler"]')!.textContent).toBe('2');
  });

  it('traegt den Testanker des e2e-Trefflaechennachweises', () => {
    // `e2e/trefflaeche-tablet.spec.ts` greift die Modulzeilen über dieses Merkmal; der Pin
    // bewacht den Anker hier statt erst im e2e-Lauf.
    const { container } = renderMitProviders(
      <ModulPanel
        einsatzId={1}
        titel="Erfassung"
        module={module}
        freigaben={freigaben()}
        aktiverModulKey={null}
        onModulKlick={() => {}}
      />,
    );
    expect(container.querySelector('[data-lfh="modul-panel"]')).not.toBeNull();
  });

  it('markiert das aktive Modul via aria-current', () => {
    /**
     * Der aktive Zustand muss programmatisch sichtbar sein, nicht nur über Fläche und
     * Schriftfarbe. Spiegelbild zu `IconRail.test.tsx`.
     */
    const { container } = renderMitProviders(
      <ModulPanel
        einsatzId={1}
        titel="Erfassung"
        module={module}
        freigaben={freigaben()}
        aktiverModulKey="etb"
        onModulKlick={() => {}}
      />,
    );
    expect(screen.getByRole('link', { name: /ETB/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('link', { name: /Sachschäden/ })).not.toHaveAttribute('aria-current');
    expect(container.querySelectorAll('[aria-current]')).toHaveLength(1);
  });

  it('traegt die Marker als Icon in aria-hidden-Huelle, nicht als Emoji', () => {
    /**
     * „Ein Emoji ist kein Icon": zwei Hälften, beide Pflicht. Die erste hält die
     * `role="img"`-Knoten der Icons (englisches `aria-label`) aus dem Vorlesebaum, die
     * zweite schließt aus, dass Emojis daneben stehen bleiben.
     */
    const { container } = renderMitProviders(
      <ModulPanel
        einsatzId={1}
        titel="Erfassung"
        module={[
          ...module,
          basis({ key: 'gz', label: 'Zonen', route: 'gz', verweistAuf: 'lagekarte' }),
        ]}
        freigaben={freigaben()}
        aktiverModulKey={null}
        onModulKlick={() => {}}
      />,
    );
    // „Geheim“ ist gesperrt und deshalb ein Knopf, die freien Einträge sind Links (LLH-1732).
    for (const knopf of [
      screen.getByRole('link', { name: 'Sachschäden' }),
      screen.getByRole('button', { name: 'Geheim' }),
      screen.getByRole('link', { name: 'Zonen' }),
    ]) {
      const name = knopf.textContent;
      expect(within(knopf).queryByRole('img'), `${name}: Icon ist kein Vorleseziel`).toBeNull();
    }
    expect(container.textContent, 'kein Emoji mehr im Baum').not.toMatch(/🚧|🔒|↗/);
  });
});

/**
 * Die Zeilenhöhe OHNE zu rendern: `test/utils.tsx` montiert ein nacktes `ConfigProvider`,
 * `useToken()` liefert dort den antd-Seed statt der Staffel 30/48/72.
 * Die Böden stehen als LITERALE da, sonst prüfte der Test den Token gegen sich selbst.
 */
describe('ModulPanel · Dichte', () => {
  const tokenFuer = (s: keyof typeof dichten) => ({
    controlHeight: dichten[s].zeilenhoehe,
    padding: dichten[s].abstand.md,
    paddingSM: dichten[s].abstand.sm,
    marginSM: dichten[s].abstand.sm,
    marginXS: dichten[s].abstand.xs,
    colorTextDisabled: '#GRAU',
  });
  const farben = {
    flaeche3: '#FLAECHE3',
    text: '#TEXT',
    text2: '#TEXT2',
    gedaempft: '#GEDAEMPFT',
    schwach: '#SCHWACH',
    bedien: '#BEDIEN',
  };
  const frei = { aktiv: false, gesperrt: false };
  const hoehe = (s: keyof typeof dichten, mindestTrefflaeche?: number) =>
    modulZeilenStil(tokenFuer(s), farben, { ...frei, mindestTrefflaeche }).minHeight;

  it('traegt ohne Trefflaechen-Prop den Boden aus controlHeight', () => {
    expect(hoehe('kompakt')).toBe(30);
    expect(hoehe('komfortabel')).toBe(48);
    expect(hoehe('handschuh')).toBe(72);
  });

  it('laesst die Drawer-Trefflaeche den Boden HEBEN, nie senken', () => {
    // Mit `??` statt `Math.max` stünde hier im Handschuh-Betrieb 48 — die Prop drehte die
    // Staffel zurück, statt sie zu ergänzen.
    expect(hoehe('kompakt', 48)).toBe(48);
    expect(hoehe('komfortabel', 48)).toBe(48);
    expect(hoehe('handschuh', 48)).toBe(72);
  });

  it('waechst ueber die Dichtestufen, statt auf einer Stufe zu kleben', () => {
    expect(hoehe('kompakt')).toBeLessThan(hoehe('komfortabel') as number);
    expect(hoehe('komfortabel')).toBeLessThan(hoehe('handschuh') as number);
  });

  it('traegt neben der Hoehe eine mitziehende Polsterung', () => {
    // Die ZWEITE Angabe (LFH-365): `minHeight` allein klebt den Text an die Kante.
    expect(modulZeilenStil(tokenFuer('kompakt'), farben, frei).padding).toBe('8px 12px');
    expect(modulZeilenStil(tokenFuer('handschuh'), farben, frei).padding).toBe('16px 24px');
  });

  it('liest beide Abstaende aus der Staffel', () => {
    expect(modulZeilenStil(tokenFuer('kompakt'), farben, frei).gap).toBe(8);
    expect(modulZeilenStil(tokenFuer('handschuh'), farben, frei).gap).toBe(16);
    // Die Liste trägt ihre Luft oben/unten aus `marginXS` — mit der Dichte, nicht aus dem
    // statischen `abstand`-Export (der ist die eingefrorene kompakte Stufe).
    expect(modulListenStil(tokenFuer('kompakt')).paddingBlock).toBe(8);
    expect(modulListenStil(tokenFuer('handschuh')).paddingBlock).toBe(16);
  });

  it('aktiv: Fläche flaeche3 und Text, dazu die Marke in bedien (Neuentwurf, LFH-618)', () => {
    const aktiv = modulZeilenStil(tokenFuer('kompakt'), farben, { ...frei, aktiv: true });
    expect(aktiv.background).toBe('#FLAECHE3');
    expect(aktiv.color).toBe('#TEXT');
    expect(modulMarkeStil(farben, true).background).toBe('#BEDIEN');
    // Inaktiv gedämpft, ohne Fläche — und die Marke bleibt als Platzhalter stehen, sonst
    // spränge das Etikett beim Aktivieren um die Markenbreite.
    const inaktiv = modulZeilenStil(tokenFuer('kompakt'), farben, frei);
    expect(inaktiv.background).toBe('transparent');
    expect(inaktiv.color).toBe('#GEDAEMPFT');
    expect(modulMarkeStil(farben, false)).toMatchObject({ width: 2, height: 16 });
    expect(modulMarkeStil(farben, false).background).toBe('transparent');
  });

  it('traegt den Steuer-Radius, nicht die weiche Ecke', () => {
    expect(modulZeilenStil(tokenFuer('kompakt'), farben, frei).borderRadius).toBe(0);
  });

  // LLH-1732: die freie Zeile ist ein Link und erbte die App-Schrift samt Zeilenhöhe, die gesperrte
  // ein Knopf mit der Systemschrift des Browsers. Beide tragen deshalb die Schrift der App
  // (Archivo, Entwurf) und die Zeilenhöhe `normal`, die die Zeile vorher als Knopf hatte.
  it('gibt Link und Knopf dieselbe Schrift: Archivo der App, Zeilenhöhe wie bisher', () => {
    for (const gesperrt of [false, true]) {
      const stil = modulZeilenStil(tokenFuer('kompakt'), farben, { ...frei, gesperrt });
      expect(stil.fontFamily).toBe('inherit');
      expect(stil.lineHeight).toBe('normal');
    }
  });

  // Spec `modul-sprungmarken`, „Eine Sprungmarke erscheint als eingerückte Unteransicht“
  // (LLH-1733): die Linie steht in der Spalte der Modulmarke, das Etikett rückt um `padding` ein.
  it('Sprungmarke: Linie in `linie` über die ganze Zeilenhöhe, fester Einzug', () => {
    const linie = (s: keyof typeof dichten) => sprungLinieStil(tokenFuer(s), { linie: '#LINIE' });
    expect(linie('kompakt')).toMatchObject({
      width: 1,
      alignSelf: 'stretch',
      background: '#LINIE',
      flexShrink: 0,
    });
    // Die Linie reicht durch die Polsterung der Zeile, damit Marken untereinander eine
    // durchgehende Linie bilden.
    expect(linie('kompakt').marginBlock).toBe(-8);
    expect(linie('handschuh').marginBlock).toBe(-16);
    // Fester Einzug statt `padding` der Dichte: gesperrt (Schloss) kürzte sonst in komfortabel
    // und Handschuh die Namen („Entscheidu…“), Review-Befund LLH-1733.
    for (const s of ['kompakt', 'komfortabel', 'handschuh'] as const) {
      expect(linie(s).marginInlineEnd, s).toBe(10);
    }
  });
});

describe('ModulPanel · Einsatzdauer im Fuß', () => {
  it('zeigt die Dauer seit Beginn, wenn der Einsatz da ist', () => {
    renderMitProviders(
      <ModulPanel
        einsatzId={1}
        titel="Führung"
        module={module}
        freigaben={freigaben()}
        aktiverModulKey={null}
        onModulKlick={() => {}}
        einsatz={{ begonnen_at: '2026-01-01 00:00:00', abgeschlossen_at: '2026-01-01 06:41:00' }}
      />,
    );
    expect(screen.getByText('Einsatzdauer')).toBeInTheDocument();
    expect(screen.getByText('06:41 h')).toBeInTheDocument();
  });

  it('lässt den Fuß ohne Einsatz weg, statt eine Dauer zu erfinden', () => {
    const { container } = renderMitProviders(
      <ModulPanel
        einsatzId={1}
        titel="Führung"
        module={module}
        freigaben={freigaben()}
        aktiverModulKey={null}
        onModulKlick={() => {}}
      />,
    );
    expect(container.querySelector('[data-lfh="modul-panel-fuss"]')).toBeNull();
  });

  /**
   * zjt7c073 D4: Das Panel klebt wie die Rail als eine Spalte unter dem Kopf. Kopf und Fuß stehen
   * fest, nur die Liste rollt in sich — so liegt kein Teil über einem anderen. Die Geometrie misst
   * `e2e/rahmen-stehen-bleiben.spec.ts`.
   */
  it('klebt als Spalte unter dem Kopf; nur die Liste rollt, Kopf und Fuß stehen fest', () => {
    const { container } = renderMitProviders(
      <ModulPanel
        einsatzId={7}
        titel="Führung"
        einsatz={{ begonnen_at: '2026-11-15T08:00:00Z', abgeschlossen_at: null }}
        module={module}
        freigaben={freigaben()}
        aktiverModulKey={null}
        onModulKlick={() => {}}
      />,
    );
    const spalte = container.querySelector<HTMLElement>('[data-lfh="modul-panel-spalte"]')!;
    expect(spalte.style.position).toBe('sticky');
    expect(spalte.style.top).toBe('var(--lfh-kopf-oben, 0px)');
    // Die Höhe ist gemessen (Review B2): vom Ort der Spalte im Fenster bis zum Fensterrand.
    expect(spalte.style.height).toBe(`${window.innerHeight}px`);
    expect(spalte.style.overflowY).not.toBe('auto');
    const liste = spalte.querySelector<HTMLElement>('[data-lfh="modul-panel-liste"]')!;
    expect(liste.style.overflowY).toBe('auto');
    expect(liste.style.minHeight).toBe('0px');
    const fuss = spalte.querySelector<HTMLElement>('[data-lfh="modul-panel-fuss"]')!;
    // Der Fuß klebt nicht mehr am Fensterrand des Dokuments, er steht am Ende der Spalte.
    expect(fuss.style.position).toBe('');
    expect(fuss.style.flexShrink).toBe('0');
    expect(liste.compareDocumentPosition(fuss) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('trägt Kopf-Augenbraue und Panelgrund aus den Nachtrollen (Vorgabe)', () => {
    const { container } = renderMitProviders(
      <ModulPanel
        einsatzId={1}
        titel="Führung"
        module={module}
        freigaben={freigaben()}
        aktiverModulKey={null}
        onModulKlick={() => {}}
      />,
    );
    const panel = container.querySelector<HTMLElement>('[data-lfh="modul-panel"]')!;
    expect(panel).toHaveStyle({ backgroundColor: farbenDunkel.paneel, width: '208px' });
    expect(screen.getByText('Führung')).toHaveStyle({ textTransform: 'uppercase' });
  });
});

/**
 * Sprungmarken (LFH-620) erben Sichtbarkeit und Sperre ihres ZIELmoduls — geprüft an einem
 * echten Registry-Schlüssel, weil `sprungZiel` in der Registry nachschlägt. Die Fixture hängt die
 * Marke bewusst hinter ein FREMDES Modul (Aufträge): so trennt sie Anker und Ziel. Die echte
 * Tabelle stellt sie seit LLH-1733 unter ihr Ziel (`sprungmarken.test.ts`).
 */
describe('ModulListe — Sprungmarken', () => {
  const marke: Sprungmarke = {
    key: 'entscheidungen',
    kategorie: 'fuehrung',
    label: 'Entscheidungen',
    zielModul: 'etb',
    nach: 'auftraege',
    hinweis: 'ETB · Entscheidung',
    schlagworte: [],
    pfad: () => '/einsaetze/1/etb?typ=entscheidung',
  };
  const fuehrung: ModulEintrag[] = [
    basis({ key: 'auftraege', kategorie: 'fuehrung', label: 'Aufträge', status: 'fertig' }),
    basis({
      key: 'lagebesprechung',
      kategorie: 'fuehrung',
      label: 'Lagebesprechung',
      status: 'fertig',
    }),
  ];
  const zeige = (props: { freigaben?: ModulFreigaben; onSprungKlick?: (m: Sprungmarke) => void }) =>
    renderMitProviders(
      <ModulPanel
        einsatzId={1}
        titel="Führung"
        module={fuehrung}
        freigaben={freigaben()}
        aktiverModulKey="auftraege"
        onModulKlick={() => {}}
        sprungmarken={[marke]}
        {...props}
      />,
    );

  it('steht hinter ihrem Anker, nennt das Ziel im Namen und ist nie aktuell', async () => {
    const klick = vi.fn();
    zeige({ onSprungKlick: klick });
    const knoepfe = screen.getAllByRole('link').map((b) => b.textContent);
    expect(knoepfe).toEqual(['Aufträge', 'Entscheidungen', 'Lagebesprechung']);
    const sprung = screen.getByRole('link', {
      name: 'Entscheidungen, springt zu ETB · Entscheidung',
    });
    // Der Titel nennt nur das Ziel, kein Verb (LFH-1078).
    expect(sprung).toHaveAttribute('title', 'ETB · Entscheidung');
    expect(sprung).not.toHaveAttribute('aria-current');
    // Unteransicht, kein Link nach außen (LLH-1733): kein Pfeil, dafür die Führungslinie.
    expect(sprung.querySelector('[data-lfh-icon="extern-pfeil"]')).toBeNull();
    expect(sprung.querySelector('[data-lfh="sprung-linie"]')).not.toBeNull();
    expect(within(sprung).queryByRole('img')).not.toBeInTheDocument();
    await userEvent.click(sprung);
    expect(klick).toHaveBeenCalledWith(marke);
  });

  it('verschwindet mit dem ausgeblendeten Zielmodul, nicht mit dem Anker', () => {
    const { unmount } = zeige({
      freigaben: freigabenFixture({ etb: { sichtbar: false, zugriff: false } }),
    });
    expect(queryNavEintrag(/Entscheidungen/)).not.toBeInTheDocument();
    unmount();
    // Gegenprobe: ein ausgeblendeter ANKER nimmt die Marke nicht mit.
    zeige({ freigaben: freigabenFixture({ auftraege: { sichtbar: false, zugriff: false } }) });
    expect(screen.getByRole('link', { name: /Entscheidungen/ })).toBeInTheDocument();
  });

  it('ist gesperrt, wenn das Zielmodul für den Benutzer gesperrt ist', async () => {
    const klick = vi.fn();
    zeige({ freigaben: freigabenFixture({ etb: { zugriff: false } }), onSprungKlick: klick });
    const sprung = screen.getByRole('button', { name: /Entscheidungen/ });
    expect(sprung).toBeDisabled();
    // Der Name steht mit im Titel: ist er im schmalen Panel gekürzt, bleibt er so lesbar.
    expect(sprung).toHaveAttribute('title', 'Entscheidungen · Keine Berechtigung');
    // Gesperrt wie eine Modulzeile: Schloss, eingerückt, ohne Pfeil.
    expect(sprung.querySelector('[data-lfh-icon="schloss"]')).not.toBeNull();
    expect(sprung.querySelector('[data-lfh-icon="extern-pfeil"]')).toBeNull();
    expect(sprung.querySelector('[data-lfh="sprung-linie"]')).not.toBeNull();
    await userEvent.click(sprung);
    expect(klick).not.toHaveBeenCalled();
  });
});

describe('ModulListe — Sprungmarke mit weiterem Modul (LLH-1312)', () => {
  const marke: Sprungmarke = {
    key: 'ohne-schicht',
    kategorie: 'kraefte',
    label: 'Ohne Schicht',
    zielModul: 'abloesung',
    nach: 'abloesung',
    hinweis: 'Ablösung · Ohne Schicht',
    schlagworte: [],
    braucht: 'einheiten',
    pfad: () => '/einsaetze/1/abloesung?ansicht=ohne-schicht',
  };
  const kraefte: ModulEintrag[] = [
    basis({ key: 'abloesung', kategorie: 'kraefte', label: 'Ablösung', status: 'fertig' }),
  ];
  const zeige = (freigabenWert?: ModulFreigaben) =>
    renderMitProviders(
      <ModulPanel
        einsatzId={1}
        titel="Kräfte"
        module={kraefte}
        freigaben={freigabenWert}
        aktiverModulKey="abloesung"
        onModulKlick={() => {}}
        sprungmarken={[marke]}
      />,
    );

  it('ist gesperrt, wenn das Modul aus `braucht` gesperrt ist, auch bei freiem Ziel', () => {
    zeige(freigabenFixture({ einheiten: { zugriff: false } }));
    const sprung = screen.getByRole('button', { name: /Ohne Schicht/ });
    expect(sprung).toBeDisabled();
    expect(sprung).toHaveAttribute('title', 'Ohne Schicht · Keine Berechtigung');
  });

  it('ist frei mit beiden Freigaben und flackert beim Laden nicht', () => {
    const { unmount } = zeige(freigabenFixture());
    expect(screen.getByRole('link', { name: /Ohne Schicht/ })).toBeEnabled();
    unmount();
    zeige(undefined);
    expect(screen.getByRole('link', { name: /Ohne Schicht/ })).toBeEnabled();
  });
});

describe('ModulListe · Beschreibung als zweite Zeile (LFH-965)', () => {
  const mitBeschreibung: ModulEintrag[] = [
    basis({
      key: 'etb',
      label: 'ETB',
      route: 'etb',
      status: 'fertig',
      beschreibung: 'Einsatztagebuch',
    }),
    basis({ key: 'sach', label: 'Sachschäden', route: 'sach', status: 'fertig' }),
    basis({ key: 'geheim', label: 'Geheim', route: 'geheim', beschreibung: 'Verschlusssache' }),
  ];

  it('zeigt die Beschreibung unter dem Namen, der Name bleibt der zugängliche Name', () => {
    renderMitProviders(
      <ModulPanel
        einsatzId={1}
        titel="Erfassung"
        module={mitBeschreibung}
        freigaben={freigaben()}
        aktiverModulKey="etb"
        onModulKlick={() => {}}
      />,
    );
    const etb = screen.getByRole('link', { name: 'ETB', description: 'Einsatztagebuch' });
    expect(within(etb).getByText('Einsatztagebuch')).toHaveAttribute(
      'data-lfh',
      'modul-beschreibung',
    );
    // Zu Lange endet in „…“; der volle Text steht im `title`.
    expect(etb).toHaveAttribute('title', 'Einsatztagebuch');
  });

  /**
   * LLH-1734 (Spec `modul-benennung`): im 208 px breiten Panel endete fast jede Beschreibung nach
   * einer Zeile in „…“. Sie bricht jetzt auf höchstens zwei Zeilen um, erst danach die Auslassung.
   * jsdom rechnet keinen Umbruch, deshalb am reinen Stil.
   */
  it('bricht die Beschreibung auf höchstens zwei Zeilen um, dann „…“', () => {
    const stil = modulBeschreibungStil({ schwach: '#777' }, false);
    expect(stil.whiteSpace).toBe('normal');
    expect(stil.display).toBe('-webkit-box');
    expect(stil.WebkitLineClamp).toBe(2);
    expect(stil.WebkitBoxOrient).toBe('vertical');
    expect(stil.overflow).toBe('hidden');
  });

  it('lässt ein Modul ohne Beschreibung einzeilig, ohne leere Beschreibung', () => {
    renderMitProviders(
      <ModulPanel
        einsatzId={1}
        titel="Erfassung"
        module={mitBeschreibung}
        freigaben={freigaben()}
        aktiverModulKey={null}
        onModulKlick={() => {}}
      />,
    );
    const sach = screen.getByRole('link', { name: 'Sachschäden' });
    expect(sach).not.toHaveAttribute('aria-describedby');
    expect(sach.querySelector('[data-lfh="modul-beschreibung"]')).toBeNull();
  });

  it('behält bei gesperrtem Modul „Keine Berechtigung“ als Titel und zeigt die Beschreibung', () => {
    renderMitProviders(
      <ModulPanel
        einsatzId={1}
        titel="Erfassung"
        module={mitBeschreibung}
        freigaben={freigaben()}
        aktiverModulKey={null}
        onModulKlick={() => {}}
      />,
    );
    const geheim = screen.getByRole('button', { name: 'Geheim', description: 'Verschlusssache' });
    expect(geheim).toBeDisabled();
    expect(geheim).toHaveAttribute('title', 'Keine Berechtigung');
  });

  it('trägt jede Registry-Beschreibung als zweite Zeile', () => {
    const erfassung = modulRegistry.filter((m) => m.kategorie === 'erfassung');
    renderMitProviders(
      <ModulPanel
        einsatzId={1}
        titel="Erfassung"
        module={erfassung}
        freigaben={freigabenFixture()}
        aktiverModulKey={null}
        onModulKlick={() => {}}
      />,
    );
    for (const m of erfassung) {
      if (!m.beschreibung) continue;
      expect(
        screen.getByRole('link', { name: m.label, description: m.beschreibung }),
      ).toBeInTheDocument();
    }
  });
});

/**
 * Die Ansichten des Fernmeldewesens (LLH-1180) stehen hinter „Fernmeldewesen“ in der Kategorie
 * Kommunikation und erben dessen Sperre, nicht die eines anderen Moduls.
 */
describe('ModulListe — Marken des Fernmeldewesens', () => {
  const kommunikation = modulRegistry.filter((m) => m.kategorie === 'kommunikation');
  const MARKEN = ['Fernmeldeskizze', 'Kommunikationsplan'];
  const zeige = (props: { freigaben?: ModulFreigaben }) =>
    renderMitProviders(
      <ModulPanel
        einsatzId={1}
        titel="Kommunikation"
        module={kommunikation}
        freigaben={freigaben()}
        aktiverModulKey="chat"
        onModulKlick={() => {}}
        sprungmarken={sprungmarkenNachKategorie('kommunikation')}
        {...props}
      />,
    );

  it('folgen „Fernmeldewesen“ und nennen ihr Ziel', () => {
    zeige({});
    const knoepfe = screen.getAllByRole('link').map((b) => b.textContent);
    const modul = knoepfe.findIndex((t) => t?.startsWith('Fernmeldewesen'));
    expect(modul).toBeGreaterThanOrEqual(0);
    expect(knoepfe.slice(modul + 1, modul + 3)).toEqual(MARKEN);
    expect(
      screen.getByRole('link', { name: 'Fernmeldeskizze, springt zu Fernmeldewesen · Skizze' }),
    ).not.toHaveAttribute('aria-current');
  });

  it('vor dem Informationstelefon, das als Modulzeile ohne Zahl folgt (i6k6mzed)', () => {
    zeige({});
    const knoepfe = screen.getAllByRole('link').map((b) => b.textContent);
    const modul = knoepfe.findIndex((t) => t?.startsWith('Fernmeldewesen'));
    expect(knoepfe[modul + 3]).toMatch(/^Informationstelefon/);
    expect(queryNavEintrag(/^Informationstelefon, springt zu/)).toBeNull();
  });

  it('bleiben bei ausgeblendetem Informationstelefon stehen', () => {
    zeige({ freigaben: freigaben({ infotelefon: { sichtbar: false, zugriff: false } }) });
    for (const label of MARKEN) {
      expect(
        screen.getByRole('link', { name: new RegExp(`^${label}, springt zu`) }),
        label,
      ).toBeEnabled();
    }
  });

  it('fehlen mit ausgeblendetem Fernmeldewesen', () => {
    zeige({ freigaben: freigaben({ fernmeldewesen: { sichtbar: false, zugriff: false } }) });
    for (const label of MARKEN) {
      expect(queryNavEintrag(new RegExp(`^${label}, springt zu`)), label).not.toBeInTheDocument();
    }
  });
});

/**
 * Review zjt7c073 (B8): Die Liste rollt in sich. Der aktive Eintrag kommt ins Bild (auch nach
 * einem Sprung über die Palette), und eine neue Kategorie beginnt oben, statt die Rollposition der
 * vorigen zu erben. jsdom rechnet kein Layout: die Lage kommt aus einer Attrappe.
 */
describe('ModulPanel — aktiver Eintrag im Bild', () => {
  function lageAttrappe(aktivOben: number) {
    return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const rect = (top: number, bottom: number) =>
        ({
          top,
          bottom,
          left: 0,
          right: 0,
          width: 0,
          height: bottom - top,
          x: 0,
          y: top,
        }) as DOMRect;
      if (this.dataset.lfh === 'modul-panel-liste') return rect(0, 100);
      if (this.getAttribute('aria-current') === 'true') return rect(aktivOben, aktivOben + 30);
      return rect(0, 0);
    });
  }

  it('holt den aktiven Eintrag unter dem Rand ins Bild', () => {
    const spion = lageAttrappe(150);
    try {
      const { container } = renderMitProviders(
        <ModulPanel
          einsatzId={7}
          titel="Erfassung"
          module={module}
          freigaben={freigaben()}
          aktiverModulKey="sach"
          onModulKlick={() => {}}
        />,
      );
      const liste = container.querySelector<HTMLElement>('[data-lfh="modul-panel-liste"]')!;
      expect(liste.scrollTop).toBe(80);
    } finally {
      spion.mockRestore();
    }
  });

  it('eine neue Kategorie beginnt oben', () => {
    const spion = lageAttrappe(10);
    try {
      const props = { module, freigaben: freigaben(), onModulKlick: () => {} };
      const { container, rerender } = renderMitProviders(
        <ModulPanel einsatzId={7} titel="Erfassung" aktiverModulKey="etb" {...props} />,
      );
      const liste = container.querySelector<HTMLElement>('[data-lfh="modul-panel-liste"]')!;
      liste.scrollTop = 50;
      rerender(<ModulPanel einsatzId={7} titel="Lage" aktiverModulKey="etb" {...props} />);
      expect(liste.scrollTop).toBe(0);
    } finally {
      spion.mockRestore();
    }
  });
});

/**
 * Review zjt7c073 (B2): Stehen Bänder über dem Rahmen (Spiegel, Führungshinweis), beginnt die
 * Spalte ungerollt tiefer als die Kopfleiste. Sie reicht dann trotzdem nur bis zum Fensterrand,
 * sonst läge der Fuß „Einsatzdauer“ darunter.
 */
describe('ModulPanel — Spalte endet am Fensterrand', () => {
  it('rechnet die Höhe von der Oberkante der Spalte im Fenster', () => {
    const spion = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const top = this.dataset.lfh === 'modul-panel-spalte' ? 120 : 0;
        return {
          top,
          bottom: top,
          left: 0,
          right: 0,
          width: 0,
          height: 0,
          x: 0,
          y: top,
        } as DOMRect;
      });
    try {
      const { container } = renderMitProviders(
        <ModulPanel
          einsatzId={7}
          titel="Erfassung"
          einsatz={{ begonnen_at: '2026-11-15T08:00:00Z', abgeschlossen_at: null }}
          module={module}
          freigaben={freigaben()}
          aktiverModulKey={null}
          onModulKlick={() => {}}
        />,
      );
      const spalte = container.querySelector<HTMLElement>('[data-lfh="modul-panel-spalte"]')!;
      expect(spalte.style.height).toBe(`${window.innerHeight - 120}px`);
    } finally {
      spion.mockRestore();
    }
  });
});

/**
 * Echte Links (LLH-1732): Strg/⌘+Klick, Mittelklick und das Kontextmenü des Browsers legen ein
 * Modul in einen neuen Tab, etwa auf den zweiten Monitor im Führungsraum. Der einfache Klick
 * bleibt beim Rahmen (Zuletzt-Speicher, Drawer schließen). Geprüft über `fireEvent`, weil nur
 * dessen Rückgabe zeigt, ob `preventDefault` lief.
 */
describe('ModulListe — Einträge als Links (LLH-1732)', () => {
  const zeige = (props: Partial<React.ComponentProps<typeof ModulPanel>> = {}) =>
    renderMitProviders(
      <ModulPanel
        titel="Erfassung"
        einsatzId={7}
        module={[
          ...module,
          basis({
            key: 'verweis',
            label: 'Gefahren',
            route: 'verweis',
            verweistAuf: 'lagekarte',
            status: 'fertig',
          }),
        ]}
        freigaben={freigaben()}
        aktiverModulKey={null}
        onModulKlick={() => {}}
        {...props}
      />,
    );

  it('führt jedes freie Modul als Link auf seine Adresse, ein Verweis auf sein Ziel', () => {
    zeige();
    expect(screen.getByRole('link', { name: 'ETB' })).toHaveAttribute('href', '/einsaetze/7/etb');
    expect(screen.getByRole('link', { name: 'Gefahren' })).toHaveAttribute(
      'href',
      '/einsaetze/7/lagekarte',
    );
  });

  it('lässt ein gesperrtes Modul ein gesperrter Knopf ohne Adresse sein', () => {
    zeige();
    expect(screen.getByRole('button', { name: 'Geheim' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Geheim' })).not.toBeInTheDocument();
  });

  it('übernimmt den einfachen Klick selbst und hält den Browser davon ab', () => {
    const onModulKlick = vi.fn();
    zeige({ onModulKlick });
    const ungehindert = fireEvent.click(screen.getByRole('link', { name: 'ETB' }));
    expect(ungehindert).toBe(false);
    expect(onModulKlick).toHaveBeenCalledWith(expect.objectContaining({ key: 'etb' }));
  });

  it('überlässt Strg-, ⌘- und Umschalt-Klick dem Browser (neuer Tab)', () => {
    const onModulKlick = vi.fn();
    zeige({ onModulKlick });
    const etb = screen.getByRole('link', { name: 'ETB' });
    for (const taste of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
      expect(fireEvent.click(etb, taste), JSON.stringify(taste)).toBe(true);
    }
    expect(onModulKlick).not.toHaveBeenCalled();
  });

  it('führt eine freie Sprungmarke als Link auf ihr Ziel, eine gesperrte bleibt Knopf', () => {
    const onSprungKlick = vi.fn();
    const { unmount } = renderMitProviders(
      <ModulPanel
        titel="Führung"
        einsatzId={7}
        module={[
          basis({
            key: 'etb',
            kategorie: 'fuehrung',
            label: 'ETB',
            route: 'etb',
            status: 'fertig',
          }),
        ]}
        freigaben={freigaben()}
        aktiverModulKey={null}
        onModulKlick={() => {}}
        sprungmarken={sprungmarkenNachKategorie('fuehrung')}
        onSprungKlick={onSprungKlick}
      />,
    );
    const sprung = screen.getByRole('link', { name: /^Entscheidungen, springt zu/ });
    expect(sprung).toHaveAttribute('href', '/einsaetze/7/etb?typ=entscheidung');
    expect(fireEvent.click(sprung, { ctrlKey: true })).toBe(true);
    expect(onSprungKlick).not.toHaveBeenCalled();
    expect(fireEvent.click(sprung)).toBe(false);
    expect(onSprungKlick).toHaveBeenCalledWith(expect.objectContaining({ key: 'entscheidungen' }));
    unmount();
    renderMitProviders(
      <ModulPanel
        titel="Führung"
        einsatzId={7}
        module={[
          basis({
            key: 'etb',
            kategorie: 'fuehrung',
            label: 'ETB',
            route: 'etb',
            status: 'fertig',
          }),
        ]}
        freigaben={freigaben({ etb: { zugriff: false } })}
        aktiverModulKey={null}
        onModulKlick={() => {}}
        sprungmarken={sprungmarkenNachKategorie('fuehrung')}
      />,
    );
    expect(screen.getByRole('button', { name: /^Entscheidungen, springt zu/ })).toBeDisabled();
    expect(screen.queryByRole('link', { name: /^Entscheidungen/ })).not.toBeInTheDocument();
  });
});
