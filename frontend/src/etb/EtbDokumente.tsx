import type { Dokument } from '../api/types';
import { dokumentDownloadPfad } from '../api/dokumente';
import { useRollen } from '../components/instrument';
import { formatGroesse } from '../karten/formatGroesse';
import { verweisStil } from './zeitachseModell';

/** Was der Verweis von einem Dokument braucht — die Zeitachse reicht die Listenzeilen durch. */
export type EtbDokument = Pick<Dokument, 'id' | 'titel' | 'dateiname' | 'groesse'>;

/**
 * Dokumente der Ablage, deren Bezug dieser ETB-Eintrag ist, als Download-Verweise (LFH-743) —
 * Gegenstück zu `EtbAnhaenge`.
 *
 * Sichtbar steht „Dokument „Titel“ · Größe": das Wort trennt es vom Anhang, der seinen
 * Dateinamen zeigt. Der zugängliche Name beginnt mit dem sichtbaren Text (WCAG 2.5.3, Sprach-
 * steuerung) und trägt dazu die laufende Nummer und die Handlung, wie beim Anhang. Mindesthöhe aus `verweisStil`, Farbe aus `bedienText`.
 *
 * Der Verweis zeigt auf die modul-gegatete Dokument-Route (`dokumentDownloadPfad`), nie auf die
 * ETB- oder die generische Route. Ohne Modulrecht `dokumente` bekommt die Zeitachse keine
 * Dokumente (die Seite fragt sie dann gar nicht ab), also erscheint auch kein Verweis.
 */
export default function EtbDokumente({
  einsatzId,
  lfdNr,
  dokumente,
}: {
  einsatzId: number;
  lfdNr: number;
  dokumente: readonly EtbDokument[];
}) {
  const { token, rollen } = useRollen();
  if (dokumente.length === 0) return null;
  const stil = { ...verweisStil(token), color: rollen.bedienText };
  return (
    <span
      data-lfh="etb-dokumente"
      style={{ display: 'inline-flex', flexWrap: 'wrap', columnGap: token.marginSM }}
    >
      {dokumente.map((d) => {
        const groesse = formatGroesse(d.groesse);
        return (
          <a
            key={d.id}
            href={dokumentDownloadPfad(einsatzId, d.id)}
            download={d.dateiname}
            aria-label={`Dokument „${d.titel}“, ${groesse}, zu Nr. ${lfdNr} herunterladen`}
            style={stil}
          >
            Dokument „{d.titel}“ · {groesse}
          </a>
        );
      })}
    </span>
  );
}
