import type { Abloesung, AbloesungVerbleib, BrListenEintrag, VollzugBody } from '../api/types';

/**
 * Verbleib der abgelösten Einheit nach dem Vollzug (LLH-1308, Spec `kraefte-abloesung`
 * „Verbleib der abgelösten Einheit“). Ein Feld „Danach“: „In Ruhe“ (Vorgabe), je aktivem Raum
 * „Bereitstellungsraum «Bezeichnung»“ und „Entlassen“ — der Raum steckt in der Option
 * (design.md D1), daher ist der Feldwert ein Schlüssel: `ruhe`, `entlassen` oder `br:<id>`.
 */
export type VerbleibWert = 'ruhe' | 'entlassen' | `br:${number}`;

export interface VerbleibOption {
  value: VerbleibWert;
  label: string;
}

/** Ein Raum, in den die abgelöste Einheit treten kann. */
export interface VerbleibRaum {
  id: number;
  bezeichnung: string;
}

/** Die Räume, die der Server annimmt: aktiv und nicht storniert. */
export function verbleibRaeume(raeume: BrListenEintrag[] | undefined): VerbleibRaum[] {
  return (raeume ?? [])
    .filter((r) => r.status === 'aktiv' && r.storniert_at == null)
    .map((r) => ({ id: r.id, bezeichnung: r.bezeichnung }));
}

/** Die Optionen des Felds „Danach“; Räume nur, wenn sie nicht gesperrt sind. */
export function verbleibOptionen(raeume: VerbleibRaum[], raumGesperrt: boolean): VerbleibOption[] {
  return [
    { value: 'ruhe', label: 'In Ruhe' },
    ...(raumGesperrt
      ? []
      : raeume.map((r) => ({
          value: `br:${r.id}` as const,
          label: `Bereitstellungsraum «${r.bezeichnung}»`,
        }))),
    { value: 'entlassen', label: 'Entlassen' },
  ];
}

/**
 * Der Teil des Vollzug-Bodys zum Verbleib. „In Ruhe“ ist die Vorgabe des Servers und geht nicht
 * hinaus.
 */
export function verbleibBody(
  wert: VerbleibWert | undefined,
): Pick<VollzugBody, 'verbleib' | 'verbleib_br_id'> {
  if (wert == null || wert === 'ruhe') return {};
  if (wert === 'entlassen') return { verbleib: 'entlassen' };
  return { verbleib: 'bereitstellungsraum', verbleib_br_id: Number(wert.slice(3)) };
}

/**
 * Was die Karte einer abgelösten Schicht über den Verbleib sagt: „danach Bereitstellungsraum
 * Schule“ bzw. „danach entlassen“; bei Ruhe nichts.
 */
export function verbleibText(
  s: Pick<Abloesung, 'verbleib' | 'verbleib_br_bezeichnung'>,
): string | null {
  const v: AbloesungVerbleib = s.verbleib;
  switch (v) {
    case 'ruhe':
      return null;
    case 'entlassen':
      return 'danach entlassen';
    case 'bereitstellungsraum':
      return s.verbleib_br_bezeichnung
        ? `danach Bereitstellungsraum ${s.verbleib_br_bezeichnung}`
        : 'danach Bereitstellungsraum';
  }
}
