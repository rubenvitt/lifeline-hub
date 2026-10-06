import { IconPerson, IconTelefon } from '../../icons';
import { Space, theme } from 'antd';
import { StatusChip, monoStil } from '../../components/instrument';
import type { Einsatzabschnitt, Staerke } from '../../api/types';
import StaerkeAnzeige from '../../anzeige/StaerkeAnzeige';
import StatusTag from '../../components/StatusTag';
import { abschnittLagezustand } from '../../theme/statusFarben';

interface Props {
  abschnitt: Einsatzabschnitt;
  /** Kumuliert über die Unterabschnitte (`abschnittStaerken(...).inklUnter`). */
  staerke: Staerke | null;
  /** Direkt zugeordnete Einheiten. */
  anzahlEinheiten: number;
}

/**
 * Ein Knoten des Gliederungsbaums als Übersicht: Name · Lagezustand · Stärke inkl.
 * Unterabschnitte · Einheitenzahl · Leiter bzw. „ohne Leiter" · Funk.
 *
 * Farben nur aus Tokens, damit der Dunkelmodus den Kontrast hält. Jede Statusfarbe steht mit
 * sichtbarem Wort (WCAG 1.4.1, „Rot bedient nichts" in `frontend/AGENTS.md`): ein reiner
 * Farbpunkt für die Führung las sich in Gelb wie der Lagezustand „angespannt" (LFH-962). Deshalb
 * zeigt ein besetzter Abschnitt nur den Leiternamen, ein unbesetzter den Chip „ohne Leiter", und
 * der Lagezustand steht in derselben Form wie im Überblick (`StatusTag` am Rand, leer = nicht
 * beurteilt). Icons in `aria-hidden`-Hülle, weil antd-Icons `role="img"` mit englischem Namen
 * mitbringen.
 */
export default function AbschnittKnoten({ abschnitt, staerke, anzahlEinheiten }: Props) {
  const { token } = theme.useToken();
  const besetzt = abschnitt.leiter_id != null;
  const lage = abschnitt.lagezustand ? abschnittLagezustand[abschnitt.lagezustand] : null;
  return (
    <Space size={token.marginXXS} wrap>
      <span>{abschnitt.name}</span>
      {lage && <StatusTag darstellung={lage} darstellungsart="rand" />}
      {/* Zahlen in Mono, kein farbiges Etikett: Blau ist die Bedienrolle. */}
      <span style={{ ...monoStil(12), color: token.colorText }}>
        <StaerkeAnzeige wert={staerke} />
      </span>
      <span style={{ ...monoStil(12), color: token.colorTextSecondary }}>
        {anzahlEinheiten} Einh.
      </span>
      {!besetzt && <StatusChip ton="achtung" wort="ohne Leiter" />}
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
