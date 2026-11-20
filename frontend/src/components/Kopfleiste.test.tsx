import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import { formatiereUhr } from '../anzeige/zeitDarstellung';
import {
  setzeZeitdarstellung,
  zeitdarstellungVergessenFuerTests,
} from '../anzeige/zeitDarstellungStore';
import { LINIE_PFAD } from '../marke/bildmarkeGeometrie';
import { dichten, farbenDunkel, rahmenFarben } from '../theme/tokens';
import {
  KOPF_NAME_FLEX_SCHMAL,
  kopfNameSucheFlex,
  kopfRasterSpalten,
  Markenzelle,
  SYNC_DARSTELLUNG,
  syncZeigtWort,
  kopfZelleStil,
  railBreite,
  syncZustand,
  wortmarkeStil,
  SyncZelle,
  Uhr,
} from './Kopfleiste';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { subscribeWiederherstellung } from '../offline/wiederherstellungOeffnen';
import { MemoryRouter } from 'react-router';
import { ConfigProvider } from 'antd';

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

  // Review LLH-1726: `connecting` meldet die Verbindung erst nach der Schonfrist, mitten in der
  // Sitzung, und bei Netzfehlern endlos. Das ist eine Störung mit Wort, nicht der Start (`idle`).
  it('trennt den Wiederaufbau (`connecting`) vom Start (`idle`)', () => {
    expect(syncZustand({ ...basis, live: 'connecting' })).toBe('wiederaufbau');
    expect(SYNC_DARSTELLUNG.wiederaufbau).toMatchObject({
      wort: 'VERBINDE',
      farbe: farbenDunkel.achtung,
    });
    expect(SYNC_DARSTELLUNG.wiederaufbau.satz(LEER)).toBe('Live-Verbindung wird wiederhergestellt');
    expect(syncZeigtWort('wiederaufbau', false)).toBe(true);
  });

  it('nennt beim Start vorgemerkte Aktionen statt des wortlosen Aufbaus', () => {
    expect(syncZustand({ ...basis, live: 'idle', queue: { ...LEER, ausstehend: 2 } })).toBe(
      'ausstehend',
    );
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
    // Der Zustand, ohne Nachsatz über die Folge (LFH-1078): GETRENNT und die Farbe tragen sie.
    expect(SYNC_DARSTELLUNG.getrennt.satz(LEER)).toBe('Live-Verbindung unterbrochen');
  });

  it('meldet ausstehende Offline-Aktionen als „nicht gesendet“, mit Zähler und Einzahl (LLH-1758)', () => {
    expect(SYNC_DARSTELLUNG.ausstehend.wort).toBe('NICHT GESENDET');
    expect(SYNC_DARSTELLUNG.ausstehend.satz({ ...LEER, ausstehend: 1 })).toBe(
      '1 Offline-Aktion nicht gesendet — antippen für Details',
    );
    expect(SYNC_DARSTELLUNG.ausstehend.satz({ ...LEER, ausstehend: 3 })).toBe(
      '3 Offline-Aktionen nicht gesendet — antippen für Details',
    );
    expect(SYNC_DARSTELLUNG.abgelehnt.wort).toBe('PRÜFEN');
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
    expect(wortmarkeStil(t('handschuh')).padding).toBe('8px 0');
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

  it('formatiert die Uhr in der Zeitdarstellung, in Gerätezeit (LLH-1750)', () => {
    const ms = new Date(2026, 8, 21, 7, 5).getTime();
    expect(formatiereUhr(ms, 'taktisch')).toBe('0705');
    expect(formatiereUhr(ms, 'datum_uhrzeit')).toBe('07:05');
  });
});

describe('Kopfgruppen — der Einsatzname vor dem Suchfeld (LLH-1726)', () => {
  it('gibt im Raster dem Namen seine Eigenbreite und der Suche den Rest', () => {
    const spalten = kopfRasterSpalten(48);
    expect(spalten).toMatch(/^minmax\(min-content, max-content\) /);
    expect(spalten).toContain('calc(48px + 2 * var(--lfh-kopf-polsterung))');
    expect(spalten).toMatch(/, 1fr\)$/);
  });

  it('bricht in kompakt nicht früher um als vorher — Basis 476 px, die Summe der alten Basen', () => {
    // Eine größere Summe kostete das Führungs-Tablet eine zweite Kopfzeile; eine kleinere hielte
    // bei 992 px alles einzeilig. Seit LLH-1726 ist die rechte Gruppe ohne Ruhewörter schmaler,
    // der Kopf bleibt also bei mehr Breiten einzeilig.
    expect(kopfNameSucheFlex({ controlHeight: dichten.kompakt.zeilenhoehe })).toBe('1 1 476px');
  });

  it('wächst mit der Dichte, damit in handschuh der Kopf umbricht statt den Namen zu kürzen', () => {
    // 1180 px in `handschuh`: rechte Gruppe ≈ 580 px, Basis 644 → zwei Zeilen, der Name ganz.
    expect(kopfNameSucheFlex({ controlHeight: dichten.komfortabel.zeilenhoehe })).toBe('1 1 548px');
    expect(kopfNameSucheFlex({ controlHeight: dichten.handschuh.zeilenhoehe })).toBe('1 1 644px');
  });

  it('gibt unter lg dem Knopf „Eingänge“ die 44 px aus der Namensbasis (vorher 240 px)', () => {
    expect(KOPF_NAME_FLEX_SCHMAL).toBe('1 1 196px');
  });
});

