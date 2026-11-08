import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../../test/utils';
import { ladeFuehrungsstelle, ladeMitglieder, ladeModulFreigaben } from '../../api/einsaetze';
import { freigabenFixture } from '../../test/fixtures';
import { legeLageberichtAn } from '../../api/lageberichte';
import { ApiError } from '../../api/client';
import type {
  Einheit,
  EinsatzAnzeige,
  Einsatzabschnitt,
  Fuehrungsfunktion,
  MitgliedAnzeige,
} from '../../api/types';
import type { Quelle } from '../../api/abrufZustand';
import type { EinsatzleiterDarstellung } from '../../einsatz/einsatzleiter';
import { AnzeigeKonventionenProvider } from '../../anzeige/AnzeigeKonventionenContext';
import Organigramm, { OrganigrammBild } from './Organigramm';
import { baumZielStil } from '../../components/organigramm/HaengenderBaum';
import { antdToken, dichten, farbenDunkel } from '../../theme/tokens';
import { baueFuehrungsorganisation } from './fuehrungsorganisation';
import { contrastSurface } from '@einsatzzeichen/core';
import { ConfigProvider, theme } from 'antd';
import { ZEICHEN_THEME_DUNKEL } from '../../zeichen/zeichenTheme';

vi.mock('../../api/einsaetze', () => ({
  ladeModulFreigaben: vi.fn(),
  ladeMitglieder: vi.fn(async () => []),
  ladeFuehrungsstelle: vi.fn(async () => ({
    art: 'mobil',
    sprechgruppen: [],
    verbindungen: [],
    fahrzeug_ids: [],
  })),
}));
vi.mock('../../api/lageberichte', () => ({
  legeLageberichtAn: vi.fn(() => Promise.resolve({ id: 77 })),
}));
const { navigiere } = vi.hoisted(() => ({ navigiere: vi.fn() }));
vi.mock('react-router', async (orig) => ({ ...(await orig()), useNavigate: () => navigiere }));

const EINSATZ = {
  id: 1,
  bezeichnung: 'Hochwasser Nord',
  status: 'aktiv',
  meine_rolle: 'einsatzleitung',
} as EinsatzAnzeige;

