import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { dichten, farbenDunkel } from '../theme/tokens';
import ModulPanel, { modulListenStil, modulMarkeStil, modulZeilenStil } from './ModulPanel';
import type { ModulEintrag } from './modulRegistry';
import type { Sprungmarke } from './sprungmarken';
import type { BenutzerAnzeige, ModulOverrides } from '../api/types';

const ueberschreibung = (
  modulKey: string,
  sichtbar: boolean,
  benoetigteRolle: 'admin' | 'fuehrungskraft' | null = null,
): ModulOverrides => ({
  [modulKey]: {
    einsatz_id: 1,
    modul_key: modulKey,
    sichtbar,
    benoetigte_rolle: benoetigteRolle,
    geaendert_at: null,
    geaendert_von: null,
  },
});

const ohne: BenutzerAnzeige = {
  id: 1,
  anzeigename: 'E',
  benutzername: 'e',
  system_rolle: 'keiner',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-05-23 10:00:00',
  totp_aktiviert: false,
};

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
  basis({ key: 'geheim', label: 'Geheim', route: 'geheim', benoetigteRolle: 'admin' }),
];

describe('ModulPanel', () => {
  it('listet Module, markiert WIP, sperrt rollengeschuetzte', () => {
    renderMitProviders(
      <ModulPanel
        titel="Erfassung"
        module={module}
        benutzer={ohne}
        aktiverModulKey="etb"
        onModulKlick={() => {}}
      />,
    );
    expect(screen.getByText('Erfassung')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ETB/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Sachschäden/ })).toBeEnabled();
    // Am Titel der Hülle greifen, nicht am Zeichen: die Marker sind seit LFH-370 Ikonen,
    // und der Glyph ist bewusst austauschbar — die Aussage ist der Titel.
    expect(screen.getByTitle('In Arbeit')).toBeInTheDocument();
    const geheim = screen.getByRole('button', { name: /Geheim/ });
    expect(geheim).toBeDisabled();
    // Das Schloss trägt bewusst KEINEN Titel (er verdrängte den des Knopfes), deshalb der
    // antd-Klassenselektor.
    expect(geheim.querySelector('.anticon-lock')).not.toBeNull();
  });

  // Der WIP-Marker ist reine Dekoration neben dem Label — er darf nicht im Accessible Name
  // des Knopfes landen („Sachschäden 🚧"), so wie das ↗ daneben es schon vormacht (LFH-328).
  it('haelt den WIP-Marker aus dem Accessible Name heraus', () => {
    renderMitProviders(
      <ModulPanel
        titel="Erfassung"
        module={module}
        benutzer={ohne}
        aktiverModulKey={null}
        onModulKlick={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Sachschäden' })).toBeInTheDocument();
    expect(screen.getByTitle('In Arbeit')).toBeInTheDocument();
    // Dasselbe gilt für das Schloss — die Sperre trägt `disabled` + `title`, nicht der Emoji.
    expect(screen.getByRole('button', { name: 'Geheim' })).toBeDisabled();
  });

  it('markiert ein Deep-Link-Modul mit Hinweis-Symbol', () => {
    renderMitProviders(
      <ModulPanel
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
        benutzer={ohne}
        aktiverModulKey={null}
        onModulKlick={() => {}}
      />,
    );
    expect(screen.getByTitle('Öffnet in der Lagekarte')).toBeInTheDocument();
  });

  it('blendet ein ausgeblendetes Modul nicht in der Liste ein (LFH-132)', () => {
    renderMitProviders(
      <ModulPanel
        titel="Erfassung"
        module={module}
        benutzer={ohne}
        overrides={ueberschreibung('sach', false)}
        aktiverModulKey="etb"
        onModulKlick={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /ETB/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sachschäden/ })).not.toBeInTheDocument();
  });

  it('rendert ein nicht-ausblendbares Modul trotz sichtbar=false (LFH-132)', () => {
    const stamm = [
      basis({
        key: 'einsatzdaten',
        label: 'Einsatzdaten',
        route: 'einsatzdaten',
        status: 'fertig',
      }),
    ];
    renderMitProviders(
      <ModulPanel
        titel="Führung"
        module={stamm}
        benutzer={ohne}
        overrides={ueberschreibung('einsatzdaten', false)}
        aktiverModulKey={null}
        onModulKlick={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Einsatzdaten' })).toBeInTheDocument();
  });

  it('sperrt ein Modul per Override-Rolle, auch ohne Registry-Default (LFH-132)', () => {
    renderMitProviders(
      <ModulPanel
        titel="Erfassung"
        module={module}
        benutzer={ohne}
        overrides={ueberschreibung('etb', true, 'fuehrungskraft')}
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
        titel="Erfassung"
        module={module}
        benutzer={ohne}
        aktiverModulKey={null}
        onModulKlick={onKlick}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /ETB/ }));
    expect(onKlick).toHaveBeenCalledWith(expect.objectContaining({ key: 'etb' }));
  });

  it('zeigt einen neutralen Zähler und nimmt seine Bedeutung in den Accessible Name auf', () => {
    renderMitProviders(
      <ModulPanel
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
        benutzer={ohne}
        aktiverModulKey={null}
        onModulKlick={() => {}}
        zaehler={{ meldungen: { wert: 5, beschreibung: '5 offene Meldungen, davon 2 ungesehen' } }}
      />,
    );
    const knopf = screen.getByRole('button', {
      name: 'Meldungen, 5 offene Meldungen, davon 2 ungesehen',
    });
    // Mono-Zahl statt Badge-Pille (Neuentwurf) — der Wert steht sichtbar im Knopf.
    const zahl = knopf.querySelector('[data-lfh="modul-zaehler"]');
    expect(zahl).not.toBeNull();
    expect(zahl!.textContent).toBe('5');
    expect(knopf.querySelector('.ant-badge')).toBeNull();
    expect(screen.getByTitle('5 offene Meldungen, davon 2 ungesehen')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('traegt den Testanker des e2e-Trefflaechennachweises', () => {
    // `e2e/trefflaeche-tablet.spec.ts` greift die Modulzeilen des inline-Rahmens über
    // dieses Merkmal. Ohne diesen Pin wäre der Anker unbewacht: wer ihn entfernt, färbt
    // einen e2e-Lauf rot, dessen Ursache dann in einer anderen Datei liegt.
    const { container } = renderMitProviders(
      <ModulPanel
        titel="Erfassung"
        module={module}
        benutzer={ohne}
        aktiverModulKey={null}
        onModulKlick={() => {}}
      />,
    );
    expect(container.querySelector('[data-lfh="modul-panel"]')).not.toBeNull();
  });

  it('markiert das aktive Modul via aria-current', () => {
    /**
     * Der aktive Zustand hing bis LFH-370 allein an Fläche und Schriftfarbe und war damit
     * programmatisch unsichtbar. Spiegelbild zu `IconRail.test.tsx:30-35`.
     */
    const { container } = renderMitProviders(
      <ModulPanel
        titel="Erfassung"
        module={module}
        benutzer={ohne}
        aktiverModulKey="etb"
        onModulKlick={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /ETB/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /Sachschäden/ })).not.toHaveAttribute('aria-current');
    expect(container.querySelectorAll('[aria-current]')).toHaveLength(1);
  });

  it('traegt die Marker als Ikone in aria-hidden-Huelle, nicht als Emoji', () => {
    /**
     * „Ein Emoji ist keine Ikone" (30.07.2026): Zeichnung, Farbe und Breite eines Emojis
     * kommen aus der Systemschrift statt aus dem Entwurf.
     *
     * ZWEI Hälften, beide Pflicht. Ohne die erste bliebe unbemerkt, dass ein
     * `@ant-design/icons`-Knoten `role="img"` mit englischem `aria-label` mitbringt und in
     * einer Liste aus 24 Modulen in jeder Zeile als eigenes Vorleseziel stünde. Ohne die
     * zweite wäre der Test auch grün, wenn die Emojis daneben stehen blieben.
     */
    const { container } = renderMitProviders(
      <ModulPanel
        titel="Erfassung"
        module={[
          ...module,
          basis({ key: 'gz', label: 'Zonen', route: 'gz', verweistAuf: 'lagekarte' }),
        ]}
        benutzer={ohne}
        aktiverModulKey={null}
        onModulKlick={() => {}}
      />,
    );
    for (const name of ['Sachschäden', 'Geheim', 'Zonen']) {
      const knopf = screen.getByRole('button', { name });
      expect(within(knopf).queryByRole('img'), `${name}: Ikone ist kein Vorleseziel`).toBeNull();
    }
    expect(container.textContent, 'kein Emoji mehr im Baum').not.toMatch(/🚧|🔒|↗/);
  });
});

/**
 * Die Zeilenhöhe OHNE zu rendern — `test/utils.tsx:31` montiert ein nacktes `ConfigProvider`
 * ohne unser Theme, `useToken()` liefert dort den antd-Seed (`controlHeight: 32`), also keine
 * der Stufen 30/48/72. Ein Render-Test belegte antd-Vorgaben statt der Staffel.
 * Bauform 1:1 nach `pages/lagekarte/Sidebar.test.tsx:591-637`.
 *
 * Die Böden stehen als LITERALE da und werden NICHT aus `dichten` zurückgelesen — sonst
 * prüfte der Test den Token gegen sich selbst.
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
    // Die eigentliche Aussage des Pakets: mit `??` statt `Math.max` stuende hier im
    // Handschuh-Betrieb 48 — die Prop drehte die Staffel zurueck, statt sie zu ergaenzen.
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
    expect(modulZeilenStil(tokenFuer('kompakt'), farben, frei).padding).toBe('7px 11px');
    expect(modulZeilenStil(tokenFuer('handschuh'), farben, frei).padding).toBe('16px 26px');
  });

  it('liest beide Abstaende aus der Staffel', () => {
    expect(modulZeilenStil(tokenFuer('kompakt'), farben, frei).gap).toBe(7);
    expect(modulZeilenStil(tokenFuer('handschuh'), farben, frei).gap).toBe(16);
    // Die Liste trägt ihre Luft oben/unten aus `marginXS` — mit der Dichte, nicht aus dem
    // statischen `abstand`-Export (der ist die eingefrorene kompakte Stufe).
    expect(modulListenStil(tokenFuer('kompakt')).paddingBlock).toBe(6);
    expect(modulListenStil(tokenFuer('handschuh')).paddingBlock).toBe(14);
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
});

describe('ModulPanel · Einsatzdauer im Fuß', () => {
  it('zeigt die Dauer seit Beginn, wenn der Einsatz da ist', () => {
    renderMitProviders(
      <ModulPanel
        titel="Führung"
        module={module}
        benutzer={ohne}
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
        titel="Führung"
        module={module}
        benutzer={ohne}
        aktiverModulKey={null}
        onModulKlick={() => {}}
      />,
    );
    expect(container.querySelector('[data-lfh="modul-panel-fuss"]')).toBeNull();
  });

  it('trägt Kopf-Augenbraue und Panelgrund aus den Nachtrollen (Vorgabe)', () => {
    const { container } = renderMitProviders(
      <ModulPanel
        titel="Führung"
        module={module}
        benutzer={ohne}
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
 * Sprungmarken (LFH-620): gefilterte Sichten in ein vorhandenes Modul. Die Marke erbt
 * Sichtbarkeit und Sperre ihres ZIELmoduls — geprüft an einem echten Registry-Schlüssel
 * (`etb`), weil `sprungZiel` in der Registry nachschlägt.
 */
describe('ModulListe — Sprungmarken', () => {
  const marke: Sprungmarke = {
    key: 'entscheidungen',
    kategorie: 'fuehrung',
    label: 'Entscheidungen',
    zielModul: 'etb',
    nach: 'auftraege',
    hinweis: 'ETB, Typ Entscheidung',
    pfad: () => '/einsaetze/1/etb?typ=entscheidung',
  };
  const fuehrung: ModulEintrag[] = [
    basis({ key: 'auftraege', kategorie: 'fuehrung', label: 'Aufträge', status: 'fertig' }),
    basis({ key: 'stab', kategorie: 'fuehrung', label: 'Stab', status: 'fertig' }),
  ];
  const zeige = (props: { overrides?: ModulOverrides; onSprungKlick?: (m: Sprungmarke) => void }) =>
    renderMitProviders(
      <ModulPanel
        titel="Führung"
        module={fuehrung}
        benutzer={ohne}
        aktiverModulKey="auftraege"
        onModulKlick={() => {}}
        sprungmarken={[marke]}
        {...props}
      />,
    );

  it('steht hinter ihrem Anker, nennt das Ziel im Namen und ist nie aktuell', async () => {
    const klick = vi.fn();
    zeige({ onSprungKlick: klick });
    const knoepfe = screen.getAllByRole('button').map((b) => b.textContent);
    expect(knoepfe).toEqual(['Aufträge', 'Entscheidungen', 'Stab']);
    const sprung = screen.getByRole('button', {
      name: 'Entscheidungen, springt zu ETB, Typ Entscheidung',
    });
    expect(sprung).not.toHaveAttribute('aria-current');
    // Die Ikone ist Dekoration: kein eigenes Vorleseziel (englisches `aria-label` „export").
    expect(within(sprung).queryByRole('img')).not.toBeInTheDocument();
    await userEvent.click(sprung);
    expect(klick).toHaveBeenCalledWith(marke);
  });

  it('verschwindet mit dem ausgeblendeten Zielmodul, nicht mit dem Anker', () => {
    const { unmount } = zeige({ overrides: ueberschreibung('etb', false) });
    expect(screen.queryByRole('button', { name: /Entscheidungen/ })).not.toBeInTheDocument();
    unmount();
    // Gegenprobe: ein ausgeblendeter ANKER nimmt die Marke nicht mit.
    zeige({ overrides: ueberschreibung('auftraege', false) });
    expect(screen.getByRole('button', { name: /Entscheidungen/ })).toBeInTheDocument();
  });

  it('ist gesperrt, wenn das Zielmodul für den Benutzer gesperrt ist', async () => {
    const klick = vi.fn();
    zeige({ overrides: ueberschreibung('etb', true, 'fuehrungskraft'), onSprungKlick: klick });
    const sprung = screen.getByRole('button', { name: /Entscheidungen/ });
    expect(sprung).toBeDisabled();
    expect(sprung).toHaveAttribute('title', 'Keine Berechtigung');
    await userEvent.click(sprung);
    expect(klick).not.toHaveBeenCalled();
  });
});
