import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders, setzeOnline } from '../../test/utils';
import { OHNE_VERBINDUNG_NICHT_AENDERBAR } from '../../offline/verbindung';
import { FREMDEBENE_FEHLERTEXT, type Fremdebene } from '../../api/fremdebenen';
import FremdebenenZeilen, { type FremdebenenZeilenProps } from './FremdebenenZeilen';

const DATEI: Fremdebene = {
  id: 4,
  name: 'Lage Nachbarkreis',
  color: 'fremd-1',
  source: 'datei',
  feature_count: 12,
  dropped_count: 0,
  created_at: '2026-11-24T10:00:00Z',
};

const vorMinuten = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

const URL_EBENE: Fremdebene = {
  id: 5,
  name: 'Pegelpunkte Kreis',
  color: 'fremd-2',
  source: 'url',
  url_host: 'geo.example.org',
  feature_count: 3,
  dropped_count: 0,
  created_at: '2026-11-24T10:00:00Z',
  fetched_at: vorMinuten(3),
};

function zeilen(teil: Partial<FremdebenenZeilenProps> = {}) {
  const props: FremdebenenZeilenProps = {
    ebenen: [DATEI, URL_EBENE],
    sichtbar: new Set([4]),
    onToggle: vi.fn(),
    darfSchreiben: true,
    onUmbenennen: vi.fn(),
    onFarbe: vi.fn(),
    onEntfernen: vi.fn(),
    ...teil,
  };
  renderMitProviders(<FremdebenenZeilen {...props} />);
  return props;
}

describe('Zeilen der Fremdebenen (LLH-2099)', () => {
  it('jede Ebene ist ein Schalter mit ihrem Namen', async () => {
    const props = zeilen();
    const datei = screen.getByRole('switch', { name: 'Lage Nachbarkreis' });
    expect(datei).toHaveAttribute('aria-checked', 'true');
    const url = screen.getByRole('switch', { name: 'Pegelpunkte Kreis' });
    expect(url).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(url);
    expect(props.onToggle).toHaveBeenCalledWith(5);
  });

  it('eine URL-Ebene nennt ihr Alter', () => {
    zeilen();
    const url = screen.getByRole('switch', { name: 'Pegelpunkte Kreis' });
    expect(url).toHaveAccessibleDescription(/vor 3 min/);
    expect(
      screen.getByRole('switch', { name: 'Lage Nachbarkreis' }),
    ).not.toHaveAccessibleDescription(/vor/);
  });

  it('eine URL-Ebene mit Abruffehler zeigt den Warnhinweis mit dem Text zum Code', () => {
    zeilen({ ebenen: [{ ...URL_EBENE, error: 'zeitlimit' }] });
    expect(screen.getByRole('switch', { name: 'Pegelpunkte Kreis' })).toHaveAccessibleDescription(
      new RegExp(FREMDEBENE_FEHLERTEXT.zeitlimit),
    );
    expect(screen.getByText(FREMDEBENE_FEHLERTEXT.zeitlimit)).toBeInTheDocument();
  });

  it('das ⋮ hat Umbenennen, Farbe und Entfernen; nur Entfernen ist rot', async () => {
    zeilen();
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen zu Lage Nachbarkreis' }));
    const liste = await waitFor(() => screen.getByRole('menu'));
    const eintraege = within(liste).getAllByRole('menuitem');
    expect(eintraege.map((e) => e.textContent)).toEqual(['Umbenennen …', 'Farbe …', 'Entfernen …']);
    const [umbenennen, farbe, entfernen] = eintraege;
    expect(umbenennen).not.toHaveClass('ant-dropdown-menu-item-danger');
    expect(farbe).not.toHaveClass('ant-dropdown-menu-item-danger');
    // Unumkehrbar (ADR-0055): rot hinter dem Trenner.
    expect(entfernen).toHaveClass('ant-dropdown-menu-item-danger');
    expect(liste.querySelector('.ant-dropdown-menu-item-divider')).not.toBeNull();
  });

  it('ohne Verbindung ist das ⋮ gesperrt, und der Grund steht sichtbar daneben', async () => {
    setzeOnline(false);
    try {
      zeilen();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Aktionen zu Lage Nachbarkreis' })).toBeDisabled(),
      );
      expect(screen.getByText(OHNE_VERBINDUNG_NICHT_AENDERBAR)).toBeVisible();
    } finally {
      setzeOnline(true);
    }
  });

  it('mit Verbindung steht kein Sperrgrund', () => {
    zeilen();
    expect(screen.queryByText(OHNE_VERBINDUNG_NICHT_AENDERBAR)).toBeNull();
  });

  it('ohne Schreibrecht kein ⋮', () => {
    zeilen({ darfSchreiben: false });
    expect(screen.queryByRole('button', { name: /Aktionen zu/ })).toBeNull();
    expect(screen.getByRole('switch', { name: 'Lage Nachbarkreis' })).toBeInTheDocument();
  });

  it('Entfernen fragt mit Folgesatz nach, der Knopf ist rot', async () => {
    const props = zeilen();
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen zu Lage Nachbarkreis' }));
    const liste = await waitFor(() => screen.getByRole('menu'));
    await userEvent.click(within(liste).getByRole('menuitem', { name: 'Entfernen …' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Fremdebene „Lage Nachbarkreis“ entfernen?',
    });
    expect(within(dialog).getByText(/für alle aus dem Einsatz/)).toBeInTheDocument();
    const knopf = within(dialog).getByRole('button', { name: 'Entfernen' });
    expect(knopf).toHaveClass('ant-btn-dangerous');
    await userEvent.click(knopf);
    expect(props.onEntfernen).toHaveBeenCalledWith(4);
  });

  it('Farbe wählt einen Ton der Palette', async () => {
    const props = zeilen();
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen zu Lage Nachbarkreis' }));
    const liste = await waitFor(() => screen.getByRole('menu'));
    await userEvent.click(within(liste).getByRole('menuitem', { name: 'Farbe …' }));
    const dialog = await screen.findByRole('dialog', { name: 'Farbe von „Lage Nachbarkreis“' });
    const toene = within(dialog).getAllByRole('radio');
    expect(toene).toHaveLength(6);
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Pflaume' }));
    expect(props.onFarbe).toHaveBeenCalledWith(4, 'fremd-3');
  });
});
