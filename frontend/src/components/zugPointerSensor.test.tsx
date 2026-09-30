import { DndContext, PointerSensor, useDraggable, useSensor, useSensors } from '@dnd-kit/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZugPointerSensor } from './zugPointerSensor';

/**
 * LFH-519: nach einem Zug schluckte dnd-kit den ersten ECHTEN Klick. Der `PointerSensor` hängt
 * beim Zugbeginn einen `click`-Stopper in die Capture-Phase von `document` und nimmt ihn erst per
 * `setTimeout(…, 50)` wieder ab. Unter Last verhungert dieser Timer, weil Chromium Eingaben vor
 * Timern abarbeitet, und der nächste Klick endet am Stopper, bevor er Reacts Wurzel erreicht.
 *
 * Die Fake-Timer bilden genau das nach: der 50-ms-Timer läuft nie, solange der Test ihn nicht
 * vorrückt.
 */

function Aufbau({ sensor, onKlick }: { sensor: typeof PointerSensor; onKlick: () => void }) {
  const sensors = useSensors(useSensor(sensor, { activationConstraint: { distance: 5 } }));
  return (
    <DndContext sensors={sensors}>
      <Ziehbar />
      <button type="button" onClick={onKlick}>
        Menü
      </button>
    </DndContext>
  );
}

function Ziehbar() {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: 'zug' });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners}>
      ziehbar
    </div>
  );
}

const zeiger = { isPrimary: true, button: 0, pointerId: 1 };

/** Ein ganzer Zug über die Aktivierungsdistanz, samt dem Klick, den das Loslassen erzeugt. */
function ziehe() {
  fireEvent.pointerDown(screen.getByText('ziehbar'), { ...zeiger, clientX: 0, clientY: 0 });
  act(() => {
    fireEvent.pointerMove(document, { ...zeiger, clientX: 40, clientY: 0 });
  });
  act(() => {
    fireEvent.pointerUp(document, { ...zeiger, clientX: 40, clientY: 0 });
  });
}

/** Ein neuer Klick mit eigener Geste: `pointerdown` auf dem Ziel, dann `click`. */
function klickeNeu(ziel: HTMLElement) {
  fireEvent.pointerDown(ziel, { ...zeiger, clientX: 200, clientY: 0 });
  fireEvent.pointerUp(ziel, { ...zeiger, clientX: 200, clientY: 0 });
  fireEvent.click(ziel);
}

describe('ZugPointerSensor (LFH-519)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('lässt den ersten echten Klick nach einem Zug durch, auch wenn der Timer verhungert', () => {
    const onKlick = vi.fn();
    render(<Aufbau sensor={ZugPointerSensor} onKlick={onKlick} />);

    ziehe();
    klickeNeu(screen.getByRole('button', { name: 'Menü' }));

    expect(onKlick).toHaveBeenCalledTimes(1);
  });

  it('schluckt weiter den Klick, den das Loslassen des Zugs selbst erzeugt', () => {
    const onKlick = vi.fn();
    render(<Aufbau sensor={ZugPointerSensor} onKlick={onKlick} />);

    ziehe();
    // Kein neues `pointerdown`: dieser Klick gehört zum Zug (Loslassen über dem Knopf).
    fireEvent.click(screen.getByRole('button', { name: 'Menü' }));

    expect(onKlick).not.toHaveBeenCalled();
  });

  it('lässt nach dem Zug auch einen Tastaturklick durch', () => {
    const onKlick = vi.fn();
    render(<Aufbau sensor={ZugPointerSensor} onKlick={onKlick} />);

    ziehe();
    const knopf = screen.getByRole('button', { name: 'Menü' });
    fireEvent.keyDown(knopf, { key: 'Enter', code: 'Enter' });
    fireEvent.click(knopf);

    expect(onKlick).toHaveBeenCalledTimes(1);
  });

  it('greift nicht in einen laufenden Zug ein: ein zweiter Finger hebt den Stopper nicht', () => {
    const onKlick = vi.fn();
    render(<Aufbau sensor={ZugPointerSensor} onKlick={onKlick} />);

    fireEvent.pointerDown(screen.getByText('ziehbar'), { ...zeiger, clientX: 0, clientY: 0 });
    act(() => {
      fireEvent.pointerMove(document, { ...zeiger, clientX: 40, clientY: 0 });
    });
    // Der zweite Finger tippt zweimal: sein Loslassen ist nicht das Ende des Zugs.
    const knopf = screen.getByRole('button', { name: 'Menü' });
    const finger2 = { isPrimary: false, button: 0, pointerId: 2 };
    fireEvent.pointerDown(knopf, finger2);
    fireEvent.pointerUp(knopf, finger2);
    fireEvent.pointerDown(knopf, finger2);
    fireEvent.click(knopf);

    expect(onKlick).not.toHaveBeenCalled();
    act(() => {
      fireEvent.pointerUp(document, { ...zeiger, clientX: 40, clientY: 0 });
    });
  });

  it('räumt nach dem Zug seine eigenen Hörer ab', () => {
    const onKlick = vi.fn();
    render(<Aufbau sensor={ZugPointerSensor} onKlick={onKlick} />);
    const entfernt = vi.spyOn(document, 'removeEventListener');

    ziehe();
    klickeNeu(screen.getByRole('button', { name: 'Menü' }));

    const typen = entfernt.mock.calls.map(([typ]) => typ);
    expect(typen).toEqual(expect.arrayContaining(['pointerdown', 'keydown']));
    entfernt.mockRestore();
  });

  // Gegenprobe: belegt die Ursache am unveränderten dnd-kit. Wird sie rot, hat dnd-kit das
  // Verhalten selbst behoben, und `ZugPointerSensor` kann zurück zum `PointerSensor`.
  it('Gegenprobe: der nackte PointerSensor schluckt den ersten echten Klick', () => {
    const onKlick = vi.fn();
    render(<Aufbau sensor={PointerSensor} onKlick={onKlick} />);

    ziehe();
    klickeNeu(screen.getByRole('button', { name: 'Menü' }));

    expect(onKlick).not.toHaveBeenCalled();
  });
});

describe('Guard: kein nackter PointerSensor im Quelltext', () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
  const dateien = (wurzel: string): string[] =>
    readdirSync(wurzel).flatMap((name) => {
      const pfad = join(wurzel, name);
      if (statSync(pfad).isDirectory()) return dateien(pfad);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [pfad] : [];
    });

  it('zieht Zeiger-Sensoren nur über zugPointerSensor.ts', () => {
    const verstoesse = dateien(SRC)
      .filter((pfad) => !pfad.endsWith('zugPointerSensor.ts'))
      .filter((pfad) =>
        /useSensor\(\s*(PointerSensor|MouseSensor|TouchSensor)\b/.test(readFileSync(pfad, 'utf8')),
      )
      .map((pfad) => relative(SRC, pfad));
    expect(verstoesse).toEqual([]);
  });
});
