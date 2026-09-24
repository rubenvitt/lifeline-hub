import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import type { ModulOverrides } from '../api/types';
import { alsOrtszeit } from '../etb/filterZeit';
import { renderMitProviders } from '../test/utils';
import { KEINE_SONDERKOST, ausgabe, zeitfenster } from '../test/verpflegungDaten';
import type { Bedarfsvorschlag, BedarfsvorschlagArgs } from './useBedarfsvorschlag';

dayjs.extend(utc);

// Der Hook ist eigens getestet (`useBedarfsvorschlag.test.tsx`). Hier zählt, WAS der Dialog
// hineingibt (Beginn als Wire, Overrides unverändert) und was er mit der Antwort tut.
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

const OVERRIDES: ModulOverrides = {};

/** Die zuletzt an den Hook gegebenen Argumente (`Array.at` fehlt in `lib` ES2020). */
const letzterAufruf = () => vorschlag.aufrufe[vorschlag.aufrufe.length - 1];
const JETZT = dayjs('2026-09-24T08:00:00Z');

const LEER = { wert: null, hinweis: null };
const K_HINWEIS = 'Vorschlag: Personal im Einsatz, Stand 09:58';
const B_HINWEIS = 'Vorschlag: in Betreuung, Stand jetzt, nicht zum Beginn';

/** Zählt die BEDIENBAREN Felder — Muster `betreuung/BetreuungDialoge.test.tsx`. */
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

/** Zeitraum über die Tastatur — Beginn, Enter, Ende, Enter (in jsdom gemessen tragfähig). */
async function waehleZeitraum(dialog: HTMLElement, von: string, bis: string) {
  const start = within(dialog).getByPlaceholderText('Beginn');
  await userEvent.click(start);
  await userEvent.clear(start);
  await userEvent.type(start, von);
  await userEvent.keyboard('{Enter}');
  const ende = within(dialog).getByPlaceholderText('Ende');
  await userEvent.clear(ende);
  await userEvent.type(ende, bis);
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(start).toHaveValue(von));
}

/** Ortszeit-Eingabe „YYYY-MM-DD HH:mm" → erwarteter Wire-String (UTC, ohne Zone). */
const wire = (ortszeit: string) => dayjs(ortszeit).utc().format('YYYY-MM-DD HH:mm:ss');

function zeigeAnlegen(onErfassen = vi.fn().mockResolvedValue(undefined), onSchliessen = vi.fn()) {
  renderMitProviders(
    <ZeitfensterDialog
      modus={{ art: 'anlegen', onErfassen }}
      einsatzId={1}
      benutzer={null}
      overrides={OVERRIDES}
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
      const ortszeit = dayjs(absolut); // so liefert ihn der Picker
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
    // Die Overrides gehen unverändert hinein — `undefined` hieße „unbekannt, nichts anfragen".
    expect(letzterAufruf().overrides).toBe(OVERRIDES);
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
            ? { wert: 55, hinweis: 'Vorschlag: in Betreuung, Stand jetzt' }
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
      modus: { art: 'anlegen' as const, onErfassen: vi.fn() },
      einsatzId: 1,
      benutzer: null,
      overrides: OVERRIDES,
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

  it('eine Ablehnung (422) lässt die Felder stehen und zeigt den Grund im Dialog', async () => {
    const fehler = new ApiError(422, 'Das Ende muss nach dem Beginn liegen');
    const onErfassen = vi.fn().mockRejectedValue(fehler);
    const onSchliessen = vi.fn();
    const props = {
      einsatzId: 1,
      benutzer: null,
      overrides: OVERRIDES,
      jetzt: JETZT,
      laeuft: false,
      onSchliessen,
      modus: { art: 'anlegen' as const, onErfassen },
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

describe('ZeitfensterDialog — bearbeiten', () => {
  function zeigeBearbeiten(onErfassen = vi.fn().mockResolvedValue(undefined)) {
    const onSchliessen = vi.fn();
    renderMitProviders(
      <ZeitfensterDialog
        modus={{ art: 'bearbeiten', zeitfenster: zeitfenster(), onErfassen }}
        einsatzId={1}
        benutzer={null}
        overrides={OVERRIDES}
        jetzt={JETZT}
        laeuft={false}
        fehler={null}
        onSchliessen={onSchliessen}
      />,
    );
    return { onErfassen, onSchliessen };
  }

  it('zeigt den Vorschlag als Hinweis und überschreibt den gespeicherten Bedarf nicht', async () => {
    vorschlag.liefere = () => ({
      kraefte: { wert: 186, hinweis: K_HINWEIS },
      betreute: { wert: 90, hinweis: 'Vorschlag: in Betreuung zum Beginn' },
    });
    zeigeBearbeiten();
    const dialog = await screen.findByRole('dialog', { name: 'Bedarf bearbeiten: Mittag' });
    expect(await within(dialog).findByText(`Aktuell 186 — ${K_HINWEIS}`)).toBeInTheDocument();
    expect(
      within(dialog).getByText('Aktuell 90 — Vorschlag: in Betreuung zum Beginn'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Einsatzkräfte (EP)')).toHaveValue('180');
    expect(within(dialog).getByLabelText('Betreute (EP)')).toHaveValue('70');
    // Der Beginn des Zeitfensters geht als Wire in den Hook — wie gespeichert, schon im ersten
    // Render (sonst ginge eine Kopfzahl-Anfrage „jetzt" hinaus).
    expect(vorschlag.aufrufe.map((x) => x.vonAt)).not.toContain(undefined);
    expect(letzterAufruf().vonAt).toBe('2026-09-24 10:00:00');
  });

  it('schickt nur die Änderung; unverändert wird nichts gesendet und der Dialog schließt', async () => {
    const { onErfassen, onSchliessen } = zeigeBearbeiten();
    const dialog = await screen.findByRole('dialog');
    await budgetUndAufklappen(dialog, 4, /Weitere Personen und Sonderkost/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(onErfassen).not.toHaveBeenCalled();
  });

  it('Betreute 70 → 90 schickt genau diesen Schlüssel', async () => {
    const { onErfassen } = zeigeBearbeiten();
    const dialog = await screen.findByRole('dialog');
    const betreute = within(dialog).getByLabelText('Betreute (EP)');
    await userEvent.clear(betreute);
    await userEvent.type(betreute, '90');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onErfassen).toHaveBeenCalledWith({ bedarf_betreute: 90 }));
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

  it('drei Felder sichtbar, der Rest eingeklappt; Knopf im <form>; sendet Menge und Ort', async () => {
    const { onErfassen, onSchliessen } = zeige(NF);
    const dialog = await screen.findByRole('dialog', { name: 'Ausgabe erfassen: Mittag' });
    await budgetUndAufklappen(dialog, 3, /Weitere Angaben/);
    const knopf = pruefeFormStruktur(dialog, 'Erfassen');
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
    await userEvent.click(within(dialog).getByRole('button', { name: 'Erfassen' }));
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
    const uhr = dayjs.utc('2026-09-24 09:40:00').local().format('HH:mm');
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
});
