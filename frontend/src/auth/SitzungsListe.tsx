import { Button, Flex, Space } from 'antd';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { PaneelZustand, StatusChip, monoStil, useRollen } from '../components/instrument';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { globalKeys } from '../api/queryKeys';
import type { SitzungAnzeige } from '../api/types';

/**
 * Unter dieser Spanne gilt eine Sitzung als „gerade eben“ gesehen: der Server schreibt „zuletzt
 * gesehen“ nur alle 5 min fort (`auth::session::ZULETZT_GESEHEN_TAKT_MINUTEN`), eine genauere
 * Angabe wäre geraten.
 */
const GERADE_EBEN_MS = 5 * 60_000;

/** Server-`datetime` (UTC ohne Zone) → Millisekunden. */
function alsMs(utc: string): number {
  return Date.parse(`${utc.trim().replace(' ', 'T')}Z`);
}

/** „gerade eben“, „vor 12 min“, „vor 3 h“; ab einem Tag `null` (dann steht der Zeitpunkt). */
export function zuletztText(utc: string, jetztMs: number): string | null {
  const alter = jetztMs - alsMs(utc);
  if (alter < GERADE_EBEN_MS) return 'gerade eben';
  if (alter < 60 * 60_000) return `vor ${Math.floor(alter / 60_000)} min`;
  if (alter < 24 * 60 * 60_000) return `vor ${Math.floor(alter / (60 * 60_000))} h`;
  return null;
}

/** Die Minute, damit „vor 12 min“ nicht stehen bleibt, solange die Liste offen ist. */
function useJetzt(): number {
  const [jetzt, setJetzt] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setJetzt(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return jetzt;
}

interface SitzungsListeProps {
  /** Benennt den Ladezustand für Vorlesende. */
  titel: string;
  queryKey: QueryKey;
  laden: () => Promise<SitzungAnzeige[]>;
  beendeEine: (kennung: string) => Promise<unknown>;
  beendeAlle: () => Promise<unknown>;
  /** „Alle anderen beenden“ (eigene Liste) oder „Alle beenden“ (Admin, fremdes Konto); steht ab
   * zwei beendbaren Sitzungen. */
  alleText: string;
}

/**
 * Laufende Sitzungen eines Kontos mit Beenden (LFH-1092). Die aktuelle Sitzung trägt die Marke
 * „dieses Gerät“ und keinen Knopf: sie endet über Abmelden (der Server lehnt sie mit 422 ab).
 *
 * Keine Rückfrage vor dem Beenden (Linie aus LFH-363, `frontend/AGENTS.md`): eine beendete
 * Sitzung ist durch erneutes Anmelden umkehrbar, also `danger` mit Abstand wie „Deaktivieren“.
 */
export default function SitzungsListe({
  titel,
  queryKey,
  laden,
  beendeEine,
  beendeAlle,
  alleText,
}: SitzungsListeProps) {
  const qc = useQueryClient();
  const { token, rollen } = useRollen();
  const { formatZeit } = useAnzeigeKonventionen();
  const jetzt = useJetzt();
  const abfrage = useQuery({ queryKey, queryFn: laden });

  // Beide Fächer (eigene und fremde) unter einem Prefix: ein Admin am eigenen Konto sieht dieselbe
  // Liste im Profil.
  const nachher = () => qc.invalidateQueries({ queryKey: globalKeys.sitzungen() });
  const eine = useMutation({ mutationFn: beendeEine, onSettled: nachher });
  const alle = useMutation({ mutationFn: beendeAlle, onSettled: nachher });

  const sitzungen = abfrage.data ?? [];
  const andere = sitzungen.filter((s) => !s.aktuell);
  const zustand = abfrage.isPending
    ? 'laden'
    : abfrage.isError
      ? 'fehler'
      : sitzungen.length === 0
        ? 'leer'
        : 'daten';
  const fehler = eine.error ?? alle.error;

  return (
    <PaneelZustand
      zustand={zustand}
      titel={titel}
      leerText="Keine Anmeldungen"
      onNeuladen={() => void abfrage.refetch()}
    >
      <Flex vertical gap={token.marginSM} data-lfh="sitzungsliste">
        {fehler != null && <SpeicherFehler fehler={fehler} titel="Nicht beendet" />}
        {sitzungen.map((s) => {
          const geraet = s.geraet ?? 'Unbekanntes Gerät';
          const zuletzt = zuletztText(s.zuletzt_gesehen_at, jetzt);
          const laeuft = eine.isPending && eine.variables === s.kennung;
          return (
            <Flex
              key={s.kennung}
              data-lfh="sitzung"
              justify="space-between"
              align="center"
              gap={token.marginSM}
              wrap
              style={{ paddingBlock: token.paddingXXS }}
            >
              <Flex vertical gap={2}>
                <Space size="small" wrap>
                  <span style={{ fontWeight: 600 }}>{geraet}</span>
                  {s.aktuell && <StatusChip ton="normal" wort="dieses Gerät" />}
                </Space>
                <span style={{ fontSize: token.fontSizeSM, color: rollen.text2 }}>
                  angemeldet{' '}
                  <span style={monoStil(token.fontSizeSM)}>{formatZeit(s.angemeldet_at)}</span>
                  {' · '}zuletzt{' '}
                  {zuletzt ?? (
                    <span style={monoStil(token.fontSizeSM)}>
                      {formatZeit(s.zuletzt_gesehen_at)}
                    </span>
                  )}
                </span>
              </Flex>
              {!s.aktuell && (
                <Button
                  danger
                  loading={laeuft}
                  aria-label={`Anmeldung ${geraet} beenden`}
                  onClick={() => {
                    if (laeuft) return;
                    alle.reset();
                    eine.mutate(s.kennung);
                  }}
                >
                  Beenden
                </Button>
              )}
            </Flex>
          );
        })}
        {/* Erst ab zwei: bei einer steht ihr eigener Knopf schon in der Zeile. */}
        {andere.length > 1 ? (
          <div>
            <Button
              danger
              loading={alle.isPending}
              onClick={() => {
                if (alle.isPending) return;
                eine.reset();
                alle.mutate();
              }}
            >
              {alleText}
            </Button>
          </div>
        ) : null}
      </Flex>
    </PaneelZustand>
  );
}
