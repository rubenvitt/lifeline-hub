import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersonDetail } from '../api/types';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import Patientenkopf from './Patientenkopf';

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
    expect(gesendet).toEqual([{ pfad: 'sichtung', body: { kategorie: 'sk1', notiz: null } }]);
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
    expect(gesendet).toEqual([{ pfad: 'notizen', body: { text: 'Infusion läuft' } }]);
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
