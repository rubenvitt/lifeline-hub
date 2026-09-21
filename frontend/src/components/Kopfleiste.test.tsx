import { describe, expect, it } from 'vitest';
import { dichten, farbenDunkel } from '../theme/tokens';
import { funktionAusSachgebieten } from './BenutzerMenu';
import {
  SYNC_DARSTELLUNG,
  formatiereUhr,
  kopfZelleStil,
  syncZustand,
  wortmarkeStil,
} from './Kopfleiste';

const LEER = { ausstehend: 0, abgelehnt: 0, nicht_zugeordnet: 0 };

describe('syncZustand — Rangfolge der SYNC-Anzeige', () => {
  const basis = { online: true, live: 'open' as const, liveErwartet: true, queue: LEER };

  it('meldet die stehende Verbindung als SYNC', () => {
    expect(syncZustand(basis)).toBe('verbunden');
  });

  it('stellt den Netzverlust vor den Verbindungsabriss', () => {
    expect(syncZustand({ ...basis, online: false, live: 'lost' })).toBe('offline');
  });

  it('stellt abgelehnte Offline-Aktionen vor den Verbindungsaufbau', () => {
    expect(syncZustand({ ...basis, live: 'connecting', queue: { ...LEER, abgelehnt: 1 } })).toBe(
      'abgelehnt',
    );
  });

  it('liest `idle` im Einsatz als „verbinde", nie als „getrennt" (Kaltstart)', () => {
    expect(syncZustand({ ...basis, live: 'idle' })).toBe('verbinde');
    expect(syncZustand({ ...basis, live: 'lost' })).toBe('getrennt');
  });

  it('meldet ausstehende Aktionen erst nach stehender Verbindung', () => {
    expect(syncZustand({ ...basis, queue: { ...LEER, ausstehend: 3 } })).toBe('ausstehend');
  });

  it('schweigt außerhalb eines Einsatzes, solange nichts zu melden ist', () => {
    expect(syncZustand({ ...basis, live: 'idle', liveErwartet: false })).toBe('ruhe');
    // Gegenprobe: der Netzverlust wird auch dort gemeldet.
    expect(syncZustand({ ...basis, online: false, liveErwartet: false })).toBe('offline');
  });

  it('trägt je Zustand ein Wort (zweiter Kanal) und die Nachtrolle als Farbe', () => {
    expect(SYNC_DARSTELLUNG.verbunden).toMatchObject({ wort: 'SYNC', farbe: farbenDunkel.normal });
    expect(SYNC_DARSTELLUNG.verbinde.farbe).toBe(farbenDunkel.achtung);
    expect(SYNC_DARSTELLUNG.getrennt.farbe).toBe(farbenDunkel.alarm);
    expect(SYNC_DARSTELLUNG.offline.wort).toBe('OFFLINE');
  });
});

describe('Kopfleiste · Stile', () => {
  it('die Wortmarke trägt ZWEI Angaben über die Dichtestufen (LFH-365)', () => {
    const t = (s: keyof typeof dichten) => ({
      controlHeight: dichten[s].zeilenhoehe,
      paddingXS: dichten[s].abstand.xs,
    });
    expect(wortmarkeStil(t('kompakt')).minHeight).toBe(30);
    expect(wortmarkeStil(t('handschuh')).minHeight).toBe(72);
    expect(wortmarkeStil(t('handschuh')).padding).toBe('7px 0');
  });

  it('die Zelle hält die 52-px-Leiste als Boden und trägt die Haarlinie', () => {
    const stil = kopfZelleStil({ padding: 11 });
    expect(stil.minHeight).toBe(52);
    expect(stil.borderInlineEnd).toContain('1px solid');
    expect(kopfZelleStil({ padding: 11 }, 'keiner').borderInlineEnd).toBeUndefined();
  });

  it('formatiert die Uhr als HH:MM', () => {
    expect(formatiereUhr(new Date(2026, 8, 21, 7, 5).getTime())).toBe('07:05');
  });
});

describe('funktionAusSachgebieten — Funktion im Kopf', () => {
  it('nennt das erste besetzte Sachgebiet im Klartext, in S1–S6-Reihenfolge', () => {
    expect(funktionAusSachgebieten(['s2'])).toBe('S2 Lage');
    expect(funktionAusSachgebieten(['s4', 's2'])).toBe('S2 Lage');
  });

  it('erfindet ohne Sachgebiet keine Funktion', () => {
    expect(funktionAusSachgebieten([])).toBeNull();
    expect(funktionAusSachgebieten(undefined)).toBeNull();
  });
});
