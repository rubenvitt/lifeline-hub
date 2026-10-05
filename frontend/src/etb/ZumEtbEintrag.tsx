import { Button } from 'antd';
import { Link } from 'react-router';
import { KEINE_BERECHTIGUNG } from '../einsatz/modulRegistry';
import { useSprungSperre } from '../einsatz/useSprungSperre';
import { etbPfad } from '../routing/deeplinks';

/**
 * Kopfaktion „Zum ETB-Eintrag" einer Detailseite (Befehl, Lagebericht, Pressemitteilung), EINE
 * Stelle für alle drei. Ist das ETB für den Benutzer gesperrt (LFH-888, Spec `modul-freigabe`,
 * design.md D4), steht ein gesperrter Knopf mit Grund da — ein fehlender Link fiele zwischen den
 * übrigen Kopfaktionen nicht als Sperre auf (M16).
 */
export default function ZumEtbEintrag({
  einsatzId,
  eintragId,
}: {
  einsatzId: number;
  eintragId: number;
}) {
  const gesperrt = useSprungSperre(einsatzId)('etb');
  if (gesperrt) {
    return (
      <Button disabled title={KEINE_BERECHTIGUNG}>
        Zum ETB-Eintrag
      </Button>
    );
  }
  return <Link to={etbPfad(einsatzId, { eintrag: eintragId })}>Zum ETB-Eintrag</Link>;
}
