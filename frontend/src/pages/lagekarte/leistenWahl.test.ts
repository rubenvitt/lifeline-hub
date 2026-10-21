import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BAUM_KLAPP_VORGABE } from './leistenDaten';
import {
  BAUM_KLAPP_SCHLUESSEL,
  LEISTE_SPEICHER_SCHLUESSEL,
  LEISTEN_ANSICHT_SCHLUESSEL,
  OBJEKT_KLAPP_SCHLUESSEL,
  gezeigteAnsicht,
  leisteSichtbar,
  leistenAnsichtLesen,
  objektKlappLesen,
  useAuswahlVorn,
  useBaumKlapp,
  useObjektKlapp,
  useLeistenAnsicht,
  useLeistenWahl,
} from './leistenWahl';

afterEach(() => localStorage.clear());

const OHNE_MODUS = { modusAktiv: false, imModus: null } as const;

describe('leisteSichtbar (LFH-715)', () => {
  it('ohne Wahl gilt die Vorgabe: ab lg offen, auf dem Tablet offen, auf dem Handschirm zu', () => {
    expect(
      leisteSichtbar({
        gemerkt: null,
        breit: true,
        istSchmal: false,
        erzwungen: false,
        ...OHNE_MODUS,
      }),
    ).toBe(true);
    expect(
      leisteSichtbar({
        gemerkt: null,
        breit: false,
        istSchmal: false,
        erzwungen: false,
        ...OHNE_MODUS,
      }),
    ).toBe(true);
    expect(
      leisteSichtbar({
        gemerkt: null,
        breit: false,
        istSchmal: true,
        erzwungen: false,
        ...OHNE_MODUS,
      }),
    ).toBe(false);
  });

  it('eine gemerkte Wahl schlägt die Vorgabe in beide Richtungen — auch ab lg', () => {
    expect(
      leisteSichtbar({
        gemerkt: false,
        breit: true,
        istSchmal: false,
        erzwungen: false,
        ...OHNE_MODUS,
      }),
    ).toBe(false);
    expect(
      leisteSichtbar({
        gemerkt: true,
        breit: false,
        istSchmal: true,
        erzwungen: false,
        ...OHNE_MODUS,
      }),
    ).toBe(true);
    expect(
      leisteSichtbar({
        gemerkt: false,
        breit: false,
        istSchmal: false,
        erzwungen: false,
        ...OHNE_MODUS,
      }),
    ).toBe(false);
  });

  it('eine Auswahl oder ein Platzier-Modus erzwingt die Leiste gegen eine gemerkte Wahl', () => {
    expect(
      leisteSichtbar({
        gemerkt: false,
        breit: true,
        istSchmal: false,
        erzwungen: true,
        ...OHNE_MODUS,
      }),
    ).toBe(true);
    expect(
      leisteSichtbar({
        gemerkt: false,
        breit: false,
        istSchmal: true,
        erzwungen: true,
        ...OHNE_MODUS,
      }),
    ).toBe(true);
  });
});

// LFH-765: Unter `lg` gibt jeder Kartenmodus die Karte frei; danach gilt wieder, was vorher galt.
describe('leisteSichtbar im Kartenmodus (LFH-765)', () => {
  const basis = {
    gemerkt: true,
    breit: false,
    istSchmal: false,
    erzwungen: false,
    modusAktiv: true,
    imModus: null,
  } as const;

  it('unter lg schließt ein laufender Modus die Leiste gegen die gemerkte Wahl', () => {
    expect(leisteSichtbar(basis)).toBe(false);
  });

  it('ohne Modus gilt wieder die gemerkte Wahl', () => {
    expect(leisteSichtbar({ ...basis, modusAktiv: false })).toBe(true);
  });

  it('ab lg gibt ein Modus nichts frei', () => {
    expect(leisteSichtbar({ ...basis, breit: true })).toBe(true);
  });

  it('die vorläufige Wahl im Modus holt die Leiste zurück', () => {
    expect(leisteSichtbar({ ...basis, gemerkt: false, imModus: true })).toBe(true);
  });

  it('die vorläufige Wahl zählt nur im Modus', () => {
    expect(leisteSichtbar({ ...basis, modusAktiv: false, gemerkt: false, imModus: true })).toBe(
      false,
    );
  });

  it('erzwungen (Auswahl) gewinnt auch im Modus', () => {
    expect(leisteSichtbar({ ...basis, erzwungen: true, imModus: false })).toBe(true);
  });
});

