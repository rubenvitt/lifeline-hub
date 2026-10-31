import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import type { Verpflegungsstelle } from '../api/types';
import { renderMitProviders } from '../test/utils';
import {
  DEICH,
  FELDKUECHE,
  TURNHALLE,
  ausgabe,
  stelle,
  verpflegungMitStellen,
  zeitfenster,
} from '../test/verpflegungDaten';
import StellenListe, { type StellenListeProps } from './StellenListe';

dayjs.extend(utc);

/** 12:30 Berlin: „Mittag“ läuft. */
const MITTAGS = dayjs.utc('2026-09-24 10:30:00');

function zeige(over: Partial<StellenListeProps> = {}) {
  const v = verpflegungMitStellen();
  const props: StellenListeProps = {
    einsatzId: 1,
    stellen: v.stellen,
    zeitfenster: v.zeitfenster,
    jetzt: MITTAGS,
    darfPlanen: true,
    mitOrt: false,
    onAnlegen: vi.fn(),
    onBearbeiten: vi.fn(),
    onStatus: vi.fn(() => Promise.resolve()),
    onStornieren: vi.fn(() => Promise.resolve()),
    ...over,
  };
  renderMitProviders(<StellenListe {...props} />);
  return props;
}

const zeile = (bezeichnung: string) =>
  screen.getByRole('article', { name: `Stelle ${bezeichnung}` });

async function oeffneMenue(bezeichnung: string) {
  await userEvent.click(screen.getByRole('button', { name: `Aktionen zu Stelle ${bezeichnung}` }));
  return waitFor(() => {
    const menue = document.querySelector<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    );
    expect(menue).not.toBeNull();
    return menue!;
  });
}

const fehler409 = () => new ApiError(409, 'Die Verpflegungsstelle ist storniert');

