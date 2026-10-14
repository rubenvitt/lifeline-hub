import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { ApiError } from '../../api/client';
import type { Einheit, EinheitTyp, Einsatzabschnitt } from '../../api/types';
import EinheitKopf, { type EinheitPatchHandler, type HandStatusHandler } from './EinheitKopf';

/**
 * Kopf der Einheit-Ansicht (LLH-1036, design.md D1–D3): jede Angabe an ihrem Wert, eine Zeile
 * schickt genau ihr Feld. Der Weg bis zum Server (Body der Anfrage) steht in
 * `EinheitDetailPage.test.tsx`; hier zählt, was die Zeile dem Handler gibt.
 */

const S2 = {
  status_id: 102,
  label: '2 – Frei auf Wache',
  fms_anker: 2,
  kategorie: 'verfuegbar',
  sortier: 2,
  farbe: null,
};

function einheit(o: Partial<Einheit> = {}): Einheit {
  return {
    id: 10,
    einsatz_id: 1,
    name: '1. Zug',
    typ_id: 1,
    typ_label: 'Zug',
    abschnitt_id: null,
    abschnitt_name: null,
    ueber_einheit_id: null,
    fuehrer_id: null,
    fuehrer_name: null,
    funkrufname: null,
    bemerkung: null,
    sortier: 0,
    soll: { fuehrer: 1, unterfuehrer: 3, mannschaft: 18 },
    ist: { fuehrer: 1, unterfuehrer: 0, mannschaft: 2 },
    ist_kumuliert: { fuehrer: 1, unterfuehrer: 0, mannschaft: 2 },
    status: { quelle: 'ohne', status: null, seit: null, verteilung: [] },
    personal_mitglieder: [
      { ep_id: 1, name: 'Max Mustermann', staerke_position: 'fuehrer', ist_fuehrer: false },
      { ep_id: 2, name: 'Uwe Unter', staerke_position: 'unterfuehrer', ist_fuehrer: false },
    ],
    fahrzeug_mitglieder: [],
    material_mitglieder: [],
    sprechgruppen: [],
    tz_fachaufgabe: null,
    tz_organisation: null,
    ...o,
  } as unknown as Einheit;
}

const typen = {
  data: [
    { id: 1, label: 'Zug', soll: null, sortier: 40 },
    { id: 2, label: 'Gruppe', soll: null, sortier: 30 },
  ] as unknown as EinheitTyp[],
  isError: false,
  error: null,
};
const abschnitte = {
  data: [
    { id: 3, name: 'EA Nord' },
    { id: 4, name: 'EA Süd' },
  ] as unknown as Einsatzabschnitt[],
  isError: false,
  error: null,
};

function renderKopf(
  e: Einheit = einheit(),
  {
    einheiten = [e],
    canEdit = true,
    orgDefault = null,
    onPatch = vi.fn<EinheitPatchHandler>().mockResolvedValue(undefined),
    onSetHandStatus = vi.fn<HandStatusHandler>().mockResolvedValue(undefined),
  }: {
    einheiten?: Einheit[];
    canEdit?: boolean;
    orgDefault?: string | null;
    onPatch?: ReturnType<typeof vi.fn<EinheitPatchHandler>>;
    onSetHandStatus?: ReturnType<typeof vi.fn<HandStatusHandler>>;
  } = {},
) {
  server.use(
    http.get('/api/fahrzeug-status', () =>
      HttpResponse.json([
        {
          id: 102,
          label: '2 – Frei auf Wache',
          kategorie: 'verfuegbar',
          farbe: null,
          fms_anker: 2,
          sortier: 2,
        },
      ]),
    ),
  );
  const ansicht = renderMitProviders(
    <EinheitKopf
      einheit={e}
      einheiten={einheiten}
      typen={typen}
      abschnitte={abschnitte}
      canEdit={canEdit}
      orgDefault={orgDefault}
      onPatch={onPatch}
      onSetHandStatus={onSetHandStatus}
    />,
  );
  return { ansicht, onPatch, onSetHandStatus };
}

