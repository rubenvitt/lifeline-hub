import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { setzeViewportBreite, setzeViewportZurueck } from '../../test/viewport';
import EinsatzSeite from '../EinsatzSeite';
import {
  DRUCKANSICHT,
  druckansichtNebenweg,
  druckansichtVon,
  useDruckNebenwege,
} from './useDruckNebenwege';

/**
 * Drucken als Nebenweg (LFH-1079): derselbe Weg wie `DruckKnopf` (Dialog erst mit geladener
 * Organisation), gesperrt mit sichtbarem Grund und einem Weg zurück, wenn sie fehlt.
 */

let drucke: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  drucke = vi.spyOn(window, 'print').mockImplementation(() => {});
});
afterEach(() => {
  drucke.mockRestore();
  setzeViewportZurueck();
});

const NAME = 'Weitere Aktionen zum Bericht';

function Seite() {
  return (
    <EinsatzSeite titel="Bericht" weitere={{ name: NAME, eintraege: useDruckNebenwege() }}>
      <div>Inhalt</div>
    </EinsatzSeite>
  );
}

function offenesMenue() {
  return document.querySelector<HTMLElement>(
    '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
  );
}

describe('useDruckNebenwege', () => {
  it('ab md: ein Knopf, der den Druckdialog öffnet', async () => {
    setzeViewportBreite(1180);
    renderMitProviders(<Seite />);
    await userEvent.click(screen.getByRole('button', { name: 'Drucken / als PDF' }));
    await waitFor(() => expect(drucke).toHaveBeenCalledTimes(1));
  });

  it('unter md: der Menüeintrag öffnet denselben Dialog', async () => {
    setzeViewportBreite(390);
    renderMitProviders(<Seite />);
    expect(screen.queryByRole('button', { name: 'Drucken / als PDF' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: NAME }));
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    await userEvent.click(
      within(offenesMenue()!).getByRole('menuitem', { name: 'Drucken / als PDF' }),
    );
    await waitFor(() => expect(drucke).toHaveBeenCalledTimes(1));
  });

  it('ohne Organisation: gesperrt mit Grund im Text, „Organisation erneut laden“ lädt nach', async () => {
    let abrufe = 0;
    server.use(
      http.get('/api/organisation', () => {
        abrufe += 1;
        return HttpResponse.json({ fehler: 'kaputt' }, { status: 500 });
      }),
    );
    setzeViewportBreite(1180);
    renderMitProviders(<Seite />);
    const gesperrt = await screen.findByRole(
      'button',
      { name: 'Drucken / als PDF (Organisation nicht geladen)' },
      { timeout: 5000 },
    );
    expect(gesperrt).toBeDisabled();
    const vorher = abrufe;
    await userEvent.click(screen.getByRole('button', { name: 'Organisation erneut laden' }));
    await waitFor(() => expect(abrufe).toBeGreaterThan(vorher));
    expect(drucke).not.toHaveBeenCalled();
  });
});

describe('useDruckNebenwege mit Vorbereitung', () => {
  function VorbereiteteSeite({ vorbereiten }: { vorbereiten: () => Promise<boolean> }) {
    return (
      <EinsatzSeite
        titel="Karte"
        weitere={{ name: NAME, eintraege: useDruckNebenwege({ vorbereiten }) }}
      >
        <div>Inhalt</div>
      </EinsatzSeite>
    );
  }

  it('druckt erst, wenn das Druckstück bereit ist', async () => {
    setzeViewportBreite(1180);
    let melde: (bereit: boolean) => void = () => {};
    const vorbereiten = vi.fn(
      () =>
        new Promise<boolean>((fertig) => {
          melde = fertig;
        }),
    );
    renderMitProviders(<VorbereiteteSeite vorbereiten={vorbereiten} />);
    await userEvent.click(screen.getByRole('button', { name: 'Drucken / als PDF' }));
    expect(vorbereiten).toHaveBeenCalledTimes(1);
    expect(drucke).not.toHaveBeenCalled();
    melde(true);
    await waitFor(() => expect(drucke).toHaveBeenCalledTimes(1));
  });

  it('meldet die Vorbereitung `false`, bleibt der Dialog zu', async () => {
    setzeViewportBreite(1180);
    const vorbereiten = vi.fn(() => Promise.resolve(false));
    renderMitProviders(<VorbereiteteSeite vorbereiten={vorbereiten} />);
    await userEvent.click(screen.getByRole('button', { name: 'Drucken / als PDF' }));
    await waitFor(() => expect(vorbereiten).toHaveBeenCalledTimes(1));
    // Der Eintrag läuft nicht weiter: eine zweite Wahl bereitet erneut vor. (Das Ladesymbol
    // klingt in jsdom nie aus, deshalb am Verhalten statt am Namen geprüft.)
    await userEvent.click(screen.getByRole('button', { name: /Drucken \/ als PDF/ }));
    await waitFor(() => expect(vorbereiten).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(drucke).not.toHaveBeenCalled();
  });
});

describe('useDruckNebenwege mit synchronem Vorbereiten (LLH-1836)', () => {
  it('läuft im selben Zug vor dem Druckdialog, ohne Ladezustand', async () => {
    setzeViewportBreite(1180);
    const folge: string[] = [];
    drucke.mockImplementation(() => folge.push('druck'));
    function Seite() {
      return (
        <EinsatzSeite
          titel="Meldebild"
          weitere={{
            name: NAME,
            eintraege: useDruckNebenwege({ vorDemDruck: () => folge.push('aufklappen') }),
          }}
        >
          <div>Inhalt</div>
        </EinsatzSeite>
      );
    }
    renderMitProviders(<Seite />);
    await userEvent.click(screen.getByRole('button', { name: 'Drucken / als PDF' }));
    await waitFor(() => expect(folge).toEqual(['aufklappen', 'druck']));
  });
});

describe('druckansichtNebenweg (LLH-1836)', () => {
  it('heißt „Druckansicht“ und öffnet die Druckseite', async () => {
    setzeViewportBreite(1180);
    const navigate = vi.fn();
    renderMitProviders(
      <EinsatzSeite
        titel="Liste"
        weitere={{ name: NAME, eintraege: [druckansichtNebenweg({ ziel: '/x/druck', navigate })] }}
      >
        <div>Inhalt</div>
      </EinsatzSeite>,
    );
    const knopf = screen.getByRole('link', { name: DRUCKANSICHT });
    expect(knopf).toHaveAttribute('href', '/x/druck');
    await userEvent.click(knopf);
    expect(navigate).toHaveBeenCalledWith('/x/druck');
    expect(drucke).not.toHaveBeenCalled();
  });

  it('nennt ein anderes Dokument vor „Druckansicht“', () => {
    expect(druckansichtVon('Einsatzbericht')).toBe('Einsatzbericht – Druckansicht');
    expect(
      druckansichtNebenweg({ ziel: '/b', navigate: () => {}, dokument: 'Einsatzbericht' }),
    ).toMatchObject({ key: 'druck', label: 'Einsatzbericht – Druckansicht', ziel: '/b' });
  });
});
