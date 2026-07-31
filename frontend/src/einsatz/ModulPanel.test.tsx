import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { dichten } from '../theme/tokens';
import ModulPanel, { modulListenStil, modulZeilenStil } from './ModulPanel';
import type { ModulEintrag } from './modulRegistry';
import type { BenutzerAnzeige, ModulOverrides } from '../api/types';

const ueberschreibung = (
  modulKey: string,
  sichtbar: boolean,
  benoetigteRolle: 'admin' | 'fuehrungskraft' | null = null,
): ModulOverrides => ({
  [modulKey]: {
    einsatz_id: 1, modul_key: modulKey, sichtbar,
    benoetigte_rolle: benoetigteRolle, geaendert_at: null, geaendert_von: null,
  },
});

const ohne: BenutzerAnzeige = {
  id: 1, anzeigename: 'E', benutzername: 'e', system_rolle: 'keiner',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00', totp_aktiviert: false,
};

const basis = (over: Partial<ModulEintrag>): ModulEintrag => ({
  key: 'k', kategorie: 'erfassung', label: 'L', icon: () => null, route: 'k', status: 'geplant', ...over,
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
        titel="Erfassung" module={module} benutzer={ohne}
        aktiverModulKey="etb" onModulKlick={() => {}}
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
        titel="Erfassung" module={module} benutzer={ohne}
        aktiverModulKey={null} onModulKlick={() => {}}
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
        module={[basis({ key: 'gefahrenzonen', label: 'Gefahren-/Absperrzonen', route: 'gefahrenzonen', status: 'fertig', verweistAuf: 'lagekarte' })]}
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
        titel="Erfassung" module={module} benutzer={ohne}
        overrides={ueberschreibung('sach', false)}
        aktiverModulKey="etb" onModulKlick={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /ETB/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sachschäden/ })).not.toBeInTheDocument();
  });

  it('rendert ein nicht-ausblendbares Modul trotz sichtbar=false (LFH-132)', () => {
    const stamm = [basis({ key: 'einsatzdaten', label: 'Einsatzdaten', route: 'einsatzdaten', status: 'fertig' })];
    renderMitProviders(
      <ModulPanel
        titel="Führung" module={stamm} benutzer={ohne}
        overrides={ueberschreibung('einsatzdaten', false)}
        aktiverModulKey={null} onModulKlick={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Einsatzdaten' })).toBeInTheDocument();
  });

  it('sperrt ein Modul per Override-Rolle, auch ohne Registry-Default (LFH-132)', () => {
    renderMitProviders(
      <ModulPanel
        titel="Erfassung" module={module} benutzer={ohne}
        overrides={ueberschreibung('etb', true, 'fuehrungskraft')}
        aktiverModulKey={null} onModulKlick={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /ETB/ })).toBeDisabled();
  });

  it('meldet Klick auf ein freies Modul', async () => {
    const onKlick = vi.fn();
    renderMitProviders(
      <ModulPanel
        titel="Erfassung" module={module} benutzer={ohne}
        aktiverModulKey={null} onModulKlick={onKlick}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /ETB/ }));
    expect(onKlick).toHaveBeenCalledWith(expect.objectContaining({ key: 'etb' }));
  });

  it('markiert das aktive Modul via aria-current', () => {
    /**
     * Der aktive Zustand hing bis LFH-370 allein an Fläche und Schriftfarbe und war damit
     * programmatisch unsichtbar. Spiegelbild zu `IconRail.test.tsx:30-35`.
     */
    const { container } = renderMitProviders(
      <ModulPanel
        titel="Erfassung" module={module} benutzer={ohne}
        aktiverModulKey="etb" onModulKlick={() => {}}
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
        module={[...module, basis({ key: 'gz', label: 'Zonen', route: 'gz', verweistAuf: 'lagekarte' })]}
        benutzer={ohne}
        aktiverModulKey={null} onModulKlick={() => {}}
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
    colorPrimary: '#BEDIEN',
    colorPrimaryBg: '#BEDIENBG',
    colorTextDisabled: '#GRAU',
  });
  const frei = { aktiv: false, gesperrt: false };
  const hoehe = (s: keyof typeof dichten, mindestTrefflaeche?: number) =>
    modulZeilenStil(tokenFuer(s), { ...frei, mindestTrefflaeche }).minHeight;

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
    expect(modulZeilenStil(tokenFuer('kompakt'), frei).padding).toBe('7px 11px');
    expect(modulZeilenStil(tokenFuer('handschuh'), frei).padding).toBe('16px 26px');
  });

  it('liest beide Abstaende aus der Staffel', () => {
    expect(modulZeilenStil(tokenFuer('kompakt'), frei).gap).toBe(7);
    expect(modulZeilenStil(tokenFuer('handschuh'), frei).gap).toBe(16);
    // Der Spaltenabstand haengt an `marginXS`. Mit dem statischen `abstand`-Export aus
    // tokens.ts:171 stuende hier in jeder Stufe 3 — er ist die eingefrorene kompakte Stufe.
    expect(modulListenStil(tokenFuer('kompakt')).gap).toBe(3);
    expect(modulListenStil(tokenFuer('komfortabel')).gap).toBe(5);
    expect(modulListenStil(tokenFuer('handschuh')).gap).toBe(7);
  });

  it('markiert die aktive Zeile mit einem Balken ZUSAETZLICH zur Flaeche', () => {
    const aktiv = modulZeilenStil(tokenFuer('kompakt'), { ...frei, aktiv: true });
    expect(aktiv.borderLeft).toBe('3px solid #BEDIEN');
    expect(aktiv.background, 'der Balken ergaenzt die Flaeche, ersetzt sie nicht').toBe('#BEDIENBG');
    // Inaktiv bleibt der Platz reserviert — sonst springt die Zeile beim Aktivieren.
    expect(modulZeilenStil(tokenFuer('kompakt'), frei).borderLeft).toBe('3px solid transparent');
  });

  it('traegt den Steuer-Radius, nicht die weiche Ecke', () => {
    expect(modulZeilenStil(tokenFuer('kompakt'), frei).borderRadius).toBe(0);
  });
});
