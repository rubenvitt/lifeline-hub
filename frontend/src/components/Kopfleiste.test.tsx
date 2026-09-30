import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LINIE_PFAD } from '../marke/bildmarkeGeometrie';
import { dichten, farbenDunkel, rahmenFarben } from '../theme/tokens';
import {
  KOPF_NAME_FLEX,
  KOPF_NAME_FLEX_SCHMAL,
  KOPF_SUCHE_FLEX,
  Markenzelle,
  SYNC_DARSTELLUNG,
  syncZeigtWort,
  formatiereUhr,
  kopfZelleStil,
  railBreite,
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
    expect(SYNC_DARSTELLUNG.getrennt.farbe).toBe(rahmenFarben.alarm);
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

  it('die Rail-Spalte wächst in `handschuh` mit, sonst hält sie die Entwurfsbreite (LFH-384)', () => {
    // Literale, nicht aus `dichten` zurückgelesen. 73 = 72 px Ziel plus die 1-px-Haarlinie,
    // die in der `border-box`-Spalte von der Zielbreite abgeht.
    const t = (s: keyof typeof dichten) => ({ controlHeight: dichten[s].zeilenhoehe });
    expect(railBreite(t('kompakt'))).toBe(60);
    expect(railBreite(t('komfortabel'))).toBe(60);
    expect(railBreite(t('handschuh'))).toBe(73);
  });

  it('das Ziel in der Rail-Spalte hält auf jeder Stufe die Steuerhöhe in der Breite', () => {
    for (const s of Object.keys(dichten) as (keyof typeof dichten)[]) {
      const controlHeight = dichten[s].zeilenhoehe;
      expect(railBreite({ controlHeight }) - 1).toBeGreaterThanOrEqual(controlHeight);
    }
  });

  it('formatiert die Uhr als HH:MM', () => {
    expect(formatiereUhr(new Date(2026, 8, 21, 7, 5).getTime())).toBe('07:05');
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
    // Der Name wächst stärker als die Suche, sonst bliebe ihm bei 1440 px kaum Platz.
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
    // Eine größere Summe kostete das Führungs-Tablet (1024–1280 px) eine zweite Kopfzeile; eine
    // kleinere hielte bei 992 px alles einzeilig und drückte den Namen auf 0 px.
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

describe('Markenzelle — Bildmarke „Lebenslinie“ (LFH-837)', () => {
  it('zeigt die Bildmarke in der Textfarbe des Rahmens statt des einfarbigen Quadrats', () => {
    const { container } = render(<Markenzelle />);
    const zelle = container.querySelector('[data-lfh="kopf-marke"]')!;
    expect(zelle).toHaveAttribute('aria-hidden', 'true');
    const marke = zelle.querySelector('svg[data-lfh="bildmarke"]');
    expect(marke).not.toBeNull();
    expect(marke).toHaveAttribute('height', '22');
    expect(marke!.querySelector('path')).toHaveAttribute('d', LINIE_PFAD);
    expect(marke!.querySelector('path')).toHaveAttribute('stroke', rahmenFarben.text);
    // Das alte 14-px-Quadrat ist fort: die Zelle enthält kein Element außer der Bildmarke.
    expect(zelle.children).toHaveLength(1);
  });
});
