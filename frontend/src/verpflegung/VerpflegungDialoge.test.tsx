import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { ApiError } from '../api/client';
import type { ModulFreigaben } from '../api/types';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import { alsOrtszeit } from '../anzeige/zeitEingabe';
import { freigabenFixture } from '../test/fixtures';
import { mitProzessZone } from '../test/prozessZone';
import { renderMitProviders } from '../test/utils';
import { optionenVon, oeffne, waehle } from '../test/auswahlListe';
import {
  ABSCHNITT_DEICH,
  FELDKUECHE,
  GRUPPE_2,
  KEINE_SONDERKOST,
  TURNHALLE,
  ZUG,
  ausgabe,
  empfaenger,
  empfaengerEinheit,
  stelle,
  verpflegungMitStellen,
  zeitfenster,
} from '../test/verpflegungDaten';
import type { Bedarfsvorschlag, BedarfsvorschlagArgs } from './useBedarfsvorschlag';
import { tippeZeit } from '../test/zeitEingabe';

dayjs.extend(utc);

// Der Hook ist eigens getestet (`useBedarfsvorschlag.test.tsx`). Hier zählt, WAS der Dialog
// hineingibt (Beginn als Wire, Freigaben unverändert) und was er mit der Antwort tut.
const vorschlag = vi.hoisted(() => ({
  aufrufe: [] as BedarfsvorschlagArgs[],
  liefere: (() => ({
    kraefte: { wert: null, hinweis: null },
    betreute: { wert: null, hinweis: null },
  })) as (a: BedarfsvorschlagArgs) => Bedarfsvorschlag,
}));
vi.mock('./useBedarfsvorschlag', () => ({
  useBedarfsvorschlag: (a: BedarfsvorschlagArgs) => {
    vorschlag.aufrufe.push(a);
    return vorschlag.liefere(a);
  },
}));

const {
  AusgabeDialog,
  LoeschenDialog,
  RuecknahmeDialog,
  ZeitfensterDialog,
  ausgabeBody,
  zeitfensterAnlegenBody,
  zeitfensterPatch,
} = await import('./VerpflegungDialoge');

const FREIGABEN: ModulFreigaben = freigabenFixture();

/** Die zuletzt an den Hook gegebenen Argumente (`Array.at` fehlt in `lib` ES2020). */
const letzterAufruf = () => vorschlag.aufrufe[vorschlag.aufrufe.length - 1];
const JETZT = dayjs('2026-09-24T08:00:00Z');

const LEER = { wert: null, hinweis: null };
const K_HINWEIS = 'Vorschlag: Personal im Einsatz, Stand 09:58';
const B_HINWEIS = 'Vorschlag: in Betreuung, Stand 09:58, nicht zum Beginn';

/** Zählt die BEDIENBAREN Felder. */
function sichtbareFelder(dialog: HTMLElement): number {
  const rollen = ['textbox', 'spinbutton', 'combobox', 'checkbox', 'radio', 'switch'] as const;
  const felder = new Set<Element>();
  for (const rolle of rollen) {
    for (const el of within(dialog).queryAllByRole(rolle)) {
      const item = el.closest('.ant-form-item');
      if (item) felder.add(item);
    }
  }
  return felder.size;
}

async function budgetUndAufklappen(dialog: HTMLElement, sichtbar: number, klappe: RegExp) {
  expect(sichtbareFelder(dialog)).toBe(sichtbar);
  await userEvent.click(within(dialog).getByRole('button', { name: klappe }));
  // Die zweite Hälfte: ohne sie wäre das Budget auch mit einem Collapse ohne forceRender grün.
  await waitFor(() => expect(sichtbareFelder(dialog)).toBeGreaterThan(sichtbar));
}

/** Struktur, aus der „Enter sendet" folgt (Erfassungs-Norm B4). */
function pruefeFormStruktur(dialog: HTMLElement, knopfName: string) {
  const knopf = within(dialog).getByRole('button', { name: knopfName });
  expect(knopf.closest('form')).not.toBeNull();
  expect(dialog.querySelector('.ant-modal-footer')).toBeNull();
  return knopf;
}

const DTG_MONATE = [
  'jan',
  'feb',
  'mrz',
  'apr',
  'mai',
  'jun',
  'jul',
  'aug',
  'sep',
  'okt',
  'nov',
  'dez',
];

/** Ortszeit „YYYY-MM-DD HH:mm" (Wanduhr der Anzeigezone) → so zeigt sie das Feld („241200sep26"). */
const dtg = (ortszeit: string) => {
  const d = dayjs(ortszeit);
  return `${d.format('DDHHmm')}${DTG_MONATE[d.month()]}${d.format('YY')}`;
};

/**
 * Zeitraum über die Tastatur — beide Felder tippen und verlassen (Verlassen übernimmt; Enter
 * schickte das Formular schon ab, bevor die übrigen Felder gefüllt sind).
 */
async function waehleZeitraum(dialog: HTMLElement, von: string, bis: string) {
  const start = within(dialog).getByRole('textbox', { name: 'Beginn' });
  await userEvent.clear(start);
  await userEvent.type(start, von);
  await userEvent.tab();
  const ende = within(dialog).getByRole('textbox', { name: 'Ende' });
  await userEvent.clear(ende);
  await userEvent.type(ende, bis);
  await userEvent.tab();
  await waitFor(() => expect(start).toHaveValue(dtg(von)));
  expect(ende).toHaveValue(dtg(bis));
}

/** Ortszeit-Eingabe „YYYY-MM-DD HH:mm" → erwarteter Wire-String (UTC, ohne Zone). */
const wire = (ortszeit: string) => dayjs(ortszeit).utc().format('YYYY-MM-DD HH:mm:ss');

function zeigeAnlegen(onErfassen = vi.fn().mockResolvedValue(undefined), onSchliessen = vi.fn()) {
  renderMitProviders(
    <ZeitfensterDialog
      onErfassen={onErfassen}
      einsatzId={1}
      freigaben={FREIGABEN}
      jetzt={JETZT}
      laeuft={false}
      fehler={null}
      onSchliessen={onSchliessen}
    />,
  );
  return { onErfassen, onSchliessen };
}

beforeEach(() => {
  vorschlag.aufrufe = [];
  vorschlag.liefere = () => ({ kraefte: LEER, betreute: LEER });
});

