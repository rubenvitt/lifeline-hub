import type { BrListenEintrag, ObjektTyp } from '../../api/types';

/**
 * Räume, in die eine Kraft verlegt werden kann (LLH-1315, Spec `bereitstellungsraum-belegung`,
 * „Verlegen in einen anderen Raum“): in Betrieb, nicht storniert, ohne den eigenen; nach
 * Bezeichnung. Der Server bucht einen Wechsel nur in einen aktiven Raum (`require_belegbar_tx`).
 */
export function zielRaeume(
  liste: readonly BrListenEintrag[],
  eigenerBrId: number,
): BrListenEintrag[] {
  return liste
    .filter((r) => r.id !== eigenerBrId && r.status === 'aktiv' && r.storniert_at == null)
    .sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de'));
}

export const VERLEGEN = 'In anderen BR verlegen …';

/**
 * Etikett des Menüeintrags. Ein gesperrter Weg nennt seinen Grund im Etikett (`frontend/AGENTS.md`,
 * „Nebenwege“): `null` = die Raumliste fehlt noch oder ist ausgefallen.
 */
export function verlegenEintrag(ziele: readonly BrListenEintrag[] | null): {
  label: string;
  gesperrt: boolean;
} {
  if (ziele == null)
    return { label: 'In anderen BR verlegen (Räume nicht geladen)', gesperrt: true };
  if (ziele.length === 0) {
    return { label: 'In anderen BR verlegen (kein anderer Raum in Betrieb)', gesperrt: true };
  }
  return { label: VERLEGEN, gesperrt: false };
}

/** Quittung „Einheit „HLF 20“ nach BR Nord verlegt“, im Muster der übrigen Belegungsquittungen. */
export function verlegenQuittung(typ: ObjektTyp, name: string, zielRaum: string): string {
  return `${typ === 'einheit' ? 'Einheit' : 'Fahrzeug'} „${name}“ nach ${zielRaum} verlegt`;
}
