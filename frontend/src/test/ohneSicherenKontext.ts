import { vi } from 'vitest';

/**
 * Stellt den Browser unter Klartext-HTTP auf einer LAN-Adresse nach (LFH-762): kein sicherer
 * Kontext, `crypto.randomUUID` fehlt (`[SecureContext]`), `crypto.getRandomValues` bleibt.
 *
 * Verschattet wird per eigener Eigenschaft am `crypto`-Objekt, nicht per Ersatzobjekt: alles
 * andere an `crypto` (etwa `subtle`) bleibt, wie es ist. Gibt die Rücknahme zurück.
 */
export function ohneSicherenKontext(): () => void {
  vi.stubGlobal('isSecureContext', false);
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: undefined,
    configurable: true,
    writable: true,
  });
  return () => {
    delete (globalThis.crypto as { randomUUID?: unknown }).randomUUID;
    vi.unstubAllGlobals();
  };
}
