import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import type { Einheit, Einsatzabschnitt, Sprechgruppe } from '../api/types';
import { baueFernmeldeskizze } from './fernmeldeskizze';
import type { FuehrungsstelleQuelle } from './fuehrungsstelle';
import FernmeldeskizzeBild from './FernmeldeskizzeBild';

function sg(id: number, betriebsart: 'TMO' | 'DMO', bezeichnung: string): Sprechgruppe {
  return { id, bezeichnung, betriebsart, aktiv: true, einsatz_lokal: false, sortier: id };
}
const TMO311 = sg(1, 'TMO', '311');
const DMO505 = sg(3, 'DMO', '505');
const DMO506 = sg(4, 'DMO', '506');

function abschnitt(id: number, p: Partial<Einsatzabschnitt> = {}): Einsatzabschnitt {
  return { id, einsatz_id: 1, name: `Abschnitt ${id}`, sortier: id, sprechgruppen: [], ...p };
}

function einheit(id: number, p: Partial<Einheit> = {}): Einheit {
  return {
    id,
    einsatz_id: 1,
    name: `Einheit ${id}`,
    sortier: id,
    sprechgruppen: [],
    fahrzeug_mitglieder: [],
    material_mitglieder: [],
    personal_mitglieder: [],
    ist: { fuehrer: 1, unterfuehrer: 2, mannschaft: 6 },
    ist_kumuliert: { fuehrer: 1, unterfuehrer: 2, mannschaft: 6 },
    status: { quelle: 'ohne', verteilung: [] },
    ...p,
  } as Einheit;
}

const ABSCHNITTE = [
  abschnitt(1, {
    name: 'EA Nord',
    kurzbezeichnung: 'EA-N',
    leiter_name: 'Anna Leiter',
    kommunikationsmittel: 'digitalfunk',
    erreichbarkeit: '0171 GEHEIM',
    sprechgruppen: [TMO311, DMO505],
  }),
  abschnitt(2, { name: 'UA Deich', ueber_abschnitt_id: 1 }),
];
const EINHEITEN = [
  einheit(10, {
    name: '1. Zug',
    abschnitt_id: 1,
    funkrufname: 'Florian 1/10',
    fuehrer_name: 'Bernd Führer',
    erreichbarkeit: '0160 GEHEIM',
    typ_label: 'Zug',
    sprechgruppen: [DMO505],
  }),
  einheit(11, { name: 'Gruppe 1', abschnitt_id: 1, ueber_einheit_id: 10, sprechgruppen: [DMO506] }),
  einheit(20, { name: 'Lose Gruppe', sprechgruppen: [TMO311] }),
];

const ohneFs: FuehrungsstelleQuelle = { zustand: 'daten', daten: null };

function bild(
  zugeklappt: ReadonlySet<string> = new Set(),
  onUmschalten = vi.fn(),
  fuehrungsstelle: FuehrungsstelleQuelle = ohneFs,
) {
  const skizze = baueFernmeldeskizze(ABSCHNITTE, EINHEITEN, fuehrungsstelle);
  const utils = renderMitProviders(
    <FernmeldeskizzeBild
      einsatzId={1}
      skizze={skizze}
      zugeklappt={zugeklappt}
      onUmschalten={onUmschalten}
    />,
  );
  return { ...utils, onUmschalten };
}

const knotenVon = (name: string) =>
  screen.getByRole('link', { name }).closest('[data-lfh="org-knoten"]') as HTMLElement;