function abschnitt(id: number, p: Partial<Einsatzabschnitt> = {}): Einsatzabschnitt {
  return {
    id,
    einsatz_id: 1,
    name: `Abschnitt ${id}`,
    sortier: id,
    sprechgruppen: [],
    verbindungen: [],
    ...p,
  };
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
    verbindungen: [],
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

/** Ein Mitglied mit Führungsfunktion: die Quelle der Stabsstelle (i6k6mzed, D7). */
function mitglied(id: number, name: string, funktion?: Fuehrungsfunktion): MitgliedAnzeige {
  return {
    benutzer_id: id,
    anzeigename: name,
    benutzername: `konto${id}`,
    einsatz_rolle: 'fuehrungspersonal',
    zugewiesen_at: '2026-10-01T08:00:00',
    ...(funktion ? { fuehrungsfunktion: funktion } : {}),
  };
}

function bild(
  zugeklappt: ReadonlySet<string> = new Set(),
  onUmschalten = vi.fn(),
  einsatzleiter: EinsatzleiterDarstellung = { art: 'nicht-erfasst' },
) {
  const org = baueFuehrungsorganisation(ABSCHNITTE, EINHEITEN);
  return {
    onUmschalten,
    ...renderMitProviders(
      <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
        <OrganigrammBild
          einsatzId={1}
          org={org}
          einsatzleiter={einsatzleiter}
          stab={[]}
          zugeklappt={zugeklappt}
          onUmschalten={onUmschalten}
        />
      </AnzeigeKonventionenProvider>,
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

  it('nennt Bezeichnung und Rufname der Führungsstelle; die Leitung bleibt offen (LFH-1181)', () => {
    renderMitProviders(
      <OrganigrammBild
        einsatzId={1}
        org={baueFuehrungsorganisation(ABSCHNITTE, EINHEITEN)}
        einsatzleiter={{ art: 'nicht-erfasst' }}
        stab={[]}
        fuehrungsstelle={{ bezeichnung: 'ELW 2 Musterstadt', rufname: 'Florian Musterstadt 10/1' }}
        zugeklappt={new Set()}
        onUmschalten={vi.fn()}
      />,
    );
    const wurzel = screen.getByRole('group', { name: 'Einsatzleitung' });
    expect(within(wurzel).getByText('ELW 2 Musterstadt')).toBeInTheDocument();
    expect(within(wurzel).getByText('Florian Musterstadt 10/1')).toBeInTheDocument();
    expect(within(wurzel).getByText('Leitung nicht erfasst')).toBeInTheDocument();
  });

  it('ohne Bezeichnung nur der Rufname, nichts erfunden (LFH-1181)', () => {
    renderMitProviders(
      <OrganigrammBild
        einsatzId={1}
        org={baueFuehrungsorganisation(ABSCHNITTE, EINHEITEN)}
        einsatzleiter={{ art: 'nicht-erfasst' }}
        stab={[]}
        fuehrungsstelle={{ bezeichnung: null, rufname: 'Florian 10/1' }}
        zugeklappt={new Set()}
        onUmschalten={vi.fn()}
      />,
    );
    const wurzel = screen.getByRole('group', { name: 'Einsatzleitung' });
    expect(within(wurzel).getByText('Florian 10/1')).toBeInTheDocument();
    expect(
      within(wurzel)
        .getAllByText(/./)
        .map((e) => e.textContent),
    ).not.toContain('—');
  });

  it('zeigt den erfassten Einsatzleiter mit „seit“ (LFH-1199)', () => {
    bild(new Set(), vi.fn(), {
      art: 'erfasst',
      name: 'Anna Schulz',
      seit: '2026-10-11 12:30:00',
      nichtMehrDisponiert: false,
    });
    const wurzel = screen.getByRole('group', { name: 'Einsatzleitung' });
    expect(within(wurzel).getByText('Anna Schulz')).toBeInTheDocument();
    expect(within(wurzel).getByText('seit 111430')).toBeInTheDocument();
    expect(within(wurzel).queryByText('Leitung nicht erfasst')).toBeNull();
  });

  it('nennt den Grund, wenn die Führungsstelle fehlt', () => {
    bild(new Set(), vi.fn(), { art: 'zustand', grund: 'nicht geladen' });
    const wurzel = screen.getByRole('group', { name: 'Einsatzleitung' });
    expect(within(wurzel).getByText('Leitung: nicht geladen')).toBeInTheDocument();
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
        einsatzleiter={{ art: 'nicht-erfasst' }}
        stab={[]}
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

  // LLH-1409: Zeichen ohne Organisation hätten im Nachtbetrieb keinen Grund, der sie trägt. Nachts
  // hinterlegt das Render-Theme `dark` jede Kontur hell, ohne Fläche dahinter; am Tag keins.
  it('zeichnet nachts jedes Zeichen mit dem Theme `dark`, am Tag ohne, nie mit Fläche dahinter', () => {
    const hinterlegung = `[stroke="${contrastSurface(ZEICHEN_THEME_DUNKEL)}"]`;
    const org = baueFuehrungsorganisation(ABSCHNITTE, EINHEITEN);
    const { container, unmount } = renderMitProviders(
      <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: antdToken(farbenDunkel) }}>
        <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
          <OrganigrammBild
            einsatzId={1}
            org={org}
            einsatzleiter={{ art: 'nicht-erfasst' }}
            stab={[]}
            zugeklappt={new Set()}
            onUmschalten={vi.fn()}
          />
        </AnzeigeKonventionenProvider>
      </ConfigProvider>,
    );
    const nachts = container.querySelectorAll<SVGElement>('[data-lfh="org-zeichen"] svg');
    expect(nachts.length).toBeGreaterThan(0);
    nachts.forEach((z) => {
      expect(z.querySelector(hinterlegung)).not.toBeNull();
      expect(z.style.backgroundColor).toBe('');
    });
    unmount();

    const tags = bild().container.querySelectorAll<SVGElement>('[data-lfh="org-zeichen"] svg');
    expect(tags.length).toBeGreaterThan(0);
    tags.forEach((z) => {
      expect(z.querySelector(hinterlegung)).toBeNull();
      expect(z.style.backgroundColor).toBe('');
    });
  });

  it('stellt Einheiten ohne Abschnitt unter „Ohne Abschnitt“', () => {
    const org = baueFuehrungsorganisation(ABSCHNITTE, [einheit(20, { name: 'Lose Gruppe' })]);
    renderMitProviders(
      <OrganigrammBild
        einsatzId={1}
        org={org}
        einsatzleiter={{ art: 'nicht-erfasst' }}
        stab={[]}
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
    const kinder = document.getElementById(knopf.getAttribute('aria-controls')!);
    expect(kinder).not.toBeNull();
    await userEvent.click(knopf);
    expect(onUmschalten).toHaveBeenCalledWith('ab-1');

    const org = baueFuehrungsorganisation(ABSCHNITTE, EINHEITEN);
    rerender(
      <OrganigrammBild
        einsatzId={1}
        org={org}
        einsatzleiter={{ art: 'nicht-erfasst' }}
        stab={[]}
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
    // Zugeklappt sind die Kinder nicht im DOM: dann verweist der Knopf auch auf nichts.
    expect(screen.getByRole('button', { name: 'Unterstellte von EA Nord' })).not.toHaveAttribute(
      'aria-controls',
    );
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
    vi.mocked(ladeModulFreigaben).mockResolvedValue(
      freigabenFixture({ stab: { sichtbar: false } }),
    );
    vi.mocked(ladeMitglieder).mockReset().mockResolvedValue([]);
  });

  function container(abschnitte = ABSCHNITTE, einheiten = EINHEITEN) {
    return renderMitProviders(
      <Organigramm einsatz={EINSATZ} abschnitte={abschnitte} einheiten={daten(einheiten)} />,
    );
  }

  it('liest die Führungsstelle für die Wurzel; gescheitert ohne ihre Zeilen, mit Grund (LFH-1181, LFH-1199)', async () => {
    vi.mocked(ladeFuehrungsstelle).mockResolvedValueOnce({
      art: 'ortsfest',
      bezeichnung: 'TEL Rathaus',
      sprechgruppen: [],
      verbindungen: [],
      fahrzeug_ids: [],
    });
    const { unmount } = container();
    const wurzel = screen.getByRole('group', { name: 'Einsatzleitung' });
    expect(await within(wurzel).findByText('TEL Rathaus')).toBeInTheDocument();
    unmount();

    vi.mocked(ladeFuehrungsstelle).mockRejectedValueOnce(new Error('kaputt'));
    container();
    const neu = screen.getByRole('group', { name: 'Einsatzleitung' });
    await waitFor(() => expect(ladeFuehrungsstelle).toHaveBeenCalledTimes(2));
    // Keine Bezeichnung, kein Rufname; die Leitung nennt den Grund statt „nicht erfasst“ (LFH-1199).
    await waitFor(() => expect(neu.textContent).toBe('EinsatzleitungLeitung: nicht geladen'));
  });

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
    // Zeiger und Fokus verlassen das Organigramm, sonst hielte die Schleuse den Zugang (LFH-867).
    fireEvent.pointerLeave(screen.getByRole('region', { name: 'Organigramm' }), {
      pointerType: 'mouse',
    });
    act(() => (document.activeElement as HTMLElement).blur());
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

  it('zeigt den Einsatzleiter, sobald die Führungsstelle antwortet, auch unter ruhendem Zeiger (LLH-1166)', async () => {
    let antworte: (f: Awaited<ReturnType<typeof ladeFuehrungsstelle>>) => void = () => {};
    vi.mocked(ladeFuehrungsstelle).mockReturnValueOnce(new Promise((r) => (antworte = r)));
    container();
    fireEvent.pointerEnter(screen.getByRole('region', { name: 'Organigramm' }), {
      pointerType: 'mouse',
    });
    expect(screen.getByText('Live pausiert')).toBeInTheDocument();
    const wurzel = screen.getByRole('group', { name: 'Einsatzleitung' });
    expect(wurzel).toHaveTextContent('Leitung: lädt');
    await act(async () =>
      antworte({
        art: 'mobil',
        sprechgruppen: [],
        verbindungen: [],
        fahrzeug_ids: [],
        einsatzleiter: {
          art: 'extern',
          name: 'BI Krause',
          personal_noch_disponiert: true,
          seit: '2026-10-11 12:30:00',
        },
      }),
    );
    expect(
      await within(screen.getByRole('group', { name: 'Einsatzleitung' })).findByText(
        'BI Krause (extern)',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Live pausiert')).toBeInTheDocument();
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
    vi.mocked(ladeMitglieder).mockReset().mockResolvedValue([]);
    vi.mocked(ladeModulFreigaben).mockResolvedValue(freigabenFixture());
  });

  function container() {
    return renderMitProviders(
      <Organigramm einsatz={EINSATZ} abschnitte={ABSCHNITTE} einheiten={daten(EINHEITEN)} />,
    );
  }

  // Spec `fuehrungsorganisation`, „Einsatzleitung und Stab“ (i6k6mzed, D7).
  it('zeigt die geführten Sachgebiete in S-Folge mit den Namen der Mitglieder, alphabetisch', async () => {
    vi.mocked(ladeMitglieder).mockResolvedValue([
      mitglied(1, 'Clara Lage', 's2'),
      mitglied(2, 'Albert Lage', 's2'),
      mitglied(3, 'Bert Personal', 's1'),
      mitglied(4, 'Lea Leitung', 'el'),
      mitglied(5, 'Otto Ohne'),
    ]);
    container();
    const stab = await screen.findByRole('group', { name: 'Stab' });
    const zeilen = within(stab)
      .getAllByRole('listitem')
      .map((z) => z.textContent);
    expect(zeilen).toEqual(['S1Bert Personal', 'S2Albert Lage, Clara Lage']);
  });

  it('zeigt ohne geführtes Sachgebiet keine Stabsstelle', async () => {
    vi.mocked(ladeMitglieder).mockResolvedValue([mitglied(4, 'Lea Leitung', 'el')]);
    container();
    await waitFor(() => expect(ladeMitglieder).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('group', { name: 'Stab' })).toBeNull();
  });

  // Eine Modulfreigabe ist nicht nötig: das Modul Stab spielt keine Rolle mehr.
  it('zeigt die Stabsstelle auch bei ausgeblendetem Stab', async () => {
    vi.mocked(ladeModulFreigaben).mockResolvedValue(
      freigabenFixture({ stab: { sichtbar: false } }),
    );
    vi.mocked(ladeMitglieder).mockResolvedValue([mitglied(1, 'Clara Lage', 's2')]);
    container();
    const stab = await screen.findByRole('group', { name: 'Stab' });
    expect(within(stab).getByText('Clara Lage')).toBeInTheDocument();
  });

  it('zeigt die Stabsstelle, sobald sie geladen ist, auch unter ruhendem Zeiger (LLH-1166)', async () => {
    let antworte: (m: MitgliedAnzeige[]) => void = () => {};
    vi.mocked(ladeMitglieder).mockReturnValueOnce(new Promise((r) => (antworte = r)));
    container();
    fireEvent.pointerEnter(screen.getByRole('region', { name: 'Organigramm' }), {
      pointerType: 'mouse',
    });
    await waitFor(() => expect(ladeMitglieder).toHaveBeenCalled());
    expect(screen.queryByRole('group', { name: 'Stab' })).toBeNull();
    await act(async () => antworte([mitglied(1, 'Clara Lage', 's1')]));
    const stab = await screen.findByRole('group', { name: 'Stab' });
    expect(within(stab).getByText('Clara Lage')).toBeInTheDocument();
    expect(screen.getByText('Live pausiert')).toBeInTheDocument();
  });

  it('zeigt keine Stabsstelle, wenn der Abruf der Mitglieder scheitert', async () => {
    vi.mocked(ladeMitglieder).mockRejectedValue(new Error('kaputt'));
    container();
    await waitFor(() => expect(ladeMitglieder).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('group', { name: 'Stab' })).toBeNull();
  });
});

describe('Organigramm — In Lagebericht übernehmen', () => {
  beforeEach(() => {
    navigiere.mockReset();
    vi.mocked(legeLageberichtAn).mockClear();
    vi.mocked(ladeModulFreigaben).mockResolvedValue(
      freigabenFixture({ stab: { sichtbar: false } }),
    );
    vi.mocked(ladeMitglieder).mockReset().mockResolvedValue([]);
  });

  function container(einsatz = EINSATZ, einheiten: Quelle<Einheit> = daten(EINHEITEN)) {
    return renderMitProviders(
      <Organigramm einsatz={einsatz} abschnitte={ABSCHNITTE} einheiten={einheiten} />,
    );
  }

  it('legt EINEN Freitext-Bericht mit der Gliederung an und öffnet ihn', async () => {
    container();
    const knopf = await screen.findByRole('button', { name: /In Lagebericht übernehmen/ });
    await waitFor(() => expect(knopf).toBeEnabled());
    await userEvent.click(knopf);
    await waitFor(() => expect(navigiere).toHaveBeenCalledWith('/einsaetze/1/lageberichte/77'));
    expect(vi.mocked(legeLageberichtAn)).toHaveBeenCalledTimes(1);
    const [einsatzId, eingabe] = vi.mocked(legeLageberichtAn).mock.calls[0];
    expect(einsatzId).toBe(1);
    expect(eingabe.vorlage).toBe('freitext');
    expect(eingabe.titel).toMatch(/^Führungsorganisation \S+/);
    expect(eingabe.abschnitte).toHaveLength(1);
    expect(eingabe.abschnitte![0].schluessel).toBe('text');
    expect(eingabe.abschnitte![0].text).toContain('**EA Nord** · Rufname EA-N');
    expect(eingabe.abschnitte![0].text).toContain('- Leitung nicht erfasst');
  });

  it('übernimmt den erfassten Einsatzleiter (LFH-1199)', async () => {
    vi.mocked(ladeFuehrungsstelle).mockResolvedValueOnce({
      art: 'mobil',
      sprechgruppen: [],
      verbindungen: [],
      fahrzeug_ids: [],
      einsatzleiter: {
        art: 'extern',
        name: 'KBM Weber',
        personal_noch_disponiert: false,
        seit: '2026-10-11 12:30:00',
      },
    });
    container();
    await screen.findByText('KBM Weber (extern)');
    const knopf = screen.getByRole('button', { name: /In Lagebericht übernehmen/ });
    await waitFor(() => expect(knopf).toBeEnabled());
    await userEvent.click(knopf);
    await waitFor(() => expect(vi.mocked(legeLageberichtAn)).toHaveBeenCalledTimes(1));
    const text = vi.mocked(legeLageberichtAn).mock.calls[0][1].abschnitte![0].text;
    expect(text).toMatch(/- Einsatzleiter: KBM Weber \(extern\) \(seit 11\d{4}okt26\)/);
  });

  it('sperrt die Übernahme, solange die Führungsstelle lädt', async () => {
    vi.mocked(ladeFuehrungsstelle).mockReturnValueOnce(new Promise(() => {}));
    container();
    const knopf = await screen.findByRole('button', { name: /In Lagebericht übernehmen/ });
    await waitFor(() => expect(ladeModulFreigaben).toHaveBeenCalled());
    expect(knopf).toBeDisabled();
  });

  it('nimmt den Stand aus dem Datenstand, nicht aus dem Klick', async () => {
    renderMitProviders(
      <Organigramm
        einsatz={EINSATZ}
        abschnitte={ABSCHNITTE}
        einheiten={daten(EINHEITEN)}
        datenstand={new Date('2026-01-01T10:12:00Z').getTime()}
      />,
    );
    const knopf = await screen.findByRole('button', { name: /In Lagebericht übernehmen/ });
    await waitFor(() => expect(knopf).toBeEnabled());
    await userEvent.click(knopf);
    await waitFor(() => expect(vi.mocked(legeLageberichtAn)).toHaveBeenCalledTimes(1));
    const eingabe = vi.mocked(legeLageberichtAn).mock.calls[0][1];
    expect(eingabe.titel).toMatch(/^Führungsorganisation 01\d{4}jan26$/);
  });

  it('schreibt einen gescheiterten Abruf der Mitglieder in den Bericht', async () => {
    vi.mocked(ladeMitglieder).mockRejectedValue(new Error('kaputt'));
    container();
    await waitFor(() => expect(ladeMitglieder).toHaveBeenCalled());
    const knopf = await screen.findByRole('button', { name: /In Lagebericht übernehmen/ });
    await waitFor(() => expect(knopf).toBeEnabled());
    await userEvent.click(knopf);
    await waitFor(() => expect(vi.mocked(legeLageberichtAn)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(legeLageberichtAn).mock.calls[0][1].abschnitte![0].text).toContain(
      '- Führungsfunktionen: Mitglieder nicht geladen',
    );
  });

  it('übernimmt die Führungsfunktionen aus den Mitgliedern (i6k6mzed, D7)', async () => {
    vi.mocked(ladeMitglieder).mockResolvedValue([mitglied(1, 'Dora Einsatz', 's3')]);
    container();
    await screen.findByRole('group', { name: 'Stab' });
    const knopf = screen.getByRole('button', { name: /In Lagebericht übernehmen/ });
    await waitFor(() => expect(knopf).toBeEnabled());
    await userEvent.click(knopf);
    await waitFor(() => expect(vi.mocked(legeLageberichtAn)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(legeLageberichtAn).mock.calls[0][1].abschnitte![0].text).toContain(
      '- Führungsfunktionen: S3 Dora Einsatz',
    );
  });

  it('sperrt die Übernahme, solange die Einheiten laden', async () => {
    container(EINSATZ, { zustand: 'laden', daten: [] });
    expect(await screen.findByRole('button', { name: /In Lagebericht übernehmen/ })).toBeDisabled();
    // Der Grund steht am Knopf: er dreht, solange eine Quelle lädt (kein Tooltip, LFH-1078).
    expect(screen.getByRole('button', { name: /In Lagebericht übernehmen/ })).toHaveClass(
      'ant-btn-loading',
    );
  });

  it('sperrt die Übernahme, solange die Mitglieder laden', async () => {
    vi.mocked(ladeMitglieder).mockReturnValue(new Promise(() => {}));
    container();
    await waitFor(() => expect(ladeMitglieder).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: /In Lagebericht übernehmen/ })).toBeDisabled();
  });

  it('zeigt einen Fehler an der Seite und navigiert nicht', async () => {
    vi.mocked(legeLageberichtAn).mockRejectedValueOnce(
      new ApiError(422, 'Einsatz ist abgeschlossen'),
    );
    container();
    const knopf = await screen.findByRole('button', { name: /In Lagebericht übernehmen/ });
    await waitFor(() => expect(knopf).toBeEnabled());
    await userEvent.click(knopf);
    expect(await screen.findByText('Einsatz ist abgeschlossen')).toBeInTheDocument();
    expect(navigiere).not.toHaveBeenCalled();
  });

  it('fehlt ohne Schreibrecht', async () => {
    container({ ...EINSATZ, meine_rolle: 'beobachter' } as EinsatzAnzeige);
    expect(await screen.findByRole('button', { name: 'Drucken / als PDF' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /In Lagebericht übernehmen/ })).toBeNull();
  });

  it('fehlt, wenn das Modul Lageberichte nicht freigegeben ist', async () => {
    vi.mocked(ladeModulFreigaben).mockResolvedValue(
      freigabenFixture({ stab: { sichtbar: false }, lageberichte: { sichtbar: false } }),
    );
    container();
    await waitFor(() => expect(ladeModulFreigaben).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('button', { name: /In Lagebericht übernehmen/ })).toBeNull();
  });
});

describe('Organigramm — Druck', () => {
  beforeEach(() => {
    vi.mocked(ladeModulFreigaben).mockResolvedValue(
      freigabenFixture({ stab: { sichtbar: false } }),
    );
  });

  it('ist eine Druckwurzel mit Druckkopf „Führungsorganisation“', () => {
    const { container } = renderMitProviders(
      <Organigramm einsatz={EINSATZ} abschnitte={ABSCHNITTE} einheiten={daten(EINHEITEN)} />,
    );
    const wurzel = container.querySelector('[data-lfh="druckwurzel"]');
    expect(wurzel).not.toBeNull();
    expect(within(wurzel as HTMLElement).getByText('Führungsorganisation')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-lfh="druckwurzel"]')).toHaveLength(1);
  });

  it('klappt vor dem Druck alles auf', async () => {
    const drucke = vi.spyOn(window, 'print').mockImplementation(() => {});
    renderMitProviders(
      <Organigramm einsatz={EINSATZ} abschnitte={ABSCHNITTE} einheiten={daten(EINHEITEN)} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Alle zuklappen' }));
    expect(screen.queryByRole('link', { name: '1. Zug' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Drucken / als PDF' }));
    expect(await screen.findByRole('link', { name: '1. Zug' })).toBeInTheDocument();
    await waitFor(() => expect(drucke).toHaveBeenCalledTimes(1));
    drucke.mockRestore();
  });
});

/**
 * Trefffläche der Namenslinks (LFH-365, Muster `bedienzielStil`): ein `<a>` erbt keine
 * Steuerhöhe. Geprüft wird die reine Stilfunktion gegen die Dichtestufen; die Böden stehen als
 * LITERALE da, sonst prüfte der Token sich selbst.
 */
describe('baumZielStil', () => {
  const tokenFuer = (stufe: keyof typeof dichten) => ({
    controlHeight: dichten[stufe].zeilenhoehe,
  });

  it('trägt den Boden aus controlHeight — 30 / 48 / 72 px', () => {
    expect(baumZielStil(tokenFuer('kompakt')).minHeight).toBe(30);
    expect(baumZielStil(tokenFuer('komfortabel')).minHeight).toBe(48);
    expect(baumZielStil(tokenFuer('handschuh')).minHeight).toBe(72);
  });

  it('ist ein Block in der Zeile, damit die Höhe greift', () => {
    expect(baumZielStil(tokenFuer('kompakt')).display).toBe('inline-flex');
  });

  it('hängt an den Namenslinks', () => {
    bild();
    const link = screen.getByRole('link', { name: 'EA Nord' });
    expect(link.style.display).toBe('inline-flex');
    expect(link.style.minHeight).not.toBe('');
  });
});