describe('Wire-Werte (design.md D2/D4)', () => {
  it('Zeiten gehen als UTC ohne Zone hinaus — gegen den absoluten Zeitpunkt, beidseits DST', () => {
    for (const absolut of [
      '2026-03-29T00:30:00Z',
      '2026-03-29T01:30:00Z',
      '2026-09-24T10:00:00Z',
      '2026-10-25T01:30:00Z',
    ]) {
      const ortszeit = dayjs(absolut); // so liefert ihn die Zeiteingabe
      const body = zeitfensterAnlegenBody({
        bezeichnung: ' Mittag ',
        zeitraum: [ortszeit, ortszeit.add(90, 'minute')],
        bedarf_kraefte: 180,
        bedarf_betreute: 70,
      });
      expect(body.von_at, absolut).toBe(dayjs.utc(absolut).format('YYYY-MM-DD HH:mm:ss'));
      expect(alsOrtszeit(body.von_at)!.valueOf()).toBe(dayjs(absolut).valueOf());
      expect(body.bezeichnung).toBe('Mittag');
      expect(ausgabeBody({ menge: 5, zeitpunkt: ortszeit }).zeitpunkt_at).toBe(body.von_at);
    }
  });

  it('Anlegen: leere Kostformen und leere weitere fehlen im Body', () => {
    const z = dayjs('2026-09-24T10:00:00Z');
    expect(
      zeitfensterAnlegenBody({
        bezeichnung: 'Mittag',
        zeitraum: [z, z.add(90, 'minute')],
        bedarf_kraefte: 180,
        bedarf_betreute: 0,
        sonderkost: { vegan: 3, vegetarisch: 0, ohne_schwein: null },
      }),
    ).toStrictEqual({
      bezeichnung: 'Mittag',
      von_at: '2026-09-24 10:00:00',
      bis_at: '2026-09-24 11:30:00',
      bedarf_kraefte: 180,
      bedarf_betreute: 0,
      sonderkost: { vegan: 3 },
    });
  });

  it('Ausgabe: ohne Zeitpunkt, Ort und Bemerkung fehlen die Schlüssel — „jetzt" setzt der Server', () => {
    expect(ausgabeBody({ menge: 120, ort: '  ', bemerkung: '', nachforderung_id: null })).toEqual({
      menge: 120,
    });
    expect(
      ausgabeBody({
        menge: 60,
        ort: ' Deich ',
        sonderkost: { vegan: 2 },
        nachforderung_id: 4,
        bemerkung: 'Nachlieferung',
      }),
    ).toStrictEqual({
      menge: 60,
      ort: 'Deich',
      sonderkost: { vegan: 2 },
      nachforderung_id: 4,
      bemerkung: 'Nachlieferung',
    });
  });

  it('PATCH: unverändert → leer; geleerte Kostform und weitere → 0, nie null', () => {
    const vorher = zeitfenster({
      bedarf: {
        kraefte: 180,
        betreute: 70,
        weitere: 5,
        gesamt: 255,
        sonderkost: { ...KEINE_SONDERKOST, vegan: 3 },
      },
    });
    const zeitraum: [dayjs.Dayjs, dayjs.Dayjs] = [
      alsOrtszeit(vorher.von_at)!,
      alsOrtszeit(vorher.bis_at)!,
    ];
    const unveraendert = {
      bezeichnung: 'Mittag',
      zeitraum,
      bedarf_kraefte: 180,
      bedarf_betreute: 70,
      bedarf_weitere: 5,
      sonderkost: { ...KEINE_SONDERKOST, vegan: 3 },
    };
    expect(zeitfensterPatch(vorher, unveraendert)).toStrictEqual({});
    expect(
      zeitfensterPatch(vorher, {
        ...unveraendert,
        bedarf_betreute: 90,
        bedarf_weitere: null,
        sonderkost: { vegan: null, vegetarisch: 12 },
        zeitraum: [zeitraum[0], zeitraum[1].add(30, 'minute')],
      }),
    ).toStrictEqual({
      bis_at: '2026-09-24 12:00:00',
      bedarf_betreute: 90,
      bedarf_weitere: 0,
      sonderkost: { vegetarisch: 12, vegan: 0 },
    });
  });
});

