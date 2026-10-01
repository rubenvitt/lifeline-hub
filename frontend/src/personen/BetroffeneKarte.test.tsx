import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type { Person } from '../api/types';
import type { KartenflaecheProps } from '../pages/lagekarte/Kartenflaeche';
import BetroffeneKarte, { ohneKoordinateText } from './BetroffeneKarte';

/**
 * Die echte Karte braucht WebGL. Der Stub zeigt, welche Marker die Kartenansicht übergibt (Lage
 * und Beschriftung), und meldet ein Auffächern wie die echte Karte (`onSpiderOffen`). Dass die
 * Karte im Browser stehen bleibt, belegt `e2e/betroffene-layout.spec.ts`.
 */
vi.mock('../pages/lagekarte/Kartenflaeche', () => ({
  default: (props: Partial<KartenflaecheProps>) => (
    <div data-testid="kartenflaeche-stub">
      {(props.markers ?? [])
        .filter((m) => m.typ === 'person')
        .map((m) => (
          <span key={m.schluessel} data-testid="marker">
            {m.schluessel} {m.label} @{m.lat}/{m.lon}
          </span>
        ))}
      <button onClick={() => props.onSpiderOffen?.(true)}>stub-auffaechern</button>
      <button onClick={() => props.onSpiderOffen?.(false)}>stub-zuklappen</button>
    </div>
  ),
}));

beforeEach(() => {
  server.use(
    http.get('/api/karte/config', () => HttpResponse.json({})),
    http.get('/api/einsaetze/1/karten-ansichten', () => HttpResponse.json([])),
  );
});

const basis: Person = {
  id: 1,
  einsatz_id: 1,
  registrier_nr: 1,
  status: 'betroffen',
  name: null,
  vorname: null,
  geschlecht: null,
  geburtsdatum: null,
  alter_geschaetzt: null,
  herkunft_adresse: null,
  antreff_ort: null,
  melder_kontakt: null,
  notiz: null,
  erfasst_at: '2026-10-01 09:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-10-01 09:00:00',
  geaendert_von: 1,
  storniert_at: null,
};

function p(id: number, teil: Partial<Person> = {}): Person {
  return {
    ...basis,
    id,
    registrier_nr: id,
    antreff_lat: Number((52.26 + id / 1000).toFixed(3)),
    antreff_lon: 9.13,
    ...teil,
  };
}

function renderKarte(personen: Person[]) {
  const ui = (ps: Person[]) => (
    <BetroffeneKarte einsatzId={1} einsatz={undefined} personen={ps} onPersonKlick={() => {}} />
  );
  const r = renderMitProviders(ui(personen));
  return { ...r, neu: (ps: Person[]) => r.rerender(ui(ps)) };
}

const bereich = () => screen.getByTestId('betroffene-karte-bereich');
const marker = () => screen.getAllByTestId('marker').map((m) => m.textContent);
const standzeile = () => screen.getByTestId('betroffene-karte-stand');
const banner = () => document.querySelector<HTMLElement>('[data-lfh="sammelbanner"]');

describe('ohneKoordinateText', () => {
  it('bisheriger Wortlaut ohne wartende Zugänge', () => {
    expect(ohneKoordinateText(0, 2, 0)).toBe(
      'Alle angetroffenen Personen dieser Auswahl stehen auf der Karte',
    );
    expect(ohneKoordinateText(0, 0, 0)).toBe('Keine angetroffene Person in dieser Auswahl');
    expect(ohneKoordinateText(3, 2, 1)).toBe('3 Personen ohne Koordinate — nicht auf der Karte');
  });

  it('wartet ein Zugang, behauptet er KEINE vollständige Karte (LFH-668, D6)', () => {
    expect(ohneKoordinateText(0, 2, 1)).toBe('Keine Person ohne Koordinate');
    expect(ohneKoordinateText(0, 0, 1)).toBe('Keine Person ohne Koordinate');
  });
});