describe('Fernmeldeskizze — Wurzel', () => {
  it('nennt die fehlende Gegenstelle und zeigt keine Stabsstelle', () => {
    bild();
    const wurzel = screen.getByRole('group', { name: 'Einsatzleitung' });
    expect(within(wurzel).getByText('Gegenstelle nicht erfasst')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Stab' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Fernmeldeskizze' })).toHaveAttribute(
      'data-lfh',
      'skizze',
    );
  });

  it('führt über „Einsatzleitung“ zu den Einsatzdaten, wo die Führungsstelle gepflegt wird', () => {
    bild();
    const wurzel = screen.getByRole('group', { name: 'Einsatzleitung' });
    expect(within(wurzel).getByRole('link', { name: 'Einsatzleitung' })).toHaveAttribute(
      'href',
      '/einsaetze/1/einsatzdaten',
    );
  });

  it('zeigt die erfasste Führungsstelle ohne Erreichbarkeit (LFH-849)', () => {
    bild(new Set(), vi.fn(), {
      zustand: 'daten',
      daten: {
        rufname: 'Florian Musterstadt 10/1',
        sprechgruppen: [TMO311],
        kommunikationsmittel: 'digitalfunk',
        erreichbarkeit: '0171 ELW',
      },
    });
    const wurzel = screen.getByRole('group', { name: 'Einsatzleitung' });
    expect(within(wurzel).getByText('Florian Musterstadt 10/1')).toBeInTheDocument();
    expect(within(wurzel).getByText('TMO 311')).toBeInTheDocument();
    expect(within(wurzel).getByText('Digitalfunk')).toBeInTheDocument();
    expect(within(wurzel).queryByText(/nicht erfasst/)).toBeNull();
    expect(wurzel.textContent).not.toContain('0171 ELW');
    // Die Kante zum obersten Abschnitt urteilt jetzt gegen die Führungsstelle.
    expect(knotenVon('EA Nord').querySelector('[data-lfh="skizze-kante"]')).toHaveTextContent(
      '⇄ TMO 311',
    );
  });

  it('nennt den Grund, wenn die Führungsstelle nicht vorliegt', () => {
    bild(new Set(), vi.fn(), { zustand: 'fehler', daten: null });
    const wurzel = screen.getByRole('group', { name: 'Einsatzleitung' });
    expect(within(wurzel).getByText('Gegenstelle nicht geladen')).toBeInTheDocument();
  });
});

describe('Fernmeldeskizze — Knoten', () => {
  it('zeigt Name als Link, Rufname, Sprechgruppen nach Betriebsart und Kommunikationsmittel', () => {
    bild();
    const nord = screen.getByRole('link', { name: 'EA Nord' });
    expect(nord).toHaveAttribute('href', '/einsaetze/1/einsatzabschnitte?abschnitt=1');
    const k = knotenVon('EA Nord');
    expect(within(k).getByText('EA-N')).toBeInTheDocument();
    expect(k.textContent).toContain('TMO 311');
    expect(k.textContent).toContain('DMO 505');
    expect(within(k).getByText('Digitalfunk')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '1. Zug' })).toHaveAttribute(
      'href',
      '/einsaetze/1/einheiten/10',
    );
  });

  it('benennt fehlenden Rufnamen und fehlende Sprechgruppen als Wort', () => {
    bild();
    const deich = knotenVon('UA Deich');
    expect(within(deich).getByText('kein Rufname')).toBeInTheDocument();
    expect(within(deich).getByText('keine Sprechgruppe')).toBeInTheDocument();
  });

  it('zeigt weder Leitung noch Stärke noch Erreichbarkeit', () => {
    const { container } = bild();
    const text = container.textContent ?? '';
    expect(text).not.toContain('Anna Leiter');
    expect(text).not.toContain('Bernd Führer');
    expect(text).not.toContain('1/2/6//9');
    expect(text).not.toContain('GEHEIM');
  });

  it('versteckt die Zeichen vor Hilfstechnik', () => {
    const { container } = bild();
    const zeichen = container.querySelectorAll('[data-lfh="org-zeichen"]');
    expect(zeichen.length).toBeGreaterThan(0);
    zeichen.forEach((z) => expect(z).toHaveAttribute('aria-hidden', 'true'));
  });

  it('stellt Einheiten ohne Abschnitt unter „Ohne Abschnitt“', () => {
    bild();
    const sammel = screen.getByRole('group', { name: 'Ohne Abschnitt' });
    expect(within(sammel).getByRole('link', { name: 'Lose Gruppe' })).toBeInTheDocument();
  });
});

