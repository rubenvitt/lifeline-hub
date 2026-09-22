import { describe, expect, it } from 'vitest';
import { dichten, farbenDunkel } from '../theme/tokens';
import { funktionAusSachgebieten } from './BenutzerMenu';
import {
  KOPF_NAME_FLEX,
  KOPF_NAME_FLEX_SCHMAL,
  KOPF_SUCHE_FLEX,
  SYNC_DARSTELLUNG,
  syncZeigtWort,
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

describe('Kopfgruppen — der Einsatzname vor dem Suchfeld (22.09.2026)', () => {
  // `flex`-Kurzform zerlegt: Wachstum, Schrumpfung, Basis in px.
  const teile = (flex: string) => {
    const [grow, shrink, basis] = flex.split(' ');
    return { grow: Number(grow), shrink: Number(shrink), basis: Number.parseInt(basis, 10) };
  };

  it('lässt ab lg die Namensgruppe stärker wachsen als die Suche', () => {
    const name = teile(KOPF_NAME_FLEX);
    const suche = teile(KOPF_SUCHE_FLEX);
    // Vorher je 1 — bei 1440 px blieben dem Namen gemessen 92 px, der Suche 451 px.
    expect(name.grow).toBeGreaterThan(suche.grow);
    // Beide dürfen schrumpfen, sonst läuft die Kopfzeile über statt umzubrechen (Gate 1).
    expect(name.shrink).toBeGreaterThan(0);
    expect(suche.shrink).toBeGreaterThan(0);
  });

  it('gibt der Namensgruppe eine Basis über ihrem festen Teil (≈ 270 px in kompakt)', () => {
    // LITERALE: mit 240 px deckte die Basis nicht einmal Marke, Wortmarke und Nummer.
    expect(teile(KOPF_NAME_FLEX).basis).toBe(340);
    expect(teile(KOPF_SUCHE_FLEX).basis).toBe(180);
  });

  it('bricht nicht früher um als vorher — die Summe der Basen bleibt 520 px', () => {
    // Vorher 240 + 280. Eine größere Summe kostete das Führungs-Tablet (1024–1280 px) eine
    // zweite Kopfzeile; eine kleinere hielte bei 992 px alles einzeilig und drückte den
    // Namen auf 0 px (gemessen).
    expect(teile(KOPF_NAME_FLEX).basis + teile(KOPF_SUCHE_FLEX).basis).toBe(520);
  });

  it('lässt die Verdichtung unter lg unverändert', () => {
    expect(KOPF_NAME_FLEX_SCHMAL).toBe('1 1 240px');
  });
});

describe('syncZeigtWort — Wort nur, wo es trägt', () => {
  it('unter md nie ein Wort (kompakt)', () => {
    expect(syncZeigtWort('getrennt', true, false)).toBe(false);
  });
  it('auf dem Tablet: der Ruhezustand ohne Wort, jede Störung mit', () => {
    expect(syncZeigtWort('verbunden', false, true)).toBe(false);
    for (const z of ['verbinde', 'ausstehend', 'getrennt', 'offline', 'abgelehnt'] as const) {
      expect(syncZeigtWort(z, false, true), z).toBe(true);
    }
  });
  it('ab xl trägt auch der Ruhezustand sein Wort', () => {
    expect(syncZeigtWort('verbunden', false, false)).toBe(true);
  });
});
