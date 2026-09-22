import { Space, theme } from 'antd';
import { monoStil } from '../../components/instrument';
import { PhoneOutlined, UserOutlined } from '@ant-design/icons';
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
 * Ein Knoten des Gliederungsbaums als Übersicht (LFH-347 · M59): Name · Stärke inkl.
 * Unterabschnitte · Einheitenzahl · Führungspunkt · Leiter · Funk. Vorher trug er nur
 * Name, Personen-Emoji und Telefonzeichen in einem grauen Hex-Literal — 6–8 Klicks für
 * eine Frage, die ein Blick beantworten muss.
 *
 * **Farben nur aus Tokens.** `colorTextSecondary` für Beiwerk, `rollenFarbe` für den Punkt:
 * beide halten im Dunkelmodus den Kontrast, ein Literal tat es nicht.
 *
 * **Der Punkt ist Statusfarbe als Punkt, nie als Textfläche**, und er trägt sein Wort im
 * `aria-label` (WCAG 1.4.1) — die Farbe allein sagte einem Vorleser und einem
 * Farbfehlsichtigen nichts. „Führungslage" heißt hier: ist ein Abschnittsleiter gesetzt.
 *
 * **Ikonen in `aria-hidden`-Hülle:** antds Icons bringen `role="img"` mit englischem
 * Namen („user", „phone") mit und stünden sonst in jeder Zeile als eigenes Vorleseziel.
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
          // Radius 0 auch für den Punkt (Neuentwurf „Instrumententafel": Formensprache).
          borderRadius: 0,
          backgroundColor: rollenFarbe(besetzt ? 'normal' : 'achtung', token),
        }}
      />
      <span>{abschnitt.name}</span>
      {/* Stärke und Einheitenzahl sind Zahlen → Mono (Neuentwurf), kein farbiges Etikett:
          Blau ist die Bedienrolle und benennt hier nichts. */}
      <span style={{ ...monoStil(12), color: token.colorText }}>
        <StaerkeAnzeige wert={staerke} />
      </span>
      <span style={{ ...monoStil(12), color: token.colorTextSecondary }}>
        {anzahlEinheiten} Einh.
      </span>
      {abschnitt.leiter_name && (
        <span style={{ color: token.colorTextSecondary }}>
          <span aria-hidden="true">
            <UserOutlined />
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
          <PhoneOutlined />
        </span>
      )}
    </Space>
  );
}
