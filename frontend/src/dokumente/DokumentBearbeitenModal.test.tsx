import { http, HttpResponse } from 'msw';
import { fireEvent, isInaccessible, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { ApiError } from '../api/client';
import type { Dokument } from '../api/types';
import DokumentBearbeitenModal from './DokumentBearbeitenModal';

vi.mock('../api/dokumente', async (importOriginal) => {
  const echt = await importOriginal<typeof import('../api/dokumente')>();
  return { ...echt, aendereDokument: vi.fn() };
});
import { aendereDokument } from '../api/dokumente';

const aendere = vi.mocked(aendereDokument);

beforeEach(() => {
  aendere.mockReset();
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
    http.get('/api/einsaetze/1/etb', () =>
      HttpResponse.json([{ id: 9, einsatz_id: 1, lfd_nr: 12, inhalt: 'Lage erkundet' }]),
    ),
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

  it('Struktur statt Tastendruck: Absende-Knopf im <form>, keine Modal-Fußzeile', async () => {
    rendere();
    const d = await dialog();
    const knopf = within(d).getByRole('button', { name: 'Speichern' });
    expect(document.querySelector('.ant-modal-footer')).toBeNull();
    expect(knopf.closest('form')).not.toBeNull();
    expect(knopf).toHaveAttribute('type', 'submit');
  });
});
