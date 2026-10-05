import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntApp } from 'antd';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { neuerQueryClient } from '../../test/utils';
import { einsatzKeys } from '../../api/queryKeys';

const ladeLageSnapshots = vi.fn();
const erzeugeLageSnapshot = vi.fn();
const loescheLageSnapshot = vi.fn();
const ladeLageSnapshot = vi.fn();
vi.mock('../../api/lageSnapshot', () => ({
  ladeLageSnapshots: (...a: unknown[]) => ladeLageSnapshots(...a),
  erzeugeLageSnapshot: (...a: unknown[]) => erzeugeLageSnapshot(...a),
  loescheLageSnapshot: (...a: unknown[]) => loescheLageSnapshot(...a),
  ladeLageSnapshot: (...a: unknown[]) => ladeLageSnapshot(...a),
}));

import { SnapshotLeiste, ANZEIGE_MS, bandStile, startEingeklappt } from './SnapshotLeiste';
import { setzeViewportBreite } from '../../test/viewport';
import { dichten } from '../../theme/tokens';
import {
  formatZeitKurz,
  type AnzeigeKonventionen,
  DEFAULT_KONVENTIONEN,
} from '../../anzeige/format';
import { AnzeigeKonventionenProvider } from '../../anzeige/AnzeigeKonventionenContext';
import { mitProzessZone } from '../../test/prozessZone';

type Snap = Record<string, unknown>;
function snapshot(over: Snap = {}): Snap {
  return {
    id: 7,
    einsatz_id: 5,
    bezeichnung: 'Stand A',
    notiz: null,
    stand_at: '2026-07-24 08:00:00',
    schema_version: 1,
    erstellt_von: 1,
    erstellt_at: '2026-07-24 08:00:00',
    ...over,
  };
}

/** Rendert mit vorbefülltem Cache (Liste synchron verfügbar → deterministisch, timer-freundlich). */
function renderLeiste(
  liste: Snap[],
  props: Record<string, unknown>,
  konventionen: AnzeigeKonventionen = {},
) {
  const client = neuerQueryClient();
  client.setQueryData(einsatzKeys.lageSnapshot(5), liste);
  ladeLageSnapshots.mockResolvedValue(liste);
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <AnzeigeKonventionenProvider konventionen={konventionen}>
        <AntApp>{children}</AntApp>
      </AnzeigeKonventionenProvider>
    </QueryClientProvider>
  );
  return render(
    <SnapshotLeiste
      einsatzId={5}
      darfSichern={false}
      onWaehle={vi.fn()}
      fehler={vi.fn()}
      {...props}
    />,
    { wrapper: Wrapper },
  );
}

/** Angezeigter Wert der Auswahl „Stand“. */
function auswahlText(): string | null {
  // antd 6 rendert die gewählte Option als `.ant-select-content` (Muster
  // `DokumentBearbeitenModal.test.tsx`).
  const feld = screen.getByRole('combobox', { name: 'Stand' });
  return feld.closest('.ant-select')!.querySelector('.ant-select-content')?.textContent ?? null;
}

/** Offene Liste greifen, nicht die Portale geschlossener Dropdowns (antd lässt sie stehen). */
async function waehleStand(titel: string) {
  await userEvent.click(screen.getByRole('combobox', { name: 'Stand' }));
  const knoten = await waitFor(() => {
    const k = document.querySelector<HTMLElement>(
      `.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="${titel}"]`,
    );
    expect(k).not.toBeNull();
    return k!;
  });
  await userEvent.click(knoten);
}

// Ohne gemerkte Wahl startet die Leiste erst ab `xl` ausgeklappt; die Bestandstests prüfen die
// ausgeklappte Leiste und laufen deshalb bei 1440 px. Die Breitenregel prüfen die Tests unten.
beforeEach(() => setzeViewportBreite(1440));