describe('BetroffeneKarte — Schleuse (LFH-668)', () => {
  it('offen: frische Marker gehen sofort durch, die Standzeile sagt „Live", kein Banner', async () => {
    const { neu } = renderKarte([p(1)]);
    await screen.findByTestId('kartenflaeche-stub');
    expect(standzeile()).toHaveTextContent(/^Live$/);
    neu([p(1), p(2)]);
    expect(marker()).toHaveLength(2);
    expect(banner()).toBeNull();
  });

  it('Maus im Bereich: ein Zugang wartet im Banner, die Sichtung fließt, „anzeigen" übernimmt', async () => {
    const { neu } = renderKarte([p(1)]);
    await screen.findByTestId('kartenflaeche-stub');
    fireEvent.pointerEnter(bereich(), { pointerType: 'mouse' });
    expect(standzeile()).toHaveTextContent('Live pausiert');

    neu([p(1, { aktuelle_sichtung: 'sk1' }), p(2)]);
    expect(marker()).toEqual(['person-1 R-001 · SK I @52.261/9.13']);
    expect(banner()).toHaveAttribute('role', 'status');
    expect(banner()).toHaveTextContent('1 neu');
    // Die letzte Lücke ist zu, aber ein Zugang wartet: keine Vollständigkeit behaupten.
    expect(screen.getByText('Keine Person ohne Koordinate')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'anzeigen' }));
    expect(marker()).toHaveLength(2);
    expect(banner()).toBeNull();
    // Der Zeiger ist noch drin: die Schleuse bleibt zu, auf dem neuen Stand.
    expect(standzeile()).toHaveTextContent('Live pausiert');
  });

  it('Verlegung und Wegfall warten, die gehaltene Lage und der Wegfall bleiben stehen', async () => {
    const { neu } = renderKarte([p(1), p(2)]);
    await screen.findByTestId('kartenflaeche-stub');
    fireEvent.pointerEnter(bereich(), { pointerType: 'pen' });
    neu([p(1, { antreff_lat: 53 })]);
    expect(marker()).toEqual([
      'person-1 R-001 · ohne Sichtung @52.261/9.13',
      'person-2 R-002 · ohne Sichtung @52.262/9.13',
    ]);
    expect(banner()).toHaveTextContent('1 verlegt · 1 entfallen');
  });

  it('Verlassen ohne Auffächerung wendet den Live-Stand an', async () => {
    const { neu } = renderKarte([p(1)]);
    await screen.findByTestId('kartenflaeche-stub');
    fireEvent.pointerEnter(bereich(), { pointerType: 'mouse' });
    neu([p(1), p(2)]);
    expect(marker()).toHaveLength(1);
    fireEvent.pointerLeave(bereich(), { pointerType: 'mouse' });
    expect(marker()).toHaveLength(2);
    expect(banner()).toBeNull();
    expect(standzeile()).toHaveTextContent(/^Live$/);
  });

  it('ein verpasstes Betreten holt die erste Bewegung im Bereich nach', async () => {
    // Erscheint die Ansicht unter einem ruhenden Zeiger, meldet der Browser beim nächsten Bewegen
    // kein `pointerenter` für den Bereich — die Schleuse bliebe sonst offen.
    const { neu } = renderKarte([p(1)]);
    await screen.findByTestId('kartenflaeche-stub');
    fireEvent.pointerMove(bereich(), { pointerType: 'mouse' });
    expect(standzeile()).toHaveTextContent('Live pausiert');
    neu([p(1), p(2)]);
    expect(marker()).toHaveLength(1);
  });

  it('Touch schließt die Schleuse nicht', async () => {
    const { neu } = renderKarte([p(1)]);
    await screen.findByTestId('kartenflaeche-stub');
    fireEvent.pointerEnter(bereich(), { pointerType: 'touch' });
    fireEvent.pointerMove(bereich(), { pointerType: 'touch' });
    neu([p(1), p(2)]);
    expect(marker()).toHaveLength(2);
  });

  it('ein aufgefächertes Bündel hält auch ohne Zeiger, Zuklappen wendet an', async () => {
    const { neu } = renderKarte([p(1)]);
    await screen.findByTestId('kartenflaeche-stub');
    act(() => screen.getByRole('button', { name: 'stub-auffaechern' }).click());
    neu([p(1), p(2)]);
    expect(marker()).toHaveLength(1);
    expect(banner()).toHaveTextContent('1 neu');
    act(() => screen.getByRole('button', { name: 'stub-zuklappen' }).click());
    expect(marker()).toHaveLength(2);
  });

  it('Zuklappen bei Zeiger im Bereich hält weiter', async () => {
    const { neu } = renderKarte([p(1)]);
    await screen.findByTestId('kartenflaeche-stub');
    fireEvent.pointerEnter(bereich(), { pointerType: 'mouse' });
    act(() => screen.getByRole('button', { name: 'stub-auffaechern' }).click());
    act(() => screen.getByRole('button', { name: 'stub-zuklappen' }).click());
    neu([p(1), p(2)]);
    expect(marker()).toHaveLength(1);
  });

  it('Verlassen bei aufgefächertem Bündel hält weiter', async () => {
    const { neu } = renderKarte([p(1)]);
    await screen.findByTestId('kartenflaeche-stub');
    fireEvent.pointerEnter(bereich(), { pointerType: 'mouse' });
    act(() => screen.getByRole('button', { name: 'stub-auffaechern' }).click());
    neu([p(1), p(2)]);
    fireEvent.pointerLeave(bereich(), { pointerType: 'mouse' });
    expect(marker()).toHaveLength(1);
    expect(banner()).toHaveTextContent('1 neu');
    act(() => screen.getByRole('button', { name: 'stub-zuklappen' }).click());
    expect(marker()).toHaveLength(2);
  });

  it('Verlassen mit Tastaturfokus im Bereich hält weiter', async () => {
    const { neu } = renderKarte([p(1)]);
    await screen.findByTestId('kartenflaeche-stub');
    fireEvent.pointerEnter(bereich(), { pointerType: 'mouse' });
    act(() => screen.getByRole('button', { name: 'stub-auffaechern' }).focus());
    neu([p(1), p(2)]);
    fireEvent.pointerLeave(bereich(), { pointerType: 'mouse' });
    expect(marker()).toHaveLength(1);
  });

  it('ein Fokus durch Klick oder Tipp zählt nicht — nach dem Verlassen ist die Karte live (Review LFH-668)', async () => {
    // MapLibre gibt dem Canvas `tabindex=0`: ein Klick oder Tipp fokussiert ihn. Zählte das als
    // Fokus, bliebe die Karte nach dem Verlassen gehalten.
    const { neu } = renderKarte([p(1)]);
    await screen.findByTestId('kartenflaeche-stub');
    const ziel = screen.getByRole('button', { name: 'stub-auffaechern' });
    fireEvent.pointerEnter(bereich(), { pointerType: 'mouse' });
    fireEvent.pointerDown(ziel, { pointerType: 'mouse' });
    act(() => ziel.focus());
    fireEvent.pointerLeave(bereich(), { pointerType: 'mouse' });
    neu([p(1), p(2)]);
    expect(marker()).toHaveLength(2);
    // Touch: das kompatible `mousedown` und damit der Fokus kommen erst nach `pointerup`.
    fireEvent.pointerDown(ziel, { pointerType: 'touch' });
    fireEvent.pointerUp(ziel, { pointerType: 'touch' });
    act(() => ziel.blur());
    act(() => ziel.focus());
    neu([p(1), p(2), p(3)]);
    expect(marker()).toHaveLength(3);
  });

  it('Tastaturfokus, dann Klick in die Karte: der Zeigerfokus übernimmt, Verlassen gibt frei (Re-Review LFH-668)', async () => {
    const { neu } = renderKarte([p(1)]);
    await screen.findByTestId('kartenflaeche-stub');
    act(() => screen.getByRole('button', { name: 'stub-auffaechern' }).focus());
    const ziel = screen.getByRole('button', { name: 'stub-zuklappen' });
    fireEvent.pointerEnter(bereich(), { pointerType: 'mouse' });
    fireEvent.pointerDown(ziel, { pointerType: 'mouse' });
    act(() => ziel.focus());
    fireEvent.pointerLeave(bereich(), { pointerType: 'mouse' });
    neu([p(1), p(2)]);
    expect(marker()).toHaveLength(2);
  });

  it('langer Druck: das Zeitfenster läuft auch ab dem Loslassen (Re-Review LFH-668)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { neu } = renderKarte([p(1)]);
      await screen.findByTestId('kartenflaeche-stub');
      const ziel = screen.getByRole('button', { name: 'stub-auffaechern' });
      fireEvent.pointerEnter(bereich(), { pointerType: 'mouse' });
      fireEvent.pointerDown(ziel, { pointerType: 'mouse' });
      vi.setSystemTime(Date.now() + 3000);
      fireEvent.pointerUp(ziel, { pointerType: 'mouse' });
      act(() => ziel.focus());
      fireEvent.pointerLeave(bereich(), { pointerType: 'mouse' });
      neu([p(1), p(2)]);
      expect(marker()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('„anzeigen" lässt keine Fokus-Bedingung zurück: nach dem Verlassen ist die Karte live (Review LFH-668)', async () => {
    const { neu } = renderKarte([p(1)]);
    await screen.findByTestId('kartenflaeche-stub');
    fireEvent.pointerEnter(bereich(), { pointerType: 'mouse' });
    neu([p(1), p(2)]);
    await userEvent.click(screen.getByRole('button', { name: 'anzeigen' }));
    fireEvent.pointerLeave(bereich(), { pointerType: 'mouse' });
    expect(standzeile()).toHaveTextContent(/^Live$/);
    neu([p(1), p(2), p(3)]);
    expect(marker()).toHaveLength(3);
  });

  it('„anzeigen" per Tastatur: der Fokus bleibt im Bereich (Standzeile), Tab hinaus wendet an', async () => {
    const { neu } = renderKarte([p(1)]);
    await screen.findByTestId('kartenflaeche-stub');
    act(() => screen.getByRole('button', { name: 'stub-auffaechern' }).focus());
    neu([p(1), p(2)]);
    const knopf = screen.getByRole('button', { name: 'anzeigen' });
    act(() => knopf.focus());
    await userEvent.keyboard('{Enter}');
    expect(banner()).toBeNull();
    expect(document.activeElement).toBe(standzeile());
    expect(standzeile()).toHaveTextContent('Live pausiert');
    act(() => standzeile().blur());
    neu([p(1), p(2), p(3)]);
    expect(marker()).toHaveLength(3);
  });

  it('verschwindet der Fokus aus dem Bereich ohne `focusout`, räumt die Karte die Bedingung', async () => {
    const { neu } = renderKarte([p(1)]);
    await screen.findByTestId('kartenflaeche-stub');
    fireEvent.focus(screen.getByRole('button', { name: 'stub-auffaechern' }));
    // Der Fokus liegt in Wahrheit auf `body` (entfernter Knoten, Firefox meldet nichts).
    neu([p(1), p(2)]);
    expect(marker()).toHaveLength(2);
  });

  it('ein Druck außerhalb der Ansicht beendet die Bündel-Bedingung (Filter wirkt sofort)', async () => {
    const { neu } = renderKarte([p(1)]);
    await screen.findByTestId('kartenflaeche-stub');
    act(() => screen.getByRole('button', { name: 'stub-auffaechern' }).click());
    neu([p(1), p(2)]);
    expect(marker()).toHaveLength(1);
    fireEvent.pointerDown(document.body, { pointerType: 'touch' });
    expect(marker()).toHaveLength(2);
  });

  it('Fokus im Bereich hält, Fokus nach außen wendet an', async () => {
    const { neu } = renderKarte([p(1)]);
    await screen.findByTestId('kartenflaeche-stub');
    const innen = screen.getByRole('button', { name: 'stub-auffaechern' });
    act(() => innen.focus());
    neu([p(1), p(2)]);
    expect(marker()).toHaveLength(1);
    // Wechsel innerhalb des Bereichs taut nicht auf.
    act(() => screen.getByRole('button', { name: 'stub-zuklappen' }).focus());
    expect(marker()).toHaveLength(1);
    act(() => (document.activeElement as HTMLElement).blur());
    expect(marker()).toHaveLength(2);
  });
});
