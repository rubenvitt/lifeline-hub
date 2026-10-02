import { IconPerson, IconTelefon } from '../../icons';
import { Space, theme } from 'antd';
import { monoStil } from '../../components/instrument';
import type { Einsatzabschnitt, Staerke } from '../../api/types';
import StaerkeAnzeige from '../../anzeige/StaerkeAnzeige';
import { rollenFarbe } from '../../theme/statusFarben';

interface Props {
  abschnitt: Einsatzabschnitt;
  /** Kumuliert über die Unterabschnitte (`abschnittStaerken(...).inklUnter`). */
  staerke: Staerke | null;
  /** Direkt zugeordnete Einheiten. */
  anzahlEinheiten: number;
}

/**
 * Ein Knoten des Gliederungsbaums als Übersicht: Name · Stärke inkl. Unterabschnitte ·
 * Einheitenzahl · Führungspunkt · Leiter · Funk.
 *
 * Farben nur aus Tokens, damit der Dunkelmodus den Kontrast hält. Der Führungspunkt ist Statusfarbe
 * als Punkt und trägt sein Wort im `aria-label` (WCAG 1.4.1); „Führungslage" heißt: ein
 * Abschnittsleiter ist gesetzt. Icons in `aria-hidden`-Hülle, weil antd-Icons `role="img"` mit
 * englischem Namen mitbringen.
 */
export default function AbschnittKnoten({ abschnitt, staerke, anzahlEinheiten }: Props) {
  const { token } = theme.useToken();
  const besetzt = abschnitt.leiter_id != null;
  return (
    <Space size={token.marginXXS} wrap>
      <span
        role="img"
        aria-label={besetzt ? 'Führung besetzt' : 'Führung unbesetzt'}
        style={{
          display: 'inline-block',
          width: token.fontSizeSM,
          height: token.fontSizeSM,
          borderRadius: 0,
          backgroundColor: rollenFarbe(besetzt ? 'normal' : 'achtung', token),
        }}
      />
      <span>{abschnitt.name}</span>
      {/* Zahlen in Mono, kein farbiges Etikett: Blau ist die Bedienrolle. */}
      <span style={{ ...monoStil(12), color: token.colorText }}>
        <StaerkeAnzeige wert={staerke} />
      </span>
      <span style={{ ...monoStil(12), color: token.colorTextSecondary }}>
        {anzahlEinheiten} Einh.
      </span>
      {abschnitt.leiter_name && (
        <span style={{ color: token.colorTextSecondary }}>
          <span aria-hidden="true">
            <IconPerson />
          </span>{' '}
          {abschnitt.leiter_name}
        </span>
      )}
      {abschnitt.erreichbarkeit && (
        <span
          aria-hidden="true"
          title="Erreichbarkeit hinterlegt"
          style={{ color: token.colorTextSecondary }}
        >
          <IconTelefon />
        </span>
      )}
    </Space>
  );
}
