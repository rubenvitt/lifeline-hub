import { describe, it, expect, vi } from 'vitest';
import type { MessageInstance } from 'antd/es/message/interface';
import { quittiereModulGespeichert } from './modulQuittung';

/** Nimmt die Toast-Anfrage entgegen, ohne antds Portal zu montieren. */
function messageAttrappe() {
  const success = vi.fn();
  return { api: { success } as unknown as MessageInstance, success };
}

describe('quittiereModulGespeichert (LFH-478)', () => {
  it('quittiert fünf Schaltvorgänge in Folge unter EINEM Schlüssel', () => {
    const { api, success } = messageAttrappe();
    for (let i = 0; i < 5; i++) quittiereModulGespeichert(api, 'Modul-Default gespeichert');

    // Fünf Aufrufe, aber ein Schlüssel: antd ersetzt die stehende Meldung, statt zu stapeln.
    expect(success).toHaveBeenCalledTimes(5);
    const schluessel = success.mock.calls.map((c) => c[0].key);
    expect(schluessel[0]).toEqual(expect.any(String));
    expect(schluessel[0]).not.toBe('');
    expect(new Set(schluessel).size).toBe(1);
    expect(success.mock.calls[0][0].content).toBe('Modul-Default gespeichert');
  });

  it('teilt den Schlüssel nicht mit dem Rückgängig-Toast', () => {
    const { api, success } = messageAttrappe();
    quittiereModulGespeichert(api, 'Modul-Einstellung gespeichert');
    // Eine Quittung darf einen offenen Rückweg nicht still verdrängen.
    expect(success.mock.calls[0][0].key).not.toBe('lfh-rueckgaengig');
  });
});
