import type { EtbEintragAnzeige } from '../api/types';
import { etbAnhangPfad } from '../api/etb';
import { useRollen } from '../components/instrument';
import { formatGroesse } from '../karten/formatGroesse';
import { verweisStil } from './zeitachseModell';

/**
 * Die Anhänge eines ETB-Eintrags als Download-Verweise (LFH-117, design.md D11) — ein
 * Bauteil für Zeitachse und Palettenvorschau.
 *
 * Sichtbar steht „Name · Größe"; der zugängliche Name trägt dazu die laufende Nummer des
 * Eintrags und die Handlung („…, Anhang zu Nr. 42 herunterladen"), weil zwei Einträge mit
 * `IMG_0001.jpg` sonst zwei gleichnamige Verweise lieferten (Regel wie beim Aktionsmenü,
 * LFH-364). Keine Ikone, kein Emoji, kein ↗: ↗ ist die Glyphe für Navigation, ein Download
 * navigiert nicht. Die Mindesthöhe kommt aus `verweisStil` (Boden `controlHeight` der
 * Dichtestufe), wie bei den übrigen Textverweisen der Zeitachse; die Farbe aus `bedienText`.
 *
 * Der Verweis zeigt auf die ETB-Route (`etbAnhangPfad`), nie auf die generische — dort
 * antwortet der Server für ETB-Anhänge 404.
 */
export default function EtbAnhaenge({
  einsatzId,
  eintrag,
}: {
  einsatzId: number;
  eintrag: Pick<EtbEintragAnzeige, 'id' | 'lfd_nr' | 'anhaenge'>;
}) {
  const { token, rollen } = useRollen();
  if (eintrag.anhaenge.length === 0) return null;
  // Blauer Bedien-TEXT nimmt `bedienText`, nicht antds `colorLink` (LFH-650): der Linkton
  // hielt auf dem Zeitachsengrund gemessen nur 4,82 : 1 in der Nacht (Boden 5).
  const stil = { ...verweisStil(token), color: rollen.bedienText };
  return (
    <span
      data-lfh="etb-anhaenge"
      style={{ display: 'inline-flex', flexWrap: 'wrap', columnGap: token.marginSM }}
    >
      {eintrag.anhaenge.map((a) => {
        const groesse = formatGroesse(a.groesse);
        return (
          <a
            key={a.id}
            href={etbAnhangPfad(einsatzId, eintrag.id, a.id)}
            download={a.dateiname}
            aria-label={`${a.dateiname}, ${groesse}, Anhang zu Nr. ${eintrag.lfd_nr} herunterladen`}
            style={stil}
          >
            {a.dateiname} · {groesse}
          </a>
        );
      })}
    </span>
  );
}
