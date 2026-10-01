import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../../test/utils';
import { ladeModulOverrides } from '../../api/einsaetze';
import { ladeStab } from '../../api/stab';
import type {
  Einheit,
  EinsatzAnzeige,
  Einsatzabschnitt,
  Stab,
  Stabsfunktion,
} from '../../api/types';
import type { Quelle } from '../../stab/luecken';
import Organigramm, { OrganigrammBild } from './Organigramm';
import { baueFuehrungsorganisation } from './fuehrungsorganisation';

vi.mock('../../api/einsaetze', () => ({ ladeModulOverrides: vi.fn() }));
vi.mock('../../api/stab', () => ({ ladeStab: vi.fn() }));

const EINSATZ = {
  id: 1,
  bezeichnung: 'Hochwasser Nord',
  status: 'aktiv',
  meine_rolle: 'einsatzleitung',
} as EinsatzAnzeige;

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
  abschnitt(1, { name: 'EA Nord', kurzbezeichnung: 'EA-N', leiter_name: 'Anna Leiter' }),
  abschnitt(2, { name: 'UA Deich', ueber_abschnitt_id: 1 }),
];
const EINHEITEN = [
  einheit(10, {
    name: '1. Zug',
    abschnitt_id: 2,
    funkrufname: 'Florian 1/10',
    fuehrer_name: 'Bernd Führer',
    typ_label: 'Zug',
  }),
];

const daten = <T,>(d: T[]): Quelle<T> => ({ zustand: 'daten', daten: d });

function besetzung(p: Partial<Stabsfunktion>): Stabsfunktion {
  return {
    sachgebiet: 's1',
    besetzung_art: 'personal',
    gesetzt_at: '2026-10-01T08:00:00',
    gesetzt_von_id: 1,
    personal_noch_disponiert: true,
    ...p,
  } as Stabsfunktion;
}

function bild(zugeklappt: ReadonlySet<string> = new Set(), onUmschalten = vi.fn()) {
  const org = baueFuehrungsorganisation(ABSCHNITTE, EINHEITEN);
  return {
    onUmschalten,
    ...renderMitProviders(
      <OrganigrammBild
        einsatzId={1}
        org={org}
        stab={{ zustand: 'aus' }}
        zugeklappt={zugeklappt}
        onUmschalten={onUmschalten}
      />,
    ),
  };
}

describe('OrganigrammBild — Einsatzleitung', () => {
  it('trägt „Leitung nicht erfasst“ und keine Stärke', () => {
    bild();
    const wurzel = screen.getByRole('group', { name: 'Einsatzleitung' });
    expect(within(wurzel).getByText('Leitung nicht erfasst')).toBeInTheDocument();
    expect(wurzel.textContent).not.toMatch(/\d+\/\d+\/\d+\/\/\d+/);
  });
});

