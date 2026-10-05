import type { FormInstance } from 'antd';
import AbschnittUebernahme from '../lageberichte/AbschnittUebernahme';
import { MEDIENLAGE_QUELLE } from './medienlageQuelle';

/**
 * „Aus S5 übernehmen“ im Abschnitt „Medienlage“ eines Lagevortrag-Entwurfs (LFH-554, Spec
 * `stab-medienlage`). Seit LFH-870 der Übernahme-Baustein mit der Quelle
 * {@link MEDIENLAGE_QUELLE}: ohne Freigabe des Stabs steht statt des Knopfes ein Hinweis.
 */
export default function MedienlageUebernahme(props: {
  einsatzId: number;
  form: FormInstance;
  feld: string;
  onGeaendert: () => void;
}) {
  return <AbschnittUebernahme quelle={MEDIENLAGE_QUELLE} {...props} />;
}
