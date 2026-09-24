import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import type { Betreuungsstelle, Evakuierungsbezirk } from '../api/types';
import { alsOrtszeit } from '../etb/filterZeit';
import { renderMitProviders } from '../test/utils';
import {
  BelegungMeldenDialog,
  BezirkAnlegenDialog,
  BezirkBearbeitenDialog,
  RaeumungDialog,
  StandMeldenDialog,
  StelleAnlegenDialog,
  StelleBearbeitenDialog,
  StornierenDialog,
  belegungBody,
  bezirkPatch,
  standBody,
  stellePatch,
} from './BetreuungDialoge';

dayjs.extend(utc);

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
 * Zählt die BEDIENBAREN Felder — Muster `stab/LagebesprechungModal.test.tsx`. Die Rollenabfrage
 * blendet aus, was im Barrierefreiheitsbaum nicht steht; genau das ist der eingeklappte Bereich
 * (`forceRender` lässt ihn im DOM, `display: none` am Element).
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
        sammelstelle: 'Schulhof',
        notiz: '',
      }),
    ).toStrictEqual({});
    expect(
      bezirkPatch(b, {
        bezeichnung: ' Uferstraße 12–40 ',
        plan_personen: 820,
        plan_erhebung: 'gezaehlt',
        abschnitt_id: undefined,
        sammelstelle: '  ',
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
        standort: '',
      }),
    ).toStrictEqual({ status: 'geschlossen' });
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
    const knopf = pruefeFormStruktur(dialog, 'Melden');
    await userEvent.type(within(dialog).getByLabelText('Evakuiert (Personen)'), '480');
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
    const feld = within(dialog).getByLabelText('Evakuiert (Personen)');
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
    await userEvent.type(within(dialog).getByLabelText('Belegt (Personen)'), '89');
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
    const feld = within(dialog).getByLabelText('Belegt (Personen)');
    await userEvent.type(feld, '1000001');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Melden' }));
    expect(await within(dialog).findByText(/Höchstens 1\s000\s000 Personen/)).toBeInTheDocument();
    // Kein `max` am InputNumber: das klemmte beim Verlassen still auf 1 000 000, und eine
    // Personenzahl, die sich still ändert, wäre schlimmer als die Ablehnung.
    expect(feld).toHaveValue('1000001');
    expect(onErfassen).not.toHaveBeenCalled();
  });

  it('die Grenze selbst geht durch; Kapazität hat dieselbe Grenze', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <StelleAnlegenDialog
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
  it('Bezeichnung, Plangröße, Erhebung sichtbar; Abschnitt, Sammelstelle, Notiz eingeklappt', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <BezirkAnlegenDialog
        abschnitte={ABSCHNITTE}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Evakuierungsbezirk anlegen' });
    await budgetUndAufklappen(dialog, 3);
    expect(sichtbareFelder(dialog)).toBe(6);
    const knopf = pruefeFormStruktur(dialog, 'Anlegen');
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Uferstraße 12–40');
    await userEvent.type(within(dialog).getByLabelText('Plangröße (Personen)'), '640');
    await userEvent.type(within(dialog).getByLabelText('Sammelstelle'), 'Schulhof');
    await userEvent.click(knopf);
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({
        bezeichnung: 'Uferstraße 12–40',
        plan_personen: 640,
        plan_erhebung: 'geschaetzt',
        sammelstelle: 'Schulhof',
      }),
    );
  });
});

describe('BezirkBearbeitenDialog', () => {
  it('Plangröße fortschreiben schickt nur die Änderung', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <BezirkBearbeitenDialog
        bezirk={bezirk()}
        abschnitte={ABSCHNITTE}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Bezirk bearbeiten: Uferstraße 12–40',
    });
    await budgetUndAufklappen(dialog, 2);
    const feld = within(dialog).getByLabelText('Plangröße (Personen)');
    await userEvent.clear(feld);
    await userEvent.type(feld, '820');
    await waehle(dialog, 'gezählt');
    await userEvent.click(pruefeFormStruktur(dialog, 'Speichern'));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({ plan_personen: 820, plan_erhebung: 'gezaehlt' }),
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
});

describe('StelleAnlegenDialog', () => {
  it('Bezeichnung, Art, Kapazität sichtbar; der Rest eingeklappt; ohne Kapazität kein Schlüssel', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <StelleAnlegenDialog
        abschnitte={ABSCHNITTE}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Betreuungsstelle anlegen' });
    await budgetUndAufklappen(dialog, 3);
    await userEvent.type(within(dialog).getByLabelText('Bezeichnung'), 'Turnhalle Ost');
    await userEvent.click(pruefeFormStruktur(dialog, 'Anlegen'));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({
        bezeichnung: 'Turnhalle Ost',
        art: 'betreuungsstelle',
      }),
    );
  });
});

describe('StelleBearbeitenDialog — Schließen einer belegten Stelle (design.md D4)', () => {
  const belegt = stelle({ belegung: { id: 30, belegt: 40, zeitpunkt_at: '2026-09-23 09:00:00' } });

  it('bietet die Leermeldung im selben Dialog an; ohne Häkchen wird nicht gesendet', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    const onLeermeldung = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <StelleBearbeitenDialog
        stelle={belegt}
        abschnitte={ABSCHNITTE}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onLeermeldung={onLeermeldung}
        onSchliessen={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Stelle bearbeiten: Turnhalle Ost' });
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    await waehle(dialog, 'geschlossen');
    const haken = await within(dialog).findByRole('checkbox', { name: /Belegung 0 melden/ });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(
      await within(dialog).findByText(/erst nach einer Leermeldung schließen/),
    ).toBeInTheDocument();
    expect(onLeermeldung).not.toHaveBeenCalled();
    expect(onErfassen).not.toHaveBeenCalled();

    await userEvent.click(haken);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
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
    renderMitProviders(
      <StelleBearbeitenDialog
        stelle={belegt}
        abschnitte={ABSCHNITTE}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onLeermeldung={onLeermeldung}
        onSchliessen={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    await waehle(dialog, 'geschlossen');
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: /Belegung 0/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(2));
    expect(onLeermeldung).toHaveBeenCalledTimes(1);
  });

  it('eine unbelegte Stelle schließt ohne Leermeldung', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    const onLeermeldung = vi.fn();
    renderMitProviders(
      <StelleBearbeitenDialog
        stelle={stelle({ belegung: { id: 31, belegt: 0, zeitpunkt_at: '2026-09-23 09:00:00' } })}
        abschnitte={ABSCHNITTE}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onLeermeldung={onLeermeldung}
        onSchliessen={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    await budgetUndAufklappen(dialog, 3);
    await waehle(dialog, 'geschlossen');
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
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