describe('ZeitfensterDialog — anlegen', () => {
  it('vier Felder sichtbar, der Rest eingeklappt; Knopf im <form>; sendet den Body', async () => {
    const { onErfassen, onSchliessen } = zeigeAnlegen();
    const dialog = await screen.findByRole('dialog', { name: 'Zeitfenster anlegen' });
    await budgetUndAufklappen(dialog, 4, /Weitere Personen und Sonderkost/);
    const knopf = pruefeFormStruktur(dialog, 'Anlegen');
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Mittag');
    await waehleZeitraum(dialog, '2026-09-24 12:00', '2026-09-24 13:30');
    await userEvent.type(within(dialog).getByLabelText('Einsatzkräfte (EP)'), '180');
    await userEvent.type(within(dialog).getByLabelText('Betreute (EP)'), '70');
    await userEvent.type(within(dialog).getByLabelText('vegan'), '3');
    await userEvent.click(knopf);
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({
        bezeichnung: 'Mittag',
        von_at: wire('2026-09-24 12:00'),
        bis_at: wire('2026-09-24 13:30'),
        bedarf_kraefte: 180,
        bedarf_betreute: 70,
        sonderkost: { vegan: 3 },
      }),
    );
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
  });

  it('belegt beide Bedarfe mit den Vorschlägen vor und nennt die Herkunft', async () => {
    vorschlag.liefere = () => ({
      kraefte: { wert: 186, hinweis: K_HINWEIS },
      betreute: { wert: 70, hinweis: B_HINWEIS },
    });
    zeigeAnlegen();
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Einsatzkräfte (EP)')).toHaveValue('186'),
    );
    expect(within(dialog).getByLabelText('Betreute (EP)')).toHaveValue('70');
    expect(within(dialog).getByText(K_HINWEIS)).toBeInTheDocument();
    expect(within(dialog).getByText(B_HINWEIS)).toBeInTheDocument();
    // Das Kürzel erklärt sich einmal sichtbar am ersten Feld, nicht nur per Tooltip (LFH-948).
    expect(within(dialog).getAllByText('EP = Essensportionen')).toHaveLength(1);
    // Die Freigaben gehen unverändert hinein — `undefined` hieße „unbekannt, nichts anfragen".
    expect(letzterAufruf().freigaben).toBe(FREIGABEN);
    expect(letzterAufruf().vonAt).toBeUndefined();
  });

  it('ohne Vorschlag bleiben die Felder leer — nie 0 als Ersatz', async () => {
    vorschlag.liefere = () => ({
      kraefte: LEER,
      betreute: { wert: null, hinweis: 'keine Belegung gemeldet' },
    });
    zeigeAnlegen();
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('keine Belegung gemeldet')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Einsatzkräfte (EP)')).toHaveValue('');
    expect(within(dialog).getByLabelText('Betreute (EP)')).toHaveValue('');
  });

  describe('Betreuungsvorschlag folgt dem Beginn (D8, eigener Merker)', () => {
    beforeEach(() => {
      // Die Kopfzahl hängt am Beginn: vor 12:00 Ortszeit 40, danach 70.
      vorschlag.liefere = (a) => ({
        kraefte: LEER,
        betreute:
          a.vonAt == null
            ? { wert: 55, hinweis: 'Vorschlag: in Betreuung, Stand 09:58' }
            : a.vonAt < wire('2026-09-24 12:00')
              ? { wert: 40, hinweis: 'Vorschlag: in Betreuung zum Beginn' }
              : { wert: 70, hinweis: 'Vorschlag: in Betreuung zum Beginn' },
      });
    });

    it('unberührt zieht das Feld mit, und der Beginn geht als UTC-Wire in den Hook', async () => {
      zeigeAnlegen();
      const dialog = await screen.findByRole('dialog');
      const betreute = within(dialog).getByLabelText('Betreute (EP)');
      await waitFor(() => expect(betreute).toHaveValue('55'));
      await waehleZeitraum(dialog, '2026-09-24 11:00', '2026-09-24 11:45');
      await waitFor(() => expect(betreute).toHaveValue('40'));
      expect(letzterAufruf().vonAt).toBe(wire('2026-09-24 11:00'));
      await waehleZeitraum(dialog, '2026-09-24 12:00', '2026-09-24 13:30');
      await waitFor(() => expect(betreute).toHaveValue('70'));
      expect(letzterAufruf().vonAt).toBe(wire('2026-09-24 12:00'));
    });

    it('nach eigener Eingabe bleibt die Zahl der Person stehen', async () => {
      zeigeAnlegen();
      const dialog = await screen.findByRole('dialog');
      const betreute = within(dialog).getByLabelText('Betreute (EP)');
      await waitFor(() => expect(betreute).toHaveValue('55'));
      await userEvent.clear(betreute);
      await userEvent.type(betreute, '65');
      await waehleZeitraum(dialog, '2026-09-24 12:00', '2026-09-24 13:30');
      await waitFor(() => expect(letzterAufruf().vonAt).toBe(wire('2026-09-24 12:00')));
      expect(betreute).toHaveValue('65');
    });
  });

  it('ein spät eintreffender Kräftevorschlag überschreibt keine eigene Eingabe', async () => {
    let da = false;
    vorschlag.liefere = () => ({
      kraefte: da ? { wert: 186, hinweis: K_HINWEIS } : LEER,
      betreute: LEER,
    });
    const props = {
      onErfassen: vi.fn(),
      einsatzId: 1,
      freigaben: FREIGABEN,
      laeuft: false,
      fehler: null,
      onSchliessen: vi.fn(),
    };
    const { rerender } = renderMitProviders(<ZeitfensterDialog {...props} jetzt={JETZT} />);
    const dialog = await screen.findByRole('dialog');
    const kraefte = within(dialog).getByLabelText('Einsatzkräfte (EP)');
    await userEvent.type(kraefte, '150');
    da = true;
    // Die Uhr tickt: ein Render, in dem der Vorschlag eingetroffen ist.
    rerender(<ZeitfensterDialog {...props} jetzt={JETZT.add(30, 'second')} />);
    expect(await within(dialog).findByText(K_HINWEIS)).toBeInTheDocument();
    expect(kraefte).toHaveValue('150');
  });

  it('nur der Beginn: „Anlegen“ nennt das fehlende Ende und sendet nichts (Review LLH-1070)', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <ZeitfensterDialog
        einsatzId={1}
        freigaben={FREIGABEN}
        jetzt={JETZT}
        laeuft={false}
        fehler={null}
        onSchliessen={vi.fn()}
        onErfassen={onErfassen}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Mittag');
    const start = within(dialog).getByRole('textbox', { name: 'Beginn' });
    await userEvent.type(start, '2026-09-24 12:00');
    await userEvent.tab();
    await userEvent.type(within(dialog).getByLabelText('Einsatzkräfte (EP)'), '180');
    await userEvent.type(within(dialog).getByLabelText('Betreute (EP)'), '70');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    expect(await within(dialog).findByText('Bitte Beginn und Ende angeben')).toBeInTheDocument();
    expect(onErfassen).not.toHaveBeenCalled();
  });

  it('eine Ablehnung (422) lässt die Felder stehen und zeigt den Grund im Dialog', async () => {
    const fehler = new ApiError(422, 'Das Ende muss nach dem Beginn liegen');
    const onErfassen = vi.fn().mockRejectedValue(fehler);
    const onSchliessen = vi.fn();
    const props = {
      einsatzId: 1,
      freigaben: FREIGABEN,
      jetzt: JETZT,
      laeuft: false,
      onSchliessen,
      onErfassen,
    };
    const { rerender } = renderMitProviders(<ZeitfensterDialog {...props} fehler={null} />);
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Mittag');
    await waehleZeitraum(dialog, '2026-09-24 12:00', '2026-09-24 13:30');
    await userEvent.type(within(dialog).getByLabelText('Einsatzkräfte (EP)'), '180');
    await userEvent.type(within(dialog).getByLabelText('Betreute (EP)'), '70');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(onErfassen).toHaveBeenCalled());
    rerender(<ZeitfensterDialog {...props} fehler={fehler} />);
    expect(
      await within(dialog).findByText('Das Ende muss nach dem Beginn liegen'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Bezeichnung')).toHaveValue('Mittag');
    expect(onSchliessen).not.toHaveBeenCalled();
  });
});

