import { sucheOrtImEinsatz } from '../api/ortSuche';
import { einsatzKeys } from '../api/queryKeys';
import { Ortsfeld, type OrtsfeldGemeinsam } from './Ortsfeld';
import { useEinsatzortPunkt } from './useEinsatzortPunkt';

interface Props extends OrtsfeldGemeinsam {
  einsatzId: number;
  /** Wofür der Ort steht („Schadensort“); Name der Nadel, der Karte und des Dialogs. */
  etikett: string;
  /** `typ:id` der bearbeiteten Sache, damit die Peilung nicht auf sie selbst zeigt. */
  exclude?: string;
}

/**
 * Ortsfeld einer Sache im Einsatz (LLH-1121, Spec `ortsfeld`): Suche im Einsatz, Kartenvorschau
 * mit Ort-Zeile, „Auf Karte wählen“ beginnt am Einsatzort. `Form.Item` reicht Wert, `onChange`,
 * `id` und `ref` herein.
 */
export function EinsatzOrtsfeld({ einsatzId, etikett, exclude, ...feld }: Props) {
  const umgebung = useEinsatzortPunkt(einsatzId);
  return (
    <Ortsfeld
      {...feld}
      suchen={(begriff) => sucheOrtImEinsatz(einsatzId, begriff)}
      suchSchluessel={(begriff) => einsatzKeys.einsatzortSuche(einsatzId, begriff)}
      karte={{ etikett, einsatzId, exclude, umgebung }}
    />
  );
}
