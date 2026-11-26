import { Button, Typography, theme } from 'antd';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import {
  ausgangFehlerText,
  useVersaende,
  useWiederholeVersand,
  type QuelleFilter,
} from '../api/ausgang';
import type { Versand } from '../api/types';
import { ZeilenFehler } from '../components/SpeicherHinweis';
import { schriftStil } from '../components/instrument';
import { useOnline } from '../offline/useOnline';

/**
 * Zustandstext eines Versands (Spec 7): „wartet“, „übergeben 14:32“, beim Fax „übergeben 14:32,
 * Zustellung wird geprüft“ und „zugestellt 14:34“ (LLH-2095), „fehlgeschlagen: …“. Eine Mail
 * ohne PDF sagt es dazu.
 */
export function versandZustandText(v: Versand, uhrzeit: (utc?: string | null) => string): string {
  const fax = v.channel === 'fax';
  const ohnePdf = v.without_pdf ? ' · ohne PDF' : '';
  if (v.state === 'wartet') return 'wartet';
  if (v.state === 'zugestellt') return `zugestellt ${uhrzeit(v.delivered_at)}`.trim();
  if (v.state === 'uebergeben') {
    const zeit = `übergeben ${uhrzeit(v.handed_over_at)}`.trim();
    return fax ? `${zeit}, Zustellung wird geprüft` : `${zeit}${ohnePdf}`;
  }
  // Unklar ist kein Fehlschlag mit Grund, sondern eine offene Frage: der Wortlaut steht allein.
  if (v.error === 'ungewiss') return ausgangFehlerText('ungewiss', v.channel) as string;
  const grund = ausgangFehlerText(v.error, v.channel);
  return grund ? `fehlgeschlagen: ${grund}` : 'fehlgeschlagen';
}

/**
 * Versandliste einer Quelle (LLH-2093, Fax LLH-2095): je Versand Stelle, Adresse, Zeit und Zustand, bei
 * `fehlgeschlagen` „Erneut senden“. Ohne Versand steht nichts da. Live über `ausgang`.
 */
export default function Versandliste({
  einsatzId,
  quelle,
  darfSchreiben = true,
}: {
  einsatzId: number;
  quelle: QuelleFilter;
  /** Ohne Schreibrecht entfällt „Erneut senden“. */
  darfSchreiben?: boolean;
}) {
  const { token } = theme.useToken();
  const { uhrzeit } = useAnzeigeKonventionen();
  const online = useOnline();
  const query = useVersaende(einsatzId, quelle);
  const wiederhole = useWiederholeVersand(einsatzId, quelle);
  const versaende = query.data ?? [];
  if (versaende.length === 0) return null;

  return (
    <section aria-label="Versand" data-lfh="versandliste" style={{ marginTop: token.marginSM }}>
      <Typography.Text strong>Versand</Typography.Text>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {versaende.map((v) => {
          const fehlgeschlagen = v.state === 'fehlgeschlagen';
          const laeuftDieser = wiederhole.isPending && wiederhole.variables === v.id;
          return (
            <li
              key={v.id}
              data-versand-id={v.id}
              data-state={v.state}
              style={{ paddingBlock: token.paddingXXS }}
            >
              <span style={{ ...schriftStil('text'), overflowWrap: 'anywhere' }}>
                {v.agency_name} · {v.channel === 'fax' ? `Fax ${v.address}` : v.address}
              </span>{' '}
              <Typography.Text
                type={fehlgeschlagen ? 'danger' : 'secondary'}
                style={schriftStil('textKlein')}
              >
                {versandZustandText(v, uhrzeit)}
              </Typography.Text>
              {fehlgeschlagen && darfSchreiben && (
                <>
                  {' '}
                  <Button
                    loading={laeuftDieser}
                    disabled={!online}
                    onClick={() => wiederhole.mutate(v.id)}
                  >
                    Erneut senden
                  </Button>
                  {!online && (
                    <Typography.Text type="secondary" style={schriftStil('textKlein')}>
                      {' '}
                      Ohne Netz nicht möglich
                    </Typography.Text>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {wiederhole.isError && (
        <ZeilenFehler fehler={wiederhole.error} fallback="Erneut senden fehlgeschlagen" />
      )}
    </section>
  );
}