describe('AusgabeDialog', () => {
  const NF = [
    { value: 4, label: 'Essensportionen ‚Mittag‘ 12:00–13:30' },
    { value: 5, label: 'Feldküche' },
  ];

  function zeige(
    nachforderungen: typeof NF | null,
    onErfassen = vi.fn().mockResolvedValue(undefined),
  ) {
    const onSchliessen = vi.fn();
    renderMitProviders(
      <AusgabeDialog
        zeitfenster={zeitfenster()}
        nachforderungen={nachforderungen}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={onSchliessen}
      />,
    );
    return { onErfassen, onSchliessen };
  }

  it('„Ausgabe nachtragen“ (LLH-1032 D8): ohne Stellen und Empfänger zwei Felder sichtbar, der Rest eingeklappt (Ort seit LLH-1055); Knopf im <form>; sendet Menge und Ort', async () => {
    const { onErfassen, onSchliessen } = zeige(NF);
    const dialog = await screen.findByRole('dialog', { name: 'Ausgabe nachtragen: Mittag' });
    await budgetUndAufklappen(dialog, 2, /Weitere Angaben/);
    const knopf = pruefeFormStruktur(dialog, 'Nachtragen');
    // Leer heißt jetzt — kein vorbelegter Client-Zeitpunkt.
    expect(within(dialog).getByPlaceholderText('jetzt')).toHaveValue('');
    await userEvent.type(within(dialog).getByLabelText('Menge (EP)'), '120');
    await userEvent.type(within(dialog).getByLabelText('Ort'), 'Verpflegungsstelle Deich');
    await userEvent.click(knopf);
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({ menge: 120, ort: 'Verpflegungsstelle Deich' }),
    );
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
  });

  it('mit bedienbarem Modul Nachforderungen steht die Auswahl eingeklappt da', async () => {
    zeige(NF);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Nachforderung')).toBeInTheDocument();
  });

  it('die Menge lässt nicht mehr zu als der Server (VERPFLEGUNG_EP_MAX): zu viel bleibt mit Grund stehen, nichts wird gesendet', async () => {
    const { onErfassen } = zeige(null);
    const dialog = await screen.findByRole('dialog');
    const feld = within(dialog).getByLabelText('Menge (EP)');
    await userEvent.type(feld, '150000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Nachtragen' }));
    expect(await within(dialog).findByText('Höchstens 100000 EP')).toBeInTheDocument();
    // Nicht still gekappt: die eingegebene Zahl steht weiter im Feld.
    expect(feld).toHaveValue('150000');
    expect(onErfassen).not.toHaveBeenCalled();
  });

  it('die Grenze selbst wird angenommen', async () => {
    const { onErfassen } = zeige(null);
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Menge (EP)'), '100000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Nachtragen' }));
    await waitFor(() => expect(onErfassen).toHaveBeenCalledWith({ menge: 100_000 }));
  });

  it('ohne bedienbares Modul Nachforderungen gibt es das Feld nicht', async () => {
    zeige(null);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    expect(within(dialog).queryByLabelText('Nachforderung')).toBeNull();
    expect(within(dialog).getByLabelText('vegan')).toBeInTheDocument();
  });

  it('Sonderkost über der Menge: der 422-Grund steht im Dialog, die Felder bleiben', async () => {
    const fehler = new ApiError(422, 'Die Sonderkost übersteigt die Menge der Ausgabe');
    const onErfassen = vi.fn().mockRejectedValue(fehler);
    const onSchliessen = vi.fn();
    const props = {
      zeitfenster: zeitfenster(),
      nachforderungen: null,
      laeuft: false,
      onErfassen,
      onSchliessen,
    };
    const { rerender } = renderMitProviders(<AusgabeDialog {...props} fehler={null} />);
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Menge (EP)'), '2');
    await userEvent.type(within(dialog).getByLabelText('vegan'), '3');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Nachtragen' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({ menge: 2, sonderkost: { vegan: 3 } }),
    );
    rerender(<AusgabeDialog {...props} fehler={fehler} />);
    expect(
      await within(dialog).findByText('Die Sonderkost übersteigt die Menge der Ausgabe'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Menge (EP)')).toHaveValue('2');
    expect(onSchliessen).not.toHaveBeenCalled();
  });
});

