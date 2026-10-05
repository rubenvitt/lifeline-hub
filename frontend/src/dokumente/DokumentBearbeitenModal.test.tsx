import { http, HttpResponse } from 'msw';
import { act, fireEvent, isInaccessible, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import type { Dokument } from '../api/types';
import DokumentBearbeitenModal from './DokumentBearbeitenModal';

vi.mock('../api/dokumente', async (importOriginal) => {
  const echt = await importOriginal<typeof import('../api/dokumente')>();
  return { ...echt, aendereDokument: vi.fn() };
});
import { aendereDokument } from '../api/dokumente';

const aendere = vi.mocked(aendereDokument);

interface EtbStub {
  id: number;
  einsatz_id: number;
  lfd_nr: number;
  inhalt: string;
}
const eintrag = (id: number, lfd_nr: number, inhalt: string): EtbStub => ({
  id,
  einsatz_id: 1,
  lfd_nr,
  inhalt,
});
/** Das jüngste Fenster, das der Dialog ohne Suchbegriff bekommt. */
let etbFenster: EtbStub[] = [];
/** Der ganze Bestand — auch was außerhalb des Fensters liegt; Suche und Nummer greifen hierauf. */
let etbBestand: EtbStub[] = [];
/** Query-Strings aller ETB-Abrufe, in Reihenfolge. */
let etbAnfragen: URLSearchParams[] = [];

beforeEach(() => {
  aendere.mockReset();
  etbAnfragen = [];
  etbFenster = [eintrag(9, 12, 'Lage erkundet')];
  etbBestand = [...etbFenster, eintrag(5, 3, 'Deichbruch gemeldet'), eintrag(7, 412, 'Pumpe 2')];
  server.use(
    http.get('/api/einsaetze/1/abschnitte', () =>
      HttpResponse.json([
        { id: 3, einsatz_id: 1, name: 'EA Nord' },
        { id: 5, einsatz_id: 1, name: 'EA Süd' },
      ]),
    ),
    http.get('/api/einsaetze/1/einheiten', () =>
      HttpResponse.json([{ id: 4, einsatz_id: 1, name: 'Florian 1' }]),
    ),
    // Ahmt den Server nach wie `DokumentAblegenModal.test.tsx`: `q` sucht ganze Wörter,
    // `before_lfd_nr` + `limit` schneidet am Cursor.
    http.get('/api/einsaetze/1/etb', ({ request }) => {
      const qs = new URL(request.url).searchParams;
      etbAnfragen.push(qs);
      const q = qs.get('q');
      const vor = qs.get('before_lfd_nr');
      let treffer = q || vor ? [...etbBestand] : [...etbFenster];
      if (q) {
        const woerter = q.toLowerCase().split(/\s+/).filter(Boolean);
        treffer = treffer.filter((e) =>
          woerter.every((w) =>
            e.inhalt
              .toLowerCase()
              .split(/[^\p{L}\p{N}]+/u)
              .includes(w),
          ),
        );
      }
      if (vor) treffer = treffer.filter((e) => e.lfd_nr < Number(vor));
      treffer.sort((a, b) => b.lfd_nr - a.lfd_nr);
      return HttpResponse.json(treffer.slice(0, Number(qs.get('limit') ?? 50)));
    }),
  );
});
afterEach(() => vi.clearAllMocks());

const lageplan: Dokument = {
  id: 7,
  einsatz_id: 1,
  kategorie: 'lagekarte_plan',
  titel: 'Lageplan',
  dateiname: 'lageplan.pdf',
  mime: 'application/pdf',
  groesse: 10,
  bezug_abschnitt_id: 3,
  bezug_abschnitt_name: 'EA Nord',
  etb_eintrag_id: 2,
  abgelegt_von_id: 1,
  abgelegt_at: '2026-10-01T10:00:00Z',
};

/** Hält das Dokument wie die Seite: ein Knopf öffnet, `onSchliessen` schließt. */
function Rahmen({ dokument }: { dokument: Dokument }) {
  const [aktuell, setAktuell] = useState<Dokument | null>(dokument);
  return (
    <>
      <button onClick={() => setAktuell(dokument)}>Öffnen</button>
      <DokumentBearbeitenModal
        einsatzId={1}
        dokument={aktuell}
        onSchliessen={() => setAktuell(null)}
      />
    </>
  );
}

function rendere(dokument: Dokument = lageplan) {
  return renderMitProviders(<Rahmen dokument={dokument} />);
}

/** Der Dialog, NACHDEM sein Anfangsfokus sitzt (Muster `DokumentAblegenModal.test.tsx`). */
async function dialog() {
  const d = (await screen.findAllByRole('dialog'))[0];
  const erstes = within(d).getByRole('combobox', { name: 'Kategorie' });
  await waitFor(() => expect(document.activeElement).toBe(erstes));
  return d;
}

async function waehleOption(label: string) {
  const option = (await screen.findAllByText(label)).find((el) =>
    el.closest('.ant-select-item-option'),
  );
  expect(option).toBeTruthy();
  await userEvent.click(option!);
}

/** Der sichtbare Wert eines antd-`Select`. antd 6 rendert die Auswahl als `.ant-select-content`
 *  (Muster `EtbBausteinFormModal.test.tsx`); gegriffen wird über das Feld. */
function selectWert(d: HTMLElement, name: string) {
  const feld = within(d).getByRole('combobox', { name }).closest('.ant-select')!;
  return feld.querySelector('.ant-select-content')?.textContent ?? null;
}

/** Labels der Optionen in der offenen Liste, in Anzeige-Reihenfolge. */
function optionsLabels() {
  return [
    ...document.querySelectorAll<HTMLElement>(
      '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option',
    ),
  ].map((o) => o.textContent);
}

async function oeffneBezugsliste(d: HTMLElement) {
  await userEvent.click(within(d).getByRole('combobox', { name: 'Bezug' }));
  await waitFor(() => expect(optionsLabels()).toContain('ETB 12 · Lage erkundet'));
}

/** Ein Takt für React: der Query-Cache meldet seine Beobachter gebündelt per `setTimeout`. */
const neuGezeichnet = () => act(() => new Promise((r) => setTimeout(r, 20)));

async function warteBisDialogWeg() {
  await waitFor(() => {
    const modal = document.querySelector<HTMLElement>('.ant-modal');
    if (modal) {
      fireEvent.transitionEnd(modal);
      fireEvent.animationEnd(modal);
    }
    expect(screen.queryByRole('textbox', { name: 'Titel' })).not.toBeInTheDocument();
  });
}

describe('DokumentBearbeitenModal', () => {
  it('belegt Titel, Kategorie und Bezug mit dem Stand des Dokuments vor', async () => {
    rendere();
    const d = await dialog();
    expect(within(d).getByText('Dokument bearbeiten')).toBeInTheDocument();
    expect(within(d).getByRole('textbox', { name: 'Titel' })).toHaveValue('Lageplan');
    expect(selectWert(d, 'Kategorie')).toBe('Lagekarte/Plan');
    await waitFor(() => expect(selectWert(d, 'Bezug')).toBe('EA Nord'));
  });

  it('zeigt einen ETB-Bezug außerhalb der geladenen Einträge mit seiner Nummer', async () => {
    rendere({
      ...lageplan,
      bezug_abschnitt_id: undefined,
      bezug_abschnitt_name: undefined,
      bezug_etb_eintrag_id: 55,
      bezug_etb_lfd_nr: 3,
    });
    const d = await dialog();
    await waitFor(() => expect(selectWert(d, 'Bezug')).toBe('ETB 3'));
  });

  it('Feldbudget: drei sichtbare Felder, der Bezug steht offen', async () => {
    rendere();
    const d = await dialog();
    const sichtbar = [...d.querySelectorAll<HTMLElement>('.ant-form-item')].filter(
      (f) => !isInaccessible(f),
    );
    expect(sichtbar).toHaveLength(3);
    expect(d.querySelector('input[type="file"]')).toBeNull();
    expect(d.querySelector('.ant-collapse')).toBeNull();
  });

  it('sendet alle drei Angaben, ein gewechselter Bezug als Paar', async () => {
    aendere.mockResolvedValue(lageplan);
    rendere();
    const d = await dialog();
    const titel = within(d).getByRole('textbox', { name: 'Titel' });
    await userEvent.clear(titel);
    await userEvent.type(titel, 'Lageplan Süd');
    await userEvent.click(within(d).getByRole('combobox', { name: 'Kategorie' }));
    await waehleOption('Befehl');
    await userEvent.click(within(d).getByRole('combobox', { name: 'Bezug' }));
    await waehleOption('EA Süd');
    await userEvent.click(within(d).getByRole('button', { name: 'Speichern' }));

    await waitFor(() =>
      expect(aendere).toHaveBeenCalledWith(1, 7, {
        titel: 'Lageplan Süd',
        kategorie: 'befehl',
        bezug_typ: 'abschnitt',
        bezug_id: 5,
      }),
    );
    await warteBisDialogWeg();
  });

  it('ein geleerter Bezug geht als null/null', async () => {
    aendere.mockResolvedValue(lageplan);
    rendere();
    const d = await dialog();
    await waitFor(() => expect(selectWert(d, 'Bezug')).toBe('EA Nord'));
    const bezug = within(d).getByRole('combobox', { name: 'Bezug' }).closest('.ant-select')!;
    await userEvent.hover(bezug);
    await userEvent.click(bezug.querySelector('.ant-select-clear')!);
    await userEvent.click(within(d).getByRole('button', { name: 'Speichern' }));

    await waitFor(() =>
      expect(aendere).toHaveBeenCalledWith(1, 7, {
        titel: 'Lageplan',
        kategorie: 'lagekarte_plan',
        bezug_typ: null,
        bezug_id: null,
      }),
    );
  });

  it('lässt die Eingaben bei Ablehnung stehen und zeigt den Fehler IM Dialog', async () => {
    aendere.mockRejectedValue(new ApiError(400, 'Unbekanntes oder fremdes Bezugsziel'));
    rendere();
    const d = await dialog();
    const titel = within(d).getByRole('textbox', { name: 'Titel' });
    await userEvent.clear(titel);
    await userEvent.type(titel, 'Mein Plan');
    await userEvent.click(within(d).getByRole('button', { name: 'Speichern' }));

    const alarm = await within(d).findByRole('alert');
    expect(alarm).toHaveTextContent('Unbekanntes oder fremdes Bezugsziel');
    expect(alarm.closest('.ant-message')).toBeNull();
    expect(within(d).getByRole('textbox', { name: 'Titel' })).toHaveValue('Mein Plan');
  });

  it('belegt beim Wiederöffnen wieder den Stand vor, nicht die verworfene Eingabe', async () => {
    rendere();
    const d = await dialog();
    const titel = within(d).getByRole('textbox', { name: 'Titel' });
    await userEvent.clear(titel);
    await userEvent.type(titel, 'Verworfen');
    await userEvent.click(within(d).getByRole('button', { name: 'Abbrechen' }));
    await warteBisDialogWeg();

    await userEvent.click(screen.getByRole('button', { name: 'Öffnen' }));
    const neu = await dialog();
    expect(within(neu).getByRole('textbox', { name: 'Titel' })).toHaveValue('Lageplan');
  });

  describe('Bezugswahl wie beim Ablegen (LFH-886)', () => {
    it('findet einen ETB-Eintrag jenseits des jüngsten Fensters über seine Nummer', async () => {
      aendere.mockResolvedValue(lageplan);
      rendere();
      const d = await dialog();
      await oeffneBezugsliste(d);
      expect(optionsLabels()).not.toContain('ETB 412 · Pumpe 2');

      await userEvent.type(within(d).getByRole('combobox', { name: 'Bezug' }), 'ETB 412');
      await waitFor(() => expect(optionsLabels()).toEqual(['ETB 412 · Pumpe 2']));
      await waehleOption('ETB 412 · Pumpe 2');
      await userEvent.click(within(d).getByRole('button', { name: 'Speichern' }));

      await waitFor(() =>
        expect(aendere).toHaveBeenCalledWith(1, 7, {
          titel: 'Lageplan',
          kategorie: 'lagekarte_plan',
          bezug_typ: 'etb_eintrag',
          bezug_id: 7,
        }),
      );
    });

    it('findet die bloße Nummer ebenso', async () => {
      rendere();
      const d = await dialog();
      await oeffneBezugsliste(d);
      await userEvent.type(within(d).getByRole('combobox', { name: 'Bezug' }), '412');
      await waitFor(() => expect(optionsLabels()).toEqual(['ETB 412 · Pumpe 2']));
    });

    it('sucht einen Volltext-Begriff am Server und zeigt den gewählten Treffer danach weiter', async () => {
      rendere();
      const d = await dialog();
      await oeffneBezugsliste(d);
      const feld = within(d).getByRole('combobox', { name: 'Bezug' });
      await userEvent.type(feld, 'Deichbruch');
      await waitFor(() =>
        expect(etbAnfragen.some((qs) => qs.get('q') === 'Deichbruch')).toBe(true),
      );
      await waehleOption('ETB 3 · Deichbruch gemeldet');

      // Nach der Wahl gilt wieder das jüngste Fenster, in dem der Eintrag nicht steht.
      await waitFor(() => expect(feld).toHaveAttribute('aria-expanded', 'false'));
      await act(() => new Promise((r) => setTimeout(r, 400)));
      expect(selectWert(d, 'Bezug')).toBe('ETB 3 · Deichbruch gemeldet');
    });

    it('friert die offene Liste ein: ein neuer ETB-Eintrag springt nicht unter den Cursor', async () => {
      const { client } = rendere();
      const d = await dialog();
      await oeffneBezugsliste(d);
      const vorher = optionsLabels();

      etbFenster = [eintrag(10, 13, 'Neue Meldung'), ...etbFenster];
      await client.invalidateQueries({ queryKey: einsatzKeys.etb(1) });
      await waitFor(() =>
        expect(
          client
            .getQueriesData<EtbStub[]>({ queryKey: einsatzKeys.etb(1) })
            .some(([, daten]) => daten?.some((e) => e.lfd_nr === 13)),
        ).toBe(true),
      );
      await neuGezeichnet();
      expect(optionsLabels()).toEqual(vorher);
    });

    it('ein Suchbegriff blendet den ergänzten aktuellen Bezug aus, wenn er nicht passt', async () => {
      rendere({
        ...lageplan,
        bezug_abschnitt_id: undefined,
        bezug_abschnitt_name: undefined,
        bezug_etb_eintrag_id: 55,
        bezug_etb_lfd_nr: 3,
      });
      const d = await dialog();
      await oeffneBezugsliste(d);
      expect(optionsLabels()).toContain('ETB 3');
      await userEvent.type(within(d).getByRole('combobox', { name: 'Bezug' }), 'Nord');
      await waitFor(() => expect(optionsLabels()).toEqual(['EA Nord']));
    });
  });

  it('Struktur statt Tastendruck: Absende-Knopf im <form>, keine Modal-Fußzeile', async () => {
    rendere();
    const d = await dialog();
    const knopf = within(d).getByRole('button', { name: 'Speichern' });
    expect(document.querySelector('.ant-modal-footer')).toBeNull();
    expect(knopf.closest('form')).not.toBeNull();
    expect(knopf).toHaveAttribute('type', 'submit');
  });
});
