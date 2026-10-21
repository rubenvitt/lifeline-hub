import { theme } from 'antd';
import { Link } from 'react-router';
import type { EtbEintragAnzeige } from '../api/types';
import {
  auftraegePfad,
  befehlDetailPfad,
  lageberichtDetailPfad,
  meldungenPfad,
  nachforderungenPfad,
} from '../routing/deeplinks';
import { hatVerknuepfung, verweisStil } from './zeitachseModell';

/**
 * Rückverweise eines ETB-Eintrags auf die gekoppelten Objekte (LFH-25): Befehl und
 * Lagebericht haben eine Item-Route, der Auftrag wird per Query-Param auf der Liste
 * adressiert. Rendert nichts, wenn kein Verweis gesetzt ist.
 *
 * Textverweis mit ↗ in der Hinweiszeile statt farbiges Etikett: Blau/Violett/Cyan sind die
 * ETB-Typkanten, ein violettes „Lagebericht" neben einer violetten Entscheidungskante
 * behauptete eine Verwandtschaft, die es nicht gibt. Das ↗ ist Glyphe und steht
 * `aria-hidden`: der zugängliche Name ist das Wort.
 *
 * Meldung und Nachforderung (LLH-1104, Spec `etb-vorgaenge`) adressiert der Verweis per
 * Query-Param auf ihrer Seite (`?meldung=`, `?nachforderung=`), die die Karte hervorhebt. Die
 * Meldung heißt nach ihrer Nummer („Meldung #12“), die Nachforderung schlicht „Nachforderung“:
 * ihr Inhalt steht schon im Eintrag.
 *
 * **Vorwärtsrichtung (LFH-636):** je Folgeauftrag — ein Auftrag, der AUS diesem Eintrag
 * erteilt wurde — ein eigener Verweis „Folgeauftrag Nr. 12", mit eindeutigem Ziel und Namen.
 * Das Wort „Folgeauftrag" trennt ihn vom Rückverweis „Auftrag" (Eintrag wurde VON einem
 * Auftrag erzeugt); beide können am selben Eintrag stehen. Die DB-`id` erscheint nie im
 * Namen — fehlt die Nummer, heißt er nur „Folgeauftrag".
 */
export default function EtbBacklinkBadges({
  eintrag,
  einsatzId,
}: {
  eintrag: EtbEintragAnzeige;
  einsatzId: number;
}) {
  const { token } = theme.useToken();
  const {
    befehl_id,
    lagebericht_id,
    auftrag_id,
    folgeauftraege,
    meldung_id,
    meldung_lfd_nr,
    nachforderung_id,
  } = eintrag;
  if (!hatVerknuepfung(eintrag)) return null;
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
      {meldung_id != null && (
        <Link to={meldungenPfad(einsatzId, { meldung: meldung_id })} style={stil}>
          {meldung_lfd_nr != null ? `Meldung #${meldung_lfd_nr}` : 'Meldung'}
          {pfeil}
        </Link>
      )}
      {nachforderung_id != null && (
        <Link to={nachforderungenPfad(einsatzId, { nachforderung: nachforderung_id })} style={stil}>
          Nachforderung{pfeil}
        </Link>
      )}
      {folgeauftraege.map((f) => (
        <Link key={f.id} to={auftraegePfad(einsatzId, { auftrag: f.id })} style={stil}>
          {f.lfd_nr != null ? `Folgeauftrag Nr. ${f.lfd_nr}` : 'Folgeauftrag'}
          {pfeil}
        </Link>
      ))}
    </span>
  );
}
