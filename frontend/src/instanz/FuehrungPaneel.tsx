import { useState } from 'react';
import { App, Button, Form, Input, Modal, Popconfirm, Radio, Space, Typography } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Datenfeld,
  Datenraster,
  Paneel,
  StatusChip,
  monoStil,
  useRollen,
} from '../components/instrument';
import { Liste, ListenEintrag, ListenEintragMeta } from '../components/Liste';
import { ErfassungsModal } from '../components/Erfassung';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import KopierbarerText from '../components/KopierbarerText';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { zeitKurz } from '../anzeige/zeitDarstellung';
import {
  bestaetigeUebernahme,
  frageFuehrungAn,
  gibFuehrungPerCodeAb,
  uebergebeFuehrung,
  uebernimmFuehrung,
  uebernimmFuehrungMitCode,
  uebernimmFuehrungMitUnterschrift,
  widersprecheUebernahme,
  type FuehrungOrt,
} from '../api/fuehrung';
import { FUEHRUNG_GRUND_MAX } from '../api/eingabegrenzen';
import { zeichenGrenze, zeichenRegel } from '../components/zeichenGrenze';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { FuehrungAnzeige, FuehrungCodeAntwort, FuehrungVerlaufEintrag } from '../api/types';
import { FUEHRUNG_ART_TEXT, fuehrungMoeglich } from './fuehrungText';

/** Folge der Übergabe und der Abgabe per Code: steht in der Rückfrage, nicht neben dem Knopf. */
const ABGABE_FOLGE = 'Danach ist der Einsatz hier nur noch zu lesen.';

/**
 * Nach jeder Änderung der Führung: die Akte, der Einsatzkopf (Chip, Hinweisband, Schreibrechte)
 * und die Seite „Instanzkopplung“ (Einsätze beim Gegenüber, Hinweise an der Kopplung).
 */
function useNachFuehrung(einsatzId?: number) {
  const qc = useQueryClient();
  return () => {
    if (einsatzId != null) {
      void qc.invalidateQueries({ queryKey: einsatzKeys.fuehrung(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId) });
    }
    void qc.invalidateQueries({ queryKey: globalKeys.instanzkopplung() });
  };
}

function ortVon(f: FuehrungAnzeige): FuehrungOrt {
  return f.einsatz_id != null ? { einsatzId: f.einsatz_id } : { akteId: f.id };
}

/**
 * Bestätigen oder Widersprechen einer offenen Übernahme (Spec „Die meldende Seite gibt nie still
 * ab“, „Widersprechen heißt Rückübernahme“). Steht im Hinweisband unter der Kopfleiste und im
 * Paneel. Beide mit Rückfrage; Widersprechen ist die Rückübernahme.
 */
export function UebernahmeEntscheidung({
  fuehrung,
  einsatzId,
}: {
  fuehrung: FuehrungAnzeige;
  einsatzId?: number;
}) {
  const { message } = App.useApp();
  const nach = useNachFuehrung(einsatzId ?? fuehrung.einsatz_id ?? undefined);
  const ort = ortVon(fuehrung);
  const bestaetigen = useMutation({
    mutationFn: () => bestaetigeUebernahme(ort),
    onSuccess: (f) => {
      nach();
      message.success(`Führung liegt jetzt bei ${f.fuehrer_name}`);
    },
  });
  const widersprechen = useMutation({
    mutationFn: () => widersprecheUebernahme(ort),
    onSuccess: () => {
      nach();
      message.success('Widersprochen, die Führung bleibt hier');
    },
  });
  const von = fuehrung.offen?.von ?? '';
  return (
    <Space orientation="vertical" size="small">
      <Space wrap>
        <Popconfirm
          title={`Übernahme durch ${von} bestätigen?`}
          description={ABGABE_FOLGE}
          okText="Übernahme bestätigen"
          cancelText="Abbrechen"
          onConfirm={() => bestaetigen.mutate()}
        >
          <Button
            type="primary"
            loading={bestaetigen.isPending}
            disabled={widersprechen.isPending}
            data-lfh="fuehrung-bestaetigen"
          >
            Übernahme bestätigen
          </Button>
        </Popconfirm>
        <Popconfirm
          title={`Der Übernahme durch ${von} widersprechen?`}
          description="Die Führung bleibt hier."
          okText="Widersprechen"
          cancelText="Abbrechen"
          okButtonProps={{ danger: true }}
          onConfirm={() => widersprechen.mutate()}
        >
          <Button
            danger
            loading={widersprechen.isPending}
            disabled={bestaetigen.isPending}
            data-lfh="fuehrung-widersprechen"
          >
            Widersprechen
          </Button>
        </Popconfirm>
      </Space>
      <SpeicherFehler fehler={bestaetigen.error} titel="Nicht bestätigt" />
      <SpeicherFehler fehler={widersprechen.error} titel="Nicht widersprochen" />
    </Space>
  );
}

