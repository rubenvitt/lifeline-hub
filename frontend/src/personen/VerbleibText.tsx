import type { Verbleib } from '../api/types';
import { KennungsLink } from '../components/kennungsLink';
import { useSprungSperre } from '../einsatz/useSprungSperre';
import { useEinsatzPfade } from '../routing/EinsatzPfade';
import { kurzVerbleib } from './personMeta';

/**
 * Kurzform eines Verbleibs (`kurzVerbleib`). Zeigt ein Verbleib „Notunterkunft“ auf eine
 * Betreuungsstelle, führt der Text auf die Seite der Stelle (LLH-1347). Kein Sprung am Gerät (dort
 * gibt es keine Stellenseite, `EinsatzPfade.betreuungsstelle`) und keiner ins gesperrte Modul
 * Betreuung (`istSprungGesperrt`: der Link entfällt, der Text bleibt).
 */
export default function VerbleibText({
  verbleib,
}: {
  verbleib: Pick<Verbleib, 'art' | 'ziel' | 'transportmittel' | 'einsatz_id'> &
    Partial<Pick<Verbleib, 'status' | 'transport_durch' | 'betreuungsstelle_id'>>;
}) {
  const pfad = useEinsatzPfade().betreuungsstelle;
  const text = kurzVerbleib(verbleib);
  if (verbleib.art !== 'notunterkunft' || verbleib.betreuungsstelle_id == null || !pfad) {
    return <>{text}</>;
  }
  return (
    <StellenSprung
      einsatzId={verbleib.einsatz_id}
      ziel={pfad(verbleib.einsatz_id, verbleib.betreuungsstelle_id)}
      text={text}
    />
  );
}

/** Eigenes Bauteil: die Modulfreigaben fragt nur ab, wer wirklich springen könnte. */
function StellenSprung({
  einsatzId,
  ziel,
  text,
}: {
  einsatzId: number;
  ziel: string;
  text: string;
}) {
  const gesperrt = useSprungSperre(einsatzId)('betreuung');
  if (gesperrt) return <>{text}</>;
  return (
    <KennungsLink to={ziel} data-lfh="verbleib-stelle">
      {text}
    </KennungsLink>
  );
}
