import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import { mitProzessZone } from '../test/prozessZone';
import { ApiError } from '../api/client';
import type { Betreuungsstelle, Evakuierungsbezirk } from '../api/types';
import { alsOrtszeit } from '../anzeige/zeitEingabe';
import { renderMitProviders } from '../test/utils';
import { server } from '../test/server';
import { tippeZeit } from '../test/zeitEingabe';
import { merkeServerzeit, serveruhrVergessenFuerTests } from '../offline/serveruhr';
import {
  BelegungMeldenDialog,
  BezirkAnlegenDialog,
  RaeumungDialog,
  StandMeldenDialog,
  StelleAnlegenDialog,
  StelleSchliessenDialog,
  StornierenDialog,
  belegungBody,
  bezirkPatch,
  bezirkPatchDreiseitig,
  standBody,
  stellePatch,
  stellePatchDreiseitig,
} from './BetreuungDialoge';

dayjs.extend(utc);

// MapLibre läuft in jsdom nicht; der Ausschnitt hat eigene Tests (`anzeige/Kartenausschnitt.test.tsx`).
vi.mock('../anzeige/Kartenausschnitt', () => ({
  Kartenausschnitt: ({
    punkt,
    etikett,
  }: {
    punkt: { lat: number; lon: number } | null;
    etikett: string;
  }) => (
    <div role="group" aria-label={`Karte: ${etikett}`}>
      {punkt && `${punkt.lat},${punkt.lon}`}
    </div>
  ),
}));

/** Einsatzkopf (Umgebung „Auf Karte wählen“), Ort-Zeile und Ortssuche der Ortsfelder (LLH-1121). */
beforeEach(() => {
  server.use(
    http.get('/api/einsaetze/1', () =>
      HttpResponse.json({ id: 1, einsatzort_lat: 52.1, einsatzort_lon: 8.6 }),
    ),
    http.get('/api/einsaetze/1/ort-vorschau', () =>
      HttpResponse.json({ ortsname: null, peilung: null }),
    ),
    http.get('/api/einsaetze/1/ort-suche', () =>
      HttpResponse.json({
        zustand: 'ok',
        treffer: [
          {
            name: 'Sportplatzweg 3, 12345 Musterstadt',
            kurz: 'Sportplatzweg 3',
            lat: 52.3,
            lon: 9.7,
          },
        ],
      }),
    ),
  );
});

/** Ortsfeld-Wert aus reinem Text (ohne Koordinate). */
const ort = (text: string) => ({ text, koordinate: null });

const bezirk = (over: Partial<Evakuierungsbezirk> = {}): Evakuierungsbezirk => ({
  id: 5,
  einsatz_id: 1,
  bezeichnung: 'Uferstraße 12–40',
  plan_personen: 640,
  plan_erhebung: 'geschaetzt',
  flaechen: 0,
  raeumung: 'angeordnet',
  angelegt_at: '2026-09-23 08:00:00',
  ...over,
});

const stelle = (over: Partial<Betreuungsstelle> = {}): Betreuungsstelle => ({
  id: 8,
  einsatz_id: 1,
  bezeichnung: 'Turnhalle Ost',
  art: 'notunterkunft',
  status: 'in_betrieb',
  kapazitaet_personen: 150,
  angelegt_at: '2026-09-23 08:00:00',
  ...over,
});

const ABSCHNITTE = [{ value: 3, label: 'Deichwache Nord' }];

/**
 * Zählt die BEDIENBAREN Felder: die Rollenabfrage blendet den eingeklappten Bereich aus
 * (`forceRender` hält ihn im DOM, `display: none` am Element).
 */
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

async function budgetUndAufklappen(dialog: HTMLElement, sichtbar: number) {
  expect(sichtbareFelder(dialog)).toBe(sichtbar);
  await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
  // Die zweite Hälfte: ohne sie wäre „≤ 3" auch mit einem Collapse ohne forceRender grün.
  await waitFor(() => expect(sichtbareFelder(dialog)).toBeGreaterThan(sichtbar));
}

/** Radio-Knöpfe in Knopfform: das `<input>` trägt `pointer-events: none`, geklickt wird das Etikett. */
async function waehle(dialog: HTMLElement, name: string) {
  await userEvent.click(within(dialog).getByRole('radio', { name }).closest('label')!);
}

/** Struktur, aus der „Enter sendet" folgt (Erfassungs-Norm B4). */
function pruefeFormStruktur(dialog: HTMLElement, knopfName: string) {
  const knopf = within(dialog).getByRole('button', { name: knopfName });
  expect(knopf.closest('form')).not.toBeNull();
  expect(dialog.querySelector('.ant-modal-footer')).toBeNull();
  return knopf;
}

