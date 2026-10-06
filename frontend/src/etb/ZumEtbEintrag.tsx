import { SprungKnopf } from '../components/Sprung';
import { useSprungSperre } from '../einsatz/useSprungSperre';
import { etbPfad } from '../routing/deeplinks';

/**
 * Kopfaktion „Zum ETB-Eintrag" einer Detailseite (Befehl, Lagebericht, Pressemitteilung), EINE
 * Stelle für alle drei. Ist das ETB für den Benutzer gesperrt (LFH-888, Spec `modul-freigabe`,
 * design.md D4), steht ein gesperrter Knopf mit Grund da — ein fehlender Link fiele zwischen den
 * übrigen Kopfaktionen nicht als Sperre auf (M16).
 *
 * Im Sprung-Muster (LFH-968): als nackter Link maß der Sprung 15 px und klebte 3 px neben
 * „Fortschreiben“. Wo er steht und wie weit er von den Handlungen abrückt, regelt die Seite.
 */
export default function ZumEtbEintrag({
  einsatzId,
  eintragId,
}: {
  einsatzId: number;
  eintragId: number;
}) {
  const gesperrt = useSprungSperre(einsatzId)('etb');
  return (
    <SprungKnopf to={etbPfad(einsatzId, { eintrag: eintragId })} gesperrt={gesperrt}>
      Zum ETB-Eintrag
    </SprungKnopf>
  );
}
