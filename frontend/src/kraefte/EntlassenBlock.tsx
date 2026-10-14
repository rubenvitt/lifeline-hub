import { Button, Collapse, Space, Typography } from 'antd';
import { ZeilenFehler } from '../components/SpeicherHinweis';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import type { ZeilenGrund } from '../components/useZeilenFehler';
import { abstand } from '../theme/tokens';

/** Ein beendeter Eintrag des Blocks: Kennung, Zusatz (Funktion o. ä.) und Ende. */
export interface BeendeterEintrag {
  id: number;
  name: string;
  zusatz?: string | null;
  /** Zeitpunkt des Endes (Server, UTC). */
  beendetAt?: string | null;
}

export interface EntlassenBlockProps {
  /** Wort des Blocks, die Zahl hängt der Block an („Entlassen (2)“). */
  titel: string;
  /** Verb im Ende-Vermerk („entlassen“, „aufgelöst“). */
  endeWort: string;
  eintraege: readonly BeendeterEintrag[];
  /**
   * Rückweg je Eintrag (Spec `kraefte-entlassung`, „Erneut disponieren“). Fehlt für Einheiten:
   * eine aufgelöste Einheit wird nicht reaktiviert (design.md D5).
   */
  aktion?: {
    etikett: string;
    onKlick: (id: number) => void;
    laeuft: (id: number) => boolean;
  };
  /** Grund einer Ablehnung am Eintrag (`useZeilenFehler`). */
  fehler?: (id: number) => ZeilenGrund | null;
  /** Aufgeklappt erzwingen, etwa im Druck: ein eingeklappter Block fehlte auf dem Blatt. */
  aufgeklappt?: boolean;
}

/**
 * Beendete Kräfte unter einer Liste (LLH-1079, design.md D6/D8): eingeklappt, damit die aktive
 * Lage oben bleibt, und nur, wenn es etwas zu zeigen gibt. Die Zahlen der Liste darüber zählen
 * die Einträge hier nicht mit; der Server liefert sie getrennt (`?entlassene=1`,
 * `?aufgeloeste=1`).
 */
export default function EntlassenBlock({
  titel,
  endeWort,
  eintraege,
  aktion,
  fehler,
  aufgeklappt,
}: EntlassenBlockProps) {
  const { formatZeitKurz } = useAnzeigeKonventionen();
  if (eintraege.length === 0) return null;
  const sortiert = [...eintraege].sort((a, b) =>
    (b.beendetAt ?? '').localeCompare(a.beendetAt ?? ''),
  );
  return (
    <Collapse
      ghost
      data-lfh="entlassen-block"
      style={{ marginTop: abstand.md }}
      {...(aufgeklappt ? { activeKey: ['entlassen'] } : {})}
      items={[
        {
          key: 'entlassen',
          label: `${titel} (${eintraege.length})`,
          children: (
            <ul
              aria-label={titel}
              style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: abstand.sm }}
            >
              {sortiert.map((e) => (
                <li key={e.id}>
                  <Space wrap size="middle">
                    <span>
                      {e.name}
                      {e.zusatz ? (
                        <Typography.Text type="secondary"> · {e.zusatz}</Typography.Text>
                      ) : null}
                    </span>
                    {e.beendetAt ? (
                      <Typography.Text type="secondary">
                        {endeWort} {formatZeitKurz(e.beendetAt)}
                      </Typography.Text>
                    ) : null}
                    {aktion ? (
                      <Button
                        aria-label={`${aktion.etikett}: ${e.name}`}
                        loading={aktion.laeuft(e.id)}
                        onClick={() => aktion.onKlick(e.id)}
                      >
                        {aktion.etikett}
                      </Button>
                    ) : null}
                  </Space>
                  <EintragError grund={fehler?.(e.id) ?? null} />
                </li>
              ))}
            </ul>
          ),
        },
      ]}
    />
  );
}

function EintragError({ grund }: { grund: ZeilenGrund | null }) {
  if (!grund) return null;
  return (
    <div>
      <ZeilenFehler fehler={grund.fehler} fallback={grund.fallback} />
    </div>
  );
}