/**
 * LLH-1726 (Spec `kopfleiste`): Ruhezustände stehen in jeder Breite nur als Symbol, auch der
 * Verbindungsaufbau beim Start. Ein Wort trägt nur die Störung, und unter md nicht einmal sie
 * (dort meldet die Betriebszeile).
 */
describe('syncZeigtWort — Wort genau bei Störung', () => {
  it('unter md nie ein Wort (kompakt)', () => {
    expect(syncZeigtWort('getrennt', true)).toBe(false);
  });
  it('Verbindung und Verbindungsaufbau stehen als Symbol, in jeder Breite', () => {
    expect(syncZeigtWort('verbunden', false)).toBe(false);
    expect(syncZeigtWort('verbinde', false)).toBe(false);
  });
  it('jede Störung trägt ihr Wort', () => {
    for (const z of ['ausstehend', 'getrennt', 'offline', 'abgelehnt'] as const) {
      expect(syncZeigtWort(z, false), z).toBe(true);
    }
  });
});

describe('SyncZelle — Knopf zum Wiederherstellungsbereich (LLH-1758)', () => {
  const queue = { ...LEER, ausstehend: 2 };

  it('„n NICHT GESENDET“ ist ein Knopf und öffnet den Wiederherstellungsbereich', async () => {
    const hoerer = vi.fn();
    const abbestellen = subscribeWiederherstellung(hoerer);
    render(<SyncZelle zustand="ausstehend" queue={queue} kompakt={false} />);
    const knopf = screen.getByRole('button', { name: /2 Offline-Aktionen nicht gesendet/ });
    expect(knopf).toHaveTextContent('2 NICHT GESENDET');
    await userEvent.click(knopf);
    expect(hoerer).toHaveBeenCalledTimes(1);
    abbestellen();
  });

  it('abgelehnte Aktionen sind ebenfalls ein Knopf', () => {
    render(<SyncZelle zustand="abgelehnt" queue={{ ...LEER, abgelehnt: 1 }} kompakt={false} />);
    expect(screen.getByRole('button', { name: /abgelehnt/ })).toHaveTextContent('PRÜFEN');
  });

  it('unter md steht die Zahl neben dem Symbol, ohne Wort', () => {
    render(<SyncZelle zustand="ausstehend" queue={queue} kompakt />);
    const knopf = screen.getByRole('button', { name: /nicht gesendet/ });
    expect(knopf).toHaveTextContent('2');
    expect(knopf).not.toHaveTextContent('NICHT GESENDET');
  });

  it('die stehende Verbindung bleibt eine Anzeige, kein Knopf', () => {
    render(<SyncZelle zustand="verbunden" queue={LEER} kompakt={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Live-Verbindung steht' })).toBeInTheDocument();
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

describe('Handy-Kopf (LLH-1728)', () => {
  it('die Markenzelle als Link trägt Ziel und Namen der Wortmarke', () => {
    const { container } = render(
      <MemoryRouter>
        <Markenzelle alsLink />
      </MemoryRouter>,
    );
    const zelle = container.querySelector('[data-lfh="kopf-marke"]')!;
    expect(zelle.tagName).toBe('A');
    expect(zelle).toHaveAttribute('href', '/einsaetze');
    expect(zelle).toHaveAttribute('aria-label', 'lifeline-hub');
    expect(zelle).not.toHaveAttribute('aria-hidden');
  });

  it('als Link hält die Markenzelle den Boden der Dichte-Staffel', () => {
    const { container } = render(
      <ConfigProvider theme={{ token: { controlHeight: 72 } }}>
        <MemoryRouter>
          <Markenzelle alsLink />
        </MemoryRouter>
      </ConfigProvider>,
    );
    const zelle = container.querySelector<HTMLElement>('[data-lfh="kopf-marke"]')!;
    expect(zelle.style.minHeight).toBe('72px');
  });

  it('die Uhr zeigt taktisch und folgt ohne Neuladen der Gerätewahl (LLH-1750)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 17, 17, 31));
    try {
      zeitdarstellungVergessenFuerTests();
      const { container } = render(<Uhr />);
      const uhr = () => container.querySelector('[data-lfh="kopf-uhr"] time')!;
      expect(uhr()).toHaveTextContent(/^1731$/);
      act(() => setzeZeitdarstellung('datum_uhrzeit'));
      expect(uhr()).toHaveTextContent(/^17:31$/);
      act(() => setzeZeitdarstellung(null));
      expect(uhr()).toHaveTextContent(/^1731$/);
    } finally {
      zeitdarstellungVergessenFuerTests();
      vi.useRealTimers();
    }
  });

  it('die Uhr folgt der Darstellung des Einsatzes, wenn das Gerät nichts wählt', () => {
    zeitdarstellungVergessenFuerTests();
    const { container } = render(
      <AnzeigeKonventionenProvider konventionen={{ zeitdarstellung: 'datum_uhrzeit' }}>
        <Uhr />
      </AnzeigeKonventionenProvider>,
    );
    expect(container.querySelector('[data-lfh="kopf-uhr"] time')!.textContent).toMatch(
      /^\d{2}:\d{2}$/,
    );
  });

  it('die Uhr nimmt die Zellpolsterung des Handy-Kopfs', () => {
    const { container } = render(<Uhr zelle={{ padding: 8 }} />);
    const zelle = container.querySelector<HTMLElement>('[data-lfh="kopf-uhr"]')!;
    expect(zelle.style.paddingInlineStart).toBe('8px');
    expect(zelle.style.paddingInlineEnd).toBe('8px');
  });
});
