import { theme } from 'antd';
import { Link } from 'react-router';
import type { EtbEintragAnzeige } from '../api/types';
import { befehlDetailPfad, lageberichtDetailPfad, auftraegePfad } from '../routing/deeplinks';
import { verweisStil } from './zeitachseModell';

/**
 * Rückverweise eines ETB-Eintrags auf die gekoppelten Objekte (LFH-25): Befehl und
 * Lagebericht haben eine Item-Route, der Auftrag wird per Query-Param auf der Liste
 * adressiert. Rendert nichts, wenn kein Rückverweis gesetzt ist.
 *
 * Seit dem Neuentwurf (S4, 21.09.2026) als Textverweis mit ↗ in der Hinweiszeile des
 * Zeitachsen-Eintrags statt als farbiges Etikett: die Farben Blau/Violett/Cyan der alten
 * Etiketten sind jetzt die ETB-Typkanten Meldung/Entscheidung/Lage — ein violettes
 * „Lagebericht" neben einer violetten Entscheidungskante behauptete eine Verwandtschaft,
 * die es nicht gibt. Das ↗ ist Glyphe (Entscheidung 2 des Auftraggebers) und steht
 * `aria-hidden`: der zugängliche Name ist das Wort.
 *
 * Einen Verweis auf eine Meldung trägt der Eintrag nicht (es gibt kein `meldung_id` am
 * Wire-Typ) — er wird deshalb auch nicht gezeigt.
 */
export default function EtbBacklinkBadges({
  eintrag,
  einsatzId,
}: {
  eintrag: EtbEintragAnzeige;
  einsatzId: number;
}) {
  const { token } = theme.useToken();
  const { befehl_id, lagebericht_id, auftrag_id } = eintrag;
  if (befehl_id == null && lagebericht_id == null && auftrag_id == null) return null;
  const pfeil = <span aria-hidden="true"> ↗</span>;
  const stil = verweisStil(token);
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', columnGap: token.marginSM }}>
      {befehl_id != null && (
        <Link to={befehlDetailPfad(einsatzId, befehl_id)} style={stil}>
          Befehl{pfeil}
        </Link>
      )}
      {lagebericht_id != null && (
        <Link to={lageberichtDetailPfad(einsatzId, lagebericht_id)} style={stil}>
          Lagebericht{pfeil}
        </Link>
      )}
      {auftrag_id != null && (
        <Link to={auftraegePfad(einsatzId, { auftrag: auftrag_id })} style={stil}>
          Auftrag{pfeil}
        </Link>
      )}
    </span>
  );
}