describe('Wire-Werte der Meldungen (design.md D2)', () => {
  it('Zeitpunkt geht als UTC ohne Zone hinaus — gegen den absoluten Zeitpunkt, beidseits DST', () => {
    for (const absolut of [
      '2026-03-29T00:30:00Z', // vor der Umstellung auf Sommerzeit
      '2026-03-29T01:30:00Z', // danach
      '2026-08-21T06:00:00Z', // Sommer: zwei Stunden Versatz in Berlin
      '2026-10-25T01:30:00Z', // nach der Rückstellung
    ]) {
      const ortszeit = dayjs(absolut); // ein dayjs in ORTSzeit — so liefert ihn der DatePicker
      const body = standBody({ evakuiert: 480, erhebung: 'gezaehlt', zeitpunkt: ortszeit });
      expect(body.zeitpunkt_at, absolut).toBe(dayjs.utc(absolut).format('YYYY-MM-DD HH:mm:ss'));
      // Und zurück über die Umkehr, nie über `dayjs(s)`: derselbe absolute Zeitpunkt.
      expect(alsOrtszeit(body.zeitpunkt_at)!.valueOf(), absolut).toBe(dayjs(absolut).valueOf());
      expect(belegungBody({ belegt: 12, zeitpunkt: ortszeit }).zeitpunkt_at).toBe(
        body.zeitpunkt_at,
      );
    }
  });

  it('ohne Zeitpunkt fehlt der Schlüssel — „jetzt" entscheidet der Server, nicht die Client-Uhr', () => {
    expect(standBody({ evakuiert: 0, erhebung: 'geschaetzt' })).toStrictEqual({
      evakuiert: 0,
      erhebung: 'geschaetzt',
    });
    expect(belegungBody({ belegt: 0, zeitpunkt: null })).toStrictEqual({ belegt: 0 });
  });
});

describe('PATCH nur mit geänderten Schlüsseln', () => {
  it('Bezirk: unverändert → leer; geleerte Freitexte → null nur, wenn vorher belegt', () => {
    const b = bezirk({ sammelstelle: 'Schulhof', notiz: undefined, abschnitt_id: 3 });
    expect(
      bezirkPatch(b, {
        bezeichnung: 'Uferstraße 12–40',
        plan_personen: 640,
        plan_erhebung: 'geschaetzt',
        abschnitt_id: 3,
        sammelstelle: ort('Schulhof'),
        notiz: '',
      }),
    ).toStrictEqual({});
    expect(
      bezirkPatch(b, {
        bezeichnung: ' Uferstraße 12–40 ',
        plan_personen: 820,
        plan_erhebung: 'gezaehlt',
        abschnitt_id: undefined,
        sammelstelle: ort('  '),
        notiz: 'Zufahrt über Nordtor',
      }),
    ).toStrictEqual({
      plan_personen: 820,
      plan_erhebung: 'gezaehlt',
      abschnitt_id: null,
      sammelstelle: null,
      notiz: 'Zufahrt über Nordtor',
    });
  });

  it('Stelle: Kapazität leeren heißt null („keine Kapazität"), Status nur bei Wechsel', () => {
    const s = stelle();
    expect(
      stellePatch(s, {
        status: 'in_betrieb',
        kapazitaet_personen: null,
        art: 'notunterkunft',
        bezeichnung: 'Turnhalle Ost',
      }),
    ).toStrictEqual({ kapazitaet_personen: null });
    expect(
      stellePatch(stelle({ kapazitaet_personen: undefined }), {
        status: 'geschlossen',
        kapazitaet_personen: undefined,
        art: 'notunterkunft',
        bezeichnung: 'Turnhalle Ost',
        standort: ort(''),
      }),
    ).toStrictEqual({ status: 'geschlossen' });
  });

  it('LLH-1044: Leitung und Kontaktweg getrimmt, geleert → null nur mit Vorwert, fehlend unberührt', () => {
    const basis = {
      art: 'notunterkunft' as const,
      bezeichnung: 'Turnhalle Ost',
      kapazitaet_personen: 150,
    };
    const mitLeitung = stelle({ leitung: 'Frau Schulz', kontaktweg: 'Kanal 3' });
    expect(stellePatch(stelle(), { ...basis, leitung: ' Herr Ott ', kontaktweg: '' })).toEqual({
      leitung: 'Herr Ott',
    });
    expect(stellePatch(mitLeitung, { ...basis, leitung: '  ', kontaktweg: 'Kanal 3' })).toEqual({
      leitung: null,
    });
    // Ein Formular ohne die Felder (Schlüssel fehlt) lässt sie stehen.
    expect(stellePatch(mitLeitung, basis)).toEqual({});
  });
});

describe('StandMeldenDialog', () => {
  it('zwei Felder sichtbar, Zeitpunkt eingeklappt; Knopf im <form>; sendet die Anzahl', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    const onSchliessen = vi.fn();
    renderMitProviders(
      <StandMeldenDialog
        bezirk={bezirk()}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={onSchliessen}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Stand melden: Uferstraße 12–40' });
    await budgetUndAufklappen(dialog, 2);
    // Der wirksame Wert eines leeren Zeitfelds steht als Platzhalter, nicht als Erklärsatz.
    expect(within(dialog).getByLabelText('Zeitpunkt')).toHaveAttribute('placeholder', 'jetzt');
    const knopf = pruefeFormStruktur(dialog, 'Melden');
    await userEvent.type(within(dialog).getByLabelText('Evakuiert gesamt (Personen)'), '480');
    await userEvent.click(knopf);
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({ evakuiert: 480, erhebung: 'gezaehlt' }),
    );
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
  });

  it('eine Ablehnung (422) lässt die Felder stehen und zeigt den Grund im Dialog', async () => {
    const fehler = new ApiError(422, 'Bezirk ist storniert');
    const onErfassen = vi.fn().mockRejectedValue(fehler);
    const onSchliessen = vi.fn();
    const { rerender } = renderMitProviders(
      <StandMeldenDialog
        bezirk={bezirk()}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={onSchliessen}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    const feld = within(dialog).getByLabelText('Evakuiert gesamt (Personen)');
    await userEvent.type(feld, '480');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Melden' }));
    await waitFor(() => expect(onErfassen).toHaveBeenCalled());
    rerender(
      <StandMeldenDialog
        bezirk={bezirk()}
        laeuft={false}
        fehler={fehler}
        onErfassen={onErfassen}
        onSchliessen={onSchliessen}
      />,
    );
    expect(await within(dialog).findByText('Bezirk ist storniert')).toBeInTheDocument();
    expect(feld).toHaveValue('480');
    expect(onSchliessen).not.toHaveBeenCalled();
  });
});

