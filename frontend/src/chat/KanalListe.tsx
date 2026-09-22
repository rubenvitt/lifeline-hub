import { Button, Form, Input } from 'antd';
import { useState, type CSSProperties } from 'react';
import type { ChatKanal } from '../api/types';
import { ErfassungsModal } from '../components/Erfassung';
import { Liste, ListenEintrag } from '../components/Liste';
import { Paneel, monoStil, useRollen } from '../components/instrument';
import { formatZeitKurz } from '../kommunikation';

interface Props {
  kanaele: ChatKanal[];
  aktiverKanalId: number | null;
  onWechsel: (kanalId: number) => void;
  darfSchreiben: boolean;
  onKanalAnlegen: (name: string, beschreibung?: string) => void;
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

interface KanalFormWerte {
  name: string;
  beschreibung?: string;
}

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
 * Kanalliste des Chats (Neuentwurf): ein `Paneel` mit Augenbraue „Kanäle", Zähler rechts im
 * Kopf und der Anlage als Kopfaktion — sie ÖFFNET einen Dialog, sendet also nichts ab
 * (Kopf-Slot-Regel LFH-346 · C11).
 *
 * Die aktive Zeile trägt die 2-px-Marke in `bedien` wie das Modulpanel und `aria-current`;
 * die Zahl der ungelesenen Nachrichten steht als Mono-Zahl in `bedien` — Zahl UND Wort
 * („2 ungelesen" für Vorleser), nicht bloß ein Farbpunkt (WCAG 1.4.1).
 *
 * Die Anlage läuft über die `ErfassungsModal`-Hülle (Erfassungs-Norm B4): der Absende-Knopf
 * liegt im `<form>`, Enter sendet, und jeder Weg hinaus setzt zurück. Vorher stand hier ein
 * handgebautes `<Modal onOk={form.submit}>` — Enter war dort tot.
 */
export default function KanalListe({
  kanaele,
  aktiverKanalId,
  onWechsel,
  darfSchreiben,
  onKanalAnlegen,
}: Props) {
  const [offen, setOffen] = useState(false);
  const [form] = Form.useForm<KanalFormWerte>();
  const { token, rollen } = useRollen();

  return (
    <Paneel
      titel="Kanäle"
      meta={kanaele.length}
      aktion={darfSchreiben ? <Button onClick={() => setOffen(true)}>Kanal anlegen</Button> : null}
    >
      {kanaele.length === 0 ? (
        <div style={{ padding: token.padding, color: rollen.gedaempft }}>
          Noch keine Kanäle
          {darfSchreiben ? ' — legen Sie den ersten über „Kanal anlegen" an.' : '.'}
        </div>
      ) : (
        <Liste<ChatKanal>
          size="small"
          dataSource={sortiereKanaele(kanaele)}
          renderItem={(k) => {
            const aktiv = k.id === aktiverKanalId;
            return (
              <ListenEintrag
                onClick={() => onWechsel(k.id)}
                // Am Element mit `role="button"`, nicht an der inneren Zeile (LFH-621).
                aria-current={aktiv ? 'true' : undefined}
                // Handgebautes Bedienziel: ZWEI Angaben (LFH-365) — Boden plus Polsterung.
                style={{
                  cursor: 'pointer',
                  minHeight: token.controlHeight,
                  padding: `${token.paddingXS}px ${token.padding}px`,
                  borderInlineStart: `2px solid ${aktiv ? rollen.bedien : 'transparent'}`,
                  background: aktiv ? rollen.flaeche2 : undefined,
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
                        style={{ ...monoStil(11, 500), color: rollen.bedien }}
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
      <ErfassungsModal<KanalFormWerte>
        offen={offen}
        titel="Neuer Kanal"
        form={form}
        erfassenText="Anlegen"
        onErfassen={async (w) => {
          onKanalAnlegen(w.name.trim(), w.beschreibung?.trim() || undefined);
        }}
        onFertig={() => setOffen(false)}
        onAbbrechen={() => setOffen(false)}
      >
        <Form.Item
          label="Name"
          name="name"
          rules={[{ required: true, whitespace: true, message: 'Name erforderlich' }]}
        >
          <Input placeholder="z. B. S2/S3 oder Abschnitt Nord" />
        </Form.Item>
        <Form.Item label="Beschreibung (optional)" name="beschreibung">
          <Input placeholder="Kurzbeschreibung" />
        </Form.Item>
      </ErfassungsModal>
    </Paneel>
  );
}