describe('OrganigrammBild — Knoten', () => {
  it('zeigt Name als Link, Rufname, Leitung und Stärke', () => {
    bild();
    const nord = screen.getByRole('link', { name: 'EA Nord' });
    expect(nord).toHaveAttribute('href', '/einsaetze/1/einsatzabschnitte?abschnitt=1');
    const knoten = nord.closest('[data-lfh="org-knoten"]') as HTMLElement;
    expect(within(knoten).getByText('EA-N')).toBeInTheDocument();
    expect(within(knoten).getByText('Anna Leiter')).toBeInTheDocument();
    expect(within(knoten).getByText('1/2/6//9')).toBeInTheDocument();

    const zug = screen.getByRole('link', { name: '1. Zug' });
    expect(zug).toHaveAttribute('href', '/einsaetze/1/einheiten/10');
    const zugKnoten = zug.closest('[data-lfh="org-knoten"]') as HTMLElement;
    expect(within(zugKnoten).getByText('Florian 1/10')).toBeInTheDocument();
    expect(within(zugKnoten).getByText('Bernd Führer')).toBeInTheDocument();
  });

  it('benennt fehlende Angaben als Wort, nicht als Lücke', () => {
    bild();
    const deich = screen
      .getByRole('link', { name: 'UA Deich' })
      .closest('[data-lfh="org-knoten"]') as HTMLElement;
    expect(within(deich).getByText('kein Rufname')).toBeInTheDocument();
    expect(within(deich).getByText('Leitung nicht besetzt')).toBeInTheDocument();
  });

  it('zeigt „—“ statt einer Stärke, wenn einem Abschnitt keine Einheit zugeordnet ist', () => {
    const org = baueFuehrungsorganisation([abschnitt(5, { name: 'Leer' })], []);
    renderMitProviders(
      <OrganigrammBild
        einsatzId={1}
        org={org}
        stab={{ zustand: 'aus' }}
        zugeklappt={new Set()}
        onUmschalten={vi.fn()}
      />,
    );
    const knoten = screen
      .getByRole('link', { name: 'Leer' })
      .closest('[data-lfh="org-knoten"]') as HTMLElement;
    expect(within(knoten).getByText('—')).toBeInTheDocument();
    expect(knoten.textContent).not.toContain('0/0/0');
  });

  it('versteckt die Zeichen vor Hilfstechnik', () => {
    const { container } = bild();
    const zeichen = container.querySelectorAll('[data-lfh="org-zeichen"]');
    expect(zeichen.length).toBeGreaterThan(0);
    zeichen.forEach((z) => expect(z).toHaveAttribute('aria-hidden', 'true'));
  });

  it('stellt Einheiten ohne Abschnitt unter „Ohne Abschnitt“', () => {
    const org = baueFuehrungsorganisation(ABSCHNITTE, [einheit(20, { name: 'Lose Gruppe' })]);
    renderMitProviders(
      <OrganigrammBild
        einsatzId={1}
        org={org}
        stab={{ zustand: 'aus' }}
        zugeklappt={new Set()}
        onUmschalten={vi.fn()}
      />,
    );
    const sammel = screen.getByRole('group', { name: 'Ohne Abschnitt' });
    expect(within(sammel).getByRole('link', { name: 'Lose Gruppe' })).toBeInTheDocument();
  });
});

describe('OrganigrammBild — Klappen', () => {
  it('trägt den Zustand am Bedienziel und verbirgt beim Zuklappen nur die Kinder', async () => {
    const { onUmschalten, rerender } = bild();
    const knopf = screen.getByRole('button', { name: 'Unterstellte von EA Nord' });
    expect(knopf).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(knopf);
    expect(onUmschalten).toHaveBeenCalledWith('ab-1');

    const org = baueFuehrungsorganisation(ABSCHNITTE, EINHEITEN);
    rerender(
      <OrganigrammBild
        einsatzId={1}
        org={org}
        stab={{ zustand: 'aus' }}
        zugeklappt={new Set(['ab-1'])}
        onUmschalten={onUmschalten}
      />,
    );
    expect(screen.getByRole('button', { name: 'Unterstellte von EA Nord' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('link', { name: 'EA Nord' })).toBeInTheDocument();
    expect(screen.getByText('1/2/6//9')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'UA Deich' })).toBeNull();
    expect(screen.queryByRole('link', { name: '1. Zug' })).toBeNull();
  });

  it('gibt Knoten ohne Kinder kein Klappziel', () => {
    bild();
    expect(screen.queryByRole('button', { name: 'Unterstellte von 1. Zug' })).toBeNull();
  });
});

