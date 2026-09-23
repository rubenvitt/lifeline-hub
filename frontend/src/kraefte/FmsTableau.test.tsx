import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EinsatzFahrzeug, Einheit, FahrzeugStatus } from '../api/types';
import type { StatusBedienung } from '../components/StatusWahl';
import { renderMitProviders } from '../test/utils';
import FmsTableau, { type FmsTableauProps } from './FmsTableau';

const KATALOG: FahrzeugStatus[] = [
  {
    id: 1,
    label: '2 – Frei auf Wache',
    kategorie: 'verfuegbar',
    farbe: null,
    fms_anker: 2,
    sortier: 20,
  },
  {
    id: 2,
    label: '3 – Einsatz übernommen',
    kategorie: 'gebunden',
    farbe: null,
    fms_anker: 3,
    sortier: 30,
  },
  {
    id: 3,
    label: '4 – Am Einsatzort',
    kategorie: 'gebunden',
    farbe: null,
    fms_anker: 4,
    sortier: 40,
  },
  // Doppelt belegte Ziffer 3 — der Anker ist nicht eindeutig (migrations/0008).
  {
    id: 4,
    label: 'Anfahrt Bereitstellungsraum',
    kategorie: 'gebunden',
    farbe: null,
    fms_anker: 3,
    sortier: 35,
  },
  { id: 5, label: 'Reserve', kategorie: 'verfuegbar', farbe: null, fms_anker: null, sortier: 90 },
];

function fzg(id: number, funkrufname: string, overrides: Partial<EinsatzFahrzeug> = {}) {
  return {
    id,
    einsatz_id: 7,
    fahrzeug_id: id,
    einheit_id: 1,
    ist_adhoc: false,
    funkrufname,
    status_id: 2,
    status_label: '3 – Einsatz übernommen',
    status_kategorie: 'gebunden',
    status_farbe: null,
    // UTC ohne Zonenkennung, wie der Server sie liefert.
    status_seit: '2026-09-23 12:05:00',
    ...overrides,
  } as unknown as EinsatzFahrzeug;
}

const EINHEITEN = [
  { id: 1, name: 'Zug 1', abschnitt_id: 10, abschnitt_name: 'EA Nord' },
] as unknown as Einheit[];

function bedienung(overrides: Partial<StatusBedienung> = {}) {
  const onWaehlen = vi.fn();
  const von = vi.fn((ef: EinsatzFahrzeug): StatusBedienung => ({
    optionen: [],
    aktuell: ef.status_id,
    kennung: ef.funkrufname,
    onWaehlen,
    ...overrides,
  }));
  return { von, onWaehlen };
}

function zeige(props: Partial<FmsTableauProps> = {}) {
  const b = bedienung();
  const alle: FmsTableauProps = {
    fahrzeuge: [fzg(10, 'Florian 1')],
    katalog: KATALOG,
    einheiten: EINHEITEN,
    darfSchreiben: true,
    bedienungVon: b.von,
    ...props,
  };
  const r = renderMitProviders(<FmsTableau {...alle} />);
  return { ...r, ...b, props: alle };
}

const ausloeser = (funkrufname: string) =>
  screen.getByRole('button', { name: `Status von ${funkrufname} ändern` });

/** Ziffer am fokussierten Auslöser — fireEvent, weil nur der keydown zählt. */
function tippe(ziel: HTMLElement, key: string, extra: Partial<KeyboardEventInit> = {}) {
  act(() => ziel.focus());
  fireEvent.keyDown(ziel, { key, ...extra });
}

afterEach(() => {
  document.querySelectorAll('[data-test-portal]').forEach((n) => n.remove());
});

