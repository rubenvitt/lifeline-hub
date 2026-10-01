import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../../test/utils';
import { ladeModulOverrides } from '../../api/einsaetze';
import { ladeStab } from '../../api/stab';
import { legeLageberichtAn } from '../../api/lageberichte';
import { ApiError } from '../../api/client';
import type {
  Einheit,
  EinsatzAnzeige,
  Einsatzabschnitt,
  Stab,
  Stabsfunktion,
} from '../../api/types';
import type { Quelle } from '../../stab/luecken';
import Organigramm, { OrganigrammBild, organigrammZielStil } from './Organigramm';
import { dichten } from '../../theme/tokens';
import { baueFuehrungsorganisation } from './fuehrungsorganisation';

vi.mock('../../api/einsaetze', () => ({ ladeModulOverrides: vi.fn() }));
vi.mock('../../api/stab', () => ({ ladeStab: vi.fn() }));
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
    const kinder = document.getElementById(knopf.getAttribute('aria-controls')!);
    expect(kinder).not.toBeNull();
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

describe('Organigramm — In Lagebericht übernehmen', () => {
  beforeEach(() => {
    navigiere.mockReset();
    vi.mocked(legeLageberichtAn).mockClear();
    vi.mocked(ladeModulOverrides).mockResolvedValue({
      stab: { sichtbar: false, einsatz_id: 1, modul_key: 'stab' },
    });
    vi.mocked(ladeStab).mockReset();
  });

  function container(einsatz = EINSATZ, einheiten: Quelle<Einheit> = daten(EINHEITEN)) {
    return renderMitProviders(
      <Organigramm einsatz={einsatz} abschnitte={ABSCHNITTE} einheiten={einheiten} />,
    );
  }

  it('legt EINEN Freitext-Bericht mit der Gliederung an und öffnet ihn', async () => {
    container();
    const knopf = await screen.findByRole('button', { name: 'In Lagebericht übernehmen' });
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
    const knopf = await screen.findByRole('button', { name: 'In Lagebericht übernehmen' });
    await waitFor(() => expect(knopf).toBeEnabled());
    await userEvent.click(knopf);
    await waitFor(() => expect(vi.mocked(legeLageberichtAn)).toHaveBeenCalledTimes(1));
    const eingabe = vi.mocked(legeLageberichtAn).mock.calls[0][1];
    expect(eingabe.titel).toMatch(/^Führungsorganisation 01\d{4}JAN2026$/);
  });

  it('schreibt einen gescheiterten Stababruf in den Bericht', async () => {
    vi.mocked(ladeModulOverrides).mockResolvedValue({});
    vi.mocked(ladeStab).mockRejectedValue(new Error('kaputt'));
    container();
    const stab = await screen.findByRole('group', { name: 'Stab' });
    await within(stab).findByText('Besetzung nicht geladen');
    const knopf = screen.getByRole('button', { name: 'In Lagebericht übernehmen' });
    await waitFor(() => expect(knopf).toBeEnabled());
    await userEvent.click(knopf);
    await waitFor(() => expect(vi.mocked(legeLageberichtAn)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(legeLageberichtAn).mock.calls[0][1].abschnitte![0].text).toContain(
      '- Stab: Besetzung nicht geladen',
    );
  });

  it('übernimmt den Stab nur, wenn er freigegeben und geladen ist', async () => {
    vi.mocked(ladeModulOverrides).mockResolvedValue({});
    vi.mocked(ladeStab).mockResolvedValue({
      besetzung: [besetzung({ sachgebiet: 's3', name: 'Dora Einsatz' })],
    } as Stab);
    container();
    await screen.findByRole('group', { name: 'Stab' });
    const knopf = screen.getByRole('button', { name: 'In Lagebericht übernehmen' });
    await waitFor(() => expect(knopf).toBeEnabled());
    await userEvent.click(knopf);
    await waitFor(() => expect(vi.mocked(legeLageberichtAn)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(legeLageberichtAn).mock.calls[0][1].abschnitte![0].text).toContain(
      '- Stab: S3 Dora Einsatz',
    );
  });

  it('sperrt die Übernahme, solange die Einheiten laden', async () => {
    container(EINSATZ, { zustand: 'laden', daten: [] });
    expect(await screen.findByRole('button', { name: 'In Lagebericht übernehmen' })).toBeDisabled();
  });

  it('sperrt die Übernahme, solange die freigegebene Stabsbesetzung lädt', async () => {
    vi.mocked(ladeModulOverrides).mockResolvedValue({});
    vi.mocked(ladeStab).mockReturnValue(new Promise(() => {}));
    container();
    await waitFor(() => expect(ladeStab).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'In Lagebericht übernehmen' })).toBeDisabled();
  });

  it('zeigt einen Fehler an der Seite und navigiert nicht', async () => {
    vi.mocked(legeLageberichtAn).mockRejectedValueOnce(
      new ApiError(422, 'Einsatz ist abgeschlossen'),
    );
    container();
    const knopf = await screen.findByRole('button', { name: 'In Lagebericht übernehmen' });
    await waitFor(() => expect(knopf).toBeEnabled());
    await userEvent.click(knopf);
    expect(await screen.findByText('Einsatz ist abgeschlossen')).toBeInTheDocument();
    expect(navigiere).not.toHaveBeenCalled();
  });

  it('fehlt ohne Schreibrecht', async () => {
    container({ ...EINSATZ, meine_rolle: 'beobachter' } as EinsatzAnzeige);
    expect(await screen.findByRole('button', { name: 'Drucken / als PDF' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'In Lagebericht übernehmen' })).toBeNull();
  });

  it('fehlt, wenn das Modul Lageberichte nicht freigegeben ist', async () => {
    vi.mocked(ladeModulOverrides).mockResolvedValue({
      stab: { sichtbar: false, einsatz_id: 1, modul_key: 'stab' },
      lageberichte: { sichtbar: false, einsatz_id: 1, modul_key: 'lageberichte' },
    });
    container();
    await waitFor(() => expect(ladeModulOverrides).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('button', { name: 'In Lagebericht übernehmen' })).toBeNull();
  });
});

describe('Organigramm — Druck', () => {
  beforeEach(() => {
    vi.mocked(ladeModulOverrides).mockResolvedValue({
      stab: { sichtbar: false, einsatz_id: 1, modul_key: 'stab' },
    });
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
describe('organigrammZielStil', () => {
  const tokenFuer = (stufe: keyof typeof dichten) => ({
    controlHeight: dichten[stufe].zeilenhoehe,
  });

  it('trägt den Boden aus controlHeight — 30 / 48 / 72 px', () => {
    expect(organigrammZielStil(tokenFuer('kompakt')).minHeight).toBe(30);
    expect(organigrammZielStil(tokenFuer('komfortabel')).minHeight).toBe(48);
    expect(organigrammZielStil(tokenFuer('handschuh')).minHeight).toBe(72);
  });

  it('ist ein Block in der Zeile, damit die Höhe greift', () => {
    expect(organigrammZielStil(tokenFuer('kompakt')).display).toBe('inline-flex');
  });

  it('hängt an den Namenslinks', () => {
    bild();
    const link = screen.getByRole('link', { name: 'EA Nord' });
    expect(link.style.display).toBe('inline-flex');
    expect(link.style.minHeight).not.toBe('');
  });
});