describe('Organigramm — Klappzustand im Container', () => {
  beforeEach(() => {
    vi.mocked(ladeModulOverrides).mockResolvedValue({
      stab: { sichtbar: false, einsatz_id: 1, modul_key: 'stab' },
    });
    vi.mocked(ladeStab).mockReset();
  });

  function container(abschnitte = ABSCHNITTE, einheiten = EINHEITEN) {
    return renderMitProviders(
      <Organigramm einsatz={EINSATZ} abschnitte={abschnitte} einheiten={daten(einheiten)} />,
    );
  }

  it('startet aufgeklappt; „Alle zuklappen“ und „Alle aufklappen“ wirken auf jede Ebene', async () => {
    container();
    expect(screen.getByRole('link', { name: '1. Zug' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Alle zuklappen' }));
    expect(screen.queryByRole('link', { name: 'UA Deich' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Unterstellte von EA Nord' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Alle aufklappen' }));
    expect(screen.getByRole('link', { name: '1. Zug' })).toBeInTheDocument();
  });

  it('zeigt einen live hinzukommenden Knoten aufgeklappt', async () => {
    const { rerender } = container();
    await userEvent.click(screen.getByRole('button', { name: 'Unterstellte von UA Deich' }));
    const neu = [...ABSCHNITTE, abschnitt(3, { name: 'EA Süd' })];
    const neueEinheiten = [...EINHEITEN, einheit(11, { name: 'Gruppe Süd', abschnitt_id: 3 })];
    rerender(<Organigramm einsatz={EINSATZ} abschnitte={neu} einheiten={daten(neueEinheiten)} />);
    expect(screen.getByRole('link', { name: 'Gruppe Süd' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unterstellte von EA Süd' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    // Der zugeklappte bleibt zu.
    expect(screen.queryByRole('link', { name: '1. Zug' })).toBeNull();
  });

  it('nennt fehlende Einheiten als Grund und zeigt keine Stärke', () => {
    renderMitProviders(
      <Organigramm
        einsatz={EINSATZ}
        abschnitte={ABSCHNITTE}
        einheiten={{ zustand: 'fehler', daten: [] }}
      />,
    );
    expect(screen.getByText('Einheiten: nicht geladen')).toBeInTheDocument();
    const knoten = screen
      .getByRole('link', { name: 'EA Nord' })
      .closest('[data-lfh="org-knoten"]') as HTMLElement;
    expect(within(knoten).getByText('—')).toBeInTheDocument();
  });
});

describe('Organigramm — Stabsstelle', () => {
  beforeEach(() => {
    vi.mocked(ladeStab).mockReset();
  });

  function container() {
    return renderMitProviders(
      <Organigramm einsatz={EINSATZ} abschnitte={ABSCHNITTE} einheiten={daten(EINHEITEN)} />,
    );
  }

  it('zeigt bei freigegebenem Stab die besetzten Sachgebiete in S-Folge mit Besetzung', async () => {
    vi.mocked(ladeModulOverrides).mockResolvedValue({});
    vi.mocked(ladeStab).mockResolvedValue({
      besetzung: [
        besetzung({ sachgebiet: 's2', name: 'Clara Lage' }),
        besetzung({ sachgebiet: 's1', besetzung_art: 'einsatzleitung' }),
        besetzung({ sachgebiet: 's5', besetzung_art: 'extern', name: 'Dr. Weber' }),
      ],
    } as Stab);
    container();
    const stab = await screen.findByRole('group', { name: 'Stab' });
    const zeilen = within(stab)
      .getAllByRole('listitem')
      .map((z) => z.textContent);
    expect(zeilen).toEqual(['S1Einsatzleitung', 'S2Clara Lage', 'S5Dr. Weber (extern)']);
  });

  it('sagt „Kein Sachgebiet besetzt“, wenn die Besetzung leer ist', async () => {
    vi.mocked(ladeModulOverrides).mockResolvedValue({});
    vi.mocked(ladeStab).mockResolvedValue({ besetzung: [] } as unknown as Stab);
    container();
    const stab = await screen.findByRole('group', { name: 'Stab' });
    expect(within(stab).getByText('Kein Sachgebiet besetzt')).toBeInTheDocument();
  });

  it('zeigt bei gesperrtem Stab keine Stabsstelle und ruft die Besetzung nicht ab', async () => {
    vi.mocked(ladeModulOverrides).mockResolvedValue({
      stab: { sichtbar: false, einsatz_id: 1, modul_key: 'stab' },
    });
    container();
    await waitFor(() => expect(ladeModulOverrides).toHaveBeenCalled());
    // Ein Tick für eine etwaige Folgeabfrage.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('group', { name: 'Stab' })).toBeNull();
    expect(ladeStab).not.toHaveBeenCalled();
  });

  it('zeigt solange die Freigabe lädt keine Stabsstelle und ruft nichts ab', async () => {
    vi.mocked(ladeModulOverrides).mockReturnValue(new Promise(() => {}));
    container();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('group', { name: 'Stab' })).toBeNull();
    expect(ladeStab).not.toHaveBeenCalled();
  });

  it('sagt „Besetzung nicht geladen“, wenn der Abruf bei freigegebenem Stab scheitert', async () => {
    vi.mocked(ladeModulOverrides).mockResolvedValue({});
    vi.mocked(ladeStab).mockRejectedValue(new Error('kaputt'));
    container();
    const stab = await screen.findByRole('group', { name: 'Stab' });
    expect(await within(stab).findByText('Besetzung nicht geladen')).toBeInTheDocument();
  });
});