describe('Fernmeldeskizze — Kanten', () => {
  const kante = (name: string) => knotenVon(name).querySelector('[data-lfh="skizze-kante"]');

  it('trägt die gemeinsame Sprechgruppe an der Kante', () => {
    bild();
    expect(kante('1. Zug')).toHaveTextContent('⇄ DMO 505');
    expect(kante('1. Zug')?.textContent).not.toContain('311');
  });

  it('setzt die Betriebsart nicht doppelt vor eine Bezeichnung, die sie schon trägt', () => {
    const tmo = sg(7, 'TMO', 'TMO 412_F_DRK');
    const dmo = sg(8, 'DMO', 'dmo 505');
    const skizze = baueFernmeldeskizze(
      [abschnitt(1, { name: 'EA West', sprechgruppen: [tmo, dmo] })],
      [einheit(30, { name: 'Zug West', abschnitt_id: 1, sprechgruppen: [tmo, dmo] })],
      ohneFs,
    );
    renderMitProviders(
      <FernmeldeskizzeBild
        einsatzId={1}
        skizze={skizze}
        zugeklappt={new Set()}
        onUmschalten={vi.fn()}
      />,
    );
    expect(kante('Zug West')).toHaveTextContent(/^⇄ TMO 412_F_DRK · dmo 505$/);
    const knoten = knotenVon('EA West');
    expect(within(knoten).getByText('TMO 412_F_DRK')).toBeInTheDocument();
    expect(within(knoten).getByText('dmo 505')).toBeInTheDocument();
    expect(knoten.textContent).not.toMatch(/TMO TMO|DMO dmo/i);
  });

  it('zeigt zwei Sprechgruppen gleicher Bezeichnung beide (einsatzlokal und Stammdaten)', () => {
    const fehler = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stamm = sg(40, 'TMO', '311');
    const lokal = { ...sg(41, 'TMO', '311'), einsatz_lokal: true };
    const skizze = baueFernmeldeskizze(
      [abschnitt(1, { name: 'EA Ost', sprechgruppen: [stamm, lokal] })],
      [],
      ohneFs,
    );
    renderMitProviders(
      <FernmeldeskizzeBild
        einsatzId={1}
        skizze={skizze}
        zugeklappt={new Set()}
        onUmschalten={vi.fn()}
      />,
    );
    expect(within(knotenVon('EA Ost')).getAllByText('TMO 311')).toHaveLength(2);
    expect(fehler.mock.calls.flat().join(' ')).not.toMatch(/same key/);
    fehler.mockRestore();
  });

  it('nennt den fehlenden gemeinsamen Kanal als Wort, das Zeichen ist verborgen', () => {
    bild();
    const k = kante('Gruppe 1')!;
    expect(k).toHaveTextContent('keine gemeinsame Sprechgruppe');
    const zeichen = k.querySelector('svg');
    expect(zeichen?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('zeigt ohne Urteil keine Kantenzeile: Wurzel, Sammelknoten, Seite ohne Sprechgruppe', () => {
    bild();
    expect(kante('EA Nord')).toBeNull();
    expect(kante('Lose Gruppe')).toBeNull();
    expect(kante('UA Deich')).toBeNull();
  });
});

describe('Fernmeldeskizze — Klappen', () => {
  it('klappt über das Gerüst und meldet den Schlüssel', async () => {
    const { onUmschalten } = bild();
    await userEvent.click(screen.getByRole('button', { name: 'Unterstellte von EA Nord' }));
    expect(onUmschalten).toHaveBeenCalledWith('ab-1');
  });

  it('verbirgt zugeklappte Kinder, der Knoten bleibt', () => {
    bild(new Set(['ab-1']));
    expect(screen.getByRole('link', { name: 'EA Nord' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '1. Zug' })).toBeNull();
  });
});
