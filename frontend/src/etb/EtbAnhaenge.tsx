import type { EtbEintragAnzeige } from '../api/types';
import { etbAnhangPfad } from '../api/etb';
import {
  istBildMime,
  originalDateiname,
  originalPfad,
  originalZugaenglicherName,
} from '../api/anhangFassung';
import { ORIGINAL_TEXT } from '../components/DownloadAnker';
import AnhangVorschau, { AnhangVorschauGruppe } from '../components/AnhangVorschau';
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
 *
 * Vor jedem Bild steht ein Vorschaubild (LFH-759, `AnhangVorschau`); die Großansicht blättert
 * durch die Bilder dieses Eintrags.
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
      <AnhangVorschauGruppe>
        {eintrag.anhaenge.map((a) => {
          const groesse = formatGroesse(a.groesse);
          const href = etbAnhangPfad(einsatzId, eintrag.id, a.id);
          return (
            // Bild und Original bleiben als Paar zusammen: beim Umbruch stünde „Original“ sonst vor
            // dem nächsten Bild.
            <span
              key={a.id}
              style={{ display: 'inline-flex', alignItems: 'center', columnGap: token.marginSM }}
            >
              <AnhangVorschau
                href={href}
                mime={a.mime}
                dateiname={a.dateiname}
                kennung={`Anhang zu Nr. ${eintrag.lfd_nr}`}
              />
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
                  download={originalDateiname(a.dateiname)}
                  aria-label={originalZugaenglicherName(
                    `${a.dateiname}, Anhang zu Nr. ${eintrag.lfd_nr}`,
                  )}
                  data-lfh="etb-anhang-original"
                  style={stil}
                >
                  {ORIGINAL_TEXT}
                </a>
              )}
            </span>
          );
        })}
      </AnhangVorschauGruppe>
    </span>
  );
}
