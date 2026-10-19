import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERSON_ZUSTAND_MAX, VERLAUFSNOTIZ_MAX } from '../api/eingabegrenzen';
import type { Massnahme, PersonDetail, Verletzung } from '../api/types';
import { benutzerFixture } from '../test/fixtures';
import { meHandler, server } from '../test/server';
import { setzeViewportBreite } from '../test/viewport';
import { queueLeerenFuerTests, schreibaktionenLaden } from '../offline/queue';
import { renderMitProviders, setzeOnline } from '../test/utils';
import {
  OHNE_VERBINDUNG_NICHT_AENDERBAR,
  meldeServerErreichbar,
  verbindungZuruecksetzenFuerTests,
} from '../offline/verbindung';
import Patientenkopf, { AUFHEBEN_OHNE_NETZ } from './Patientenkopf';
import { PAT_OHNE_NETZ } from './PatKennzeichen';

/**
 * Der Patientenkopf (LLH-1094, Spec `personen-detail`): die Patientenfragen auf einen Blick, Sichten,
 * Verbleib und Notiz ohne Dialog. Die Seite prüft Aufbau und Ladehoheit, hier geht es um Inhalt und
 * Bedienung des Bausteins.
 */
const basis = {
  id: 10,
  einsatz_id: 1,
  registrier_nr: 12,
  status: 'betroffen',
  name: null,
  vorname: null,
  geschlecht: 'maennlich',
  geburtsdatum: null,
  alter_geschaetzt: 45,
  herkunft_adresse: null,
  antreff_ort: 'Brücke',
  melder_kontakt: null,
  notiz: null,
  zustand: 'Verdacht auf Hüftfraktur',
  erfasst_at: '2026-10-18 08:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-10-18 08:00:00',
  geaendert_von: 1,
  storniert_at: null,
  aktuelle_sichtung: 'sk2',
  aktuelle_sichtung_at: '2026-10-18 09:18:00',
  aktueller_verbleib: null,
  aktuelle_uhs_id: 3,
  aktueller_platz_id: null,
  sichtungen: [
    {
      id: 1,
      einsatz_id: 1,
      person_id: 10,
      kategorie: 'sk2',
      gesichtet_at: '2026-10-18 09:18:00',
      gesichtet_von: 1,
      bestaetigt_name: 'Dr. A. Muster',
    },
  ],
  notizen: [
    {
      id: 4,
      einsatz_id: 1,
      person_id: 10,
      text: 'Schmerzmittel verweigert',
      erfasst_at: '2026-10-18 09:30:00',
      erfasst_von: 1,
    },
  ],
  verbleib: [],
  abgleiche: [],
  transporte: [],
  massnahmen: [],
  verletzungen: [],
  aufenthalt: {
    uhs_id: 3,
    uhs_bezeichnung: 'Turnhalle',
    platz_id: null,
    platz_bezeichnung: null,
    seit: '2026-10-18 09:05:00',
  },
} as PersonDetail;

function zeige(person: Partial<PersonDetail> = {}, props: Record<string, unknown> = {}) {
  const onGeschrieben = vi.fn();
  renderMitProviders(
    <Patientenkopf
      einsatzId={1}
      person={{ ...basis, ...person } as PersonDetail}
      darfSchreiben
      onGeschrieben={onGeschrieben}
      {...props}
    />,
  );
  return { onGeschrieben, kopf: screen.getByRole('region', { name: 'Patientenkopf' }) };
}

let gesendet: { pfad: string; body: unknown }[];
beforeEach(() => {
  gesendet = [];
  server.use(
    http.post('/api/einsaetze/1/personen/10/:was', async ({ request, params }) => {
      gesendet.push({ pfad: String(params.was), body: await request.json() });
      return HttpResponse.json({ id: 99 }, { status: 201 });
    }),
  );
});

describe('Patientenkopf — lesen (LLH-1094)', () => {
  it('beantwortet Sichtung, Zustand / Verdacht, Aufenthalt und letzte Notiz', () => {
    const { kopf } = zeige();
    expect(within(kopf).getByText(/SK II · schwer/)).toBeInTheDocument();
    expect(kopf.querySelector('[data-lfh="sichtung-zeit"]')?.textContent).toMatch(
      /gesichtet .+ · .+ · bestätigt: Dr\. A\. Muster/,
    );
    expect(within(kopf).getByText('Zustand / Verdacht')).toBeInTheDocument();
    expect(kopf.querySelector('[data-lfh="aufenthalt"]')?.textContent).toMatch(
      /^Turnhalle · Wartebereich · seit /,
    );
    expect(within(kopf).getByText(/Schmerzmittel verweigert/)).toBeInTheDocument();
  });

  it('nennt den Platz, wenn die Person auf einem liegt', () => {
    const { kopf } = zeige({
      aufenthalt: { ...basis.aufenthalt!, platz_id: 7, platz_bezeichnung: 'Behandlungsplatz 2' },
    });
    expect(kopf.querySelector('[data-lfh="aufenthalt"]')?.textContent).toMatch(
      /^Turnhalle · Behandlungsplatz 2/,
    );
  });

  it('zeigt nach dem Abtransport den Verbleib statt des Aufenthalts', () => {
    const { kopf } = zeige({
      aufenthalt: null,
      aktuelle_uhs_id: null,
      verbleib: [
        {
          id: 2,
          einsatz_id: 1,
          person_id: 10,
          art: 'transport',
          ziel: 'KH Mitte',
          transportmittel: 'RTW 1-83-1',
          zeitpunkt_at: '2026-10-18 10:40:00',
          erfasst_von: 1,
        },
      ],
    });
    expect(within(kopf).getByText('Verbleib')).toBeInTheDocument();
    expect(kopf.querySelector('[data-lfh="aufenthalt"]')?.textContent).toMatch(
      /^Transport → KH Mitte \(RTW 1-83-1\)/,
    );
  });

  it('nennt eine ungesichtete Person „ungesichtet“', () => {
    const { kopf } = zeige({ aktuelle_sichtung: null, aktuelle_sichtung_at: null, sichtungen: [] });
    expect(within(kopf).getByRole('button', { name: 'Sichten, bisher ungesichtet' })).toBeVisible();
    expect(kopf.querySelector('[data-lfh="sichtung-zeit"]')).toBeNull();
  });

  it('zeigt eine verstorbene Person mit Sichtung und Verbleib des Leichnams', () => {
    const { kopf } = zeige({
      status: 'verstorben',
      aktuelle_sichtung: 'tot',
      aufenthalt: null,
      aktuelle_uhs_id: null,
      verbleib: [
        {
          id: 3,
          einsatz_id: 1,
          person_id: 10,
          art: 'verstorben',
          ziel: null,
          transportmittel: null,
          zeitpunkt_at: '2026-10-18 11:00:00',
          erfasst_von: 1,
        },
      ],
    } as Partial<PersonDetail>);
    expect(
      within(kopf).getByRole('button', { name: /^Nachsichten, aktuell .*verstorben/ }),
    ).toBeVisible();
    expect(kopf.querySelector('[data-lfh="aufenthalt"]')?.textContent).toMatch(
      /^Verbleib des Leichnams · /,
    );
  });

  it('bietet an einer stornierten Person keine Bedienung an, zeigt aber den Inhalt', () => {
    const { kopf } = zeige({ storniert_at: '2026-10-18 12:00:00' });
    expect(within(kopf).queryAllByRole('button')).toHaveLength(0);
    expect(within(kopf).queryByRole('textbox')).toBeNull();
    expect(within(kopf).getByText(/SK II · schwer/)).toBeInTheDocument();
    expect(within(kopf).getByText(/Schmerzmittel verweigert/)).toBeInTheDocument();
  });

  it.each([
    ['ohne Schreibrecht', { darfSchreiben: false }],
    ['in der Lesefassung', { modus: 'lesen' }],
  ])('bietet %s keine Bedienung an', (_fall, props) => {
    const { kopf } = zeige({}, props);
    expect(within(kopf).queryAllByRole('button')).toHaveLength(0);
    expect(within(kopf).queryByRole('textbox')).toBeNull();
    expect(within(kopf).getByText('Verdacht auf Hüftfraktur')).toBeInTheDocument();
  });
});

