import { Tag } from 'antd';
import StatusTag from '../components/StatusTag';
import { uebernahmeOffen } from '../theme/statusFarben';

/**
 * Kennzeichen einer unangemeldet eingetroffenen Einheit, die die Führung noch nicht übernommen
 * hat (LLH-1075, design.md D14): das Wort „nicht übernommen“ in der Rolle `achtung`. Kein Blinken
 * (Alarmbudget, `frontend/AGENTS.md`), im Druck steht das Wort. Steht in der Belegungszeile des
 * Raums, im Kräftebaum, in der Einheitenliste und im Kopf der Einheit-Ansicht.
 */
export default function NichtUebernommenMarke() {
  return (
    <span data-lfh="nicht-uebernommen">
      <StatusTag darstellung={uebernahmeOffen} />
    </span>
  );
}

/**
 * Herkunft „unangemeldet“ nach der Übernahme: neutral, ohne Statusrolle. Nur in der
 * Belegungszeile des Raums.
 */
export function UnangemeldetMarke() {
  return <Tag data-lfh="unangemeldet">unangemeldet</Tag>;
}