describe('BelegungMeldenDialog', () => {
  it('ein Feld sichtbar, Zeitpunkt eingeklappt; sendet die Belegung', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <BelegungMeldenDialog
        stelle={stelle()}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Belegung melden: Turnhalle Ost',
    });
    await budgetUndAufklappen(dialog, 1);
    const knopf = pruefeFormStruktur(dialog, 'Melden');
    await userEvent.type(within(dialog).getByLabelText('Belegt gesamt (Personen)'), '89');
    await userEvent.click(knopf);
    await waitFor(() => expect(onErfassen).toHaveBeenCalledWith({ belegt: 89 }));
  });
});

describe('Obergrenze der Personenzahlen (LFH-680)', () => {
  it('Belegung über 1 000 000: Grund am Feld, nichts gesendet, der Wert bleibt stehen', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <BelegungMeldenDialog
        stelle={stelle()}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Belegung melden: Turnhalle Ost',
    });
    const feld = within(dialog).getByLabelText('Belegt gesamt (Personen)');
    await userEvent.type(feld, '1000001');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Melden' }));
    expect(await within(dialog).findByText(/Höchstens 1\s000\s000 Personen/)).toBeInTheDocument();
    // Kein `max` am InputNumber: das klemmte beim Verlassen still auf 1 000 000; eine Personenzahl,
    // die sich still ändert, wäre schlimmer als die Ablehnung.
    expect(feld).toHaveValue('1000001');
    expect(onErfassen).not.toHaveBeenCalled();
  });

  it('die Grenze selbst geht durch; Kapazität hat dieselbe Grenze', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <StelleAnlegenDialog
        einsatzId={1}
        abschnitte={ABSCHNITTE}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Betreuungsstelle anlegen' });
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Messehalle');
    const kapazitaet = within(dialog).getByLabelText('Kapazität (Personen)');
    await userEvent.type(kapazitaet, '1000001');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    expect(await within(dialog).findByText(/Höchstens 1\s000\s000 Personen/)).toBeInTheDocument();
    expect(onErfassen).not.toHaveBeenCalled();
    await userEvent.clear(kapazitaet);
    await userEvent.type(kapazitaet, '1000000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({
        bezeichnung: 'Messehalle',
        art: 'betreuungsstelle',
        kapazitaet_personen: 1000000,
      }),
    );
  });
});

