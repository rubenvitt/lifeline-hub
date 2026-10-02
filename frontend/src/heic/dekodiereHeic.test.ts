import { describe, expect, it, vi } from 'vitest';
import { erzeugeHeicDekodierer } from './dekodiereHeic';

/** Ein Worker, der Aufträge sammelt; der Test beantwortet sie von Hand. */
class FalscherWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  auftraege: { id: number; daten: ArrayBuffer }[] = [];
  beendet = false;
  postMessage(nachricht: { id: number; daten: ArrayBuffer }) {
    this.auftraege.push(nachricht);
  }
  terminate() {
    this.beendet = true;
  }
  antworte(antwort: object) {
    this.onmessage?.({ data: antwort } as MessageEvent);
  }
}

const warte = () => new Promise((r) => setTimeout(r, 0));

function aufbau(zeitlimitMs?: number) {
  const worker = new FalscherWorker();
  const neuerWorker = vi.fn(() => worker as unknown as Worker);
  const laden = vi.fn(async (href: string) => new TextEncoder().encode(href).buffer as ArrayBuffer);
  return {
    worker,
    neuerWorker,
    laden,
    dekodiere: erzeugeHeicDekodierer(neuerWorker, laden, zeitlimitMs),
  };
}

describe('erzeugeHeicDekodierer (LFH-759)', () => {
  it('startet den Worker erst beim ersten Auftrag', async () => {
    const { neuerWorker, dekodiere, worker } = aufbau();
    expect(neuerWorker).not.toHaveBeenCalled();
    const lauf = dekodiere('/a/1');
    await warte();
    expect(neuerWorker).toHaveBeenCalledTimes(1);
    const klein = new Blob(['k']);
    const gross = new Blob(['g']);
    worker.antworte({ id: worker.auftraege[0]!.id, klein, gross });
    await expect(lauf).resolves.toEqual({ klein, gross });
  });

  it('arbeitet die Aufträge der Reihe nach ab, nie zwei zugleich', async () => {
    const { worker, laden, dekodiere } = aufbau();
    const erster = dekodiere('/a/1');
    const zweiter = dekodiere('/a/2');
    await warte();
    expect(worker.auftraege).toHaveLength(1);
    expect(laden).toHaveBeenCalledTimes(1);
    worker.antworte({ id: worker.auftraege[0]!.id, klein: new Blob(), gross: new Blob() });
    await erster;
    await warte();
    expect(worker.auftraege).toHaveLength(2);
    expect(laden).toHaveBeenLastCalledWith('/a/2');
    worker.antworte({ id: worker.auftraege[1]!.id, fehler: 'kaputt' });
    await expect(zweiter).rejects.toThrow('kaputt');
  });

  it('lässt nach einem Ladefehler die Warteschlange weiterlaufen', async () => {
    const { worker, laden, dekodiere } = aufbau();
    laden.mockRejectedValueOnce(new Error('HTTP 422'));
    await expect(dekodiere('/a/1')).rejects.toThrow('HTTP 422');
    const lauf = dekodiere('/a/2');
    await warte();
    worker.antworte({ id: worker.auftraege[0]!.id, klein: new Blob(), gross: new Blob() });
    await expect(lauf).resolves.toBeDefined();
  });

  it('verwirft bei einem Absturz des Workers den Auftrag und baut einen neuen auf', async () => {
    const { worker, neuerWorker, dekodiere } = aufbau();
    const lauf = dekodiere('/a/1');
    await warte();
    worker.onerror?.({ message: 'abgestürzt' } as ErrorEvent);
    await expect(lauf).rejects.toThrow();
    expect(worker.beendet).toBe(true);
    void dekodiere('/a/2');
    await warte();
    expect(neuerWorker).toHaveBeenCalledTimes(2);
  });

  it('lässt einen hängenden Auftrag nach dem Zeitlimit scheitern und ersetzt den Worker', async () => {
    const { worker, neuerWorker, dekodiere } = aufbau(20);
    const haengt = dekodiere('/a/1');
    const danach = dekodiere('/a/2');
    await expect(haengt).rejects.toThrow('Zeitlimit');
    expect(worker.beendet).toBe(true);
    await warte();
    expect(neuerWorker).toHaveBeenCalledTimes(2);
    worker.antworte({ id: worker.auftraege[1]!.id, klein: new Blob(), gross: new Blob() });
    await expect(danach).resolves.toBeDefined();
  });

  it('ersetzt den Worker, wenn er einen Absturz meldet', async () => {
    const { worker, neuerWorker, dekodiere } = aufbau();
    const lauf = dekodiere('/a/1');
    await warte();
    worker.antworte({ id: worker.auftraege[0]!.id, fehler: 'RuntimeError: abort', tot: true });
    await expect(lauf).rejects.toThrow('abort');
    expect(worker.beendet).toBe(true);
    void dekodiere('/a/2');
    await warte();
    expect(neuerWorker).toHaveBeenCalledTimes(2);
  });
});
