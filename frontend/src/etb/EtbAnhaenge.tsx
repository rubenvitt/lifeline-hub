import { Fragment } from 'react';
import type { EtbEintragAnzeige } from '../api/types';
import { etbAnhangPfad } from '../api/etb';
import { istBildMime, originalPfad } from '../api/anhangFassung';
import { ORIGINAL_TEXT } from '../components/DownloadAnker';
import { useRollen } from '../components/instrument';
import { formatGroesse } from '../karten/formatGroesse';
import { verweisStil } from './zeitachseModell';

/**
 * Die Anhänge eines ETB-Eintrags als Download-Verweise (LFH-117) — ein Bauteil für Zeitachse
 * und Palettenvorschau.
 *
 * Sichtbar steht „Name · Größe"; der zugängliche Name trägt dazu die laufende Nummer und die
 * Handlung („…, Anhang zu Nr. 42 herunterladen"), sonst lieferten zwei Einträge mit
 * `IMG_0001.jpg` zwei gleichnamige Verweise. Kein ↗: das ist die Glyphe für Navigation, ein
 * Download navigiert nicht. Mindesthöhe aus `verweisStil`, Farbe aus `bedienText`.
 *
 * Der Verweis zeigt auf die ETB-Route (`etbAnhangPfad`), nie auf die generische — dort
 * antwortet der Server für ETB-Anhänge 404.
 *
 * Mit `darfOriginal` (der Aufrufer fragt `useDarfOriginalLaden`, LFH-747) steht hinter jedem
 * Bild ein zweiter Verweis auf das Original samt Standort; der Hauptverweis lädt die bereinigte
 * Fassung. Als Prop statt Hook, damit das Bauteil ohne Provider renderbar bleibt.
 */
export default function EtbAnhaenge({
  einsatzId,
  eintrag,
  darfOriginal = false,
}: {
  einsatzId: number;
  eintrag: Pick<EtbEintragAnzeige, 'id' | 'lfd_nr' | 'anhaenge'>;
  darfOriginal?: boolean;
}) {
  const { token, rollen } = useRollen();
  if (eintrag.anhaenge.length === 0) return null;
  // Blauer Bedien-TEXT nimmt `bedienText` (LFH-650); seit LFH-652 wertgleich mit antds `colorLink`.
  const stil = { ...verweisStil(token), color: rollen.bedienText };
  return (
    <span
      data-lfh="etb-anhaenge"
      style={{ display: 'inline-flex', flexWrap: 'wrap', columnGap: token.marginSM }}
    >
      {eintrag.anhaenge.map((a) => {
        const groesse = formatGroesse(a.groesse);
        const href = etbAnhangPfad(einsatzId, eintrag.id, a.id);
        return (
          <Fragment key={a.id}>
            <a
              href={href}
              download={a.dateiname}
              aria-label={`${a.dateiname}, ${groesse}, Anhang zu Nr. ${eintrag.lfd_nr} herunterladen`}
              style={stil}
            >
              {a.dateiname} · {groesse}
            </a>
            {darfOriginal && istBildMime(a.mime) && (
              <a
                href={originalPfad(href)}
                download={a.dateiname}
                aria-label={`${a.dateiname}, Anhang zu Nr. ${eintrag.lfd_nr}: Original mit Standort- und Gerätedaten herunterladen`}
                data-lfh="etb-anhang-original"
                style={{ ...stil, fontWeight: 'normal' }}
              >
                {ORIGINAL_TEXT}
              </a>
            )}
          </Fragment>
        );
      })}
    </span>
  );
}