describe('BezirkAnlegenDialog', () => {
  it('Bezeichnung, Plangröße, Erhebung und Gebiet sichtbar; Abschnitt, Sammelstelle, Notiz eingeklappt', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <BezirkAnlegenDialog
        einsatzId={1}
        abschnitte={ABSCHNITTE}
        karteGesperrt={false}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Evakuierungsbezirk anlegen' });
    // Drei Angaben plus die Gebietswahl (LLH-1069): sie ist der nächste Schritt, kein Datenfeld,
    // und steht nach der Erfassungs-Norm sichtbar; der Rest bleibt eingeklappt.
    await budgetUndAufklappen(dialog, 4);
    expect(sichtbareFelder(dialog)).toBe(7);
    const knopf = pruefeFormStruktur(dialog, 'Anlegen');
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Uferstraße 12–40');
    await userEvent.type(within(dialog).getByLabelText('Plangröße (Personen)'), '640');
    // Getippte Koordinate: das Ortsfeld erkennt sie (LLH-1121), die Sammelstelle ist verortet.
    await userEvent.type(within(dialog).getByLabelText('Sammelstelle'), '52.512, 13.401');
    await userEvent.click(knopf);
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith(
        {
          bezeichnung: 'Uferstraße 12–40',
          plan_personen: 640,
          plan_erhebung: 'geschaetzt',
          sammelstelle: '52.512, 13.401',
          sammelstelle_lat: 52.512,
          sammelstelle_lon: 13.401,
        },
        { wahl: 'flaeche' },
      ),
    );
  });

  it('Gebiet: Vorgabe „Fläche zeichnen“ bei freier Lagekarte, „Keins“ wählbar (LLH-1069)', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <BezirkAnlegenDialog
        einsatzId={1}
        abschnitte={ABSCHNITTE}
        karteGesperrt={false}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Evakuierungsbezirk anlegen' });
    const gruppe = within(dialog).getByRole('radiogroup', { name: 'Gebiet auf der Lagekarte' });
    expect(within(gruppe).getByRole('radio', { name: 'Fläche zeichnen' })).toBeChecked();
    // Keins · Fläche zeichnen · Radius (LLH-1346); ohne „Radius“ kein Radiusfeld.
    expect(within(gruppe).getAllByRole('radio')).toHaveLength(3);
    expect(within(dialog).queryByRole('spinbutton', { name: 'Radius in Metern' })).toBeNull();
    await userEvent.click(within(gruppe).getByRole('radio', { name: 'Keins' }));
    expect(within(gruppe).getByRole('radio', { name: 'Keins' })).toBeChecked();
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Deichweg');
    await userEvent.type(within(dialog).getByLabelText('Plangröße (Personen)'), '12');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith(
        { bezeichnung: 'Deichweg', plan_personen: 12, plan_erhebung: 'geschaetzt' },
        { wahl: 'keins' },
      ),
    );
  });

  it('Lagekarte gesperrt: Vorgabe „Keins“, „Fläche zeichnen“ gesperrt mit sichtbarem Grund (LFH-888)', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <BezirkAnlegenDialog
        einsatzId={1}
        abschnitte={ABSCHNITTE}
        karteGesperrt
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Evakuierungsbezirk anlegen' });
    const gruppe = within(dialog).getByRole('radiogroup', { name: 'Gebiet auf der Lagekarte' });
    expect(within(gruppe).getByRole('radio', { name: 'Keins' })).toBeChecked();
    const flaeche = within(gruppe).getByRole('radio', {
      name: 'Fläche zeichnen (Keine Berechtigung)',
    });
    expect(flaeche).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(flaeche);
    expect(flaeche).not.toBeChecked();
    expect(
      within(gruppe).getByRole('radio', { name: 'Radius (Keine Berechtigung)' }),
    ).toHaveAttribute('aria-disabled', 'true');
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Deichweg');
    await userEvent.type(within(dialog).getByLabelText('Plangröße (Personen)'), '12');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith(expect.anything(), { wahl: 'keins' }),
    );
  });

  it('Gebiet „Radius“ (LLH-1346): Radius Pflicht, Schnellwahl 500 m, Kreis um den Einsatzort', async () => {
    // Einsatzort 52.1, 8.6 aus dem Einsatzkopf (beforeEach).
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <BezirkAnlegenDialog
        einsatzId={1}
        abschnitte={ABSCHNITTE}
        karteGesperrt={false}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Evakuierungsbezirk anlegen' });
    const gruppe = within(dialog).getByRole('radiogroup', { name: 'Gebiet auf der Lagekarte' });
    await userEvent.click(within(gruppe).getByRole('radio', { name: 'Radius' }));
    expect(await within(dialog).findByText('Radius um den Einsatzort')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Deichweg');
    await userEvent.type(within(dialog).getByLabelText('Plangröße (Personen)'), '12');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    expect(await within(dialog).findByText('Bitte einen Radius angeben')).toBeInTheDocument();
    expect(onErfassen).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: '500 m' }));
    expect(within(dialog).getByRole('button', { name: '500 m' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(dialog).getByRole('spinbutton', { name: 'Radius in Metern' })).toHaveValue('500');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith(
        { bezeichnung: 'Deichweg', plan_personen: 12, plan_erhebung: 'geschaetzt' },
        { wahl: 'radius', kreis: { radius: 500, mitte: { lat: 52.1, lon: 8.6 } } },
      ),
    );
  });

  it('Gebiet „Radius“ ohne verorteten Einsatzort: nur der Radius geht mit (LLH-1346)', async () => {
    server.use(
      http.get('/api/einsaetze/1', () =>
        HttpResponse.json({ id: 1, einsatzort_lat: null, einsatzort_lon: null }),
      ),
    );
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <BezirkAnlegenDialog
        einsatzId={1}
        abschnitte={ABSCHNITTE}
        karteGesperrt={false}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Evakuierungsbezirk anlegen' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Radius' }));
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Deichweg');
    await userEvent.type(within(dialog).getByLabelText('Plangröße (Personen)'), '12');
    await userEvent.type(
      within(dialog).getByRole('spinbutton', { name: 'Radius in Metern' }),
      '750',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith(expect.anything(), {
        wahl: 'radius',
        kreis: { radius: 750 },
      }),
    );
  });
});

