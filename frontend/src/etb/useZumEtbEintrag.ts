import { useNavigate } from 'react-router';
import type { Nebenweg } from '../components/EinsatzSeite';
import { sprungGesperrtText } from '../components/Sprung';
import { useSprungSperre } from '../einsatz/useSprungSperre';
import { etbPfad } from '../routing/deeplinks';

const ZIEL = 'Zum ETB-Eintrag';

/**
 * Nebenweg „Zum ETB-Eintrag" einer Detailseite (Befehl, Lagebericht, Pressemitteilung), EINE
 * Stelle für alle drei. Seit LFH-1079 ein Eintrag für `EinsatzSeite.weitere`: ab `md` ein Sprung
 * mit „↗“ (Strg/⌘+Klick öffnet einen Tab), unter `md` ein Eintrag hinter „Weitere“.
 *
 * Ist das ETB für den Benutzer gesperrt (LFH-888, Spec `modul-freigabe`, design.md D4), steht der
 * Weg gesperrt da und nennt den Grund im Text — ein fehlender Weg fiele zwischen den übrigen nicht
 * als Sperre auf (M16). `null`, solange das Dokument keinen ETB-Eintrag hat (Entwurf).
 */
export function useZumEtbEintrag(
  einsatzId: number,
  eintragId: number | null | undefined,
): Nebenweg | null {
  const gesperrt = useSprungSperre(einsatzId)('etb');
  const navigate = useNavigate();
  if (eintragId == null) return null;
  const ziel = etbPfad(einsatzId, { eintrag: eintragId });
  if (gesperrt) {
    return { key: 'etb', label: sprungGesperrtText(ZIEL), gesperrt: true, onWahl: () => {} };
  }
  return { key: 'etb', label: ZIEL, ziel, sprung: true, onWahl: () => navigate(ziel) };
}