describe('SnapshotLeiste', () => {
  beforeEach(() => {
    ladeLageSnapshots.mockReset();
    erzeugeLageSnapshot.mockReset();
    ladeLageSnapshot.mockReset();
    ladeLageSnapshot.mockResolvedValue(snapshot());
  });
  afterEach(() => vi.useRealTimers());

  it('„Stand sichern" öffnet den Dialog; Enter sichert mit der Bezeichnung und schließt', async () => {
    erzeugeLageSnapshot.mockResolvedValue(snapshot());
    renderLeiste([], { darfSichern: true });
    // Das Feld steht nicht dauerhaft im Band (LFH-899, D2).
    expect(screen.queryByLabelText('Snapshot-Bezeichnung')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Stand sichern' }));
    const dialog = await screen.findByRole('dialog', { name: 'Stand sichern' });
    const feld = within(dialog).getByLabelText('Snapshot-Bezeichnung');
    await waitFor(() => expect(feld).toHaveFocus());
    await userEvent.type(feld, '08:00 Lage{Enter}');
    await waitFor(() =>
      expect(erzeugeLageSnapshot).toHaveBeenCalledWith(5, { bezeichnung: '08:00 Lage' }),
    );
    // Erfolg quittiert und schließt: antd hängt das Modal erst nach `transitionend` ab, das jsdom
    // nie feuert; beobachtbar ist der Austritt (`ant-zoom-leave`).
    expect(await screen.findByText('Stand gesichert')).toBeInTheDocument();
    await waitFor(() => expect(dialog).toHaveClass('ant-zoom-leave'));
  });

  it('der Knopf „Sichern" im Dialog sichert; ohne Bezeichnung ohne Bezeichnung', async () => {
    erzeugeLageSnapshot.mockResolvedValue(snapshot());
    renderLeiste([], { darfSichern: true });
    await userEvent.click(screen.getByRole('button', { name: 'Stand sichern' }));
    const dialog = await screen.findByRole('dialog', { name: 'Stand sichern' });
    const knopf = within(dialog).getByRole('button', { name: 'Sichern' });
    // Erfassungs-Norm: Absende-Knopf im <form>, keine Modal-Fußzeile.
    expect(knopf.closest('form')).not.toBeNull();
    expect(document.querySelector('.ant-modal-footer')).toBeNull();
    await userEvent.click(knopf);
    await waitFor(() => expect(erzeugeLageSnapshot).toHaveBeenCalledWith(5, { bezeichnung: null }));
  });

  it('ein abgelehntes Sichern meldet den Fehler und lässt Dialog und Wortlaut stehen', async () => {
    const fehler = vi.fn();
    erzeugeLageSnapshot.mockRejectedValue(new Error('kaputt'));
    renderLeiste([], { darfSichern: true, fehler });
    await userEvent.click(screen.getByRole('button', { name: 'Stand sichern' }));
    const dialog = await screen.findByRole('dialog', { name: 'Stand sichern' });
    await userEvent.type(within(dialog).getByLabelText('Snapshot-Bezeichnung'), 'Lage{Enter}');
    await waitFor(() => expect(fehler).toHaveBeenCalled());
    expect(within(dialog).getByLabelText('Snapshot-Bezeichnung')).toHaveValue('Lage');
  });

  it('die Auswahl „Stand“ bietet Live und die Stände an, die neuesten oben', async () => {
    renderLeiste(
      [
        snapshot({ id: 10, bezeichnung: 'Stand A', stand_at: '2026-07-24 08:00:00' }),
        snapshot({ id: 30, bezeichnung: null, stand_at: '2026-07-24 10:15:00' }),
        snapshot({ id: 20, bezeichnung: 'Stand B', stand_at: '2026-07-24 09:00:00' }),
      ],
      {},
    );
    await userEvent.click(screen.getByRole('combobox', { name: 'Stand' }));
    const titel = await waitFor(() => {
      const t = Array.from(
        document.querySelectorAll<HTMLElement>(
          '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option',
        ),
      ).map((o) => o.getAttribute('title'));
      expect(t.length).toBe(4);
      return t;
    });
    // Ohne Bezeichnung die Uhrzeit (`formatZeitKurz`, UTC-Wire-String).
    expect(titel).toEqual([
      'Live',
      formatZeitKurz('2026-07-24 10:15:00', DEFAULT_KONVENTIONEN),
      'Stand B',
      'Stand A',
    ]);
  });

  it('die Auswahl zeigt den aktiven Stand, sonst „Live“', () => {
    const liste = [snapshot({ id: 7, bezeichnung: 'Stand A' })];
    const { unmount } = renderLeiste(liste, { aktiverSnapshotId: 7 });
    expect(auswahlText()).toBe('Stand A');
    unmount();
    renderLeiste(liste, {});
    expect(auswahlText()).toBe('Live');
  });

  it('ein unbekannter aktiver Stand (gelöscht, alter Link) zeigt „Live“, nicht seine Id', () => {
    renderLeiste([snapshot({ id: 7, bezeichnung: 'Stand A' })], { aktiverSnapshotId: 42 });
    expect(auswahlText()).toBe('Live');
  });

  it('eine Wahl in der Auswahl ruft onWaehle(id), „Live“ ruft onWaehle(null)', async () => {
    const onWaehle = vi.fn();
    const liste = [snapshot({ id: 7, bezeichnung: 'Stand A' })];
    const { unmount } = renderLeiste(liste, { aktiverSnapshotId: 7, onWaehle });
    await waehleStand('Live');
    expect(onWaehle).toHaveBeenLastCalledWith(null);
    unmount();
    renderLeiste(liste, { onWaehle });
    await waehleStand('Stand A');
    expect(onWaehle).toHaveBeenLastCalledWith(7);
  });

  it('im Band stehen keine Stand-Knöpfe und kein „Aktuell“ (LFH-899, D1)', () => {
    const { container } = renderLeiste(
      [snapshot(), snapshot({ id: 2, bezeichnung: 'Stand B', stand_at: '2026-07-24 09:00:00' })],
      { darfSichern: true },
    );
    // Positivkontrolle: das Band steht ausgeklappt mit beiden Ständen.
    expect(screen.getByRole('combobox', { name: 'Stand' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stand A' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stand B' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Aktuell' })).toBeNull();
    expect(container.querySelector('[data-lfh="zeitachse-staende"]')).toBeNull();
  });

  it('rendert nichts ohne Schreibrecht und ohne Stände', () => {
    renderLeiste([], { darfSichern: false });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('Replay: Play springt auf den ältesten Stand und zeigt Pause; Zeitleisten-Slider vorhanden', async () => {
    const onWaehle = vi.fn();
    // Reihenfolge absichtlich neu→alt (wie das Backend liefert) — der Slider muss chronologisch sortieren.
    renderLeiste(
      [
        snapshot({ id: 20, bezeichnung: 'B', stand_at: '2026-07-24 09:00:00' }),
        snapshot({ id: 10, bezeichnung: 'A', stand_at: '2026-07-24 08:00:00' }),
      ],
      { onWaehle },
    );
    expect(screen.getByRole('slider')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Abspielen' }));
    expect(onWaehle).toHaveBeenCalledWith(10); // ältester Stand chronologisch
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('Replay schreitet nach der Anzeigedauer zum nächsten Stand fort und lädt ihn vor', async () => {
    vi.useFakeTimers();
    const onWaehle = vi.fn();
    const { rerender } = renderLeiste(
      [
        snapshot({ id: 10, bezeichnung: 'A', stand_at: '2026-07-24 08:00:00' }),
        snapshot({ id: 20, bezeichnung: 'B', stand_at: '2026-07-24 09:00:00' }),
      ],
      { onWaehle },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Abspielen' }));
    expect(onWaehle).toHaveBeenCalledWith(10);

    // LagekartePage setzte ?snapshot=10 → Rerender mit aktivem Stand 10 (spielt bleibt an).
    rerender(
      <SnapshotLeiste
        einsatzId={5}
        darfSichern={false}
        aktiverSnapshotId={10}
        onWaehle={onWaehle}
        fehler={vi.fn()}
      />,
    );
    await vi.advanceTimersByTimeAsync(ANZEIGE_MS);
    expect(ladeLageSnapshot).toHaveBeenCalledWith(5, 20); // Vorladen des nächsten Dokuments
    expect(onWaehle).toHaveBeenLastCalledWith(20);
  });

  it('Replay stoppt am Ende der Folge (Out-of-Bounds-Guard)', async () => {
    vi.useFakeTimers();
    const onWaehle = vi.fn();
    const { rerender } = renderLeiste(
      [
        snapshot({ id: 10, bezeichnung: 'A', stand_at: '2026-07-24 08:00:00' }),
        snapshot({ id: 20, bezeichnung: 'B', stand_at: '2026-07-24 09:00:00' }),
      ],
      { onWaehle },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Abspielen' }));
    rerender(
      <SnapshotLeiste
        einsatzId={5}
        darfSichern={false}
        aktiverSnapshotId={10}
        onWaehle={onWaehle}
        fehler={vi.fn()}
      />,
    );
    await vi.advanceTimersByTimeAsync(ANZEIGE_MS);
    expect(onWaehle).toHaveBeenLastCalledWith(20);

    // Am letzten Stand (spielt bleibt an) → kein weiterer Schritt, die Wiedergabe stoppt. Ohne den
    // next>=length-Guard würfe chrono[2] hier.
    onWaehle.mockClear();
    rerender(
      <SnapshotLeiste
        einsatzId={5}
        darfSichern={false}
        aktiverSnapshotId={20}
        onWaehle={onWaehle}
        fehler={vi.fn()}
      />,
    );
    await vi.advanceTimersByTimeAsync(ANZEIGE_MS * 2);
    expect(onWaehle).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Abspielen' })).toBeInTheDocument();
  });

  it('Replay startet neu vom Anfang, wenn man am letzten Stand abspielt', async () => {
    const onWaehle = vi.fn();
    renderLeiste(
      [
        snapshot({ id: 10, bezeichnung: 'A', stand_at: '2026-07-24 08:00:00' }),
        snapshot({ id: 20, bezeichnung: 'B', stand_at: '2026-07-24 09:00:00' }),
      ],
      { aktiverSnapshotId: 20, onWaehle },
    );
    await userEvent.click(screen.getByRole('button', { name: 'Abspielen' }));
    expect(onWaehle).toHaveBeenCalledWith(10); // Neustart am ältesten Stand
  });

  it('Ausblenden lässt nur den Einblenden-Knopf stehen, Einblenden holt die Leiste zurück', async () => {
    renderLeiste([snapshot({ id: 7, bezeichnung: 'Stand A' })], { darfSichern: true });
    await userEvent.click(await screen.findByRole('button', { name: 'Zeitachse ausblenden' }));
    expect(screen.queryByRole('combobox', { name: 'Stand' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stand sichern' })).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Zeitachse einblenden' }));
    expect(screen.getByRole('combobox', { name: 'Stand' })).toBeInTheDocument();
  });

  it('der eingeklappte Zustand überlebt einen Remount (per-User gemerkt)', async () => {
    const erst = renderLeiste([snapshot({ id: 7, bezeichnung: 'Stand A' })], {});
    await userEvent.click(await screen.findByRole('button', { name: 'Zeitachse ausblenden' }));
    erst.unmount();

    renderLeiste([snapshot({ id: 7, bezeichnung: 'Stand A' })], {});
    expect(await screen.findByRole('button', { name: 'Zeitachse einblenden' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Stand' })).toBeNull();
  });

  it('Ausblenden stoppt eine laufende Wiedergabe (sonst liefe sie ohne sichtbare Pause-Taste weiter)', async () => {
    renderLeiste(
      [
        snapshot({ id: 10, bezeichnung: 'A', stand_at: '2026-07-24 08:00:00' }),
        snapshot({ id: 20, bezeichnung: 'B', stand_at: '2026-07-24 09:00:00' }),
      ],
      {},
    );
    await userEvent.click(screen.getByRole('button', { name: 'Abspielen' }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Zeitachse ausblenden' }));
    await userEvent.click(screen.getByRole('button', { name: 'Zeitachse einblenden' }));
    expect(screen.getByRole('button', { name: 'Abspielen' })).toBeInTheDocument();
  });

  it('eine Wahl in der Auswahl unterbricht eine laufende Wiedergabe', async () => {
    const onWaehle = vi.fn();
    renderLeiste(
      [
        snapshot({ id: 10, bezeichnung: 'A', stand_at: '2026-07-24 08:00:00' }),
        snapshot({ id: 20, bezeichnung: 'B', stand_at: '2026-07-24 09:00:00' }),
      ],
      { onWaehle },
    );
    await userEvent.click(screen.getByRole('button', { name: 'Abspielen' }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    await waehleStand('B');
    expect(onWaehle).toHaveBeenLastCalledWith(20);
    expect(screen.getByRole('button', { name: 'Abspielen' })).toBeInTheDocument();
  });
});

describe('SnapshotLeiste — Platz im KartenFuss (LFH-355)', () => {
  it('ausgeklappt: volle Bandbreite im Fluss, ohne eigene Positionierung', () => {
    const { container } = renderLeiste([snapshot()], { darfSichern: true });
    const band = container.querySelector('div[style*="pointer-events"]') as HTMLElement;
    expect(band.style.position).toBe('');
    expect(band.style.zIndex).toBe('');
    expect(band.style.alignSelf).toBe('stretch');
    expect(band.style.pointerEvents).toBe('auto');
  });

  it('eingeklappt: linksbündiger Knopf im Fluss, ohne eigene Positionierung', async () => {
    renderLeiste([snapshot()], { darfSichern: true });
    await userEvent.click(screen.getByRole('button', { name: 'Zeitachse ausblenden' }));
    const knopf = screen.getByRole('button', { name: 'Zeitachse einblenden' });
    expect(knopf.style.position).toBe('');
    expect(knopf.style.zIndex).toBe('');
    expect(knopf.style.alignSelf).toBe('flex-start');
    expect(knopf.style.pointerEvents).toBe('auto');
  });

  it('Startzustand: gemerkte Wahl gewinnt, ohne Wahl eingeklappt nur auf dem Handschirm', () => {
    expect(startEingeklappt(null, true)).toBe(true);
    expect(startEingeklappt(null, false)).toBe(false);
    expect(startEingeklappt(false, true)).toBe(false);
    expect(startEingeklappt(true, false)).toBe(true);
  });

  it.each([390, 1024])('bei %i px ohne gemerkte Wahl steht nur der Einblenden-Knopf', (breite) => {
    setzeViewportBreite(breite);
    renderLeiste([snapshot()], { darfSichern: true });
    expect(screen.getByRole('button', { name: 'Zeitachse einblenden' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Stand sichern/ })).toBeNull();
  });

  it('ab xl ohne gemerkte Wahl ausgeklappt; eine gemerkte Wahl schlägt die Breite', () => {
    setzeViewportBreite(1440);
    const { unmount } = renderLeiste([snapshot()], { darfSichern: true });
    expect(screen.getByRole('button', { name: /Stand sichern/ })).toBeInTheDocument();
    unmount();
    localStorage.setItem('lfh:lagekarte:zeitachse-eingeklappt', '0');
    setzeViewportBreite(390);
    renderLeiste([snapshot()], { darfSichern: true });
    expect(screen.getByRole('button', { name: /Stand sichern/ })).toBeInTheDocument();
  });
});

describe('SnapshotLeiste — zwei Gruppen, Abstände aus der Staffel (LFH-899)', () => {
  /** Die Werte der Stufe `handschuh`, so wie `antdToken` sie ins Theme legt. */
  const HANDSCHUH = {
    controlHeight: dichten.handschuh.zeilenhoehe,
    margin: dichten.handschuh.abstand.md,
    marginSM: dichten.handschuh.abstand.sm,
    paddingSM: dichten.handschuh.abstand.sm,
  };
  const KOMPAKT = {
    controlHeight: dichten.kompakt.zeilenhoehe,
    margin: dichten.kompakt.abstand.md,
    marginSM: dichten.kompakt.abstand.sm,
    paddingSM: dichten.kompakt.abstand.sm,
  };

  it('Gruppenlücke `margin`, Lücke in der Gruppe `marginSM`, Polsterung `paddingSM`', () => {
    const s = bandStile(HANDSCHUH);
    // Literale statt Rechnung: 26 / 16 / 16 ist die Handschuh-Stufe aus `theme/tokens.ts`.
    expect(s.band.gap).toBe(26);
    expect(s.band.padding).toBe(16);
    expect(s.wiedergabe.gap).toBe(16);
    expect(s.stand.gap).toBe(16);
    expect(s.schieber.marginInline).toBe(16);
    // Gegenprobe: die Abstände wachsen mit der Stufe.
    expect(bandStile(KOMPAKT).band.padding).toBe(7);
  });

  it('jede Gruppe bleibt in einer Zeile, das Band bricht zwischen den Gruppen um', () => {
    const s = bandStile(HANDSCHUH);
    expect(s.band.flexWrap).toBe('wrap');
    expect(s.wiedergabe.flexWrap).toBe('nowrap');
    expect(s.stand.flexWrap).toBe('nowrap');
    // Ohne `minWidth: 0` nähme eine Gruppe ihre Inhaltsbreite an und liefe über den Bandrand.
    expect(s.wiedergabe.minWidth).toBe(0);
    expect(s.stand.minWidth).toBe(0);
    expect(s.schieber.minWidth).toBe(0);
    expect(s.auswahl.minWidth).toBe(0);
  });

  it('beide Gruppen passen im Fükw in eine Zeile, am Tablet nicht', () => {
    // Innenbreite = Bandbreite − 2 × Polsterung; Bandbreiten gemessen auf `alpha` (design.md).
    for (const [token, fuekw, tablet] of [
      [HANDSCHUH, 730 - 32, 335 - 32],
      [KOMPAKT, 730 - 14, 335 - 14],
    ] as const) {
      const s = bandStile(token);
      const zeile = s.wiedergabeBasis + token.margin + s.standBasis;
      expect(zeile).toBeLessThanOrEqual(fuekw);
      expect(zeile).toBeGreaterThan(tablet);
    }
  });

  it('Ausblenden, Abspielen und Sichern schrumpfen nicht unter ihre Kante', () => {
    const s = bandStile(HANDSCHUH);
    expect(s.knopf.flexShrink).toBe(0);
  });

  it('die Gruppen tragen die Ziele: Ausblenden, Abspielen, Schieber | Auswahl, Sichern', () => {
    const { container } = renderLeiste(
      [snapshot(), snapshot({ id: 2, bezeichnung: 'Stand B', stand_at: '2026-07-24 09:00:00' })],
      { darfSichern: true },
    );
    const wiedergabe = container.querySelector('[data-lfh="zeitachse-wiedergabe"]') as HTMLElement;
    const stand = container.querySelector('[data-lfh="zeitachse-stand"]') as HTMLElement;
    expect(within(wiedergabe).getByRole('button', { name: 'Zeitachse ausblenden' })).toBeTruthy();
    expect(within(wiedergabe).getByRole('button', { name: 'Abspielen' })).toBeTruthy();
    expect(within(wiedergabe).getByRole('slider')).toBeTruthy();
    expect(within(stand).getByRole('combobox', { name: 'Stand' })).toBeTruthy();
    expect(within(stand).getByRole('button', { name: 'Stand sichern' })).toBeTruthy();
  });

  it('ohne Schreibrecht fehlt „Stand sichern“, die Auswahl bleibt', () => {
    renderLeiste([snapshot()], { darfSichern: false });
    expect(screen.getByRole('combobox', { name: 'Stand' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stand sichern' })).toBeNull();
  });

  it('„Stand sichern" heißt so — ohne das englische Symbol-Label „camera" davor', () => {
    renderLeiste([snapshot()], { darfSichern: true });
    expect(screen.getByRole('button', { name: 'Stand sichern' })).toBeInTheDocument();
  });
});

/** LFH-913 (Spec `zeiteingabe`): ein Stand ohne Bezeichnung heißt nach seiner Zeit in der Anzeigezone. */
describe('SnapshotLeiste — Standzeit in der Anzeigezone (LFH-913)', () => {
  mitProzessZone('UTC');

  it('ein Stand von 08:00 UTC heißt in der Auswahl 241000 (Berlin)', async () => {
    renderLeiste(
      [snapshot({ id: 7, bezeichnung: null, stand_at: '2026-07-24 08:00:00' })],
      { aktiverSnapshotId: 7 },
      { zeitzone: 'Europe/Berlin' },
    );
    expect(auswahlText()).toBe('241000');
  });
});