describe('RaeumungDialog', () => {
  it('ein Feld, vorbelegt mit dem aktuellen Zustand; sendet den neuen', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <RaeumungDialog
        bezirk={bezirk({ raeumung: 'laeuft' })}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Räumung: Uferstraße 12–40' });
    expect(sichtbareFelder(dialog)).toBe(1);
    expect(within(dialog).getByRole('radio', { name: 'läuft' })).toBeChecked();
    await waehle(dialog, 'geräumt');
    await userEvent.click(pruefeFormStruktur(dialog, 'Speichern'));
    await waitFor(() => expect(onErfassen).toHaveBeenCalledWith({ raeumung: 'geraeumt' }));
  });

  const raeumungDialog = (
    b: Evakuierungsbezirk,
    onErfassen: () => Promise<unknown>,
    onSchliessen = () => {},
  ) => (
    <RaeumungDialog
      bezirk={b}
      laeuft={false}
      fehler={null}
      onErfassen={onErfassen}
      onSchliessen={onSchliessen}
    />
  );

  it('LFH-681: unberührt folgt das Radio dem Live-Stand — Speichern dreht einen fremden Wechsel NICHT zurück', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    const onSchliessen = vi.fn();
    const { rerender } = renderMitProviders(
      raeumungDialog(bezirk({ raeumung: 'angeordnet' }), onErfassen, onSchliessen),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Räumung: Uferstraße 12–40' });
    rerender(raeumungDialog(bezirk({ raeumung: 'geraeumt' }), onErfassen, onSchliessen));
    await waitFor(() =>
      expect(within(dialog).getByRole('radio', { name: 'geräumt' })).toBeChecked(),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(onErfassen).not.toHaveBeenCalled();
  });

  it('LFH-681: zurück auf den Stand beim Öffnen, nachdem ein Live-Refetch ihn geändert hat, geht als PATCH raus', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderMitProviders(
      raeumungDialog(bezirk({ raeumung: 'angeordnet' }), onErfassen),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Räumung: Uferstraße 12–40' });
    rerender(raeumungDialog(bezirk({ raeumung: 'laeuft' }), onErfassen));
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: 'läuft' })).toBeChecked());
    await waehle(dialog, 'angeordnet');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onErfassen).toHaveBeenCalledWith({ raeumung: 'angeordnet' }));
  });

  it('LFH-681: eine eigene Wahl bleibt stehen, wenn der Live-Stand wechselt (Gegenstück)', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderMitProviders(
      raeumungDialog(bezirk({ raeumung: 'angeordnet' }), onErfassen),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Räumung: Uferstraße 12–40' });
    await waehle(dialog, 'geräumt');
    rerender(raeumungDialog(bezirk({ raeumung: 'laeuft' }), onErfassen));
    expect(within(dialog).getByRole('radio', { name: 'geräumt' })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onErfassen).toHaveBeenCalledWith({ raeumung: 'geraeumt' }));
  });

  it('LFH-681: steht der gewählte Zustand schon auf dem Server, geht kein PATCH raus', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    const onSchliessen = vi.fn();
    const dialogMit = (b: Evakuierungsbezirk) => (
      <RaeumungDialog
        bezirk={b}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={onSchliessen}
      />
    );
    const { rerender } = renderMitProviders(dialogMit(bezirk({ raeumung: 'angeordnet' })));
    const dialog = await screen.findByRole('dialog', { name: 'Räumung: Uferstraße 12–40' });
    await waehle(dialog, 'geräumt');
    rerender(dialogMit(bezirk({ raeumung: 'geraeumt' })));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(onErfassen).not.toHaveBeenCalled();
  });
});

describe('LFH-681: Mehrfeld-Dialoge vergleichen dreiseitig', () => {
  it('bezirkPatchDreiseitig: nur was die Person geändert hat UND vom aktuellen Stand abweicht', () => {
    const beimOeffnen = bezirk({ notiz: 'Zufahrt Nord', plan_personen: 640 });
    const aktuell = bezirk({ notiz: 'Zufahrt Süd gesperrt', plan_personen: 700 });
    const w = {
      bezeichnung: 'Uferstraße 12–40',
      plan_personen: 820,
      plan_erhebung: 'geschaetzt' as const,
      notiz: 'Zufahrt Nord',
    };
    // Die unberührte Notiz trägt den alten Wert — gegen `aktuell` allein ginge sie raus und
    // überschriebe die fremde Änderung still.
    expect(bezirkPatch(aktuell, w)).toEqual({ plan_personen: 820, notiz: 'Zufahrt Nord' });
    expect(bezirkPatchDreiseitig(beimOeffnen, aktuell, w)).toEqual({ plan_personen: 820 });
    // Geändert, aber fremd schon auf denselben Wert gesetzt → nichts zu senden.
    expect(bezirkPatchDreiseitig(beimOeffnen, bezirk({ plan_personen: 820 }), w)).toEqual({});
  });

  it('stellePatchDreiseitig: eine fremd geleerte Kapazität bleibt leer, ein eigener Wechsel geht raus', () => {
    const beimOeffnen = stelle({ kapazitaet_personen: 150 });
    const aktuell = stelle({ kapazitaet_personen: null });
    const w = {
      bezeichnung: 'Turnhalle Ost',
      art: 'notunterkunft' as const,
      status: 'geschlossen' as const,
      kapazitaet_personen: 150,
    };
    expect(stellePatchDreiseitig(beimOeffnen, aktuell, w)).toEqual({ status: 'geschlossen' });
  });
});

describe('StelleAnlegenDialog', () => {
  it('Bezeichnung, Art, Kapazität sichtbar; der Rest eingeklappt; ohne Kapazität kein Schlüssel', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <StelleAnlegenDialog
        einsatzId={1}
        abschnitte={ABSCHNITTE}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Betreuungsstelle anlegen' });
    await budgetUndAufklappen(dialog, 3);
    expect(within(dialog).getByLabelText('Kapazität (Personen)')).toHaveAttribute(
      'placeholder',
      'keine Angabe',
    );
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Turnhalle Ost');
    await userEvent.click(pruefeFormStruktur(dialog, 'Anlegen'));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({
        bezeichnung: 'Turnhalle Ost',
        art: 'betreuungsstelle',
      }),
    );
  });

  it('LLH-1044: Leitung und Kontakt unter „Weitere Angaben“, getrimmt; über 200 Zeichen gesperrt', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <StelleAnlegenDialog
        einsatzId={1}
        abschnitte={ABSCHNITTE}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Betreuungsstelle anlegen' });
    await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Turnhalle Ost');
    const leitung = within(dialog).getByLabelText('Leitung');
    await userEvent.click(leitung);
    await userEvent.paste('x'.repeat(201));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    expect(
      await within(dialog).findByText('Leitung darf höchstens 200 Zeichen lang sein'),
    ).toBeInTheDocument();
    expect(onErfassen).not.toHaveBeenCalled();

    await userEvent.clear(leitung);
    await userEvent.type(leitung, '  Frau Schulz ');
    await userEvent.type(within(dialog).getByLabelText('Kontakt'), 'Kanal 3');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({
        bezeichnung: 'Turnhalle Ost',
        art: 'betreuungsstelle',
        leitung: 'Frau Schulz',
        kontaktweg: 'Kanal 3',
      }),
    );
  });
});

