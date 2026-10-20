import type { BefehlAbschnitt } from '../api/types';
import type { VorlageDef } from '../befehle/vorlagen';
import AbschnittsText from '../entwurf/AbschnittsText';

/**
 * Die Abschnitte eines Befehls als Lesefassung: Vollseite (freigegeben oder ohne Schreibrecht) und
 * Detailpaneel der Liste nutzen dieselbe (Change `oxgob5gk-auftraege-befehle-angleichen`, D5).
 * Leere Abschnitte stehen mit „—“, damit das Schema vollständig bleibt. Die Mechanik teilt der
 * Befehl mit Lagebericht und Pressemitteilung (`entwurf/AbschnittsText.tsx`).
 *
 * `ebene` ist die Überschriftenebene der Abschnittsköpfe: unter dem Paneel der Vollseite (h2) h3,
 * im Detail unter dem Paneel (h4) h5.
 */
export default function BefehlLesefassung({
  vorlage: v,
  abschnitte,
  ebene = 3,
  className,
}: {
  vorlage: VorlageDef | undefined;
  abschnitte: readonly BefehlAbschnitt[];
  ebene?: 3 | 5;
  className?: string;
}) {
  return (
    <div className={className}>
      <AbschnittsText
        gliederung={v?.abschnitte ?? []}
        abschnitte={abschnitte}
        unterEbene={ebene === 3 ? 2 : 4}
      />
    </div>
  );
}
