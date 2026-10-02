import type { Dokument } from '../api/types';
import { dokumentDownloadPfad } from '../api/dokumente';
import {
  istBildMime,
  originalDateiname,
  originalPfad,
  originalZugaenglicherName,
} from '../api/anhangFassung';
import { ORIGINAL_TEXT } from '../components/DownloadAnker';
import { useRollen } from '../components/instrument';
import { formatGroesse } from '../karten/formatGroesse';
import { verweisStil } from './zeitachseModell';

/** Was der Verweis von einem Dokument braucht — die Zeitachse reicht die Listenzeilen durch. */
export type EtbDokument = Pick<Dokument, 'id' | 'titel' | 'dateiname' | 'groesse' | 'mime'>;

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
 *
 * Mit `darfOriginal` steht hinter jedem Bild der Verweis auf das Original samt Standort
 * (LFH-747), wie in `EtbAnhaenge`; der Hauptverweis lädt die bereinigte Fassung.
 */
export default function EtbDokumente({
  einsatzId,
  lfdNr,
  dokumente,
  darfOriginal = false,
}: {
  einsatzId: number;
  lfdNr: number;
  dokumente: readonly EtbDokument[];
  darfOriginal?: boolean;
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
        const href = dokumentDownloadPfad(einsatzId, d.id);
        return (
          // Dokument und Original bleiben als Paar zusammen (wie in `EtbAnhaenge`).
          <span key={d.id} style={{ display: 'inline-flex', columnGap: token.marginSM }}>
            <a
              href={href}
              download={d.dateiname}
              aria-label={`Dokument „${d.titel}“, ${groesse}, zu Nr. ${lfdNr} herunterladen`}
              style={stil}
            >
              Dokument „{d.titel}“ · {groesse}
            </a>
            {darfOriginal && istBildMime(d.mime) && (
              <a
                href={originalPfad(href)}
                download={originalDateiname(d.dateiname)}
                aria-label={originalZugaenglicherName(`Dokument „${d.titel}“, zu Nr. ${lfdNr}`)}
                data-lfh="etb-dokument-original"
                style={stil}
              >
                {ORIGINAL_TEXT}
              </a>
            )}
          </span>
        );
      })}
    </span>
  );
}