describe('StelleSchliessenDialog — Schließen einer belegten Stelle (LLH-1044)', () => {
  const belegt = stelle({ belegung: { id: 30, belegt: 40, zeitpunkt_at: '2026-09-23 09:00:00' } });
  const TITEL = 'Betreuungsstelle Turnhalle Ost schließen';

  function dialogMit(
    s: Betreuungsstelle,
    onErfassen: (p: unknown) => Promise<unknown>,
    onLeermeldung: () => Promise<unknown>,
    onSchliessen: () => void = () => {},
  ) {
    return (
      <StelleSchliessenDialog
        stelle={s}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onLeermeldung={onLeermeldung}
        onSchliessen={onSchliessen}
      />
    );
  }

  it('verlangt die Leermeldung als Häkchen; ohne Häkchen wird nichts gesendet', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    const onLeermeldung = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(dialogMit(belegt, onErfassen, onLeermeldung));
    const dialog = await screen.findByRole('dialog', { name: TITEL });
    expect(within(dialog).getByText(/mit 40 Personen belegt/)).toBeInTheDocument();
    const haken = within(dialog).getByRole('checkbox', { name: /Belegung 0 melden/ });
    await userEvent.click(pruefeFormStruktur(dialog, 'Stelle schließen'));
    expect(
      await within(dialog).findByText(/erst nach einer Leermeldung schließen/),
    ).toBeInTheDocument();
    expect(onLeermeldung).not.toHaveBeenCalled();
    expect(onErfassen).not.toHaveBeenCalled();

    await userEvent.click(haken);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stelle schließen' }));
    await waitFor(() => expect(onErfassen).toHaveBeenCalledWith({ status: 'geschlossen' }));
    // Erst die Leermeldung, dann das Schließen — zwei ehrliche Tatsachen.
    expect(onLeermeldung.mock.invocationCallOrder[0]).toBeLessThan(
      onErfassen.mock.invocationCallOrder[0],
    );
  });

  it('scheitert das Schließen, meldet der zweite Versuch die 0 NICHT noch einmal', async () => {
    const onErfassen = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, 'Stelle ist storniert'))
      .mockResolvedValue(undefined);
    const onLeermeldung = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(dialogMit(belegt, onErfassen, onLeermeldung));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Belegung 0/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stelle schließen' }));
    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stelle schließen' }));
    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(2));
    expect(onLeermeldung).toHaveBeenCalledTimes(1);
  });

  it('LFH-681: kommt nach der eigenen Leermeldung eine NEUE Belegung, wird wieder geleert — nicht übersprungen', async () => {
    const onErfassen = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(503, 'Dienst nicht erreichbar'))
      .mockResolvedValue(undefined);
    const onLeermeldung = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderMitProviders(dialogMit(belegt, onErfassen, onLeermeldung));
    const dialog = await screen.findByRole('dialog', { name: TITEL });
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Belegung 0/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stelle schließen' }));
    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    expect(onLeermeldung).toHaveBeenCalledTimes(1);
    // Refetch: die eigene 0 steht da …
    rerender(
      dialogMit(
        stelle({ belegung: { id: 41, belegt: 0, zeitpunkt_at: '2026-09-23 11:00:00' } }),
        onErfassen,
        onLeermeldung,
      ),
    );
    await waitFor(() => expect(within(dialog).queryByRole('checkbox')).toBeNull());
    // … dann meldet jemand anderes 3 Personen.
    rerender(
      dialogMit(
        stelle({ belegung: { id: 42, belegt: 3, zeitpunkt_at: '2026-09-23 11:05:00' } }),
        onErfassen,
        onLeermeldung,
      ),
    );
    const haken = await within(dialog).findByRole('checkbox', { name: /Belegung 0/ });
    if (!(haken as HTMLInputElement).checked) await userEvent.click(haken);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stelle schließen' }));
    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(2));
    expect(onLeermeldung).toHaveBeenCalledTimes(2);
    expect(onLeermeldung.mock.invocationCallOrder[1]).toBeLessThan(
      onErfassen.mock.invocationCallOrder[1],
    );
  });

  it('LFH-681: hat jemand die Stelle inzwischen geschlossen, gibt es weder Leermeldung noch PATCH', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    const onLeermeldung = vi.fn();
    const onSchliessen = vi.fn();
    const { rerender } = renderMitProviders(
      dialogMit(belegt, onErfassen, onLeermeldung, onSchliessen),
    );
    const dialog = await screen.findByRole('dialog', { name: TITEL });
    rerender(
      dialogMit(
        stelle({
          status: 'geschlossen',
          belegung: { id: 33, belegt: 0, zeitpunkt_at: '2026-09-23 11:00:00' },
        }),
        onErfassen,
        onLeermeldung,
        onSchliessen,
      ),
    );
    await waitFor(() => expect(within(dialog).queryByRole('checkbox')).toBeNull());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stelle schließen' }));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(onLeermeldung).not.toHaveBeenCalled();
    expect(onErfassen).not.toHaveBeenCalled();
  });

  it('inzwischen leer gemeldet: schließt ohne Leermeldung', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    const onLeermeldung = vi.fn();
    const { rerender } = renderMitProviders(dialogMit(belegt, onErfassen, onLeermeldung));
    const dialog = await screen.findByRole('dialog', { name: TITEL });
    rerender(
      dialogMit(
        stelle({ belegung: { id: 31, belegt: 0, zeitpunkt_at: '2026-09-23 09:00:00' } }),
        onErfassen,
        onLeermeldung,
      ),
    );
    await waitFor(() => expect(within(dialog).queryByRole('checkbox')).toBeNull());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stelle schließen' }));
    await waitFor(() => expect(onErfassen).toHaveBeenCalledWith({ status: 'geschlossen' }));
    expect(onLeermeldung).not.toHaveBeenCalled();
  });
});