describe('Zeichengrenzen der Freitexte (LLH-1040, design.md D10)', () => {
  it('Bezeichnung des Zeitfensters: Zähler ab 80 %, über 200 kein Senden, nichts gekürzt', async () => {
    const { onErfassen } = zeigeAnlegen();
    const dialog = await screen.findByRole('dialog', { name: 'Zeitfenster anlegen' });
    const feld = within(dialog).getByLabelText('Bezeichnung');
    fireEvent.change(feld, { target: { value: 'm'.repeat(159) } });
    expect(within(dialog).queryByText(/\/ 200/)).toBeNull();
    fireEvent.change(feld, { target: { value: 'm'.repeat(160) } });
    expect(within(dialog).getByText('160 / 200')).toBeInTheDocument();
    fireEvent.change(feld, { target: { value: 'm'.repeat(201) } });
    expect(within(dialog).getByText('201 / 200 · zu lang')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    expect(
      await within(dialog).findByText('Bezeichnung darf höchstens 200 Zeichen lang sein'),
    ).toBeInTheDocument();
    expect(onErfassen).not.toHaveBeenCalled();
    expect(feld).toHaveValue('m'.repeat(201));
  });

  function zeigeAusgabe(onErfassen = vi.fn().mockResolvedValue(undefined)) {
    renderMitProviders(
      <AusgabeDialog
        zeitfenster={zeitfenster()}
        nachforderungen={null}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={vi.fn()}
      />,
    );
    return { onErfassen };
  }

  it('Ort der Ausgabe: über 500 kein Senden, der Text bleibt ungekürzt stehen', async () => {
    const { onErfassen } = zeigeAusgabe();
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Menge (EP)'), '5');
    const ort = within(dialog).getByLabelText('Ort');
    fireEvent.change(ort, { target: { value: 'o'.repeat(501) } });
    expect(within(dialog).getByText('501 / 500 · zu lang')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Nachtragen' }));
    expect(
      await within(dialog).findByText('Ort darf höchstens 500 Zeichen lang sein'),
    ).toBeInTheDocument();
    expect(onErfassen).not.toHaveBeenCalled();
    expect(ort).toHaveValue('o'.repeat(501));
    // Der Ort liegt eingeklappt (LLH-1055): der Klappteil geht mit dem Grund auf.
    expect(within(dialog).getByRole('button', { name: /Weitere Angaben/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    fireEvent.change(ort, { target: { value: 'o'.repeat(500) } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Nachtragen' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({ menge: 5, ort: 'o'.repeat(500) }),
    );
  });

  /**
   * Ort mit Ortssuche (LLH-1407): Enter sucht und trägt nicht nach, ein Treffer setzt den Text; die
   * Ausgabe speichert keine Koordinate. Mutationsprobe: `normalize` weg → `ort` ist ein Objekt.
   */
  it('Ort der Ausgabe: Enter sucht im Einsatz, der Treffer geht nur als Text hinaus', async () => {
    const suchen: string[] = [];
    server.use(
      http.get('/api/einsaetze/:eid/ort-suche', ({ params, request }) => {
        suchen.push(`${params.eid}:${new URL(request.url).searchParams.get('q')}`);
        return HttpResponse.json({
          zustand: 'ok',
          treffer: [
            { lat: 52.3, lon: 9.7, name: 'Turnhalle Nord, Musterstadt', kurz: 'Turnhalle Nord' },
          ],
        });
      }),
    );
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <AusgabeDialog
        einsatzId={7}
        zeitfenster={zeitfenster()}
        nachforderungen={null}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Menge (EP)'), '5');
    await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    await userEvent.type(within(dialog).getByLabelText('Ort'), 'Turnhalle{Enter}');
    await userEvent.click(await within(dialog).findByRole('button', { name: /Turnhalle Nord/ }));
    expect(suchen).toEqual(['7:Turnhalle']);
    expect(onErfassen).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText('Ort')).toHaveValue('Turnhalle Nord');
    // Ohne Karte: die Ausgabe hat keinen Punkt.
    expect(within(dialog).queryByRole('button', { name: 'Auf Karte wählen' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Nachtragen' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({ menge: 5, ort: 'Turnhalle Nord' }),
    );
  });

  it('Bemerkung über 2 000: kein Senden, der zugeklappte Teil geht mit dem Grund auf', async () => {
    const { onErfassen } = zeigeAusgabe();
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Menge (EP)'), '5');
    const klappe = within(dialog).getByRole('button', { name: /Weitere Angaben/ });
    await userEvent.click(klappe);
    const bemerkung = within(dialog).getByLabelText('Bemerkung');
    fireEvent.change(bemerkung, { target: { value: 'b'.repeat(2_001) } });
    expect(within(dialog).getByText('2.001 / 2.000 · zu lang')).toBeInTheDocument();
    await userEvent.click(klappe);
    await waitFor(() => expect(klappe).toHaveAttribute('aria-expanded', 'false'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Nachtragen' }));
    await waitFor(() => expect(klappe).toHaveAttribute('aria-expanded', 'true'));
    expect(
      await within(dialog).findByText('Bemerkung darf höchstens 2.000 Zeichen lang sein'),
    ).toBeInTheDocument();
    expect(onErfassen).not.toHaveBeenCalled();
    expect(bemerkung).toHaveValue('b'.repeat(2_001));
  });

  it('zugeklappt nennt der Kopf jede Abweichung von der Vorgabe (LFH-974)', async () => {
    renderMitProviders(
      <AusgabeDialog
        zeitfenster={zeitfenster()}
        nachforderungen={[{ value: 4, label: 'Essensportionen ‚Mittag‘' }]}
        laeuft={false}
        fehler={null}
        onErfassen={vi.fn()}
        onSchliessen={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    const klappe = within(dialog).getByRole('button', { name: /Weitere Angaben/ });
    expect(klappe).toHaveTextContent(/^Weitere Angaben$/);
    fireEvent.change(within(dialog).getByLabelText('vegan'), { target: { value: '3' } });
    fireEvent.change(within(dialog).getByLabelText('Bemerkung'), {
      target: { value: 'b'.repeat(2_001) },
    });
    await waitFor(() =>
      expect(klappe).toHaveTextContent(/^Weitere Angaben · 3 vegan · Bemerkung$/),
    );
    fireEvent.change(within(dialog).getByLabelText('Bemerkung'), { target: { value: '  ' } });
    await waitFor(() => expect(klappe).toHaveTextContent(/^Weitere Angaben · 3 vegan$/));
  });
});

interface RueckfrageTestProps {
  laeuft: boolean;
  fehler: unknown;
  onBestaetigen: () => void;
  onSchliessen: () => void;
}

describe('Rückfragen', () => {
  it('Rücknahme: Modal mit rotem Knopf, nennt die Ausgabe; Abbrechen sendet nichts', async () => {
    const onBestaetigen = vi.fn();
    const onSchliessen = vi.fn();
    renderMitProviders(
      <RuecknahmeDialog
        ausgabe={ausgabe({ id: 11, sonderkost: { ...KEINE_SONDERKOST, vegan: 2 } })}
        zeitfenster={zeitfenster()}
        laeuft={false}
        fehler={null}
        onBestaetigen={onBestaetigen}
        onSchliessen={onSchliessen}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Ausgabe zurücknehmen?' });
    const uhr = dayjs.utc('2026-09-24 09:40:00').local().format('HHmm');
    expect(
      within(dialog).getByText(
        `120 EP um ${uhr} (Verpflegungsstelle Deich) zu ‚Mittag‘, davon 2 vegan.`,
      ),
    ).toBeInTheDocument();
    const ok = within(dialog).getByRole('button', { name: 'Zurücknehmen' });
    expect(ok).toHaveClass('ant-btn-dangerous');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(onSchliessen).toHaveBeenCalled();
    expect(onBestaetigen).not.toHaveBeenCalled();
    await userEvent.click(ok);
    expect(onBestaetigen).toHaveBeenCalledTimes(1);
  });

  it('Löschen: Modal mit rotem Knopf; der Server-Grund steht im Dialog', async () => {
    const onBestaetigen = vi.fn();
    renderMitProviders(
      <LoeschenDialog
        zeitfenster={zeitfenster()}
        laeuft={false}
        fehler={new ApiError(422, 'Das Zeitfenster hat gültige Ausgaben')}
        onBestaetigen={onBestaetigen}
        onSchliessen={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Zeitfenster ‚Mittag‘ löschen?' });
    expect(within(dialog).getByRole('button', { name: 'Löschen' })).toHaveClass(
      'ant-btn-dangerous',
    );
    expect(within(dialog).getByText('Das Zeitfenster hat gültige Ausgaben')).toBeInTheDocument();
  });

  /**
   * Echte Mutation mit hängender Antwort wie auf `VerpflegungPage`: der Dialog steht nur, solange
   * der Aufrufer ihn offen hält. Schlösse er während des Laufs, ginge ein 422 danach still verloren
   * (LFH-706, Fehlerbild LFH-535). Escape und Maske hält auch antd unter `confirmLoading` ab;
   * gesperrtes „Abbrechen“ und fehlendes Kreuz sind unser Teil.
   */
  it.each([
    {
      art: 'Rücknahme',
      name: 'Ausgabe zurücknehmen?',
      ok: 'Zurücknehmen',
      dialog: (p: RueckfrageTestProps) => (
        <RuecknahmeDialog ausgabe={ausgabe({ id: 11 })} zeitfenster={zeitfenster()} {...p} />
      ),
    },
    {
      art: 'Löschen',
      name: 'Zeitfenster ‚Mittag‘ löschen?',
      ok: 'Löschen',
      dialog: (p: RueckfrageTestProps) => <LoeschenDialog zeitfenster={zeitfenster()} {...p} />,
    },
  ])('$art: solange die Aktion läuft, lässt sich die Rückfrage nicht schließen', async (fall) => {
    let scheitere: (e: unknown) => void = () => {};
    function Aufrufer() {
      const [offen, setOffen] = useState(true);
      const mut = useMutation({
        mutationFn: () => new Promise((_, nein) => (scheitere = nein)),
      });
      return offen
        ? fall.dialog({
            laeuft: mut.isPending,
            fehler: mut.error,
            onBestaetigen: () => mut.mutate(),
            onSchliessen: () => setOffen(false),
          })
        : null;
    }
    renderMitProviders(<Aufrufer />);
    const dialog = await screen.findByRole('dialog', { name: fall.name });
    await userEvent.click(within(dialog).getByRole('button', { name: fall.ok }));
    const abbrechen = within(dialog).getByRole('button', { name: 'Abbrechen' });
    await waitFor(() => expect(abbrechen).toBeDisabled());
    // Kein Weg hinaus: Escape, Schließkreuz und Maske wirken nicht.
    await userEvent.keyboard('{Escape}');
    expect(within(dialog).queryByRole('button', { name: 'Close' })).toBeNull();
    const maske = document.querySelector('.ant-modal-wrap');
    if (maske) fireEvent.click(maske);
    scheitere(new ApiError(422, 'Ausgabe gehört zu einem gelöschten Zeitfenster'));
    expect(
      await within(dialog).findByText('Ausgabe gehört zu einem gelöschten Zeitfenster'),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: fall.name })).toBe(dialog);
    // Nach dem Fehlschlag ist der Weg hinaus wieder frei.
    expect(abbrechen).toBeEnabled();
  });
});

/**
 * LFH-692 (Spec `zeiteingabe`): Browser auf UTC, Organisation auf Europe/Berlin. Vorher zeigte
 * die Karte 12:00–13:30 und der Dialog 10:00–11:30; wer dort 12:00 „korrigierte“, speicherte
 * 14:00 Berliner Zeit. Unter der Suiten-Zone Berlin wäre jede dieser Aussagen blind grün.
 */
describe('Zeitzone: Dialog in der Anzeigezone, Browser in UTC (LFH-692)', () => {
  mitProzessZone('UTC');
  const BERLIN = { zeitzone: 'Europe/Berlin' };

  // Über das Anlegen (früher ein Rückweg um antds RangePicker, der in jsdom eine Korrektur an einem
  // SCHON belegten Zeitraum nicht übernahm). Die Anzeige beim Bearbeiten pinnt
  // `ZeitfensterBearbeiten.test.tsx` (LLH-1139).
  it('ein eingegebenes Fenster 13:00–14:30 Berliner Zeit geht als 11:00–12:30 UTC hinaus', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <AnzeigeKonventionenProvider konventionen={BERLIN}>
        <ZeitfensterDialog
          onErfassen={onErfassen}
          einsatzId={1}
          freigaben={FREIGABEN}
          jetzt={JETZT}
          laeuft={false}
          fehler={null}
          onSchliessen={vi.fn()}
        />
      </AnzeigeKonventionenProvider>,
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Mittag');
    await waehleZeitraum(dialog, '2026-09-24 13:00', '2026-09-24 14:30');
    await userEvent.type(within(dialog).getByLabelText('Einsatzkräfte (EP)'), '1');
    await userEvent.type(within(dialog).getByLabelText('Betreute (EP)'), '0');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(onErfassen).toHaveBeenCalled());
    expect(onErfassen.mock.calls[0][0]).toMatchObject({
      von_at: '2026-09-24 11:00:00',
      bis_at: '2026-09-24 12:30:00',
    });
    // Und die Kopfzahl-Anfrage bekam den Beginn als Zeitpunkt, nicht als Browser-Wanduhr (nach
    // dem Anlegen setzt der Dialog zurück, daher nicht der letzte Aufruf).
    expect(vorschlag.aufrufe.map((a) => a.vonAt)).toContain('2026-09-24 11:00:00');
  });

  it('Ausgabe: ein eingegebener Zeitpunkt 12:15 gilt in Berlin', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <AnzeigeKonventionenProvider konventionen={BERLIN}>
        <AusgabeDialog
          zeitfenster={zeitfenster()}
          nachforderungen={null}
          laeuft={false}
          fehler={null}
          onErfassen={onErfassen}
          onSchliessen={vi.fn()}
        />
      </AnzeigeKonventionenProvider>,
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Menge (EP)'), '120');
    // Taktisch getippt (LLH-1077); Enter übernimmt und sendet ab.
    await tippeZeit(userEvent.setup(), within(dialog).getByPlaceholderText('jetzt'), '241215sep26');
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({ menge: 120, zeitpunkt_at: '2026-09-24 10:15:00' }),
    );
  });

  it('LLH-1077: Ende „1430“ + Enter liegt am Tag des Beginns und legt das Fenster an', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <AnzeigeKonventionenProvider konventionen={BERLIN}>
        <ZeitfensterDialog
          onErfassen={onErfassen}
          einsatzId={1}
          freigaben={FREIGABEN}
          jetzt={JETZT}
          laeuft={false}
          fehler={null}
          onSchliessen={vi.fn()}
        />
      </AnzeigeKonventionenProvider>,
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Mittag');
    await userEvent.type(within(dialog).getByLabelText('Einsatzkräfte (EP)'), '1');
    await userEvent.type(within(dialog).getByLabelText('Betreute (EP)'), '0');
    const start = within(dialog).getByRole('textbox', { name: 'Beginn' });
    await userEvent.clear(start);
    await userEvent.type(start, '241300sep26');
    await userEvent.tab();
    await tippeZeit(
      userEvent.setup(),
      within(dialog).getByRole('textbox', { name: 'Ende' }),
      '1430',
    );
    await waitFor(() => expect(onErfassen).toHaveBeenCalled());
    expect(onErfassen.mock.calls[0][0]).toMatchObject({
      von_at: '2026-09-24 11:00:00',
      bis_at: '2026-09-24 12:30:00',
    });
  });
});

describe('Stellen und Verpflegungsart (LLH-1040, D13 Punkte 5–6)', () => {
  const STELLEN = [
    ...verpflegungMitStellen().stellen,
    stelle({ id: 30, bezeichnung: 'Ausgabe Schule', status: 'aufgeloest' }),
    stelle({ id: 31, bezeichnung: 'Ausgabe Halle Süd', status: 'aufgeloest' }),
  ];

  function zeigeZf(stellen = STELLEN) {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <ZeitfensterDialog
        onErfassen={onErfassen}
        einsatzId={1}
        freigaben={FREIGABEN}
        jetzt={JETZT}
        stellen={stellen}
        laeuft={false}
        fehler={null}
        onSchliessen={vi.fn()}
      />,
    );
    return { onErfassen };
  }

  describe('Zeitfensterdialog', () => {
    it('ohne Stellen im Einsatz nur „Art“, eingeklappt; die Art geht in den Body', async () => {
      const { onErfassen } = zeigeZf([]);
      const dialog = await screen.findByRole('dialog', { name: 'Zeitfenster anlegen' });
      expect(sichtbareFelder(dialog)).toBe(4);
      await userEvent.click(within(dialog).getByRole('button', { name: /^Art$/ }));
      expect(within(dialog).queryByRole('combobox', { name: 'Stellen' })).toBeNull();
      await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Mittag');
      await waehleZeitraum(dialog, '2026-09-24 12:00', '2026-09-24 13:30');
      await userEvent.type(within(dialog).getByLabelText('Einsatzkräfte (EP)'), '200');
      await userEvent.type(within(dialog).getByLabelText('Betreute (EP)'), '0');
      await waehle('Art', 'warm');
      expect(within(dialog).getByRole('button', { name: /^Art · warm$/ })).toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
      await waitFor(() =>
        expect(onErfassen).toHaveBeenCalledWith(
          expect.objectContaining({ bezeichnung: 'Mittag', verpflegungsart: 'warm' }),
        ),
      );
      expect(onErfassen.mock.calls[0][0]).not.toHaveProperty('stelle_ids');
    });

    it('mit Stellen: Mehrfachwahl der nicht aufgelösten, Kopf nennt die Wahl, Body trägt `stelle_ids`', async () => {
      const { onErfassen } = zeigeZf();
      const dialog = await screen.findByRole('dialog', { name: 'Zeitfenster anlegen' });
      await userEvent.click(within(dialog).getByRole('button', { name: /^Art und Stellen/ }));
      await oeffne('Stellen');
      expect(optionenVon('Stellen')).toEqual([
        'Ausgabe Turnhalle Nord',
        'Feldküche BR Sportplatz',
        'Zuführung Deich',
      ]);
      await waehle('Stellen', 'Feldküche BR Sportplatz', 'Ausgabe Turnhalle Nord');
      expect(
        within(dialog).getByRole('button', { name: /^Art und Stellen · 2 Stellen$/ }),
      ).toBeInTheDocument();
      await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Mittag');
      await waehleZeitraum(dialog, '2026-09-24 12:00', '2026-09-24 13:30');
      await userEvent.type(within(dialog).getByLabelText('Einsatzkräfte (EP)'), '200');
      await userEvent.type(within(dialog).getByLabelText('Betreute (EP)'), '0');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
      await waitFor(() => expect(onErfassen).toHaveBeenCalled());
      expect([...onErfassen.mock.calls[0][0].stelle_ids].sort()).toEqual([FELDKUECHE, TURNHALLE]);
      expect(onErfassen.mock.calls[0][0]).not.toHaveProperty('verpflegungsart');
    });

    it('Patch: gleiche Stellen in anderer Reihenfolge und gleiche Art schicken nichts', () => {
      const vorher = zeitfenster({ stelle_ids: [TURNHALLE, FELDKUECHE], verpflegungsart: 'warm' });
      const werte = {
        bezeichnung: 'Mittag',
        zeitraum: [dayjs.utc(vorher.von_at), dayjs.utc(vorher.bis_at)] as [
          dayjs.Dayjs,
          dayjs.Dayjs,
        ],
        bedarf_kraefte: 180,
        bedarf_betreute: 70,
        bedarf_weitere: 0,
        sonderkost: { vegan: 3 },
        verpflegungsart: 'warm' as const,
        stelle_ids: [FELDKUECHE, TURNHALLE],
      };
      expect(zeitfensterPatch(vorher, werte)).toEqual({});
      expect(zeitfensterPatch(vorher, { ...werte, stelle_ids: [] })).toEqual({ stelle_ids: [] });
      expect(zeitfensterPatch(vorher, { ...werte, verpflegungsart: undefined })).toEqual({
        verpflegungsart: null,
      });
    });
  });

  describe('Nachtrag', () => {
    function zeigeNachtrag(
      stellen = STELLEN,
      zf = verpflegungMitStellen().zeitfenster[0],
      liste = empfaenger(),
    ) {
      const onErfassen = vi.fn().mockResolvedValue(undefined);
      renderMitProviders(
        <AusgabeDialog
          zeitfenster={zf}
          nachforderungen={null}
          stellen={stellen}
          empfaenger={liste}
          laeuft={false}
          fehler={null}
          onErfassen={onErfassen}
          onSchliessen={vi.fn()}
        />,
      );
      return { onErfassen };
    }

    it('ohne Stellen im Einsatz: Feld „Ort“, keine Stellenwahl', async () => {
      zeigeNachtrag([]);
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByLabelText('Ort')).toBeInTheDocument();
      expect(within(dialog).queryByRole('combobox', { name: 'Stelle' })).toBeNull();
      expect(within(dialog).queryByLabelText('Zuführungsziel')).toBeNull();
    });

    it('mit Stellen: „Stelle“ und „Zuführungsziel“ (eingeklappt); die gewählte Stelle nimmt das Zuführungsziel weg', async () => {
      const { onErfassen } = zeigeNachtrag();
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).queryByLabelText('Ort')).toBeNull();
      expect(within(dialog).getByLabelText('Zuführungsziel')).toBeInTheDocument();
      // Menge, Empfänger, Stelle, Zeitpunkt (Feldbudget, LLH-1055); das Zuführungsziel liegt eingeklappt.
      expect(sichtbareFelder(dialog)).toBe(4);
      await waehle('Stelle', 'Feldküche BR Sportplatz');
      await waitFor(() => expect(within(dialog).queryByLabelText('Zuführungsziel')).toBeNull());
      expect(sichtbareFelder(dialog)).toBe(4);
      await userEvent.type(within(dialog).getByLabelText('Menge (EP)'), '100');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Nachtragen' }));
      await waitFor(() =>
        expect(onErfassen).toHaveBeenCalledWith({ menge: 100, verpflegungsstelle_id: FELDKUECHE }),
      );
    });

    it('Zuführungsziel ohne gewählte Stelle geht als `ort` hinaus; der Klappkopf nennt es', async () => {
      const { onErfassen } = zeigeNachtrag();
      const dialog = await screen.findByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText('Menge (EP)'), '20');
      await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
      await userEvent.type(within(dialog).getByLabelText('Zuführungsziel'), 'Deich km 3');
      expect(
        within(dialog).getByRole('button', { name: 'Weitere Angaben · Zuführungsziel' }),
      ).toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Nachtragen' }));
      await waitFor(() =>
        expect(onErfassen).toHaveBeenCalledWith({ menge: 20, ort: 'Deich km 3' }),
      );
    });

    it('Reihenfolge der Wahl: zugeordnete zuerst, aufgelöste als eigene Gruppe', async () => {
      zeigeNachtrag();
      await oeffne('Stelle');
      expect(optionenVon('Stelle')).toEqual([
        'Ausgabe Turnhalle Nord',
        'Feldküche BR Sportplatz',
        'Zuführung Deich',
        // Innerhalb der Gruppe die Folge der Testdaten (beim Server: nach Bezeichnung).
        'Ausgabe Schule',
        'Ausgabe Halle Süd',
      ]);
      const gruppen = [...document.querySelectorAll<HTMLElement>('.ant-select-item-group')].map(
        (g) => g.textContent,
      );
      expect(gruppen).toEqual(['zugeordnet', 'weitere', 'aufgelöst']);
    });

    it('Empfänger: Einheiten mit Stärke, Zuführung an Abschnitt, aufgelöste als eigene Gruppe', async () => {
      const liste = empfaenger();
      liste.einheiten.push(
        empfaengerEinheit({ id: 50, name: 'Alt', aufgeloest_at: '2026-09-24 08:00:00' }),
      );
      zeigeNachtrag(STELLEN, verpflegungMitStellen().zeitfenster[0], liste);
      await oeffne('Empfänger');
      expect(optionenVon('Empfänger')).toEqual([
        '1. Zug · Florian 1 · 1/2/17//20',
        '1. Gruppe · Florian 1-1 · 0/1/8//9',
        '2. Gruppe · Florian 1-2 · 0/1/8//9',
        'Wasserrettung',
        'Zuführung Deich',
        'Alt',
      ]);
      const gruppen = [...document.querySelectorAll<HTMLElement>('.ant-select-item-group')].map(
        (g) => g.textContent,
      );
      expect(gruppen).toContain('aufgelöst');
    });

    it('eine Einheit belegt die leere Menge mit ihrer Stärke vor; überschreibbar; sendet `einheit_id`', async () => {
      const { onErfassen } = zeigeNachtrag();
      const dialog = await screen.findByRole('dialog');
      const menge = within(dialog).getByLabelText('Menge (EP)');
      await waehle('Empfänger', '1. Zug · Florian 1 · 1/2/17//20');
      await waitFor(() => expect(menge).toHaveValue('20'));
      // Ein Wechsel ersetzt nur die eigene Vorgabe.
      await waehle('Empfänger', '2. Gruppe · Florian 1-2 · 0/1/8//9');
      await waitFor(() => expect(menge).toHaveValue('9'));
      await userEvent.clear(menge);
      await userEvent.type(menge, '8');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Nachtragen' }));
      await waitFor(() =>
        expect(onErfassen).toHaveBeenCalledWith({ menge: 8, einheit_id: GRUPPE_2 }),
      );
    });

    it('eine eingetippte Menge bleibt beim Wählen der Einheit stehen', async () => {
      zeigeNachtrag();
      const dialog = await screen.findByRole('dialog');
      const menge = within(dialog).getByLabelText('Menge (EP)');
      await userEvent.type(menge, '12');
      await waehle('Empfänger', '1. Zug · Florian 1 · 1/2/17//20');
      expect(menge).toHaveValue('12');
    });

    it('Zuführung an einen Abschnitt: keine Vorgabe, sendet `abschnitt_id`', async () => {
      const { onErfassen } = zeigeNachtrag();
      const dialog = await screen.findByRole('dialog');
      await waehle('Empfänger', 'Zuführung Deich');
      expect(within(dialog).getByLabelText('Menge (EP)')).toHaveValue('');
      await userEvent.type(within(dialog).getByLabelText('Menge (EP)'), '40');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Nachtragen' }));
      await waitFor(() =>
        expect(onErfassen).toHaveBeenCalledWith({ menge: 40, abschnitt_id: ABSCHNITT_DEICH }),
      );
    });

    it('ohne Einheiten und Abschnitte gibt es kein Feld „Empfänger“', async () => {
      zeigeNachtrag(STELLEN, verpflegungMitStellen().zeitfenster[0], {
        einheiten: [],
        abschnitte: [],
        betreuungsstellen: [],
      });
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).queryByRole('combobox', { name: 'Empfänger' })).toBeNull();
    });

    it('ausgabeBody: höchstens ein Empfänger', () => {
      expect(ausgabeBody({ menge: 5, empfaenger: `einheit:${ZUG}` })).toEqual({
        menge: 5,
        einheit_id: ZUG,
      });
      expect(ausgabeBody({ menge: 5, empfaenger: `abschnitt:${ABSCHNITT_DEICH}` })).toEqual({
        menge: 5,
        abschnitt_id: ABSCHNITT_DEICH,
      });
      expect(ausgabeBody({ menge: 5, empfaenger: null })).toEqual({ menge: 5 });
    });

    it('ausgabeBody: mit Stelle kein Ort', () => {
      expect(ausgabeBody({ menge: 5, ort: 'Deich', verpflegungsstelle_id: FELDKUECHE })).toEqual({
        menge: 5,
        verpflegungsstelle_id: FELDKUECHE,
      });
    });
  });
});
