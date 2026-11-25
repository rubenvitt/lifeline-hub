import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { neuerQueryClient } from '../../test/utils';
import { einsatzKeys } from '../../api/queryKeys';
import type { Fremdebene } from '../../api/fremdebenen';
import type { UebernahmeTeil } from './fremdebeneUebernahme';
import { FREIE_SKIZZE_VORGABEFARBE } from './zonenStil';
import { useFremdebeneUebernahme } from './useFremdebeneUebernahme';

const lagezonenApi = vi.hoisted(() => ({ legeZoneAn: vi.fn() }));
vi.mock('../../api/lagezonen', () => lagezonenApi);
const freieZeichenApi = vi.hoisted(() => ({ legeFreiesZeichenAn: vi.fn() }));
vi.mock('../../api/freieZeichen', () => freieZeichenApi);

const EBENE = { id: 7, name: 'Lage Kreis X' } as Fremdebene;
const poly = (x: number): UebernahmeTeil => ({
  art: 'flaeche',
  geometrie: {
    type: 'Polygon',
    coordinates: [
      [
        [x, 50],
        [x + 0.1, 50],
        [x, 50.1],
        [x, 50],
      ],
    ],
  },
});
const punkt: UebernahmeTeil = {
  art: 'punkt',
  geometrie: { type: 'Point', coordinates: [9.5, 50.5] },
};
const SPEC = { zeichen_spec: '{"v":1,"spec":{"kind":"circle-12"}}' };

function aufbau() {
  const qc = neuerQueryClient();
  const invalidiere = vi.spyOn(qc, 'invalidateQueries');
  const erfolg = vi.fn();
  const melde = vi.fn();
  const beginneHandlung = vi.fn(() => melde);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () => useFremdebeneUebernahme({ einsatzId: 3, ansichtId: 11, beginneHandlung, erfolg }),
    { wrapper },
  );
  return { result, invalidiere, erfolg, melde, beginneHandlung };
}

describe('useFremdebeneUebernahme (LLH-2129)', () => {
  beforeEach(() => {
    lagezonenApi.legeZoneAn.mockReset().mockResolvedValue({ id: 1 });
    freieZeichenApi.legeFreiesZeichenAn.mockReset().mockResolvedValue({ id: 1 });
  });

  it('legt je Fläche eine Zone mit Herkunft, Ansicht, Nummer und Notiz an', async () => {
    const { result, invalidiere, erfolg } = aufbau();
    let ok = false;
    await act(async () => {
      ok = await result.current.uebernehme({
        ebene: EBENE,
        teile: [poly(9), poly(10)],
        name: 'A',
        beschreibung: 'Text',
        zonenTyp: 'gefahrengebiet',
      });
    });
    expect(ok).toBe(true);
    expect(lagezonenApi.legeZoneAn).toHaveBeenCalledTimes(2);
    expect(lagezonenApi.legeZoneAn).toHaveBeenNthCalledWith(1, 3, {
      typ: 'gefahrengebiet',
      geometrie_typ: 'Polygon',
      geometrie: JSON.stringify(poly(9).geometrie),
      label: 'A (1/2)',
      notiz: 'Übernommen aus Fremdebene «Lage Kreis X».\n\nText',
      farbe: null,
      ansicht_id: 11,
      fremdebene_id: 7,
    });
    expect(lagezonenApi.legeZoneAn.mock.calls[1][1]).toMatchObject({ label: 'A (2/2)' });
    expect(invalidiere).toHaveBeenCalledWith({ queryKey: einsatzKeys.zonen(3) });
    expect(invalidiere).toHaveBeenCalledWith({ queryKey: einsatzKeys.gefahrengebiete(3) });
    expect(erfolg).toHaveBeenCalledWith('2 Objekte übernommen');
  });

  it('eine freie Skizze bekommt die Vorgabefarbe', async () => {
    const { result, erfolg } = aufbau();
    await act(async () => {
      await result.current.uebernehme({
        ebene: EBENE,
        teile: [poly(9)],
        name: null,
        beschreibung: null,
        zonenTyp: 'freie_skizze',
      });
    });
    expect(lagezonenApi.legeZoneAn.mock.calls[0][1]).toMatchObject({
      farbe: FREIE_SKIZZE_VORGABEFARBE,
      label: 'Lage Kreis X',
    });
    expect(erfolg).toHaveBeenCalledWith('Objekt übernommen');
  });

  it('bricht beim ersten Fehler ab und nennt, wie viele schon übernommen sind', async () => {
    const fehler = new Error('422');
    lagezonenApi.legeZoneAn.mockResolvedValueOnce({ id: 1 }).mockRejectedValueOnce(fehler);
    const { result, melde, beginneHandlung, erfolg } = aufbau();
    let ok = true;
    await act(async () => {
      ok = await result.current.uebernehme({
        ebene: EBENE,
        teile: [poly(9), poly(10), poly(11)],
        name: 'A',
        beschreibung: null,
        zonenTyp: 'gefahrengebiet',
      });
    });
    expect(ok).toBe(false);
    expect(lagezonenApi.legeZoneAn).toHaveBeenCalledTimes(2);
    expect(beginneHandlung).toHaveBeenCalledWith(
      'fremdebene-uebernehmen',
      'Übernahme abgebrochen (1 von 3 übernommen)',
      'Übernehmen fehlgeschlagen',
    );
    expect(melde).toHaveBeenCalledWith(fehler);
    expect(erfolg).not.toHaveBeenCalled();
  });

  it('legt Punkte als freie Zeichen mit Herkunft an', async () => {
    const { result, invalidiere } = aufbau();
    await act(async () => {
      await result.current.uebernehme({
        ebene: EBENE,
        teile: [punkt],
        name: 'Sammelpunkt',
        beschreibung: null,
        spec: SPEC,
      });
    });
    expect(freieZeichenApi.legeFreiesZeichenAn).toHaveBeenCalledWith(3, {
      lat: 50.5,
      lon: 9.5,
      ...SPEC,
      label: 'Sammelpunkt',
      ansicht_id: 11,
      fremdebene_id: 7,
    });
    expect(invalidiere).toHaveBeenCalledWith({ queryKey: einsatzKeys.freieZeichen(3) });
  });

  it('ein zweiter Aufruf während eines laufenden legt nichts an', async () => {
    let gib!: (v: unknown) => void;
    lagezonenApi.legeZoneAn.mockImplementationOnce(() => new Promise((r) => (gib = r)));
    const { result } = aufbau();
    const auftrag = {
      ebene: EBENE,
      teile: [poly(9)],
      name: 'A',
      beschreibung: null,
      zonenTyp: 'gefahrengebiet' as const,
    };
    let erster!: Promise<boolean>;
    let zweiter = true;
    await act(async () => {
      erster = result.current.uebernehme(auftrag);
      zweiter = await result.current.uebernehme(auftrag);
    });
    expect(zweiter).toBe(false);
    await act(async () => {
      gib({ id: 1 });
      await erster;
    });
    expect(lagezonenApi.legeZoneAn).toHaveBeenCalledTimes(1);
  });
});
