import { Tag } from 'antd';
import { Link } from 'react-router';
import type { EtbEintragAnzeige } from '../api/types';
import { befehlDetailPfad, lageberichtDetailPfad, auftraegePfad } from '../routing/deeplinks';

/**
 * Deeplink-Badges am ETB-Eintrag auf die gekoppelten Objekte (LFH-25): macht den im Backend
 * vorhandenen Bezug (Befehl/Lagebericht/Auftrag) klickbar — „ETB-Eintrag → betroffenes Objekt".
 * Befehl/Lagebericht haben eine Item-Route; der Auftrag wird per Query-Param auf der Liste
 * adressiert (keine eigene Detail-Route). Rendert nichts, wenn kein Backlink gesetzt ist.
 */
export default function EtbBacklinkBadges({
  eintrag,
  einsatzId,
}: {
  eintrag: EtbEintragAnzeige;
  einsatzId: number;
}) {
  const { befehl_id, lagebericht_id, auftrag_id } = eintrag;
  if (befehl_id == null && lagebericht_id == null && auftrag_id == null) return null;
  return (
    <>
      {befehl_id != null && (
        <Link to={befehlDetailPfad(einsatzId, befehl_id)}>
          <Tag color="blue">Befehl</Tag>
        </Link>
      )}
      {lagebericht_id != null && (
        <Link to={lageberichtDetailPfad(einsatzId, lagebericht_id)}>
          <Tag color="purple">Lagebericht</Tag>
        </Link>
      )}
      {auftrag_id != null && (
        <Link to={auftraegePfad(einsatzId, { auftrag: auftrag_id })}>
          <Tag color="cyan">Auftrag</Tag>
        </Link>
      )}
    </>
  );
}