describe('Patientenkopf — Bedienung ohne Dialog (LLH-1094)', () => {
  it('sichtet nach: Sichtung tippen, Fläche, Übernehmen — kein Dialog', async () => {
    const { kopf, onGeschrieben } = zeige();
    await userEvent.click(
      within(kopf).getByRole('button', { name: /^Nachsichten, aktuell SK II/ }),
    );
    const paneel = screen.getByRole('region', { name: 'Sichtung erfassen' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(within(paneel).getByRole('radio', { name: /^SK I,/ }));
    await userEvent.click(within(paneel).getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() => expect(onGeschrieben).toHaveBeenCalledTimes(1));
    expect(gesendet).toEqual([
      { pfad: 'sichtung', body: { kategorie: 'sk1', notiz: null, client_id: expect.any(String) } },
    ]);
    // Online ohne Erfassungszeit: der Server nimmt seine Uhr (LLH-1138).
    expect(gesendet[0].body).not.toHaveProperty('zeitpunkt_at');
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Sichtung erfassen' })).toBeNull(),
    );
  });

  it('lässt eine Ablehnung im Paneel stehen, die Eingabe bleibt', async () => {
    server.use(
      http.post('/api/einsaetze/1/personen/10/sichtung', () =>
        HttpResponse.json({ error: 'Person ist storniert' }, { status: 409 }),
      ),
    );
    const { kopf, onGeschrieben } = zeige();
    await userEvent.click(within(kopf).getByRole('button', { name: /^Nachsichten/ }));
    const paneel = screen.getByRole('region', { name: 'Sichtung erfassen' });
    await userEvent.click(within(paneel).getByRole('radio', { name: /^SK III,/ }));
    await userEvent.click(within(paneel).getByRole('button', { name: 'Übernehmen' }));
    expect(await within(paneel).findByText(/Person ist storniert/)).toBeInTheDocument();
    expect(within(paneel).getByRole('radio', { name: /^SK III,/ })).toBeChecked();
    expect(onGeschrieben).not.toHaveBeenCalled();
    // Die übrigen Bedienungen des Kopfs bleiben bedienbar.
    expect(within(kopf).getByRole('button', { name: 'Verbleib erfassen' })).toBeEnabled();
  });

  it('klappt „Verbleib erfassen“ als Paneel auf und sendet die Art', async () => {
    const { kopf, onGeschrieben } = zeige();
    await userEvent.click(within(kopf).getByRole('button', { name: 'Verbleib erfassen' }));
    const paneel = screen.getByRole('region', { name: 'Verbleib erfassen' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(within(paneel).getByRole('combobox', { name: 'Art' }));
    await userEvent.click(await screen.findByTitle('Transport'));
    await userEvent.type(within(paneel).getByLabelText('Ziel'), 'KH Mitte');
    await userEvent.click(within(paneel).getByRole('button', { name: 'Verbleib erfassen' }));
    await waitFor(() => expect(onGeschrieben).toHaveBeenCalledTimes(1));
    expect(gesendet[0]).toMatchObject({
      pfad: 'verbleib',
      body: { art: 'transport', ziel: 'KH Mitte' },
    });
  });

  it('legt eine Notiz über die Eingabezeile an', async () => {
    const { onGeschrieben } = zeige();
    await userEvent.type(screen.getByRole('textbox', { name: 'Verlaufsnotiz' }), 'Infusion läuft');
    await userEvent.click(screen.getByRole('button', { name: 'Notiz anlegen' }));
    await waitFor(() => expect(onGeschrieben).toHaveBeenCalledTimes(1));
    expect(gesendet).toEqual([
      { pfad: 'notizen', body: { text: 'Infusion läuft', client_id: expect.any(String) } },
    ]);
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Verlaufsnotiz' })).toHaveValue(''),
    );
  });

  /** Hält die Antwort auf die Sichtung zurück, bis der Test sie freigibt. */
  function verzoegereSichtung(antwort: () => Response) {
    let freigeben!: () => void;
    const freigabe = new Promise<void>((r) => {
      freigeben = r;
    });
    server.use(
      http.post('/api/einsaetze/1/personen/10/sichtung', async () => {
        await freigabe;
        return antwort();
      }),
    );
    return () => freigeben();
  }

  async function sichteBisSpeichern(kopf: HTMLElement, kategorie: RegExp) {
    await userEvent.click(within(kopf).getByRole('button', { name: /^Nachsichten/ }));
    const paneel = screen.getByRole('region', { name: 'Sichtung erfassen' });
    await userEvent.click(within(paneel).getByRole('radio', { name: kategorie }));
    const uebernehmen = within(paneel).getByRole('button', { name: 'Übernehmen' });
    await userEvent.click(uebernehmen);
    await waitFor(() => expect(uebernehmen).toHaveClass('ant-btn-loading'));
    return paneel;
  }

  it('sperrt den Wechsel, solange die Sichtung speichert, und zeigt eine Ablehnung danach im Paneel', async () => {
    const freigeben = verzoegereSichtung(() =>
      HttpResponse.json({ error: 'Person ist storniert' }, { status: 409 }),
    );
    const { kopf, onGeschrieben } = zeige();
    const paneel = await sichteBisSpeichern(kopf, /^SK III,/);
    const ausloeser = within(kopf).getByRole('button', { name: /^Nachsichten/ });
    await userEvent.click(within(kopf).getByRole('button', { name: 'Verbleib erfassen' }));
    await userEvent.click(ausloeser);
    expect(screen.queryByRole('region', { name: 'Verbleib erfassen' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Sichtung erfassen' })).toBe(paneel);
    expect(ausloeser).toBeDisabled();
    expect(within(kopf).getByRole('button', { name: 'Verbleib erfassen' })).toBeDisabled();

    freigeben();
    expect(await within(paneel).findByText(/Person ist storniert/)).toBeInTheDocument();
    expect(onGeschrieben).not.toHaveBeenCalled();
    expect(within(kopf).getByRole('button', { name: 'Verbleib erfassen' })).toBeEnabled();
    expect(ausloeser).toBeEnabled();
  });

  it('schließt nach gespeicherter Sichtung nur das eigene Paneel', async () => {
    const freigeben = verzoegereSichtung(() => HttpResponse.json({ id: 99 }, { status: 201 }));
    const { kopf, onGeschrieben } = zeige();
    await sichteBisSpeichern(kopf, /^SK I,/);
    // Ginge der Verbleib jetzt auf, schlösse ihn der späte Erfolg samt Eingabe.
    await userEvent.click(within(kopf).getByRole('button', { name: 'Verbleib erfassen' }));
    expect(screen.queryByRole('region', { name: 'Verbleib erfassen' })).toBeNull();

    freigeben();
    await waitFor(() => expect(onGeschrieben).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Sichtung erfassen' })).toBeNull(),
    );
    // Danach geht der Verbleib wieder auf, und nichts Spätes schließt ihn.
    await userEvent.click(within(kopf).getByRole('button', { name: 'Verbleib erfassen' }));
    const verbleib = screen.getByRole('region', { name: 'Verbleib erfassen' });
    await userEvent.type(within(verbleib).getByLabelText('Ziel'), 'KH Mitte');
    expect(screen.getByRole('region', { name: 'Verbleib erfassen' })).toBe(verbleib);
    expect(within(verbleib).getByLabelText('Ziel')).toHaveValue('KH Mitte');
  });

  it('nimmt die Aufenthalts-Handlungen der Seite auf', () => {
    const { kopf } = zeige({}, { aufenthaltAktionen: <button type="button">Verlegen</button> });
    expect(within(kopf).getByRole('button', { name: 'Verlegen' })).toBeVisible();
  });

  it('bietet an der Betreuungsstelle kein Sichten an', () => {
    const { kopf } = zeige({}, { darfSichten: false });
    expect(within(kopf).queryByRole('button', { name: /Sichten/ })).toBeNull();
    expect(within(kopf).getByText(/SK II · schwer/)).toBeInTheDocument();
  });
});

/** Eine Maßnahme der Fixture; `aufgehoben` setzt `aufgehoben_at`. */
function massnahme(id: number, art: Massnahme['art'], um: string, aufgehoben = false): Massnahme {
  return {
    id,
    einsatz_id: 1,
    person_id: 10,
    art,
    zeitpunkt_at: `2026-10-18 ${um}:00`,
    erfasst_at: `2026-10-18 ${um}:00`,
    erfasst_von: 1,
    aufgehoben_at: aufgehoben ? '2026-10-18 11:00:00' : null,
  };
}

function verletzung(
  id: number,
  region: Verletzung['region'],
  art: Verletzung['art'],
  aufgehoben = false,
  ansicht: Verletzung['ansicht'] = 'vorn',
): Verletzung {
  return {
    id,
    einsatz_id: 1,
    person_id: 10,
    ansicht,
    region,
    art,
    zeitpunkt_at: '2026-10-18 09:40:00',
    erfasst_at: '2026-10-18 09:40:00',
    erfasst_von: 1,
    aufgehoben_at: aufgehoben ? '2026-10-18 10:00:00' : null,
  };
}

/** Der volle PAT-Kern aus dem Szenario der Spec (`personen-detail`, „Voller PAT-Kern“). */
const vollerKern: Partial<PersonDetail> = {
  pat_nummer: 'A-4711',
  kontamination: true,
  transport_prioritaet: 'dringlich',
  transport_art: 'liegend',
  transport_fachrichtung: 'unfallchirurgie',
  transport_at: '2026-10-18 09:50:00',
  // Jüngste Durchführung zuerst, wie der Server liefert; die aufgehobene zählt nicht.
  massnahmen: [
    massnahme(6, 'sauerstoff', '10:20'),
    massnahme(5, 'infusion', '10:10', true),
    massnahme(4, 'zugang', '10:00'),
    massnahme(3, 'analgesie', '09:55'),
    massnahme(2, 'immobilisation', '09:45'),
    massnahme(1, 'blutstillung', '09:30'),
  ],
  // Erfassungsfolge; Nummer 2 ist aufgehoben und lässt eine Lücke.
  verletzungen: [
    verletzung(1, 'unterarm_l', 'fraktur_verdacht'),
    verletzung(2, 'kopf', 'wunde_blutung', true),
    verletzung(3, 'thorax', 'prellung_schwellung'),
    verletzung(4, 'ruecken', 'schmerz', false, 'hinten'),
    verletzung(5, 'fuss_r', 'verbrennung'),
  ],
};

describe('Patientenkopf — voller PAT-Kern (LLH-1324/1325/1326/1113, design.md D14)', () => {
  it('nennt PAT-Nummer und „kontaminiert“ in der Kopfzeile', () => {
    const { kopf } = zeige(vollerKern, { darfSchreiben: false });
    const zeile = kopf.querySelector<HTMLElement>('[data-lfh="patientenkopf-zeile"]');
    expect(zeile).not.toBeNull();
    expect(within(zeile!).getByText('PAT A-4711')).toBeInTheDocument();
    expect(within(zeile!).getByText('kontaminiert')).toBeInTheDocument();
  });

  it('teilt das Raster ab lg in zwei Spalten: links Lage, rechts Behandlung', () => {
    const { kopf } = zeige(vollerKern, { darfSchreiben: false });
    const spalten = kopf.querySelectorAll<HTMLElement>('dl[data-lfh="datenraster"]');
    expect(spalten).toHaveLength(2);
    const begriffe = [...spalten].map((dl) =>
      [...dl.querySelectorAll('dt')].map((dt) => dt.textContent),
    );
    expect(begriffe).toEqual([
      ['Sichtung', 'Zustand / Verdacht', 'Aufenthalt', 'Transport'],
      ['Maßnahmen', 'Verletzungen', 'Letzte Notiz'],
    ]);
    const huelle = spalten[0].parentElement!;
    expect(huelle.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
  });

  it('stapelt die Spalten unter lg, die Lage zuerst', () => {
    setzeViewportBreite(800);
    const { kopf } = zeige(vollerKern, { darfSchreiben: false });
    const spalten = kopf.querySelectorAll<HTMLElement>('dl[data-lfh="datenraster"]');
    expect(spalten[0].parentElement!.style.gridTemplateColumns).toBe('minmax(0, 1fr)');
    expect(spalten[0].querySelector('dt')?.textContent).toBe('Sichtung');
  });

  it('zeigt den Transportstand mit Priorität, Art und Fachrichtung', () => {
    const { kopf } = zeige(vollerKern, { darfSchreiben: false });
    expect(kopf.querySelector('[data-lfh="transport"]')?.textContent).toMatch(
      /^dringlich · liegend · Unfallchirurgie/,
    );
  });

  it('kürzt die Maßnahmen auf drei gültige und nennt die übrigen', () => {
    const { kopf } = zeige(vollerKern, { darfSchreiben: false });
    const liste = within(kopf).getByRole('list', { name: 'Maßnahmen' });
    const zeilen = within(liste)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(zeilen).toHaveLength(3);
    expect(zeilen[0]).toMatch(/^Sauerstoff · /);
    expect(zeilen[1]).toMatch(/^Zugang · /);
    expect(zeilen[2]).toMatch(/^Analgesie · /);
    // Fünf gültige, drei stehen: die aufgehobene Infusion zählt nicht mit.
    expect(within(kopf).getByText('+ 2 weitere')).toBeInTheDocument();
    expect(liste.textContent).not.toContain('Infusion');
  });

  it('nummeriert die Verletzungen fest nach Erfassung, Aufgehobene lassen eine Lücke', () => {
    const { kopf } = zeige(vollerKern, { darfSchreiben: false });
    const liste = within(kopf).getByRole('list', { name: 'Verletzungen' });
    const zeilen = within(liste)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    // Die jüngsten zuerst (gleiche Zeit: die spätere Erfassung), jede mit ihrer festen Nummer.
    expect(zeilen).toEqual([
      '5 Fuß rechts, vorn · Verbrennung · 1140',
      '4 Rücken, hinten · Schmerz · 1140',
      '3 Thorax, vorn · Prellung/Schwellung · 1140',
    ]);
    expect(within(kopf).getByText('+ 1 weitere')).toBeInTheDocument();
  });

  it('nennt leere Angaben, ohne Kopfzeile', () => {
    const { kopf } = zeige({}, { darfSchreiben: false });
    expect(kopf.querySelector('[data-lfh="patientenkopf-zeile"]')).toBeNull();
    expect(kopf.querySelector('[data-lfh="transport"]')?.textContent).toBe('kein Transport');
    expect(kopf.querySelector('[data-lfh="massnahmen"]')?.textContent).toBe('keine');
    expect(kopf.querySelector('[data-lfh="verletzungen"]')?.textContent).toBe('keine');
    expect(within(kopf).queryByText(/weitere/)).toBeNull();
  });

  it('zeigt „nicht kontaminiert“ nicht als Marke', () => {
    const { kopf } = zeige({ kontamination: false }, { darfSchreiben: false });
    expect(within(kopf).queryByText('kontaminiert')).toBeNull();
  });

  it.each([
    ['ohne Schreibrecht', { darfSchreiben: false }],
    ['in der Lesefassung', { modus: 'lesen' }],
  ])('zeigt %s den vollen Kern ohne jede Bedienung', (_fall, props) => {
    const { kopf } = zeige(vollerKern, props);
    expect(within(kopf).queryAllByRole('button')).toHaveLength(0);
    expect(within(kopf).queryByRole('textbox')).toBeNull();
    expect(within(kopf).getByText('PAT A-4711')).toBeInTheDocument();
    expect(within(kopf).getByRole('list', { name: 'Verletzungen' })).toBeInTheDocument();
  });
});

describe('Patientenkopf — Transport, Maßnahme, PAT und Kontamination (D14)', () => {
  let gepatcht: unknown[];
  beforeEach(() => {
    gepatcht = [];
    server.use(
      http.patch('/api/einsaetze/1/personen/10', async ({ request }) => {
        gepatcht.push(await request.json());
        return HttpResponse.json({ ...basis });
      }),
      http.post('/api/einsaetze/1/personen/10/massnahmen/:mid/aufheben', ({ params }) => {
        gesendet.push({ pfad: `massnahmen/${String(params.mid)}/aufheben`, body: null });
        return HttpResponse.json({ id: Number(params.mid) });
      }),
    );
  });

  it('legt den Transport im Paneel fest, ohne Dialog', async () => {
    const { kopf, onGeschrieben } = zeige();
    await userEvent.click(within(kopf).getByRole('button', { name: 'Transport festlegen' }));
    const paneel = screen.getByRole('region', { name: 'Transport festlegen' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(
      within(within(paneel).getByRole('radiogroup', { name: 'Priorität' })).getByRole('radio', {
        name: 'sofort',
      }),
    );
    await userEvent.click(
      within(within(paneel).getByRole('radiogroup', { name: 'Art' })).getByRole('radio', {
        name: 'liegend',
      }),
    );
    await userEvent.click(within(paneel).getByRole('combobox', { name: 'Fachrichtung' }));
    await userEvent.click(await screen.findByTitle('Unfallchirurgie'));
    await userEvent.click(within(paneel).getByRole('button', { name: 'Transport festlegen' }));
    await waitFor(() => expect(onGeschrieben).toHaveBeenCalledTimes(1));
    expect(gesendet).toEqual([
      {
        pfad: 'transport',
        body: {
          prioritaet: 'sofort',
          art: 'liegend',
          fachrichtung: 'unfallchirurgie',
          client_id: expect.any(String),
        },
      },
    ]);
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Transport festlegen' })).toBeNull(),
    );
  });

  it('belegt das Paneel mit dem aktuellen Stand vor; „ohne“ leert ein Feld', async () => {
    const { kopf } = zeige(vollerKern);
    await userEvent.click(within(kopf).getByRole('button', { name: 'Transport festlegen' }));
    const paneel = screen.getByRole('region', { name: 'Transport festlegen' });
    const prio = within(paneel).getByRole('radiogroup', { name: 'Priorität' });
    expect(within(prio).getByRole('radio', { name: 'dringlich' })).toBeChecked();
    await userEvent.click(within(prio).getByRole('radio', { name: 'ohne' }));
    await userEvent.click(within(paneel).getByRole('button', { name: 'Transport festlegen' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0].body).toEqual({
      prioritaet: null,
      art: 'liegend',
      fachrichtung: 'unfallchirurgie',
      client_id: expect.any(String),
    });
  });

  it('lässt eine Ablehnung des Transports im Paneel stehen, die übrigen bleiben bedienbar', async () => {
    server.use(
      http.post('/api/einsaetze/1/personen/10/transport', () =>
        HttpResponse.json({ error: 'Person ist vermisst' }, { status: 422 }),
      ),
    );
    const { kopf, onGeschrieben } = zeige();
    await userEvent.click(within(kopf).getByRole('button', { name: 'Transport festlegen' }));
    const paneel = screen.getByRole('region', { name: 'Transport festlegen' });
    await userEvent.click(within(paneel).getByRole('radio', { name: 'normal' }));
    await userEvent.click(within(paneel).getByRole('button', { name: 'Transport festlegen' }));
    expect(await within(paneel).findByText(/Person ist vermisst/)).toBeInTheDocument();
    expect(within(paneel).getByRole('radio', { name: 'normal' })).toBeChecked();
    expect(onGeschrieben).not.toHaveBeenCalled();
    expect(within(kopf).getByRole('button', { name: 'Maßnahme erfassen' })).toBeEnabled();
  });

  it('erfasst eine Maßnahme über die Flächen, ohne Uhrzeit gilt die Erfassung', async () => {
    const { kopf, onGeschrieben } = zeige();
    await userEvent.click(within(kopf).getByRole('button', { name: 'Maßnahme erfassen' }));
    const paneel = screen.getByRole('region', { name: 'Maßnahme erfassen' });
    await userEvent.click(within(paneel).getByRole('radio', { name: 'Blutstillung' }));
    await userEvent.click(within(paneel).getByRole('button', { name: 'Maßnahme erfassen' }));
    await waitFor(() => expect(onGeschrieben).toHaveBeenCalledTimes(1));
    expect(gesendet).toEqual([
      { pfad: 'massnahmen', body: { art: 'blutstillung', client_id: expect.any(String) } },
    ]);
  });

  it('verlangt eine Maßnahme, bevor es sendet', async () => {
    const { kopf } = zeige();
    await userEvent.click(within(kopf).getByRole('button', { name: 'Maßnahme erfassen' }));
    const paneel = screen.getByRole('region', { name: 'Maßnahme erfassen' });
    await userEvent.click(within(paneel).getByRole('button', { name: 'Maßnahme erfassen' }));
    expect(await within(paneel).findByText('Bitte eine Maßnahme wählen')).toBeInTheDocument();
    expect(gesendet).toEqual([]);
  });

  it('hebt eine Maßnahme im Paneel nach Rückfrage auf (unumkehrbar, LFH-363)', async () => {
    const { kopf, onGeschrieben } = zeige(vollerKern);
    await userEvent.click(within(kopf).getByRole('button', { name: 'Maßnahme erfassen' }));
    const paneel = screen.getByRole('region', { name: 'Maßnahme erfassen' });
    await userEvent.click(
      within(paneel).getByRole('button', { name: /^Maßnahme Blutstillung .* aufheben$/ }),
    );
    // Noch nichts gesendet: erst die Rückfrage, ihr Knopf nennt die Handlung.
    expect(gesendet).toEqual([]);
    const rueckfrage = await screen.findByRole('tooltip');
    await userEvent.click(within(rueckfrage).getByRole('button', { name: 'Maßnahme aufheben' }));
    await waitFor(() => expect(onGeschrieben).toHaveBeenCalledTimes(1));
    expect(gesendet).toEqual([{ pfad: 'massnahmen/1/aufheben', body: null }]);
  });

  it('hält immer nur ein Paneel offen', async () => {
    const { kopf } = zeige();
    await userEvent.click(within(kopf).getByRole('button', { name: 'Transport festlegen' }));
    expect(screen.getByRole('region', { name: 'Transport festlegen' })).toBeInTheDocument();
    await userEvent.click(within(kopf).getByRole('button', { name: 'Maßnahme erfassen' }));
    expect(screen.queryByRole('region', { name: 'Transport festlegen' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Maßnahme erfassen' })).toBeInTheDocument();
    // Der Auslöser schließt sein eigenes Paneel wieder.
    await userEvent.click(
      within(kopf).getByRole('button', { name: 'Maßnahme erfassen', expanded: true }),
    );
    expect(screen.queryByRole('region', { name: 'Maßnahme erfassen' })).toBeNull();
  });

  it('sperrt den Wechsel, solange die Maßnahme speichert, und zeigt die Ablehnung im Paneel', async () => {
    let freigeben!: () => void;
    const freigabe = new Promise<void>((r) => {
      freigeben = r;
    });
    server.use(
      http.post('/api/einsaetze/1/personen/10/massnahmen', async () => {
        await freigabe;
        return HttpResponse.json({ error: 'Person ist storniert' }, { status: 409 });
      }),
    );
    const { kopf, onGeschrieben } = zeige();
    await userEvent.click(within(kopf).getByRole('button', { name: 'Maßnahme erfassen' }));
    const paneel = screen.getByRole('region', { name: 'Maßnahme erfassen' });
    await userEvent.click(within(paneel).getByRole('radio', { name: 'Sauerstoff' }));
    const senden = within(paneel).getByRole('button', { name: 'Maßnahme erfassen' });
    await userEvent.click(senden);
    await waitFor(() => expect(senden).toHaveClass('ant-btn-loading'));
    const transport = within(kopf).getByRole('button', { name: 'Transport festlegen' });
    expect(transport).toBeDisabled();
    expect(within(kopf).getByRole('button', { name: /^Nachsichten/ })).toBeDisabled();
    expect(within(kopf).getByRole('button', { name: 'Verbleib erfassen' })).toBeDisabled();
    await userEvent.click(transport);
    expect(screen.getByRole('region', { name: 'Maßnahme erfassen' })).toBe(paneel);

    freigeben();
    expect(await within(paneel).findByText(/Person ist storniert/)).toBeInTheDocument();
    expect(onGeschrieben).not.toHaveBeenCalled();
    expect(transport).toBeEnabled();
  });

  it('nennt am UHS-Tablet „Bestätigt von“ und schickt die Kennung mit', async () => {
    server.use(
      meHandler({
        ...benutzerFixture({ anzeigename: 'UHS Nord · Tablet 1' }),
        geraet: {
          kopplung_id: 3,
          einsatz_id: 1,
          ansicht: 'uhs-tablet',
          uhs_id: 3,
          stelle: 'UHS Nord',
          bezeichnung: 'Tablet 1',
          laeuft_ab_at: '2026-10-08 12:00:00',
        },
      }),
      http.get('/api/einsaetze/1/personen/bestaetiger', () =>
        HttpResponse.json([{ id: 5, name: 'Dr. A. Muster', funktion: 'Notärztin' }]),
      ),
    );
    const user = userEvent.setup();
    const { kopf } = zeige();
    await user.click(within(kopf).getByRole('button', { name: 'Maßnahme erfassen' }));
    const paneel = screen.getByRole('region', { name: 'Maßnahme erfassen' });
    await user.click(within(paneel).getByRole('radio', { name: 'Zugang' }));
    await user.click(await within(paneel).findByRole('combobox', { name: 'Bestätigt von' }));
    await user.click(await screen.findByTitle('Dr. A. Muster · Notärztin'));
    await user.click(within(paneel).getByRole('button', { name: 'Maßnahme erfassen' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0].body).toEqual({
      art: 'zugang',
      bestaetigt_personal_id: 5,
      client_id: expect.any(String),
    });
  });

  it('bietet ohne Behandlungsrecht (Betreuungsstelle) weder Transport noch Maßnahme an', () => {
    const { kopf } = zeige(vollerKern, { darfBehandeln: false });
    expect(within(kopf).queryByRole('button', { name: 'Transport festlegen' })).toBeNull();
    expect(within(kopf).queryByRole('button', { name: 'Maßnahme erfassen' })).toBeNull();
    expect(kopf.querySelector('[data-lfh="transport"]')?.textContent).toMatch(/^dringlich/);
  });

  it('schreibt die PAT-Nummer inline über den PATCH, nur dieses Feld', async () => {
    const { kopf, onGeschrieben } = zeige();
    await userEvent.click(within(kopf).getByRole('button', { name: 'PAT-Nummer eintragen' }));
    const feld = within(kopf).getByRole('textbox', { name: 'PAT-Nummer' });
    await userEvent.type(feld, 'A-4711{Enter}');
    await waitFor(() => expect(gepatcht).toEqual([{ pat_nummer: 'A-4711' }]));
    await waitFor(() => expect(onGeschrieben).toHaveBeenCalledTimes(1));
  });

  it('zählt die PAT-Nummer gegen die Servergrenze und sendet Überlänge nicht', async () => {
    const { kopf } = zeige();
    await userEvent.click(within(kopf).getByRole('button', { name: 'PAT-Nummer eintragen' }));
    const feld = within(kopf).getByRole('textbox', { name: 'PAT-Nummer' });
    await userEvent.type(feld, `${'9'.repeat(33)}{Enter}`);
    expect(within(kopf).getByText(/zu lang/)).toBeInTheDocument();
    expect(gepatcht).toEqual([]);
  });

  it('setzt die Kontamination inline über den PATCH', async () => {
    const { kopf } = zeige();
    await userEvent.click(within(kopf).getByRole('button', { name: 'Kontamination eintragen' }));
    await userEvent.click(within(kopf).getByRole('combobox', { name: 'Kontamination' }));
    await userEvent.click(await screen.findByTitle('kontaminiert'));
    await userEvent.click(within(kopf).getByRole('button', { name: 'Kontamination speichern' }));
    await waitFor(() => expect(gepatcht).toEqual([{ kontamination: true }]));
  });

  it('sperrt PAT-Nummer und Kontamination ohne Netz mit Grund', () => {
    setzeOnline(false);
    try {
      const { kopf } = zeige(vollerKern);
      expect(within(kopf).queryByRole('button', { name: /PAT-Nummer/ })).toBeNull();
      expect(within(kopf).queryByRole('button', { name: /Kontamination/ })).toBeNull();
      expect(within(kopf).getByText('PAT A-4711')).toBeInTheDocument();
      expect(within(kopf).getByText('kontaminiert')).toBeInTheDocument();
      expect(within(kopf).getByRole('status')).toHaveTextContent(
        'PAT-Nummer und Kontamination ohne Netz nicht änderbar',
      );
    } finally {
      setzeOnline(true);
    }
  });
});

describe('Patientenkopf — Verletzungen am Körperschema (LLH-1120, design.md D13)', () => {
  it('zeigt ab md die kleine Figur neben der Liste, darunter nur die Liste', () => {
    const { kopf } = zeige(vollerKern, { darfSchreiben: false });
    const feld = kopf.querySelector<HTMLElement>('[data-lfh="verletzungen"]')!;
    expect(feld.querySelectorAll('[data-lfh="koerperfigur"]')).toHaveLength(2);
    // Vier gültige Verletzungen, je ein Sternchen mit seiner festen Nummer.
    expect(
      [...feld.querySelectorAll('[data-lfh="stern"]')].map((s) => s.getAttribute('data-nummer')),
    ).toEqual(['1', '3', '5', '4']);
  });

  it('lässt die Figur unter md weg', () => {
    setzeViewportBreite(600);
    const { kopf } = zeige(vollerKern, { darfSchreiben: false });
    expect(kopf.querySelector('[data-lfh="koerperfigur"]')).toBeNull();
    expect(within(kopf).getByRole('list', { name: 'Verletzungen' })).toBeInTheDocument();
  });

  it('öffnet „Verletzung markieren“ als Paneel mit dem vollen Schema und speichert mit zwei Tipps', async () => {
    const { kopf, onGeschrieben } = zeige();
    await userEvent.click(within(kopf).getByRole('button', { name: 'Verletzung markieren' }));
    const paneel = screen.getByRole('region', { name: 'Verletzung markieren' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(within(paneel).getByRole('button', { name: 'Unterarm links, vorn' }));
    await userEvent.click(within(paneel).getByRole('radio', { name: 'Fraktur-Verdacht' }));
    await waitFor(() => expect(onGeschrieben).toHaveBeenCalledTimes(1));
    expect(gesendet).toHaveLength(1);
    expect(gesendet[0]).toMatchObject({
      pfad: 'verletzungen',
      body: { ansicht: 'vorn', region: 'unterarm_l', art: 'fraktur_verdacht' },
    });
    // Mehrere Verletzungen nacheinander: das Paneel bleibt offen.
    expect(screen.getByRole('region', { name: 'Verletzung markieren' })).toBe(paneel);
  });

  it('lässt eine Ablehnung am Schema stehen, die übrigen Paneele bleiben bedienbar', async () => {
    server.use(
      http.post('/api/einsaetze/1/personen/10/verletzungen', () =>
        HttpResponse.json({ error: 'Person ist vermisst' }, { status: 422 }),
      ),
    );
    const { kopf, onGeschrieben } = zeige();
    await userEvent.click(within(kopf).getByRole('button', { name: 'Verletzung markieren' }));
    const paneel = screen.getByRole('region', { name: 'Verletzung markieren' });
    await userEvent.click(within(paneel).getByRole('button', { name: 'Kopf, vorn' }));
    await userEvent.click(within(paneel).getByRole('radio', { name: 'Wunde/Blutung' }));
    expect(await within(paneel).findByText(/Person ist vermisst/)).toBeInTheDocument();
    expect(onGeschrieben).not.toHaveBeenCalled();
    expect(within(kopf).getByRole('button', { name: 'Transport festlegen' })).toBeEnabled();
  });

  it('hebt eine Verletzung am Sternchen auf', async () => {
    server.use(
      http.post('/api/einsaetze/1/personen/10/verletzungen/:vid/aufheben', ({ params }) => {
        gesendet.push({ pfad: `verletzungen/${String(params.vid)}/aufheben`, body: null });
        return HttpResponse.json({ id: Number(params.vid) });
      }),
    );
    const { kopf, onGeschrieben } = zeige(vollerKern);
    await userEvent.click(within(kopf).getByRole('button', { name: 'Verletzung markieren' }));
    const paneel = screen.getByRole('region', { name: 'Verletzung markieren' });
    await userEvent.click(
      within(paneel).getByRole('button', { name: /^Verletzung 3, Thorax, vorn/ }),
    );
    await userEvent.click(within(paneel).getByRole('button', { name: 'Aufheben' }));
    await waitFor(() => expect(onGeschrieben).toHaveBeenCalledTimes(1));
    expect(gesendet).toEqual([{ pfad: 'verletzungen/3/aufheben', body: null }]);
  });

  it('hebt ohne Netz nicht auf: das Sternchen nennt den Grund', async () => {
    const { kopf } = zeige(vollerKern);
    await userEvent.click(within(kopf).getByRole('button', { name: 'Verletzung markieren' }));
    setzeOnline(false);
    try {
      const paneel = await screen.findByRole('region', { name: 'Verletzung markieren' });
      await userEvent.click(
        within(paneel).getByRole('button', { name: /^Verletzung 3, Thorax, vorn/ }),
      );
      expect(within(paneel).getByRole('button', { name: 'Aufheben' })).toBeDisabled();
      expect(within(paneel).getByText('Aufheben ohne Netz nicht möglich')).toBeVisible();
      expect(gesendet).toEqual([]);
    } finally {
      setzeOnline(true);
    }
  });

  it('bietet ohne Behandlungsrecht kein Markieren an', () => {
    const { kopf } = zeige(vollerKern, { darfBehandeln: false });
    expect(within(kopf).queryByRole('button', { name: 'Verletzung markieren' })).toBeNull();
  });
});

/**
 * Ohne Netz am UHS-Tablet (LLH-1138, design.md D8, Spec `personen-detail`, „Nachsichtung am
 * Tablet ohne Netz“): jeder Eintrag geht in die Warteschlange statt zu scheitern, am Ort steht
 * „Offline vorgemerkt“. Geladen wird online, dann fällt das Netz weg (`setzeOnline`).
 */
describe('Patientenkopf — ohne Netz am UHS-Tablet (LLH-1138)', () => {
  const TABLET = 41;
  beforeEach(async () => {
    await queueLeerenFuerTests();
    server.use(
      meHandler({
        ...benutzerFixture({ id: TABLET, anzeigename: 'UHS Nord · Tablet 1' }),
        geraet: {
          kopplung_id: 3,
          einsatz_id: 1,
          ansicht: 'uhs-tablet',
          uhs_id: 3,
          stelle: 'UHS Nord',
          bezeichnung: 'Tablet 1',
          laeuft_ab_at: '2026-10-08 12:00:00',
        },
      }),
      http.get('/api/einsaetze/1/personen/bestaetiger', () =>
        HttpResponse.json([{ id: 5, name: 'Dr. A. Muster', funktion: 'Notärztin' }]),
      ),
    );
  });
  afterEach(() => setzeOnline(true));

  /** Wartet auf die Gerätesitzung: „Bestätigt von“ erscheint im Sichtungspaneel erst mit ihr. */
  async function sitzungAbwarten(kopf: HTMLElement) {
    await userEvent.click(within(kopf).getByRole('button', { name: /^Nachsichten/ }));
    const paneel = screen.getByRole('region', { name: 'Sichtung erfassen' });
    await within(paneel).findByRole('combobox', { name: 'Bestätigt von' });
    await userEvent.click(within(paneel).getByRole('button', { name: 'Abbrechen' }));
  }

  /** Öffnet ein Paneel bei stehender Gerätesitzung und nimmt dann das Netz weg. */
  async function paneelOhneNetz(kopf: HTMLElement, knopf: RegExp | string, region: string) {
    await sitzungAbwarten(kopf);
    await userEvent.click(within(kopf).getByRole('button', { name: knopf }));
    const paneel = screen.getByRole('region', { name: region });
    setzeOnline(false);
    return paneel;
  }

  async function vorgemerkt() {
    return (await schreibaktionenLaden(TABLET, 1)).map((z) => z.aktion);
  }

  it('Nachsichtung: steht im Kopf „Offline vorgemerkt“, mit „Bestätigt von“ in der Warteschlange', async () => {
    const user = userEvent.setup();
    const { kopf, onGeschrieben } = zeige();
    const paneel = await paneelOhneNetz(kopf, /^Nachsichten/, 'Sichtung erfassen');
    await user.click(within(paneel).getByRole('radio', { name: /^SK I,/ }));
    await user.click(within(paneel).getByRole('combobox', { name: 'Bestätigt von' }));
    await user.click(await screen.findByTitle('Dr. A. Muster · Notärztin'));
    await user.click(within(paneel).getByRole('button', { name: 'Übernehmen' }));

    const quittung = await within(kopf).findByRole('region', { name: 'Offline vorgemerkt' });
    expect(quittung).toHaveTextContent('Sichtung SK I');
    expect(gesendet).toEqual([]);
    expect(onGeschrieben).not.toHaveBeenCalled();
    // Der Kopf zeigt weiter den Serverstand, das Vorgemerkte steht daneben.
    expect(within(kopf).getByRole('button', { name: /^Nachsichten, aktuell SK II/ })).toBeVisible();
    expect(await vorgemerkt()).toEqual([
      {
        art: 'sichtung',
        person_id: 10,
        bezeichnung: 'R-012',
        daten: {
          kategorie: 'sk1',
          notiz: null,
          bestaetigt_personal_id: 5,
          client_id: expect.any(String),
          zeitpunkt_at: expect.stringMatching(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/),
        },
      },
    ]);
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Sichtung erfassen' })).toBeNull(),
    );
  });

  it('Verbleib, Transport und Maßnahme: je vorgemerkt und im Kopf quittiert', async () => {
    const user = userEvent.setup();
    const { kopf } = zeige();

    let paneel = await paneelOhneNetz(kopf, 'Verbleib erfassen', 'Verbleib erfassen');
    await user.click(within(paneel).getByRole('combobox', { name: 'Art' }));
    await user.click(await screen.findByTitle('Transport'));
    await user.type(within(paneel).getByLabelText('Ziel'), 'KH Mitte');
    await user.click(within(paneel).getByRole('button', { name: 'Verbleib erfassen' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Verbleib erfassen' })).toBeNull(),
    );

    setzeOnline(true);
    paneel = await paneelOhneNetz(kopf, 'Transport festlegen', 'Transport festlegen');
    await user.click(within(paneel).getByRole('radio', { name: 'dringlich' }));
    await user.click(within(paneel).getByRole('button', { name: 'Transport festlegen' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Transport festlegen' })).toBeNull(),
    );

    setzeOnline(true);
    paneel = await paneelOhneNetz(kopf, 'Maßnahme erfassen', 'Maßnahme erfassen');
    await user.click(within(paneel).getByRole('radio', { name: 'Zugang' }));
    await user.click(within(paneel).getByRole('button', { name: 'Maßnahme erfassen' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Maßnahme erfassen' })).toBeNull(),
    );

    const quittung = within(kopf).getByRole('region', { name: 'Offline vorgemerkt' });
    await waitFor(() => expect(within(quittung).getAllByRole('listitem')).toHaveLength(3));
    expect(quittung).toHaveTextContent('Verbleib Transport → KH Mitte');
    expect(quittung).toHaveTextContent('Transport dringlich');
    expect(quittung).toHaveTextContent('Maßnahme Zugang');
    expect(gesendet).toEqual([]);
    expect((await vorgemerkt()).map((a) => a.art)).toEqual(['verbleib', 'transport', 'massnahme']);
  });

  it('Maßnahme aufheben bleibt ohne Netz mit Grund gesperrt', async () => {
    const { kopf } = zeige(vollerKern);
    const paneel = await paneelOhneNetz(kopf, 'Maßnahme erfassen', 'Maßnahme erfassen');
    expect(await within(paneel).findByText('Aufheben ohne Netz nicht möglich')).toBeVisible();
    expect(
      within(paneel).getByRole('button', { name: /^Maßnahme Blutstillung .* aufheben$/ }),
    ).toBeDisabled();
  });

  it('Verletzung: markiert ohne Netz mit zwei Tipps und merkt vor', async () => {
    const user = userEvent.setup();
    const { kopf } = zeige();
    const paneel = await paneelOhneNetz(kopf, 'Verletzung markieren', 'Verletzung markieren');
    await user.click(within(paneel).getByRole('button', { name: 'Kopf, vorn' }));
    await user.click(within(paneel).getByRole('radio', { name: 'Wunde/Blutung' }));

    const quittung = await within(kopf).findByRole('region', { name: 'Offline vorgemerkt' });
    expect(quittung).toHaveTextContent('Verletzung Kopf, vorn · Wunde/Blutung');
    expect(gesendet).toEqual([]);
    expect(await vorgemerkt()).toEqual([
      expect.objectContaining({
        art: 'verletzung',
        daten: expect.objectContaining({ ansicht: 'vorn', region: 'kopf', art: 'wunde_blutung' }),
      }),
    ]);
  });

  it('Notiz: die Zeile quittiert „Offline vorgemerkt“ mit dem Text und leert sich', async () => {
    const user = userEvent.setup();
    const { kopf } = zeige();
    await sitzungAbwarten(kopf);
    setzeOnline(false);
    await user.type(screen.getByRole('textbox', { name: 'Verlaufsnotiz' }), 'Infusion läuft');
    await user.click(screen.getByRole('button', { name: 'Notiz anlegen' }));

    const zeile = kopf.querySelector<HTMLElement>('[data-lfh="notiz-zeile"]')!;
    expect(await within(zeile).findByText(/Offline vorgemerkt/)).toBeVisible();
    expect(zeile).toHaveTextContent('Infusion läuft');
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Verlaufsnotiz' })).toHaveValue(''),
    );
    expect(gesendet).toEqual([]);
    expect(await vorgemerkt()).toEqual([
      expect.objectContaining({
        art: 'notiz',
        daten: expect.objectContaining({ text: 'Infusion läuft' }),
      }),
    ]);
  });
});

/**
 * Befunde aus dem Review des PAT-Kerns (Change `y18v58dt-pat-kern`): Verletzungsliste mit
 * Uhrzeit und jüngste zuerst, geräumte Gründe beim Öffnen (LFH-1077), Sperre ohne Verbindung
 * auch bei erreichbarem WLAN ohne Server (`useOhneVerbindung`).
 */
describe('Patientenkopf — Review PAT-Kern', () => {
  beforeEach(() => {
    server.use(
      http.post('/api/einsaetze/1/personen/10/massnahmen/:mid/aufheben', ({ params }) => {
        gesendet.push({ pfad: `massnahmen/${String(params.mid)}/aufheben`, body: null });
        return HttpResponse.json({ id: Number(params.mid) });
      }),
    );
  });
  afterEach(() => {
    verbindungZuruecksetzenFuerTests();
  });

  it('räumt den Grund eines gescheiterten Aufhebens beim neuen Öffnen des Paneels', async () => {
    server.use(
      http.post('/api/einsaetze/1/personen/10/massnahmen/:mid/aufheben', () =>
        HttpResponse.json({ error: 'Maßnahme ist bereits aufgehoben' }, { status: 409 }),
      ),
    );
    const { kopf } = zeige(vollerKern);
    const knopf = within(kopf).getByRole('button', { name: 'Maßnahme erfassen' });
    await userEvent.click(knopf);
    let paneel = screen.getByRole('region', { name: 'Maßnahme erfassen' });
    await userEvent.click(
      within(paneel).getByRole('button', { name: /^Maßnahme Blutstillung .* aufheben$/ }),
    );
    const rueckfrage = await screen.findByRole('tooltip');
    await userEvent.click(within(rueckfrage).getByRole('button', { name: 'Maßnahme aufheben' }));
    expect(await within(paneel).findByText(/bereits aufgehoben/)).toBeVisible();
    // Schließen (Auslöser im Kopf) und wieder öffnen: der alte Grund steht nicht mehr.
    await userEvent.click(knopf);
    await userEvent.click(knopf);
    paneel = screen.getByRole('region', { name: 'Maßnahme erfassen' });
    expect(within(paneel).queryByText(/bereits aufgehoben/)).toBeNull();
  });

  it('zeigt die Verletzungen jüngste zuerst, mit Nummer und Uhrzeit', () => {
    const { kopf } = zeige(
      {
        ...vollerKern,
        verletzungen: [
          {
            ...verletzung(1, 'unterarm_l', 'fraktur_verdacht'),
            zeitpunkt_at: '2026-10-18 09:10:00',
          },
          { ...verletzung(2, 'kopf', 'wunde_blutung', true), zeitpunkt_at: '2026-10-18 09:20:00' },
          {
            ...verletzung(3, 'thorax', 'prellung_schwellung'),
            zeitpunkt_at: '2026-10-18 09:30:00',
          },
          {
            ...verletzung(4, 'ruecken', 'schmerz', false, 'hinten'),
            zeitpunkt_at: '2026-10-18 09:40:00',
          },
          { ...verletzung(5, 'fuss_r', 'verbrennung'), zeitpunkt_at: '2026-10-18 09:50:00' },
        ],
      },
      { darfSchreiben: false },
    );
    const liste = within(kopf).getByRole('list', { name: 'Verletzungen' });
    expect(
      within(liste)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      '5 Fuß rechts, vorn · Verbrennung · 1150',
      '4 Rücken, hinten · Schmerz · 1140',
      '3 Thorax, vorn · Prellung/Schwellung · 1130',
    ]);
    expect(within(kopf).getByText('+ 1 weitere')).toBeInTheDocument();
  });

  it('sperrt Aufheben, PAT-Nummer und Kontamination auch, wenn nur der Server fehlt', async () => {
    const { kopf } = zeige(vollerKern);
    // Das Gerät hat ein Netz (`navigator.onLine`), aber der Server antwortet nicht.
    act(() => meldeServerErreichbar(false));
    expect(within(kopf).queryByRole('button', { name: /PAT-Nummer/ })).toBeNull();
    expect(within(kopf).getByText(PAT_OHNE_NETZ)).toBeInTheDocument();
    await userEvent.click(within(kopf).getByRole('button', { name: 'Maßnahme erfassen' }));
    const paneel = screen.getByRole('region', { name: 'Maßnahme erfassen' });
    expect(
      within(paneel).getByRole('button', { name: /^Maßnahme Blutstillung .* aufheben$/ }),
    ).toBeDisabled();
    expect(within(paneel).getByText(AUFHEBEN_OHNE_NETZ)).toBeVisible();
  });
});

/**
 * Grenzen im Kopf (LLH-1329): Notizzeile und „Zustand / Verdacht“ zählen ab 80 % wie der Server,
 * kürzen nie, und ein Text über der Grenze geht nicht hinaus, auch nicht in die Warteschlange.
 * Mutationsprobe: `zeichenRegel` an der Notizzeile bzw. `max` am Zustand entfernt → der zu lange
 * Text geht hinaus und der Fall wird rot.
 */
describe('Patientenkopf — Grenzen der Freitexte (LLH-1329)', () => {
  it('die Notizzeile zählt, sperrt über der Grenze und kürzt nicht', async () => {
    const { onGeschrieben } = zeige();
    const feld = screen.getByRole('textbox', { name: 'Verlaufsnotiz' });
    fireEvent.change(feld, { target: { value: 'x'.repeat(VERLAUFSNOTIZ_MAX + 1) } });
    expect(screen.getByText('2.001 / 2.000 · zu lang')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Notiz anlegen' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(gesendet).toEqual([]);
    expect(onGeschrieben).not.toHaveBeenCalled();
    expect(feld).toHaveValue('x'.repeat(VERLAUFSNOTIZ_MAX + 1));

    fireEvent.change(feld, { target: { value: 'x'.repeat(VERLAUFSNOTIZ_MAX) } });
    expect(screen.getByText('2.000 / 2.000')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Notiz anlegen' }));
    await waitFor(() => expect(gesendet).toHaveLength(1));
  });

  it('„Zustand / Verdacht“ zählt, sperrt über der Grenze und kürzt nicht', async () => {
    const patches: unknown[] = [];
    server.use(
      http.patch('/api/einsaetze/1/personen/10', async ({ request }) => {
        patches.push(await request.json());
        return HttpResponse.json({ ...basis });
      }),
    );
    const { kopf } = zeige({ zustand: null });
    await userEvent.click(
      within(kopf).getByRole('button', { name: /^Zustand \/ Verdacht zu R-012 hinzufügen$/ }),
    );
    const zelle = kopf.querySelector<HTMLElement>('[data-lfh="zustand-zelle"]')!;
    const feld = within(zelle).getByRole('textbox');
    const lang = 'x'.repeat(PERSON_ZUSTAND_MAX + 1);
    // Eingefügt statt getippt: die Zelle liest den Entwurf aus den Eingabe-Ereignissen.
    await userEvent.click(feld);
    await userEvent.paste(lang);
    expect(within(zelle).getByText('501 / 500 · zu lang')).toBeInTheDocument();
    fireEvent.blur(feld);
    fireEvent.keyDown(feld, { key: 'Enter' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(patches).toEqual([]);
    expect(within(zelle).getByRole('textbox')).toHaveValue(lang);
  });
});

/**
 * „Zustand / Verdacht“ ohne Netz (LLH-1103, design.md D8, Spec `personendaten-bearbeiten`, „Ohne
 * Netz gesperrt“): gesperrt mit sichtbarem Grund am Feld, im einen Wortlaut aller Gründe ohne
 * Netz. Bisher pausierte die Änderung still und überschriebe nach der Rückkehr einen ungesehenen
 * Wert. Ein schon getippter Entwurf bleibt dabei stehen.
 */
describe('Patientenkopf — Zustand / Verdacht ohne Netz (LLH-1103)', () => {
  it('sperrt den Zustand ohne Netz und nennt den Grund am Feld', async () => {
    const { kopf } = zeige({ zustand: 'gehfähig' });
    setzeOnline(false);
    try {
      // Mutationsprobe: Sperre entfernt — der Knopf bleibt bedienbar, rot.
      const knopf = within(kopf).getByRole('button', {
        name: 'Zustand / Verdacht zu R-012 bearbeiten',
      });
      await waitFor(() => expect(knopf).toBeDisabled());
      const zelle = kopf.querySelector<HTMLElement>('[data-lfh="zustand-zelle"]')!;
      expect(within(zelle).getByText(OHNE_VERBINDUNG_NICHT_AENDERBAR)).toBeVisible();
      expect(knopf).toHaveAccessibleDescription(`gehfähig ${OHNE_VERBINDUNG_NICHT_AENDERBAR}`);
    } finally {
      setzeOnline(true);
    }
  });

  it('ein getippter Entwurf bleibt ohne Netz stehen und geht erst mit Netz hinaus', async () => {
    const patches: unknown[] = [];
    server.use(
      http.patch('/api/einsaetze/1/personen/10', async ({ request }) => {
        patches.push(await request.json());
        return HttpResponse.json({ ...basis, zustand: 'Atemnot' });
      }),
    );
    const { kopf } = zeige({ zustand: null });
    await userEvent.click(
      within(kopf).getByRole('button', { name: 'Zustand / Verdacht zu R-012 hinzufügen' }),
    );
    const zelle = kopf.querySelector<HTMLElement>('[data-lfh="zustand-zelle"]')!;
    await userEvent.type(within(zelle).getByRole('textbox'), 'Atemnot');
    setzeOnline(false);
    try {
      // Mutationsprobe: ohne Netz wieder gegen den Textknoten tauschen — der Entwurf ist weg, rot.
      expect(await within(zelle).findByText(OHNE_VERBINDUNG_NICHT_AENDERBAR)).toBeVisible();
      const feld = within(zelle).getByRole('textbox');
      expect(feld).toHaveValue('Atemnot');
      fireEvent.blur(feld);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
      expect(within(zelle).getByRole('textbox')).toHaveValue('Atemnot');
    } finally {
      setzeOnline(true);
    }
    // Mutationsprobe: das Senden ohne Netz nicht sperren — die pausierte Mutation holt nach der
    // Rückkehr still nach, rot.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(patches).toEqual([]);
    fireEvent.blur(within(zelle).getByRole('textbox'));
    await waitFor(() => expect(patches).toEqual([{ zustand: 'Atemnot' }]));
  });

  it('mit Netz bleibt er schreibbar, ohne Grund', () => {
    const { kopf } = zeige({ zustand: 'gehfähig' });
    expect(
      within(kopf).getByRole('button', { name: 'Zustand / Verdacht zu R-012 bearbeiten' }),
    ).toBeEnabled();
    expect(within(kopf).queryByText(OHNE_VERBINDUNG_NICHT_AENDERBAR)).toBeNull();
  });
});
