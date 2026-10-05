import VerlassenRueckfrage from '../components/VerlassenRueckfrage';

interface Props {
  ungespeichert: boolean;
  speichert: boolean;
  speichern: () => Promise<void>;
  /** Grund eines gescheiterten „Speichern und weiter" — `schutz.speicherFehler`. */
  speicherFehler?: unknown;
}

/**
 * Navigation und Autosave teilen denselben Verlustschutz-Merker. Die Rückfrage selbst ist der
 * gemeinsame Baustein der Formularseiten (`components/VerlassenRueckfrage.tsx`, LFH-979); Entwürfe
 * bieten dort zusätzlich „Speichern und weiter" an. `autosaveJetzt()` liefert `void`, deshalb wird
 * der Fehlerzustand hereingereicht.
 */
export default function EntwurfNavigationSchutz(props: Props) {
  return <VerlassenRueckfrage {...props} />;
}