describe('useLeistenWahl (LFH-715)', () => {
  it('liest je Breitenklasse ihren eigenen Platz', () => {
    localStorage.setItem(LEISTE_SPEICHER_SCHLUESSEL.breit, '0');
    localStorage.setItem(LEISTE_SPEICHER_SCHLUESSEL.schmal, '1');
    const { result, rerender } = renderHook(({ breit }) => useLeistenWahl(breit), {
      initialProps: { breit: true },
    });
    expect(result.current.wahl).toBe(false);
    rerender({ breit: false });
    expect(result.current.wahl).toBe(true);
  });

  it('ohne Eintrag ist nichts gewählt, und das Einhängen schreibt nichts', () => {
    const { result } = renderHook(() => useLeistenWahl(true));
    expect(result.current.wahl).toBeNull();
    expect(localStorage.getItem(LEISTE_SPEICHER_SCHLUESSEL.breit)).toBeNull();
    expect(localStorage.getItem(LEISTE_SPEICHER_SCHLUESSEL.schmal)).toBeNull();
  });

  it('merkt eine Wahl nur in der Klasse, die beim Umschalten gilt', () => {
    const { result, rerender } = renderHook(({ breit }) => useLeistenWahl(breit), {
      initialProps: { breit: true },
    });
    act(() => result.current.merke(false));
    expect(result.current.wahl).toBe(false);
    expect(localStorage.getItem(LEISTE_SPEICHER_SCHLUESSEL.breit)).toBe('0');
    expect(localStorage.getItem(LEISTE_SPEICHER_SCHLUESSEL.schmal)).toBeNull();

    rerender({ breit: false });
    expect(result.current.wahl).toBeNull();
    act(() => result.current.merke(true));
    expect(localStorage.getItem(LEISTE_SPEICHER_SCHLUESSEL.schmal)).toBe('1');
    expect(localStorage.getItem(LEISTE_SPEICHER_SCHLUESSEL.breit)).toBe('0');
  });

  it('`zeige` öffnet nur für die Sitzung: nichts gespeichert, nach dem Neuladen gilt die Wahl', () => {
    localStorage.setItem(LEISTE_SPEICHER_SCHLUESSEL.breit, '0');
    const erst = renderHook(() => useLeistenWahl(true));
    act(() => erst.result.current.zeige());
    expect(erst.result.current.wahl).toBe(true);
    expect(localStorage.getItem(LEISTE_SPEICHER_SCHLUESSEL.breit)).toBe('0');
    erst.unmount();
    expect(renderHook(() => useLeistenWahl(true)).result.current.wahl).toBe(false);
  });

  it('nach `zeige` gewinnt das nächste eigene Umschalten', () => {
    const { result } = renderHook(() => useLeistenWahl(true));
    act(() => result.current.zeige());
    act(() => result.current.merke(false));
    expect(result.current.wahl).toBe(false);
    expect(localStorage.getItem(LEISTE_SPEICHER_SCHLUESSEL.breit)).toBe('0');
  });

  it('`zeige` gilt nur in der Klasse, in der es geschah', () => {
    localStorage.setItem(LEISTE_SPEICHER_SCHLUESSEL.schmal, '0');
    const { result, rerender } = renderHook(({ breit }) => useLeistenWahl(breit), {
      initialProps: { breit: true },
    });
    act(() => result.current.zeige());
    rerender({ breit: false });
    expect(result.current.wahl).toBe(false);
  });

  it('ein unlesbarer Eintrag gilt als keine Wahl', () => {
    localStorage.setItem(LEISTE_SPEICHER_SCHLUESSEL.breit, 'kaputt');
    const { result } = renderHook(() => useLeistenWahl(true));
    expect(result.current.wahl).toBeNull();
  });
});

describe('useLeistenWahl im Kartenmodus (LFH-765)', () => {
  it('`umschalteImModus` gilt nur bis zum Modusende und schreibt nichts', () => {
    localStorage.setItem(LEISTE_SPEICHER_SCHLUESSEL.schmal, '0');
    const { result, rerender } = renderHook(({ modusAktiv }) => useLeistenWahl(false, modusAktiv), {
      initialProps: { modusAktiv: true },
    });
    expect(result.current.imModus).toBeNull();
    act(() => result.current.umschalteImModus(true));
    expect(result.current.imModus).toBe(true);
    expect(localStorage.getItem(LEISTE_SPEICHER_SCHLUESSEL.schmal)).toBe('0');
    rerender({ modusAktiv: false });
    expect(result.current.imModus).toBeNull();
    expect(result.current.wahl).toBe(false);
  });

  it('der nächste Modus startet ohne vorläufige Wahl', () => {
    const { result, rerender } = renderHook(({ modusAktiv }) => useLeistenWahl(false, modusAktiv), {
      initialProps: { modusAktiv: true },
    });
    act(() => result.current.umschalteImModus(true));
    rerender({ modusAktiv: false });
    rerender({ modusAktiv: true });
    expect(result.current.imModus).toBeNull();
  });

  it('das Modusende lässt `zeige` und die gemerkte Wahl stehen', () => {
    const { result, rerender } = renderHook(({ modusAktiv }) => useLeistenWahl(false, modusAktiv), {
      initialProps: { modusAktiv: false },
    });
    act(() => result.current.zeige());
    rerender({ modusAktiv: true });
    rerender({ modusAktiv: false });
    expect(result.current.wahl).toBe(true);
  });
});