interface NotuebernahmeWerte {
  grund?: string;
  beweis?: 'unterschrift' | 'code';
  code?: string;
}

/**
 * Paneel „Führung“ (LLH-1491): wer führt, mit welcher Epoche, wie es dazu kam, und die Bedienung.
 * Auf der Seite Einsatzdaten für den lokalen Einsatz, auf der Seite „Instanzkopplung“ für einen
 * Einsatz beim Gegenüber. Ohne `darfBedienen` nur der Stand.
 */
export default function FuehrungPaneel({
  fuehrung,
  darfBedienen,
  titel = 'Führung',
  style,
}: {
  fuehrung: FuehrungAnzeige;
  darfBedienen: boolean;
  titel?: string;
  style?: React.CSSProperties;
}) {
  const { token, rollen } = useRollen();
  const { message } = App.useApp();
  const { konventionen: konv } = useAnzeigeKonventionen();
  const zeit = (wert: string) => zeitKurz(wert, konv);
  const nach = useNachFuehrung(fuehrung.einsatz_id ?? undefined);
  const ort = ortVon(fuehrung);
  const moeglich = fuehrungMoeglich(fuehrung);
  const [neuerCode, setNeuerCode] = useState<FuehrungCodeAntwort | null>(null);
  const [notOffen, setNotOffen] = useState(false);
  const [form] = Form.useForm<NotuebernahmeWerte>();
  const beweisWahl = Form.useWatch('beweis', form);

  const uebergeben = useMutation({
    mutationFn: (an: string) => uebergebeFuehrung(ort, an),
    onSuccess: (f) => {
      nach();
      message.success(`Führung an ${f.fuehrer_name} übergeben`);
    },
  });
  const perCode = useMutation({
    mutationFn: (an: string) => gibFuehrungPerCodeAb(ort, an),
    onSuccess: (c) => {
      nach();
      setNeuerCode(c);
    },
  });
  const anfragen = useMutation({
    mutationFn: () => frageFuehrungAn(ort),
    onSuccess: () => {
      nach();
      message.success('Führung angefragt');
    },
  });
  const notuebernahme = useMutation({
    mutationFn: (w: NotuebernahmeWerte) => {
      const grund = (w.grund ?? '').trim();
      if (!moeglich.notuebernahmeMitBeweis) return uebernimmFuehrung(ort, grund);
      return w.beweis === 'code'
        ? uebernimmFuehrungMitCode(ort, grund, w.code ?? '')
        : uebernimmFuehrungMitUnterschrift(ort, grund);
    },
    onSuccess: () => {
      nach();
      message.success('Führung übernommen');
    },
  });

  const stand = (
    <Datenraster spalten={2}>
      <Datenfeld label="Führung">
        <StatusChip
          ton={fuehrung.fuehrend ? 'normal' : 'neutral'}
          wort={fuehrung.fuehrend ? 'hier' : fuehrung.fuehrer_name}
        />
      </Datenfeld>
      <Datenfeld label="Epoche">
        <span style={monoStil(13)}>{fuehrung.epoche}</span>
      </Datenfeld>
      <Datenfeld label="Zuletzt">{FUEHRUNG_ART_TEXT[fuehrung.art]}</Datenfeld>
      <Datenfeld label="Bruchstelle">{fuehrung.bruch_at ? zeit(fuehrung.bruch_at) : '—'}</Datenfeld>
      {fuehrung.anfrage_offen && <Datenfeld label="Anfrage">beim Gegenüber gestellt</Datenfeld>}
    </Datenraster>
  );

  return (
    <Paneel titel={titel} koerperPolster style={style}>
      {stand}

      {fuehrung.offen && (
        <div
          data-lfh="fuehrung-offen"
          style={{
            marginBlockStart: token.marginMD,
            padding: token.paddingSM,
            border: `1px solid ${rollen.achtungText}`,
          }}
        >
          <Typography.Text strong style={{ color: rollen.achtungText }}>
            Führung übernommen von {fuehrung.offen.von}
          </Typography.Text>
          <Datenraster spalten={2}>
            <Datenfeld label="Grund" breit>
              {fuehrung.offen.grund ?? '—'}
            </Datenfeld>
            <Datenfeld label="Unterzeichnet von">{fuehrung.offen.unterzeichner ?? '—'}</Datenfeld>
            <Datenfeld label="Erklärt">
              {fuehrung.offen.zeitpunkt ? zeit(fuehrung.offen.zeitpunkt) : '—'}
            </Datenfeld>
          </Datenraster>
          {darfBedienen && (
            <div style={{ marginBlockStart: token.marginSM }}>
              <UebernahmeEntscheidung fuehrung={fuehrung} />
            </div>
          )}
        </div>
      )}

      {darfBedienen && (
        <Space wrap style={{ marginBlockStart: token.marginMD }}>
          {moeglich.uebergeben.map((g) => (
            <Popconfirm
              key={`u-${g.kennung}`}
              title={`Führung an ${g.name} übergeben?`}
              description={ABGABE_FOLGE}
              okText="Führung übergeben"
              cancelText="Abbrechen"
              okButtonProps={{ danger: true }}
              onConfirm={() => uebergeben.mutate(g.kennung)}
            >
              <Button loading={uebergeben.isPending} data-lfh="fuehrung-uebergeben">
                Führung an {g.name} übergeben
              </Button>
            </Popconfirm>
          ))}
          {moeglich.perCode.map((g) => (
            <Popconfirm
              key={`c-${g.kennung}`}
              title={`Führung per Code an ${g.name} abgeben?`}
              description={ABGABE_FOLGE}
              okText="Code erzeugen"
              cancelText="Abbrechen"
              okButtonProps={{ danger: true }}
              onConfirm={() => perCode.mutate(g.kennung)}
            >
              <Button loading={perCode.isPending} data-lfh="fuehrung-code">
                Führung per Code abgeben
              </Button>
            </Popconfirm>
          ))}
          {moeglich.anfragen && (
            <Button
              loading={anfragen.isPending}
              onClick={() => anfragen.mutate()}
              data-lfh="fuehrung-anfragen"
            >
              Führung anfragen
            </Button>
          )}
          {(moeglich.notuebernahme || moeglich.notuebernahmeMitBeweis) && (
            <Button
              danger
              onClick={() => {
                notuebernahme.reset();
                setNotOffen(true);
              }}
              data-lfh="fuehrung-notuebernahme"
            >
              Notübernahme …
            </Button>
          )}
        </Space>
      )}
      <div style={{ marginBlockStart: token.marginSM }}>
        <SpeicherFehler fehler={uebergeben.error} titel="Nicht übergeben" />
        <SpeicherFehler fehler={perCode.error} titel="Kein Code" />
        <SpeicherFehler fehler={anfragen.error} titel="Nicht angefragt" />
      </div>

      <Typography.Title level={5} style={{ marginBlockStart: token.marginMD }}>
        Verlauf
      </Typography.Title>
      <Liste<FuehrungVerlaufEintrag>
        dataSource={[...fuehrung.verlauf].reverse()}
        rowKey={(v) => `${v.at}-${v.epoche_zaehler}-${v.art}`}
        emptyText="Kein Wechsel"
        renderItem={(v) => (
          <ListenEintrag>
            <ListenEintragMeta
              title={
                <span>
                  <span style={monoStil(12)}>{v.epoche_zaehler}</span> {FUEHRUNG_ART_TEXT[v.art]}
                  {' · '}
                  {v.von_name ? `${v.von_name} → ${v.nach_name}` : v.nach_name}
                </span>
              }
              description={
                <span>
                  {zeit(v.at)}
                  {v.wer ? ` · ${v.wer}` : ''}
                  {v.unterzeichner ? ` · unterzeichnet von ${v.unterzeichner}` : ''}
                  {v.grund ? ` · ${v.grund}` : ''}
                  {v.bruch_at ? ` · Bruchstelle ${zeit(v.bruch_at)}` : ''}
                </span>
              }
            />
          </ListenEintrag>
        )}
      />

      <ErfassungsModal<NotuebernahmeWerte>
        offen={notOffen}
        titel={`Notübernahme gegen ${fuehrung.fuehrer_name}`}
        form={form}
        erfassenText="Führung übernehmen"
        unumkehrbar
        laeuft={notuebernahme.isPending}
        speicherung={notuebernahme}
        speicherFehlerTitel="Nicht übernommen"
        initialValues={{ beweis: 'unterschrift' }}
        onErfassen={(w) => notuebernahme.mutateAsync(w)}
        onFertig={() => setNotOffen(false)}
        onAbbrechen={() => {
          notuebernahme.reset();
          setNotOffen(false);
        }}
      >
        <Form.Item
          label="Grund"
          name="grund"
          rules={[
            { required: true, whitespace: true, message: 'Grund angeben' },
            zeichenRegel(FUEHRUNG_GRUND_MAX, 'Grund'),
          ]}
        >
          <Input.TextArea
            autoSize={{ minRows: 2, maxRows: 5 }}
            count={zeichenGrenze(FUEHRUNG_GRUND_MAX)}
            placeholder="ohne Verbindung seit 40 min"
          />
        </Form.Item>
        {moeglich.notuebernahmeMitBeweis && (
          <>
            <Form.Item label="Beweis" name="beweis">
              <Radio.Group
                optionType="button"
                options={[
                  { value: 'unterschrift', label: 'Eigene Unterschrift' },
                  { value: 'code', label: 'Code des Gegenübers' },
                ]}
              />
            </Form.Item>
            {beweisWahl === 'code' && (
              <Form.Item
                label="Code"
                name="code"
                rules={[{ required: true, whitespace: true, message: 'Code angeben' }]}
              >
                <Input
                  autoComplete="off"
                  maxLength={19}
                  placeholder="ABCD-EFGH-JKMN-PQRS"
                  style={monoStil(14)}
                />
              </Form.Item>
            )}
          </>
        )}
      </ErfassungsModal>

      <Modal
        open={neuerCode != null}
        title="Code für die Abgabe"
        // Der Code kommt nie wieder vom Server: kein Schließen per Klick daneben oder Escape.
        mask={{ closable: false }}
        keyboard={false}
        footer={
          <Button type="primary" onClick={() => setNeuerCode(null)}>
            Fertig
          </Button>
        }
        onCancel={() => setNeuerCode(null)}
        destroyOnHidden
      >
        {neuerCode && (
          <div data-lfh="fuehrung-code-anzeige">
            <p>Nur jetzt sichtbar. Per Funk oder Telefon durchgeben:</p>
            <KopierbarerText text={neuerCode.code} bezeichnung="Code">
              <span style={monoStil(20, 500)}>{neuerCode.code}</span>
            </KopierbarerText>
          </div>
        )}
      </Modal>
    </Paneel>
  );
}