describe('StellenListe (LLH-1040 D13 Punkt 2)', () => {
  it('zeigt je Stelle Art, Standort, Status als Wort und das laufende Zeitfenster mit Ist', () => {
    zeige({
      stellen: [
        stelle({
          id: FELDKUECHE,
          bezeichnung: 'Feldküche BR Sportplatz',
          standort: 'Am Sportplatz 2',
        }),
        stelle({ id: DEICH, bezeichnung: 'Zuführung Deich', art: 'zufuehrung', status: 'geplant' }),
      ],
    });
    const fk = zeile('Feldküche BR Sportplatz');
    expect(within(fk).getByText('Feldküche')).toBeInTheDocument();
    expect(within(fk).getByText('Am Sportplatz 2')).toBeInTheDocument();
    expect(within(fk).getByText('aktiv')).toBeInTheDocument();
    expect(within(fk).getByText('Mittag 1200–1330')).toBeInTheDocument();
    expect(within(fk).getByText('100 EP ausgegeben')).toBeInTheDocument();

    const deich = zeile('Zuführung Deich');
    expect(within(deich).getByText('Zuführung')).toBeInTheDocument();
    expect(within(deich).getByText('geplant')).toBeInTheDocument();
    expect(within(deich).getByText('kein laufendes Zeitfenster')).toBeInTheDocument();
  });

  it('stellt aufgelöste Stellen eingeklappt ans Ende', async () => {
    zeige({
      stellen: [
        stelle({ id: 1, bezeichnung: 'A alt', status: 'aufgeloest' }),
        stelle({ id: 2, bezeichnung: 'B neu' }),
      ],
    });
    expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual([
      'Stelle B neu',
    ]);
    await userEvent.click(screen.getByRole('button', { name: /aufgelöst \(1\)/ }));
    await waitFor(() =>
      expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual([
        'Stelle B neu',
        'Stelle A alt',
      ]),
    );
  });

  it('Leerzustand mit „Stelle anlegen“, ohne Planrecht ohne Aktion', async () => {
    const props = zeige({ stellen: [] });
    expect(screen.getByText('Keine Verpflegungsstellen')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Stelle anlegen' }));
    expect(props.onAnlegen).toHaveBeenCalled();
  });

  it('Leerzustand ohne Planrecht ohne Aktion', () => {
    zeige({ stellen: [], darfPlanen: false });
    expect(screen.getByText('Keine Verpflegungsstellen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stelle anlegen' })).toBeNull();
  });

  describe('Aktionen je Status', () => {
    it('geplant ohne Ausgabe: ein Menü mit In Betrieb nehmen, Bearbeiten, Auflösen, Stornieren', async () => {
      zeige();
      const menue = await oeffneMenue('Zuführung Deich');
      expect(
        within(menue)
          .getAllByRole('menuitem')
          .map((m) => m.textContent),
      ).toEqual(['In Betrieb nehmen', 'Bearbeiten …', 'Auflösen …', 'Stornieren …']);
    });

    it('geplant mit Ausgabe (auch zurückgenommen): kein Stornieren', async () => {
      const v = verpflegungMitStellen();
      v.zeitfenster[0].ausgaben.push(
        ausgabe({
          id: 30,
          verpflegungsstelle_id: DEICH,
          zurueckgenommen_at: '2026-09-24 10:20:00',
        }),
      );
      zeige({ zeitfenster: v.zeitfenster });
      const menue = await oeffneMenue('Zuführung Deich');
      expect(
        within(menue)
          .getAllByRole('menuitem')
          .map((m) => m.textContent),
      ).toEqual(['In Betrieb nehmen', 'Bearbeiten …', 'Auflösen …']);
    });

    it('geplant mit gekoppeltem Gerät: „Stornieren“ gesperrt mit Grund „Gerät gekoppelt“ (LLH-1048)', async () => {
      const v = verpflegungMitStellen();
      const props = zeige({
        stellen: v.stellen.map((s) => (s.id === DEICH ? { ...s, geraet_gekoppelt: true } : s)),
      });
      const menue = await oeffneMenue('Zuführung Deich');
      const eintrag = within(menue).getByRole('menuitem', {
        name: 'Stornieren … (Gerät gekoppelt)',
      });
      expect(eintrag).toHaveAttribute('aria-disabled', 'true');
      await userEvent.click(eintrag);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(props.onStornieren).not.toHaveBeenCalled();
    });

    it('aktiv: zwei Knöpfe, kein Menü', () => {
      zeige();
      const fk = zeile('Feldküche BR Sportplatz');
      expect(
        within(fk).getByRole('button', { name: 'Bearbeiten … zu Stelle Feldküche BR Sportplatz' }),
      ).toBeInTheDocument();
      expect(
        within(fk).getByRole('button', { name: 'Auflösen … zu Stelle Feldküche BR Sportplatz' }),
      ).toBeInTheDocument();
      expect(within(fk).queryByRole('button', { name: /^Aktionen zu/ })).toBeNull();
    });

    it('aufgelöst: nur Bearbeiten', async () => {
      const props = zeige({
        stellen: [stelle({ id: 1, bezeichnung: 'Alt', status: 'aufgeloest' })],
      });
      await userEvent.click(screen.getByRole('button', { name: /aufgelöst \(1\)/ }));
      const alt = await screen.findByRole('article', { name: 'Stelle Alt' });
      const knoepfe = within(alt).getAllByRole('button');
      expect(knoepfe.map((k) => k.getAttribute('aria-label'))).toEqual([
        'Bearbeiten … zu Stelle Alt',
      ]);
      await userEvent.click(knoepfe[0]);
      expect(props.onBearbeiten).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    });

    it('ohne Planrecht (Beobachter, Gerät): keine Zeilenaktionen', () => {
      zeige({ darfPlanen: false });
      expect(screen.getAllByRole('article')).toHaveLength(3);
      for (const a of screen.getAllByRole('article')) {
        expect(within(a).queryAllByRole('button')).toEqual([]);
      }
    });
  });

  describe('Handlungen', () => {
    it('In Betrieb nehmen geht ohne Rückfrage', async () => {
      const props = zeige();
      const menue = await oeffneMenue('Zuführung Deich');
      await userEvent.click(within(menue).getByText('In Betrieb nehmen'));
      expect(props.onStatus).toHaveBeenCalledWith(expect.objectContaining({ id: DEICH }), 'aktiv');
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('In Betrieb nehmen zeigt bis zur Antwort an der Zeile, dass es läuft (LLH-1297)', async () => {
      let antworte!: () => void;
      const props = zeige({
        onStatus: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              antworte = resolve;
            }),
        ),
      });
      const menue = await oeffneMenue('Zuführung Deich');
      await userEvent.click(within(menue).getByText('In Betrieb nehmen'));
      const deich = zeile('Zuführung Deich');
      const ausloeser = within(deich).getByRole('button', {
        name: 'Aktionen zu Stelle Zuführung Deich',
      });
      expect(deich).toHaveAttribute('aria-busy', 'true');
      expect(ausloeser).toHaveClass('ant-btn-loading');
      // Gesperrt: ein zweiter Tipp schickt nichts doppelt.
      await userEvent.click(ausloeser);
      expect(props.onStatus).toHaveBeenCalledTimes(1);
      // Die andere Zeile läuft nicht mit.
      expect(zeile('Feldküche BR Sportplatz')).not.toHaveAttribute('aria-busy');

      antworte();
      await waitFor(() => expect(deich).not.toHaveAttribute('aria-busy'));
      // antd nimmt `loading` erst im Effekt nach dem Render zurück: darauf warten.
      await waitFor(() => expect(ausloeser).not.toHaveClass('ant-btn-loading'));
    });

    it('Auflösen fragt rot zurück, der Knopf nennt die Handlung; Abbrechen sendet nichts', async () => {
      const props = zeige();
      await userEvent.click(
        screen.getByRole('button', { name: 'Auflösen … zu Stelle Feldküche BR Sportplatz' }),
      );
      const dialog = await screen.findByRole('dialog', {
        name: 'Stelle ‚Feldküche BR Sportplatz‘ auflösen?',
      });
      const ok = within(dialog).getByRole('button', { name: 'Auflösen' });
      expect(ok.className).toMatch(/ant-btn-dangerous/);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
      expect(props.onStatus).not.toHaveBeenCalled();

      await userEvent.click(
        screen.getByRole('button', { name: 'Auflösen … zu Stelle Feldküche BR Sportplatz' }),
      );
      const zweiter = await screen.findByRole('dialog', {
        name: 'Stelle ‚Feldküche BR Sportplatz‘ auflösen?',
      });
      await userEvent.click(within(zweiter).getByRole('button', { name: 'Auflösen' }));
      expect(props.onStatus).toHaveBeenCalledWith(
        expect.objectContaining({ id: FELDKUECHE }),
        'aufgeloest',
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('Stornieren fragt rot zurück und ruft den Storno', async () => {
      const props = zeige();
      const menue = await oeffneMenue('Zuführung Deich');
      await userEvent.click(within(menue).getByText('Stornieren …'));
      const dialog = await screen.findByRole('dialog', {
        name: 'Stelle ‚Zuführung Deich‘ stornieren?',
      });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Stornieren' }));
      expect(props.onStornieren).toHaveBeenCalledWith(expect.objectContaining({ id: DEICH }));
    });

    it('eine Ablehnung (409) beim In-Betrieb-Nehmen steht an der Zeile, kein Fehler-Toast', async () => {
      zeige({ onStatus: vi.fn(() => Promise.reject(fehler409())) });
      const menue = await oeffneMenue('Zuführung Deich');
      await userEvent.click(within(menue).getByText('In Betrieb nehmen'));
      const deich = zeile('Zuführung Deich');
      expect(
        await within(deich).findByText('Die Verpflegungsstelle ist storniert'),
      ).toBeInTheDocument();
      expect(document.querySelector('.ant-message-notice')).toBeNull();
      // Die Zeile steht wieder auf „geplant“, der Auslöser dreht nicht mehr (LLH-1297).
      await waitFor(() => expect(deich).not.toHaveAttribute('aria-busy'));
      expect(deich).toHaveAttribute('data-status', 'geplant');
      expect(within(deich).getByText('geplant')).toBeInTheDocument();
      await waitFor(() =>
        expect(
          within(deich).getByRole('button', { name: 'Aktionen zu Stelle Zuführung Deich' }),
        ).not.toHaveClass('ant-btn-loading'),
      );
      // Die andere Zeile bleibt ohne Grund.
      expect(
        within(zeile('Feldküche BR Sportplatz')).queryByText(
          'Die Verpflegungsstelle ist storniert',
        ),
      ).toBeNull();
    });

    it('eine Ablehnung (422) beim Auflösen steht im Dialog, der offen bleibt', async () => {
      zeige({
        onStatus: vi.fn(() => Promise.reject(new ApiError(422, 'Übergang nicht zulässig'))),
      });
      await userEvent.click(
        screen.getByRole('button', { name: 'Auflösen … zu Stelle Ausgabe Turnhalle Nord' }),
      );
      const dialog = await screen.findByRole('dialog', {
        name: 'Stelle ‚Ausgabe Turnhalle Nord‘ auflösen?',
      });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Auflösen' }));
      expect(await within(dialog).findByText('Übergang nicht zulässig')).toBeInTheDocument();
      expect(document.querySelector('.ant-message-notice')).toBeNull();
    });
  });

  it('ordnet die Ausgabe einer Stelle über die Kennung zu, nicht über den Ort', () => {
    // Die Turnhalle ist der Stelle 22 zugeordnet; ihr Ist kommt aus je_stelle.
    zeige();
    expect(
      within(zeile('Ausgabe Turnhalle Nord')).getByText('80 EP ausgegeben'),
    ).toBeInTheDocument();
    expect(TURNHALLE).toBe(22);
  });

  it('eine Stelle ohne Zeitfenster zeigt keine Zahl', () => {
    const s: Verpflegungsstelle = stelle({ id: 5, bezeichnung: 'Leer' });
    zeige({ stellen: [s], zeitfenster: [zeitfenster({ stelle_ids: [] })] });
    expect(within(zeile('Leer')).queryByText(/EP ausgegeben/)).toBeNull();
  });
});