describe('Ansicht der Leiste (Ebenen · Objekte)', () => {
  it('ohne gespeicherte Wahl gilt „Ebenen“, Unbekanntes ebenso', () => {
    expect(leistenAnsichtLesen(null)).toBe('ebenen');
    expect(leistenAnsichtLesen('auswahl')).toBe('ebenen');
    expect(leistenAnsichtLesen('objekte')).toBe('objekte');
  });

  it('merkt den Wechsel je Gerät und liest ihn beim nächsten Einhängen', () => {
    const { result, unmount } = renderHook(() => useLeistenAnsicht());
    expect(result.current.ansicht).toBe('ebenen');
    expect(localStorage.getItem(LEISTEN_ANSICHT_SCHLUESSEL)).toBeNull();
    act(() => result.current.wechsle('objekte'));
    expect(result.current.ansicht).toBe('objekte');
    expect(localStorage.getItem(LEISTEN_ANSICHT_SCHLUESSEL)).toBe('objekte');
    unmount();
    expect(renderHook(() => useLeistenAnsicht()).result.current.ansicht).toBe('objekte');
  });
});

describe('Klappzustand des Ebenenbaums', () => {
  it('startet mit der Vorgabe und merkt jedes Umschalten', () => {
    const { result } = renderHook(() => useBaumKlapp());
    expect(result.current.offen).toEqual(BAUM_KLAPP_VORGABE);
    act(() => result.current.setze('fachebenen', true));
    expect(result.current.offen.fachebenen).toBe(true);
    expect(JSON.parse(localStorage.getItem(BAUM_KLAPP_SCHLUESSEL)!)).toMatchObject({
      fachebenen: true,
    });
  });
});

describe('Klappzustand der Objektliste (LLH-1033)', () => {
  it('Vorgabe: alle Gruppen zu; Kaputtes und Fremdes fällt auf die Vorgabe', () => {
    expect(objektKlappLesen(null)).toEqual({});
    expect(objektKlappLesen('kaputt')).toEqual({});
    expect(
      objektKlappLesen(JSON.stringify({ einheit: true, unbekannt: true, fahrzeug: 'ja' })),
    ).toEqual({ einheit: true });
  });

  it('merkt jedes Umschalten je Gerät', () => {
    const { result, unmount } = renderHook(() => useObjektKlapp());
    expect(result.current.offen.einheit).toBeUndefined();
    act(() => result.current.setze('einheit', true));
    expect(result.current.offen.einheit).toBe(true);
    expect(JSON.parse(localStorage.getItem(OBJEKT_KLAPP_SCHLUESSEL)!)).toEqual({ einheit: true });
    unmount();
    expect(renderHook(() => useObjektKlapp()).result.current.offen.einheit).toBe(true);
  });
});

describe('Auswahl vorn (LLH-1033)', () => {
  it('eine neue Auswahl holt „Auswahl“ nach vorn und zählt hoch', () => {
    const { result, rerender } = renderHook(({ k }) => useAuswahlVorn(k), {
      initialProps: { k: null as unknown },
    });
    expect(result.current.vorn).toBe(false);
    rerender({ k: 'einheit-1' });
    expect(result.current.vorn).toBe(true);
    const nr = result.current.nr;
    rerender({ k: 'einheit-2' });
    expect(result.current.nr).toBe(nr + 1);
  });

  it('„Ebenen“ oder „Objekte“ nimmt sie nach hinten, dieselbe Auswahl holt sie nicht zurück', () => {
    const { result, rerender } = renderHook(({ k }) => useAuswahlVorn(k), {
      initialProps: { k: 'einheit-1' as unknown },
    });
    expect(result.current.vorn).toBe(true);
    act(() => result.current.verlasse());
    rerender({ k: 'einheit-1' });
    expect(result.current.vorn).toBe(false);
  });

  it('`zeige` holt sie zurück — der Tipp auf dasselbe Objekt oder auf das Segment', () => {
    const { result } = renderHook(() => useAuswahlVorn('einheit-1'));
    act(() => result.current.verlasse());
    const nr = result.current.nr;
    act(() => result.current.zeige());
    expect(result.current.vorn).toBe(true);
    expect(result.current.nr).toBe(nr + 1);
  });

  it('endet die Auswahl, kommt die nächste wieder nach vorn', () => {
    const { result, rerender } = renderHook(({ k }) => useAuswahlVorn(k), {
      initialProps: { k: 'zone:3' as unknown },
    });
    act(() => result.current.verlasse());
    rerender({ k: null });
    rerender({ k: 'zone:3' });
    expect(result.current.vorn).toBe(true);
  });

  it('gezeigt wird „Auswahl“ nur mit offener Auswahl, die vorn steht', () => {
    expect(gezeigteAnsicht('objekte', true, true)).toBe('auswahl');
    expect(gezeigteAnsicht('objekte', true, false)).toBe('objekte');
    expect(gezeigteAnsicht('ebenen', false, true)).toBe('ebenen');
  });
});
