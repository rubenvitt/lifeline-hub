import { Alert } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { ladeDatentraegerStatus } from '../api/system';
import { globalKeys } from '../api/queryKeys';
import type { DatentraegerOrt, DatentraegerStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { istAdmin } from '../einsatz/schreibrecht';
import { StatusChip, monoStil, useRollen } from '../components/instrument';

/**
 * Warnleiste über der Verwaltung, solange der Server-Rechner einen Ort ohne erkennbare
 * Verschlüsselung meldet (LFH-1100). Nur für den System-Admin: nur er kann am Rechner etwas
 * ändern, und nur ihm antwortet `GET /api/system/datentraeger`.
 *
 * Ob gewarnt wird, entscheidet der Server (`warnung`, samt Zusicherung externer
 * Verschlüsselung); die Leiste nennt nur die Orte, die dazu führen. Kein erklärender Satz:
 * Ort, Pfad und Befund als Marken.
 */

/** Seltene Prüfung, kein Live-Kanal: ein Abruf je fünf Minuten genügt. */
const FRISCH_MS = 5 * 60_000;

const ORT: Record<DatentraegerOrt['art'], string> = {
  datenbank: 'Datenbank',
  sicherung: 'Sicherungen',
  auslagerung: 'Auslagerung',
};

const GRUND: Record<NonNullable<DatentraegerOrt['grund']>, string> = {
  netzlaufwerk: 'Netzlaufwerk',
  virtuell: 'virtuell',
  kein_zugriff: 'kein Zugriff',
  nicht_unterstuetzt: 'nicht unterstützt',
  werkzeug_fehlt: 'Werkzeug fehlt',
  ausgabe_unbekannt: 'Ausgabe unbekannt',
};

/** Die Orte, die zur Warnung führen. */
export function betroffeneOrte(status: DatentraegerStatus): DatentraegerOrt[] {
  return status.orte.filter(
    (o) => o.wert === 'unverschluesselt' || (o.wert === 'unbekannt' && !status.extern_zugesichert),
  );
}

export default function DatentraegerWarnung() {
  const { benutzer } = useAuth();
  const { token } = useRollen();
  const aktiv = istAdmin(benutzer);
  const { data } = useQuery({
    queryKey: globalKeys.datentraeger(),
    queryFn: ladeDatentraegerStatus,
    enabled: aktiv,
    staleTime: FRISCH_MS,
  });
  if (!aktiv || !data?.warnung) return null;

  return (
    <Alert
      type="warning"
      showIcon
      // Höflich statt unterbrechend: die Leiste steht auf jeder Verwaltungsseite.
      role="status"
      data-lfh="datentraeger-warnung"
      title={
        data.gesamt === 'unverschluesselt'
          ? 'Datenträger unverschlüsselt'
          : 'Verschlüsselung unbekannt'
      }
      description={
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {betroffeneOrte(data).map((o) => (
            <li
              key={o.art}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: token.marginXS,
                marginBlockStart: token.marginXXS,
              }}
            >
              <span>{ORT[o.art]}</span>
              <span style={{ ...monoStil(12), overflowWrap: 'anywhere' }}>{o.pfad}</span>
              <StatusChip
                ton={o.wert === 'unverschluesselt' ? 'alarm' : 'achtung'}
                wort={o.wert === 'unverschluesselt' ? 'unverschlüsselt' : 'unbekannt'}
              />
              {o.grund && <StatusChip ton="neutral" wort={GRUND[o.grund]} />}
            </li>
          ))}
        </ul>
      }
      style={{ marginBlockEnd: token.marginMD }}
    />
  );
}