describe('StornierenDialog', () => {
  it('ist ein Modal mit rotem Bestätigungsknopf; Abbrechen sendet nichts', async () => {
    const onBestaetigen = vi.fn();
    const onSchliessen = vi.fn();
    renderMitProviders(
      <StornierenDialog
        titel="Bezirk Uferstraße 12–40 stornieren?"
        text="Nur für Fehlanlagen."
        laeuft={false}
        fehler={null}
        onBestaetigen={onBestaetigen}
        onSchliessen={onSchliessen}
      />,
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Bezirk Uferstraße 12–40 stornieren?',
    });
    const ok = within(dialog).getByRole('button', { name: 'Stornieren' });
    expect(ok).toHaveClass('ant-btn-dangerous');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(onSchliessen).toHaveBeenCalled();
    expect(onBestaetigen).not.toHaveBeenCalled();
    await userEvent.click(ok);
    expect(onBestaetigen).toHaveBeenCalledTimes(1);
  });
});

/**
 * LFH-692 (Spec `zeiteingabe`): Browser auf UTC, Organisation auf Europe/Berlin, es ist 30.09.
 * 23:30 UTC — in Berlin schon der 01.10. 01:30. Eine nachgetragene Meldung von 01:00 Berliner Zeit
 * liegt in der Vergangenheit und auf dem heutigen Berliner Kalendertag.
 */
describe('BelegungMeldenDialog — Zeitpunkt in der Anzeigezone (LFH-692)', () => {
  mitProzessZone('UTC');
  afterEach(() => {
    vi.useRealTimers();
  });

  it('01:00 Berliner Zeit am Berliner „heute“ geht als 23:00 UTC des Vortags hinaus', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-30T23:30:00Z'));
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
        <BelegungMeldenDialog
          stelle={stelle()}
          laeuft={false}
          fehler={null}
          onErfassen={onErfassen}
          onSchliessen={() => {}}
        />
      </AnzeigeKonventionenProvider>,
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    await userEvent.type(within(dialog).getByLabelText('Belegt gesamt (Personen)'), '89');
    const feld = within(dialog).getByRole('textbox', { name: 'Zeitpunkt' });
    await userEvent.click(feld);
    await userEvent.type(feld, '2026-10-01 01:00');
    await userEvent.keyboard('{Enter}');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Melden' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({ belegt: 89, zeitpunkt_at: '2026-09-30 23:00:00' }),
    );
  });
});

