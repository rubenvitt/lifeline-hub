import { describe, expect, it, vi } from 'vitest';
import type { EtbEintragAnzeige } from '../api/types';
import type { AbgelehnterEintrag, AusstehenderEintrag } from '../offline/queue';
import { KEINE_BERECHTIGUNG } from '../einsatz/modulRegistry';
import type { EtbZeile } from './etbZeile';
import {
  fuehreZeilenWahlAus,
  zeilenAktionen,
  zeilenMenueName,
  type ZeilenAufrufe,
  type ZeilenRechte,
} from './zeilenAktionen';

const eintrag = { id: 4, lfd_nr: 12 } as unknown as EtbEintragAnzeige;
const puffer = (inMeldungseingang?: boolean): AbgelehnterEintrag => ({
  id: 3,
  benutzer_id: 1,
  einsatz_id: 7,
  eintrag: {
    typ: 'meldung',
    inhalt: 'abgelehnt',
    ...(inMeldungseingang != null ? { in_meldungseingang: inMeldungseingang } : {}),
  },
  erstellt_at: '2026-11-09 10:05:00',
  grund: 'Einsatz abgeschlossen',
  abgelehnt_at: '2026-11-09 10:06:00',
});
const ausstehend: AusstehenderEintrag = {
  id: 5,
  benutzer_id: 1,
  einsatz_id: 7,
  eintrag: { typ: 'meldung', inhalt: 'unterwegs' },
  erstellt_at: '2026-11-09 10:05:00',
};

const Z = {
  eintrag: { art: 'eintrag', schluessel: 'eintrag-4', eintrag } as EtbZeile,
  ausstehend: { art: 'ausstehend', schluessel: 'ausstehend-5', puffer: ausstehend } as EtbZeile,
  abgelehnt: (m?: boolean) =>
    ({ art: 'abgelehnt', schluessel: 'abgelehnt-3', puffer: puffer(m) }) as EtbZeile,
};

const alle: ZeilenRechte = {
  kannBerichtigen: true,
  kannWiedervorlage: true,
  kannAuftrag: true,
  auftragGesperrt: false,
  nurProtokollierenAngeboten: true,
};

describe('zeilenAktionen (LLH-1597, design.md D2)', () => {
  it('gesendeter Eintrag: Berichtigen, Wiedervorlage, Auftrag erteilen', () => {
    expect(zeilenAktionen(Z.eintrag, alle)).toEqual([
      { key: 'berichtigen', label: 'Berichtigen' },
      { key: 'wiedervorlage', label: 'Wiedervorlage' },
      { key: 'auftrag', label: 'Auftrag erteilen' },
    ]);
  });

  it('gesperrte Wege stehen gesperrt mit Grund da', () => {
    expect(
      zeilenAktionen(Z.eintrag, {
        ...alle,
        berichtigenGesperrt: 'Entwurf sendet',
        auftragGesperrt: true,
      }),
    ).toEqual([
      { key: 'berichtigen', label: 'Berichtigen (Entwurf sendet)', gesperrt: true },
      { key: 'wiedervorlage', label: 'Wiedervorlage' },
      { key: 'auftrag', label: `Auftrag erteilen (${KEINE_BERECHTIGUNG})`, gesperrt: true },
    ]);
  });

  it('ohne Wege keine Einträge', () => {
    expect(
      zeilenAktionen(Z.eintrag, {
        ...alle,
        kannBerichtigen: false,
        kannWiedervorlage: false,
        kannAuftrag: false,
      }),
    ).toEqual([]);
  });

  it('vorgemerkter Eintrag: keine Einträge', () => {
    expect(zeilenAktionen(Z.ausstehend, alle)).toEqual([]);
  });

  it('abgelehnte Meldung mit Kopplung: Erneut senden, Nur protokollieren, rot Verwerfen', () => {
    expect(zeilenAktionen(Z.abgelehnt(true), alle)).toEqual([
      { key: 'erneut', label: 'Erneut senden' },
      { key: 'nurProtokollieren', label: 'Nur protokollieren' },
      { key: 'verwerfen', label: 'Verwerfen', gefahr: true },
    ]);
  });

  it('„Nur protokollieren“ nur mit Kopplung und angebotenem Weg', () => {
    const ohne = [
      { key: 'erneut', label: 'Erneut senden' },
      { key: 'verwerfen', label: 'Verwerfen', gefahr: true },
    ];
    expect(zeilenAktionen(Z.abgelehnt(false), alle)).toEqual(ohne);
    expect(zeilenAktionen(Z.abgelehnt(), alle)).toEqual(ohne);
    expect(
      zeilenAktionen(Z.abgelehnt(true), { ...alle, nurProtokollierenAngeboten: false }),
    ).toEqual(ohne);
  });
});

describe('fuehreZeilenWahlAus (LLH-1597)', () => {
  function aufrufe(): ZeilenAufrufe {
    return {
      berichtigen: vi.fn(),
      wiedervorlage: vi.fn(),
      auftragErteilen: vi.fn(),
      erneutSenden: vi.fn(),
      verwerfen: vi.fn(),
      nurProtokollieren: vi.fn(),
    };
  }

  it.each([
    ['berichtigen', 'berichtigen'],
    ['wiedervorlage', 'wiedervorlage'],
    ['auftrag', 'auftragErteilen'],
  ] as const)('gesendeter Eintrag: %s ruft %s mit dem Eintrag', (key, aufruf) => {
    const a = aufrufe();
    fuehreZeilenWahlAus(Z.eintrag, key, a);
    expect(a[aufruf]).toHaveBeenCalledWith(eintrag);
    const andere = Object.entries(a).filter(([k]) => k !== aufruf);
    for (const [, f] of andere) expect(f).not.toHaveBeenCalled();
  });

  it.each([
    ['erneut', 'erneutSenden'],
    ['nurProtokollieren', 'nurProtokollieren'],
    ['verwerfen', 'verwerfen'],
  ] as const)('abgelehnte Zeile: %s ruft %s mit dem Puffer', (key, aufruf) => {
    const a = aufrufe();
    const z = Z.abgelehnt(true);
    fuehreZeilenWahlAus(z, key, a);
    expect(a[aufruf]).toHaveBeenCalledWith(z.art === 'abgelehnt' ? z.puffer : null);
    expect(Object.values(a).filter((f) => vi.mocked(f!).mock.calls.length > 0)).toHaveLength(1);
  });

  it('ein Schlüssel der falschen Zeilenart tut nichts', () => {
    const a = aufrufe();
    fuehreZeilenWahlAus(Z.eintrag, 'verwerfen', a);
    fuehreZeilenWahlAus(Z.abgelehnt(true), 'berichtigen', a);
    fuehreZeilenWahlAus(Z.ausstehend, 'berichtigen', a);
    for (const f of Object.values(a)) expect(f).not.toHaveBeenCalled();
  });
});

describe('zeilenMenueName (LLH-1597)', () => {
  it('nennt die laufende Nummer bzw. den Zustand', () => {
    expect(zeilenMenueName(Z.eintrag)).toBe('Aktionen zu Eintrag 12');
    expect(zeilenMenueName(Z.abgelehnt())).toBe('Aktionen zu abgelehntem Eintrag');
    expect(zeilenMenueName(Z.ausstehend)).toBe('Aktionen zu vorgemerktem Eintrag');
  });
});
