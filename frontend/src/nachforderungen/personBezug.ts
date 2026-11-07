import type {
  NachforderungPrioritaet,
  RettungsmittelStand,
  TransportPrioritaet,
} from '../api/types';

/**
 * Rettungsmittel für einen Patienten (LLH-1573, Change `n12q80rt-rettungsmittel-anfordern`): die
 * reinen Regeln zwischen Person und Nachforderung, ohne Oberfläche.
 */

/** Priorität der Nachforderung aus der Transportpriorität der Person (design.md D3). */
export function prioritaetAusTransport(
  p: TransportPrioritaet | null | undefined,
): NachforderungPrioritaet | undefined {
  switch (p) {
    case 'sofort':
      return 'sofort';
    case 'dringlich':
      return 'dringend';
    case 'normal':
      return 'normal';
    default:
      return undefined;
  }
}

/**
 * Darf für die Person (wieder) angefordert werden? Ohne Stand oder nach einer Absage ja; solange
 * eine Anforderung läuft oder das Rettungsmittel da ist, nicht (design.md D3/D4).
 */
export function rettungsmittelAnforderbar(stand: RettungsmittelStand | null | undefined): boolean {
  return stand == null || stand.status === 'abgelehnt';
}

/** Wer kommt: der erste zugesagte Rufname, sonst die Art („RTW 1/83-1“ bzw. „RTW“). */
export function rettungsmittelName(stand: RettungsmittelStand): string {
  return stand.rufnamen[0] ?? stand.art;
}

/**
 * Kurze Marke für Platzkarte und Wartebereich der UHS (design.md D4): „RTW unterwegs“. Nur, solange
 * es etwas zu erwarten gibt; ein eingetroffenes heißt „RTW da“, ein abgelehntes trägt keine Marke.
 */
export function rettungsmittelMarke(stand: RettungsmittelStand | null | undefined): string | null {
  if (!stand) return null;
  switch (stand.status) {
    case 'angefordert':
      return `${stand.art} angefordert`;
    case 'zugesagt':
      return `${stand.art} zugesagt`;
    case 'unterwegs':
      return `${stand.art} unterwegs`;
    case 'eingetroffen':
      return `${stand.art} da`;
    default:
      return null;
  }
}