const kopf = () => screen.getByRole('region', { name: 'Kopfdaten' });
const labelsOf = (wurzel: HTMLElement) =>
  Array.from(wurzel.querySelectorAll('[data-lfh="datenfeld"] dt')).map((e) => e.textContent);

async function waehleOption(user: ReturnType<typeof userEvent.setup>, label: string) {
  const option = await waitFor(() => {
    const treffer = [
      ...document.querySelectorAll<HTMLElement>(
        '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option',
      ),
    ].find((el) => el.getAttribute('title') === label);
    expect(treffer, `Option „${label}“`).toBeTruthy();
    return treffer!;
  });
  await user.click(option);
}

const offeneOptionen = () =>
  [
    ...document.querySelectorAll<HTMLElement>(
      '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option',
    ),
  ].map((o) => o.getAttribute('title'));

describe('EinheitKopf · Angaben an der Zeile (D1, D2)', () => {
  it('die Etiketten stehen in der Folge aus D2', () => {
    renderKopf();
    expect(labelsOf(kopf())).toEqual([
      'Name',
      'Typ',
      'Funkrufname',
      'Abschnitt',
      'Über-Einheit',
      'Einheitsführer',
      'Soll-Stärke (F/UF/M)',
      'Ist (F/UF/M//Σ)',
      'Status',
      'Bemerkung',
    ]);
  });

  it('ohne Klick steht kein Eingabefeld im Kopf', () => {
    renderKopf(einheit({ funkrufname: 'Heros 3/1', bemerkung: 'Zufahrt Nord' }));
    expect(within(kopf()).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(kopf()).queryAllByRole('combobox')).toHaveLength(0);
    expect(within(kopf()).queryAllByRole('spinbutton')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Name bearbeiten' })).toHaveAccessibleDescription(
      '1. Zug',
    );
  });

  it('Name: genau `name`, getrimmt', async () => {
    const user = userEvent.setup();
    const { onPatch } = renderKopf();
    await user.click(screen.getByRole('button', { name: 'Name bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Name' });
    await user.clear(feld);
    await user.type(feld, '  2. Zug {Enter}');
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    expect(onPatch).toHaveBeenCalledWith('Name', { name: '2. Zug' });
  });

  it('Name ist Pflicht: leer gespeichert heißt keine Anfrage und ein Hinweis an der Zeile', async () => {
    const user = userEvent.setup();
    const { onPatch } = renderKopf();
    await user.click(screen.getByRole('button', { name: 'Name bearbeiten' }));
    await user.clear(screen.getByRole('textbox', { name: 'Name' }));
    await user.click(screen.getByRole('button', { name: 'Name speichern' }));
    expect(await screen.findByText(/Name ist eine Pflichtangabe/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Name bearbeiten' })).toHaveAccessibleDescription(
      '1. Zug',
    );
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('unverändert gespeichert: keine Anfrage', async () => {
    const user = userEvent.setup();
    const { onPatch } = renderKopf();
    await user.click(screen.getByRole('button', { name: 'Name bearbeiten' }));
    await user.click(screen.getByRole('button', { name: 'Name speichern' }));
    expect(await screen.findByRole('button', { name: 'Name bearbeiten' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Soll-Stärke bearbeiten' }));
    await user.click(screen.getByRole('button', { name: 'Soll-Stärke speichern' }));
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('Typ: genau `typ_id`', async () => {
    const user = userEvent.setup();
    const { onPatch } = renderKopf();
    await user.click(screen.getByRole('button', { name: 'Typ bearbeiten' }));
    await user.click(screen.getByRole('combobox', { name: 'Typ' }));
    await waehleOption(user, 'Gruppe');
    await user.click(screen.getByRole('button', { name: 'Typ speichern' }));
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith('Typ', { typ_id: 2 }));
    expect(onPatch).toHaveBeenCalledTimes(1);
  });

  it('Funkrufname: genau `funkrufname`; geleert geht `null`', async () => {
    const user = userEvent.setup();
    const { onPatch } = renderKopf(einheit({ funkrufname: 'Heros 3/1' }));
    await user.click(screen.getByRole('button', { name: 'Funkrufname bearbeiten' }));
    await user.clear(screen.getByRole('textbox', { name: 'Funkrufname' }));
    await user.click(screen.getByRole('button', { name: 'Funkrufname speichern' }));
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith('Funkrufname', { funkrufname: null }));
  });

  it('Abschnitt: genau `abschnitt_id`', async () => {
    const user = userEvent.setup();
    const { onPatch } = renderKopf();
    await user.click(screen.getByRole('button', { name: 'Abschnitt eintragen' }));
    await user.click(screen.getByRole('combobox', { name: 'Abschnitt' }));
    await waehleOption(user, 'EA Süd');
    await user.click(screen.getByRole('button', { name: 'Abschnitt speichern' }));
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith('Abschnitt', { abschnitt_id: 4 }));
  });

  it('Abschnitt geleert: `abschnitt_id: null`', async () => {
    const user = userEvent.setup();
    const { onPatch } = renderKopf(einheit({ abschnitt_id: 3, abschnitt_name: 'EA Nord' }));
    await user.click(screen.getByRole('button', { name: 'Abschnitt bearbeiten' }));
    const feld = screen.getByRole('combobox', { name: 'Abschnitt' }).closest('.ant-select')!;
    await user.click(feld.querySelector('.ant-select-clear')!);
    await user.click(screen.getByRole('button', { name: 'Abschnitt speichern' }));
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith('Abschnitt', { abschnitt_id: null }));
  });

  it('Über-Einheit: weder sie selbst noch ein Nachfahre steht zur Wahl, genau `ueber_einheit_id`', async () => {
    const user = userEvent.setup();
    const selbst = einheit();
    const einheiten = [
      selbst,
      einheit({ id: 11, name: 'Kind', ueber_einheit_id: 10 }),
      einheit({ id: 13, name: 'Enkel', ueber_einheit_id: 11 }),
      einheit({ id: 12, name: 'Nachbar' }),
    ];
    const { onPatch } = renderKopf(selbst, { einheiten });
    await user.click(screen.getByRole('button', { name: 'Über-Einheit eintragen' }));
    await user.click(screen.getByRole('combobox', { name: 'Über-Einheit' }));
    await waitFor(() => expect(offeneOptionen()).toEqual(['Nachbar']));
    await waehleOption(user, 'Nachbar');
    await user.click(screen.getByRole('button', { name: 'Über-Einheit speichern' }));
    await waitFor(() =>
      expect(onPatch).toHaveBeenCalledWith('Über-Einheit', { ueber_einheit_id: 12 }),
    );
  });

  it('Einheitsführer: eine Person der Einheit, genau `fuehrer_id`', async () => {
    const user = userEvent.setup();
    const { onPatch } = renderKopf();
    await user.click(screen.getByRole('button', { name: 'Einheitsführer eintragen' }));
    await user.click(screen.getByRole('combobox', { name: 'Einheitsführer' }));
    await waitFor(() => expect(offeneOptionen()).toEqual(['Max Mustermann', 'Uwe Unter']));
    await waehleOption(user, 'Uwe Unter');
    await user.click(screen.getByRole('button', { name: 'Einheitsführer speichern' }));
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith('Einheitsführer', { fuehrer_id: 2 }));
  });

  it('Soll-Stärke: genau die drei Felder in einer Anfrage', async () => {
    const user = userEvent.setup();
    const { onPatch } = renderKopf();
    await user.click(screen.getByRole('button', { name: 'Soll-Stärke bearbeiten' }));
    const gruppe = screen.getByRole('group', { name: 'Soll-Stärke' });
    const mannschaft = within(gruppe).getByRole('spinbutton', { name: 'Mannschaft' });
    expect(within(gruppe).getByRole('spinbutton', { name: 'Führer' })).toHaveFocus();
    await user.clear(mannschaft);
    await user.type(mannschaft, '12');
    await user.click(screen.getByRole('button', { name: 'Soll-Stärke speichern' }));
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    expect(onPatch).toHaveBeenCalledWith('Soll-Stärke', {
      soll_fuehrer: 1,
      soll_unterfuehrer: 3,
      soll_mannschaft: 12,
    });
  });

  it('Bemerkung: mehrzeilig, genau `bemerkung`', async () => {
    const user = userEvent.setup();
    const { onPatch } = renderKopf();
    await user.click(screen.getByRole('button', { name: 'Bemerkung eintragen' }));
    await user.type(screen.getByRole('textbox', { name: 'Bemerkung' }), 'Zufahrt{Enter}Nord');
    // Enter bricht um; erst „Speichern“ sendet.
    expect(onPatch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Bemerkung speichern' }));
    await waitFor(() =>
      expect(onPatch).toHaveBeenCalledWith('Bemerkung', { bemerkung: 'Zufahrt\nNord' }),
    );
  });

  it('Ablehnung: die Eingabe bleibt mit dem Entwurf offen, der Grund steht an der Zeile', async () => {
    const user = userEvent.setup();
    const onPatch = vi
      .fn<EinheitPatchHandler>()
      .mockRejectedValue(new ApiError(422, 'Name bereits vergeben'));
    renderKopf(einheit(), { onPatch });
    await user.click(screen.getByRole('button', { name: 'Name bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Name' });
    await user.clear(feld);
    await user.type(feld, '2. Zug{Enter}');
    expect(await within(kopf()).findByText('Name bereits vergeben')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('2. Zug');
  });

  it('ohne Recht: kein Stift, keine Aufforderung, leere Angaben als „—“', () => {
    renderKopf(einheit(), { canEdit: false });
    expect(within(kopf()).queryAllByRole('button', { name: /bearbeiten$/ })).toHaveLength(0);
    expect(within(kopf()).queryByText(/eintragen$/)).toBeNull();
    expect(within(kopf()).getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('EinheitKopf · Lesezeilen (D3)', () => {
  const zeileVon = (label: string) =>
    [...kopf().querySelectorAll<HTMLElement>('[data-lfh="datenfeld"]')].find(
      (f) => f.querySelector('dt')?.textContent === label,
    )!;

  it('Ist unter Soll: Urteil „unterbesetzt“ als Wort', () => {
    renderKopf();
    expect(zeileVon('Ist (F/UF/M//Σ)')).toHaveTextContent('unterbesetzt');
  });

  it('Ist erfüllt das Soll: Urteil „Soll erfüllt“', () => {
    const voll = { fuehrer: 1, unterfuehrer: 3, mannschaft: 18 };
    renderKopf(einheit({ ist: voll, ist_kumuliert: voll }));
    expect(zeileVon('Ist (F/UF/M//Σ)')).toHaveTextContent('Soll erfüllt');
    expect(zeileVon('Ist (F/UF/M//Σ)')).not.toHaveTextContent('unterbesetzt');
  });

  it('ohne Soll kein Urteil', () => {
    renderKopf(einheit({ soll: null }));
    expect(zeileVon('Ist (F/UF/M//Σ)')).not.toHaveTextContent(/unterbesetzt|erfüllt|kein Soll/);
  });

  it('kumuliert nur mit Untereinheiten', () => {
    const e = einheit({ ist_kumuliert: { fuehrer: 2, unterfuehrer: 1, mannschaft: 9 } });
    const { ansicht } = renderKopf(e);
    expect(zeileVon('Ist (F/UF/M//Σ)')).not.toHaveTextContent('kumuliert');
    ansicht.unmount();
    renderKopf(e, { einheiten: [e, einheit({ id: 11, name: 'Kind', ueber_einheit_id: 10 })] });
    expect(zeileVon('Ist (F/UF/M//Σ)')).toHaveTextContent('kumuliert 2/1/9//12');
  });

  it('das große Zeichen trägt die Vorgabe der Organisation', () => {
    renderKopf(einheit(), { orgDefault: 'thw' });
    const desc = kopf().querySelector('[data-lfh="einheit-zeichen"] svg desc');
    expect(desc).toHaveTextContent('Organisation: Technisches Hilfswerk');
  });

  it('mit Fahrzeug: Status als Wort mit „seit“, keine Statuswahl', () => {
    renderKopf(
      einheit({
        status: {
          quelle: 'fahrzeuge',
          status: S2,
          seit: '2026-09-30T04:40:00Z',
          verteilung: [],
        } as unknown as Einheit['status'],
        fahrzeug_mitglieder: [
          { ef_id: 30, funkrufname: 'FW 1/44-1', fahrzeugtyp: 'HLF 20' },
        ] as unknown as Einheit['fahrzeug_mitglieder'],
      }),
    );
    expect(zeileVon('Status')).toHaveTextContent('Frei auf Wache');
    expect(zeileVon('Status')).toHaveTextContent(/seit /);
    expect(screen.queryByRole('button', { name: 'Status von 1. Zug ändern' })).toBeNull();
  });

  it('ohne Fahrzeug: Handstatus über die Statuswahl, „kein Status“ schickt `null`', async () => {
    const user = userEvent.setup();
    const { onSetHandStatus } = renderKopf(
      einheit({
        status: {
          quelle: 'hand',
          status: S2,
          seit: '2026-09-30T04:40:00Z',
          verteilung: [],
        } as unknown as Einheit['status'],
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Status von 1. Zug ändern' }));
    const menue = await waitFor(() => {
      const m = document.querySelector<HTMLElement>(
        '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
      );
      expect(m).not.toBeNull();
      return m!;
    });
    await waitFor(() => expect(within(menue).getByText(/Frei auf Wache/)).toBeInTheDocument());
    await user.click(within(menue).getByText('kein Status'));
    await waitFor(() => expect(onSetHandStatus).toHaveBeenCalledWith(null));
  });

  it('ohne Fahrzeug: ein gewählter Status geht mit seiner ID', async () => {
    const user = userEvent.setup();
    const { onSetHandStatus } = renderKopf();
    await user.click(screen.getByRole('button', { name: 'Status von 1. Zug ändern' }));
    const eintrag = await screen.findByText(/S2 · Frei auf Wache/);
    await user.click(eintrag);
    await waitFor(() => expect(onSetHandStatus).toHaveBeenCalledWith(102));
  });

  it('Handstatus abgelehnt: der Grund steht an der Statuszeile', async () => {
    const user = userEvent.setup();
    const onSetHandStatus = vi
      .fn<HandStatusHandler>()
      .mockRejectedValue(new ApiError(422, 'Einheit führt inzwischen ein Fahrzeug'));
    renderKopf(einheit(), { onSetHandStatus });
    await user.click(screen.getByRole('button', { name: 'Status von 1. Zug ändern' }));
    await user.click(await screen.findByText(/S2 · Frei auf Wache/));
    expect(
      await within(zeileVon('Status')).findByText('Einheit führt inzwischen ein Fahrzeug'),
    ).toBeInTheDocument();
  });

  it('ohne Recht: Status als Wort, keine Statuswahl', () => {
    renderKopf(einheit(), { canEdit: false });
    expect(screen.queryByRole('button', { name: 'Status von 1. Zug ändern' })).toBeNull();
    expect(zeileVon('Status')).toHaveTextContent(/kein Status|ohne Status|—/);
  });
});