/** LFH-895: „Jetzt“ setzt die Serverzeit; die Zukunftsprüfung misst an derselben Uhr. */
describe('Betreuung — „Jetzt“ auf einem nachgehenden Gerät (LFH-895)', () => {
  mitProzessZone('UTC');
  afterEach(() => {
    vi.useRealTimers();
    serveruhrVergessenFuerTests();
  });

  it('die Serverzeit aus „Jetzt“ gilt nicht als Zukunft, auch wenn die Geräteuhr 10 min nachgeht', async () => {
    const server = Date.parse('2026-09-30T10:00:00Z');
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(server - 10 * 60_000);
    serveruhrVergessenFuerTests();
    merkeServerzeit(new Response(null, { headers: { Date: new Date(server).toUTCString() } }));
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <BelegungMeldenDialog
        stelle={stelle()}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    await userEvent.type(within(dialog).getByLabelText('Belegt gesamt (Personen)'), '89');
    // „jetzt“ steht in der Schnellwahl des Kalenders neben dem Zeitfeld.
    await userEvent.click(within(dialog).getByRole('button', { name: /^Kalender und Uhrzeit/ }));
    const kalender = await screen.findByRole('dialog', { name: 'Tag und Uhrzeit wählen' });
    await userEvent.click(within(kalender).getByRole('button', { name: 'jetzt' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Melden' }));
    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    const gesendet = Date.parse(
      `${(onErfassen.mock.calls[0][0] as { zeitpunkt_at: string }).zeitpunkt_at.replace(' ', 'T')}Z`,
    );
    expect(Math.abs(gesendet - server)).toBeLessThanOrEqual(5_000);
  });
});

/**
 * Standort und Sammelstelle über das Ortsfeld (LLH-1121, design.md D2/D3): Text und Koordinate
 * gehen gemeinsam hinaus, das Paar nur bei Änderung; eine gespeicherte Koordinate steht als
 * Kartenpunkt im Feld und überlebt eine Textkorrektur.
 */
describe('Ortsangaben über das Ortsfeld (LLH-1121)', () => {
  const punkt = (text: string, lat: number, lon: number, quelle: 'adresse' | 'karte' = 'adresse') =>
    ({ text, koordinate: { lat, lon }, quelle }) as const;

  it('Bezirk: ein Treffer setzt Text und Paar; eine Textkorrektur am Kartenpunkt schickt kein Paar', () => {
    const basis = {
      bezeichnung: 'Uferstraße 12–40',
      plan_personen: 640,
      plan_erhebung: 'geschaetzt' as const,
    };
    expect(bezirkPatch(bezirk(), { ...basis, sammelstelle: punkt('Schulhof', 52.3, 9.7) })).toEqual(
      { sammelstelle: 'Schulhof', sammelstelle_lat: 52.3, sammelstelle_lon: 9.7 },
    );
    const verortet = bezirk({
      sammelstelle: 'Schulhof',
      sammelstelle_lat: 52.3,
      sammelstelle_lon: 9.7,
    });
    expect(
      bezirkPatch(verortet, { ...basis, sammelstelle: punkt('Schulhof Nord', 52.3, 9.7, 'karte') }),
    ).toEqual({ sammelstelle: 'Schulhof Nord' });
    // Geleerter Text leert beide.
    expect(bezirkPatch(verortet, { ...basis, sammelstelle: ort('') })).toEqual({
      sammelstelle: null,
      sammelstelle_lat: null,
      sammelstelle_lon: null,
    });
  });

  it('Bezirk dreiseitig: ein fremd gesetzter Punkt bleibt, wenn die Person die Sammelstelle nicht berührt', () => {
    const beimOeffnen = bezirk({ sammelstelle: 'Schulhof' });
    const aktuell = bezirk({
      sammelstelle: 'Schulhof',
      sammelstelle_lat: 52.3,
      sammelstelle_lon: 9.7,
    });
    const w = {
      bezeichnung: 'Uferstraße 12–40',
      plan_personen: 820,
      plan_erhebung: 'geschaetzt' as const,
      sammelstelle: ort('Schulhof'),
    };
    expect(bezirkPatchDreiseitig(beimOeffnen, aktuell, w)).toEqual({ plan_personen: 820 });
  });

  it('Stelle: ein Treffer setzt Text und Paar; geleert leert beide', () => {
    const basis = {
      bezeichnung: 'Turnhalle Ost',
      art: 'notunterkunft' as const,
      kapazitaet_personen: 150,
    };
    expect(
      stellePatch(stelle(), { ...basis, standort: punkt('Sportplatzweg 3', 52.3, 9.7) }),
    ).toEqual({ standort: 'Sportplatzweg 3', lat: 52.3, lon: 9.7 });
    const verortet = stelle({ standort: 'Sportplatzweg 3', lat: 52.3, lon: 9.7 });
    expect(
      stellePatch(verortet, { ...basis, standort: punkt('Sportplatzweg 3a', 52.3, 9.7, 'karte') }),
    ).toEqual({ standort: 'Sportplatzweg 3a' });
    expect(stellePatch(verortet, { ...basis, standort: ort(' ') })).toEqual({
      standort: null,
      lat: null,
      lon: null,
    });
  });

  it('Stelle anlegen: ein gewählter Standort verortet die Stelle', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <StelleAnlegenDialog
        einsatzId={1}
        abschnitte={ABSCHNITTE}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Betreuungsstelle anlegen' });
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Turnhalle Ost');
    await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    await userEvent.type(within(dialog).getByLabelText('Standort'), 'Sportplatzweg{Enter}');
    await userEvent.click(await within(dialog).findByRole('button', { name: /Sportplatzweg 3/ }));
    expect(within(dialog).getByRole('group', { name: 'Karte: Standort' })).toHaveTextContent(
      '52.3,9.7',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({
        bezeichnung: 'Turnhalle Ost',
        art: 'betreuungsstelle',
        standort: 'Sportplatzweg 3',
        lat: 52.3,
        lon: 9.7,
      }),
    );
  });

  it('Stelle anlegen: ohne Auswahl bleibt die Stelle nicht verortet', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <StelleAnlegenDialog
        einsatzId={1}
        abschnitte={ABSCHNITTE}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Betreuungsstelle anlegen' });
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Turnhalle Ost');
    await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    await userEvent.type(within(dialog).getByLabelText('Standort'), 'Sportplatzweg 3');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({
        bezeichnung: 'Turnhalle Ost',
        art: 'betreuungsstelle',
        standort: 'Sportplatzweg 3',
      }),
    );
  });
});

/** LLH-1077: der Zeitpunkt einer Meldung wird taktisch getippt und mit Enter übernommen. */
describe('StandMeldenDialog — Zeitpunkt getippt (LLH-1077)', () => {
  mitProzessZone('UTC');
  afterEach(() => {
    vi.useRealTimers();
  });

  it('„1430“ + Enter gilt heute 14:30 Berliner Zeit und meldet', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    // 15:00 Berliner Zeit: 14:30 ist eben vorbei.
    vi.setSystemTime(new Date('2026-09-24T13:00:00Z'));
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
        <StandMeldenDialog
          bezirk={bezirk()}
          laeuft={false}
          fehler={null}
          onErfassen={onErfassen}
          onSchliessen={vi.fn()}
        />
      </AnzeigeKonventionenProvider>,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Stand melden: Uferstraße 12–40' });
    await userEvent.type(within(dialog).getByLabelText('Evakuiert gesamt (Personen)'), '480');
    await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    await tippeZeit(userEvent.setup(), within(dialog).getByLabelText('Zeitpunkt'), '1430');
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith(
        expect.objectContaining({ evakuiert: 480, zeitpunkt_at: '2026-09-24 12:30:00' }),
      ),
    );
  });
});
