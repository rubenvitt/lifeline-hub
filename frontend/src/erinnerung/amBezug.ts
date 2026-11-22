import type { Erinnerung } from '../api/types';

/** Modul, das den Bezug einer automatischen Frist selbst zeigt. */
export type BezugModul = 'meldungen' | 'auftraege' | 'abloesung';

/**
 * Automatische Fristen, die ihr Bezug selbst trägt (LLH-1908, `src/AGENTS.md`, „Automatische
 * Fristen stehen am Bezug“): Bezugstyp → Modul, in dem die Frist schon steht. Gegenstück zu
 * `erinnerung::AM_BEZUG_GETRAGEN` im Server; eine neue Auto-Frist-Art zieht beide nach.
 * Der Planungshinweis der Ablösung (`abloesung_planung`) fehlt bewusst: ihn zeigt sonst nichts.
 */
export const AM_BEZUG_GETRAGEN: Readonly<Record<string, BezugModul>> = {
  meldung: 'meldungen',
  auftrag: 'auftraege',
  abloesung: 'abloesung',
  abloesung_vorwarnung: 'abloesung',
};

/**
 * Steht diese Erinnerung schon an ihrem Bezug? Nur eine automatische Frist (`auto_frist`), und
 * nur, wenn `traegt` den Bezug in seinem Modul zeigt: Modul für die Person frei und der Bezug
 * dort offen; sonst sähe sie die Frist nirgends.
 */
export function amBezugGetragen(
  e: Pick<Erinnerung, 'quelle' | 'bezug_typ' | 'bezug_id'>,
  traegt: (modul: BezugModul, bezugId: number) => boolean,
): boolean {
  if (e.quelle !== 'auto_frist' || !e.bezug_typ || e.bezug_id == null) return false;
  const modul = AM_BEZUG_GETRAGEN[e.bezug_typ];
  return modul !== undefined && traegt(modul, e.bezug_id);
}
