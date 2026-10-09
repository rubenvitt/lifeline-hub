import { Button } from 'antd';
import { useState, type CSSProperties } from 'react';
import type { ChatKanal } from '../api/types';
import { Liste, ListenEintrag } from '../components/Liste';
import { SeitenLeer } from '../components/SeitenZustand';
import { Paneel, monoStil, useRollen } from '../components/instrument';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import KanalAnlegenDialog from './KanalAnlegenDialog';
import type { Speicherung } from '../components/Erfassung';

interface Props {
  kanaele: ChatKanal[];
  aktiverKanalId: number | null;
  onWechsel: (kanalId: number) => void;
  darfSchreiben: boolean;
  /** Lehnt bei Ablehnung ab (`mutateAsync`); dann bleibt der Dialog mit den Eingaben offen. */
  onKanalAnlegen: (name: string, beschreibung?: string) => Promise<unknown>;
  /** Die Anlege-Mutation; ihr Grund steht im Dialog (`KanalAnlegenDialog`, LFH-1077). */
  kanalSpeicherung?: Speicherung;
}

/** Visuell verborgen, für Vorleser da (dieselbe Clip-Bauform wie `instrument/Status.tsx`). */
const NUR_VORLESER: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

/** Ungelesene Kanäle zuerst, innerhalb beider Gruppen die jüngste Aktivität zuerst. */
export function sortiereKanaele(kanaele: ChatKanal[]): ChatKanal[] {
  return [...kanaele].sort((a, b) => {
    const ungelesen = Number(b.ungelesen_anzahl > 0) - Number(a.ungelesen_anzahl > 0);
    if (ungelesen !== 0) return ungelesen;
    return (b.letzte_nachricht_at ?? b.erstellt_at).localeCompare(
      a.letzte_nachricht_at ?? a.erstellt_at,
    );
  });
}

/**
 * Kanalliste des Chats: ein `Paneel` mit Zähler im Kopf und der Anlage als Kopfaktion (sie
 * öffnet einen Dialog, sendet nichts ab).
 *
 * Die aktive Zeile trägt die 2-px-Marke in `bedien` und `aria-current`; Ungelesenes steht als
 * Zahl UND Wort („2 ungelesen" für Vorleser), nicht bloß als Farbpunkt (WCAG 1.4.1).
 * Die Anlage läuft über `KanalAnlegenDialog`, denselben Dialog wie unter `md`. Ohne Kanal steht
 * sie als Knopf im Leerzustand statt im Kopf: EIN Weg, kein Satz, der auf den Kopf zeigt
 * (LFH-1078).
 */
export default function KanalListe({
  kanaele,
  aktiverKanalId,
  onWechsel,
  darfSchreiben,
  onKanalAnlegen,
  kanalSpeicherung,
}: Props) {
  const [offen, setOffen] = useState(false);
  const { token, rollen } = useRollen();
  const { formatZeitKurz } = useAnzeigeKonventionen();
  const leer = kanaele.length === 0;

  return (
    <Paneel
      titel="Kanäle"
      meta={kanaele.length}
      aktion={
        darfSchreiben && !leer ? (
          <Button onClick={() => setOffen(true)}>Kanal anlegen</Button>
        ) : null
      }
    >
      {leer ? (
        <SeitenLeer
          titel="Noch keine Kanäle"
          aktion={
            darfSchreiben ? { label: 'Kanal anlegen', onClick: () => setOffen(true) } : undefined
          }
        />
      ) : (
        <Liste<ChatKanal>
          size="small"
          dataSource={sortiereKanaele(kanaele)}
          renderItem={(k) => {
            const aktiv = k.id === aktiverKanalId;
            return (
              <ListenEintrag
                onClick={() => onWechsel(k.id)}
                // Am Element mit `role="button"`, nicht an der inneren Zeile.
                aria-current={aktiv ? 'true' : undefined}
                // Handgebautes Bedienziel: Boden plus Polsterung.
                style={{
                  cursor: 'pointer',
                  minHeight: token.controlHeight,
                  padding: `${token.paddingXS}px ${token.padding}px`,
                  borderInlineStart: `2px solid ${aktiv ? rollen.bedien : 'transparent'}`,
                  background: aktiv ? rollen.flaeche3 : undefined,
                  fontWeight: aktiv ? 600 : 400,
                }}
              >
                <div
                  data-lfh="kanal-zeile"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: token.marginXS,
                    width: '100%',
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: aktiv ? rollen.text : rollen.text2,
                    }}
                  >
                    {k.name}
                  </span>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: token.marginXS,
                      flex: '0 0 auto',
                    }}
                  >
                    {k.ungelesen_anzahl > 0 && (
                      <span
                        data-lfh="kanal-ungelesen"
                        // `bedienText`, nicht `bedien`: die aktive Zeile trägt `flaeche3`, darauf
                        // hielt `bedien` am Tag nur 6,71 : 1 (LFH-879, Boden 7 : 1).
                        style={{ ...monoStil(11, 500), color: rollen.bedienText }}
                      >
                        {k.ungelesen_anzahl}
                        <span style={NUR_VORLESER}> ungelesen</span>
                      </span>
                    )}
                    {k.letzte_nachricht_at && (
                      <span
                        title="Letzte Nachricht"
                        style={{ ...monoStil(11), color: rollen.schwach }}
                      >
                        {formatZeitKurz(k.letzte_nachricht_at)}
                      </span>
                    )}
                  </span>
                </div>
              </ListenEintrag>
            );
          }}
        />
      )}
      <KanalAnlegenDialog
        offen={offen}
        onSchliessen={() => setOffen(false)}
        onKanalAnlegen={onKanalAnlegen}
        speicherung={kanalSpeicherung}
      />
    </Paneel>
  );
}