describe('FmsTableau (LFH-642)', () => {
  it('zeigt je Abschnitt ein Paneel und je Fahrzeug Funkrufname, S-Code, Wort, Seit und Einheit', () => {
    zeige({ fahrzeuge: [fzg(10, 'Florian 1'), fzg(11, 'MTW', { einheit_id: null })] });
    expect(screen.getByRole('heading', { name: 'EA Nord' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ohne Einheit' })).toBeInTheDocument();

    const kachel = ausloeser('Florian 1').closest<HTMLElement>('[data-lfh="fms-kachel"]')!;
    expect(within(kachel).getByText('Florian 1')).toBeInTheDocument();
    // Code und Wort getrennt — der Chip trägt BEIDE Kanäle, der Präfix „3 – " fällt weg.
    expect(within(kachel).getByText('S3')).toBeInTheDocument();
    expect(within(kachel).getByText('Einsatz übernommen')).toBeInTheDocument();
    expect(within(kachel).getByText(/^seit \d{2}[.:]/)).toBeInTheDocument();
    expect(within(kachel).getByText('Zug 1')).toBeInTheDocument();
  });

  it('nennt den Tastenweg nur mit Schreibrecht', () => {
    const { unmount } = zeige();
    expect(screen.getByText(/setzt den Status des gewählten Fahrzeugs/)).toBeInTheDocument();
    unmount();
    zeige({ darfSchreiben: false });
    expect(screen.queryByText(/setzt den Status des gewählten Fahrzeugs/)).toBeNull();
    // Ohne Schreibrecht kein Auslöser — nur das Etikett.
    expect(screen.queryByRole('button', { name: /Status von/ })).toBeNull();
    expect(screen.getByText('S3')).toBeInTheDocument();
  });

  describe('Ziffern', () => {
    it('eine eindeutig belegte Ziffer setzt den Status der fokussierten Kachel', () => {
      const { onWaehlen } = zeige();
      tippe(ausloeser('Florian 1'), '4');
      expect(onWaehlen).toHaveBeenCalledExactlyOnceWith(3);
    });

    it('trifft die Kachel, in der der Fokus steht — nicht die erste', () => {
      const b = bedienung();
      zeige({
        fahrzeuge: [fzg(10, 'Florian 1'), fzg(11, 'Florian 2')],
        bedienungVon: b.von,
      });
      tippe(ausloeser('Florian 2'), '2');
      expect(b.onWaehlen).toHaveBeenCalledExactlyOnceWith(1);
      expect(b.von.mock.calls[b.von.mock.calls.length - 1]?.[0].id).toBe(11);
    });

    it('eine doppelt belegte Ziffer setzt NICHTS und sagt warum', async () => {
      const { onWaehlen } = zeige({ fahrzeuge: [fzg(10, 'Florian 1', { status_id: 3 })] });
      tippe(ausloeser('Florian 1'), '3');
      expect(onWaehlen).not.toHaveBeenCalled();
      expect(
        await screen.findByText(/Ziffer 3 ist im Statuskatalog 2-fach belegt/),
      ).toBeInTheDocument();
    });

    it('eine unbelegte Ziffer setzt nichts', async () => {
      const { onWaehlen } = zeige();
      tippe(ausloeser('Florian 1'), '9');
      expect(onWaehlen).not.toHaveBeenCalled();
      expect(await screen.findByText(/Ziffer 9 ist keinem Status zugeordnet/)).toBeInTheDocument();
    });

    it('der aktuelle Status wird nicht erneut gesetzt', () => {
      const { onWaehlen } = zeige({ fahrzeuge: [fzg(10, 'Florian 1', { status_id: 3 })] });
      tippe(ausloeser('Florian 1'), '4');
      expect(onWaehlen).not.toHaveBeenCalled();
    });

    it('mit Strg, ⌘ oder Alt ist die Ziffer kein Statuswechsel', () => {
      const { onWaehlen } = zeige();
      const knopf = ausloeser('Florian 1');
      tippe(knopf, '4', { ctrlKey: true });
      tippe(knopf, '4', { metaKey: true });
      tippe(knopf, '4', { altKey: true });
      expect(onWaehlen).not.toHaveBeenCalled();
    });

    it('während eine Mutation läuft, nimmt die Kachel keine Ziffer an', () => {
      const b = bedienung({ gesperrt: true });
      zeige({ bedienungVon: b.von });
      // Der gesperrte Knopf ist `disabled` und nicht fokussierbar — der Riegel muss also
      // auch dann halten, wenn das Ereignis von anderswo aus der Kachel kommt.
      const kachel = ausloeser('Florian 1').closest<HTMLElement>('[data-lfh="fms-kachel"]')!;
      fireEvent.keyDown(kachel, { key: '4' });
      expect(b.onWaehlen).not.toHaveBeenCalled();
    });

    it('ausserhalb einer Kachel (Tastenhinweis, Paneelkopf) wirkt keine Ziffer', () => {
      const { onWaehlen } = zeige();
      fireEvent.keyDown(screen.getByRole('heading', { name: 'EA Nord' }), { key: '4' });
      expect(onWaehlen).not.toHaveBeenCalled();
    });

    it('eine Ziffer im geöffneten Statusmenü (Portal) setzt nichts', async () => {
      const { onWaehlen } = zeige();
      await userEvent.click(ausloeser('Florian 1'));
      const menue = document.querySelector<HTMLElement>('.ant-dropdown [role="menu"]')!;
      expect(menue).not.toBeNull();
      // Das Synthetic Event steigt aus dem Portal in den Komponentenbaum auf — der
      // DOM-Vorfahr ist aber keine Kachel.
      fireEvent.keyDown(menue, { key: '4' });
      expect(onWaehlen).not.toHaveBeenCalled();
    });
  });

  it('zeigt während der eigenen Mutation kein „Seit" — die neue Zeit kennt erst der Server', () => {
    const b = bedienung({ laeuft: true });
    zeige({ bedienungVon: b.von });
    const kachel = ausloeser('Florian 1').closest<HTMLElement>('[data-lfh="fms-kachel"]')!;
    expect(within(kachel).getByText('seit …')).toBeInTheDocument();
  });

  it('zeigt „seit —" ohne Zeitstempel', () => {
    zeige({ fahrzeuge: [fzg(10, 'Florian 1', { status_seit: null })] });
    expect(screen.getByText('seit —')).toBeInTheDocument();
  });

  it('läuft ohne Einheiten ungegliedert weiter und nennt den Grund', () => {
    zeige({
      einheiten: null,
      einheitenHinweis: 'Einheiten nicht abrufbar — Fahrzeuge ohne Gliederung',
    });
    expect(screen.getByRole('heading', { name: 'Alle Fahrzeuge' })).toBeInTheDocument();
    expect(screen.getByText(/Einheiten nicht abrufbar/)).toBeInTheDocument();
    // Ohne Liste ist die Einheit UNBEKANNT, nicht „keine" — die Zeile fehlt deshalb.
    expect(screen.queryByText('ohne Einheit')).toBeNull();
    expect(ausloeser('Florian 1')).toBeInTheDocument();
  });

  it('sagt es, wenn nichts disponiert ist', () => {
    zeige({ fahrzeuge: [] });
    expect(screen.getByText('Noch keine Fahrzeuge disponiert')).toBeInTheDocument();
  });

  describe('Zufluss (Kriterium 12)', () => {
    it('hält ein neues Fahrzeug hinter dem Sammelbanner, solange der Fokus im Tableau steht', async () => {
      const { rerender, props } = zeige();
      act(() => ausloeser('Florian 1').focus());
      rerender(<FmsTableau {...props} fahrzeuge={[...props.fahrzeuge, fzg(11, 'Florian 0')]} />);

      expect(screen.queryByText('Florian 0')).toBeNull();
      const banner = screen.getByRole('status');
      expect(banner).toHaveTextContent('1 neues Fahrzeug');
      await userEvent.click(within(banner).getByRole('button', { name: 'anzeigen' }));
      expect(screen.getByText('Florian 0')).toBeInTheDocument();
    });

    it('ohne Fokus im Tableau steht ein neues Fahrzeug sofort da', () => {
      const { rerender, props } = zeige();
      rerender(<FmsTableau {...props} fahrzeuge={[...props.fahrzeuge, fzg(11, 'Florian 0')]} />);
      expect(screen.getByText('Florian 0')).toBeInTheDocument();
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('ein Wechsel ins Statusmenü (Portal) taut die Schleuse NICHT auf', () => {
      const { rerender, props } = zeige();
      const knopf = ausloeser('Florian 1');
      act(() => knopf.focus());
      // jsdom schiebt den Fokus beim Öffnen nicht ins Portal (gemessen, LFH-339) — ein
      // Test, der bloss das Menü öffnet, belegte nichts. Deshalb der Handler direkt.
      const portal = document.createElement('div');
      portal.className = 'ant-dropdown';
      portal.dataset.testPortal = '';
      document.body.appendChild(portal);
      fireEvent.focusOut(knopf, { relatedTarget: portal });

      rerender(<FmsTableau {...props} fahrzeuge={[...props.fahrzeuge, fzg(11, 'Florian 0')]} />);
      expect(screen.queryByText('Florian 0')).toBeNull();
    });

    it('verlässt der Fokus das Tableau, taut die Schleuse auf', () => {
      const { rerender, props } = zeige();
      const knopf = ausloeser('Florian 1');
      act(() => knopf.focus());
      fireEvent.focusOut(knopf, { relatedTarget: document.body });
      rerender(<FmsTableau {...props} fahrzeuge={[...props.fahrzeuge, fzg(11, 'Florian 0')]} />);
      expect(screen.getByText('Florian 0')).toBeInTheDocument();
    });
  });
});
