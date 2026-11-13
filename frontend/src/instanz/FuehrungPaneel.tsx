import { useEffect, useId, useState } from 'react';
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
import { OHNE_VERBINDUNG_NICHT_AENDERBAR, useOhneVerbindung } from '../offline/verbindung';
import { zeitKurz } from '../anzeige/zeitDarstellung';
import {
  bestaetigeUebernahme,
  frageFuehrungAn,
  gibFuehrungPerCodeAb,
  holeFuehrungZurueck,
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
import {
  FUEHRUNG_ART_TEXT,
  fuehrungMoeglich,
  kopplungBeendetText,
  offeneUebernahmeTitel,
  vorOrtHinweis,
} from './fuehrungText';

/** Folge der Übergabe und der Abgabe per Code: steht in der Rückfrage, nicht neben dem Knopf. */
const ABGABE_FOLGE = 'Danach ist der Einsatz hier nur noch zu lesen.';

/**
 * Jede Aktion der Führung ist ohne Verbindung gesperrt, nie vorgemerkt (LLH-1670): Es gibt keinen
 * Weg in die Queue, und eine angehaltene Übergabe oder Code-Abgabe ginge sonst bei der Rückkehr
 * des Netzes hinaus, auch nach Verlassen der Seite, und der einmalige Code landete im Nichts.
 * `'always'` sendet sofort oder scheitert sofort (`frontend/src/offline/AGENTS.md`, „Schreiben
 * ohne Netz“); die Knöpfe fragen `useOhneVerbindung`.
 */
const SOFORT_ODER_NIE = { networkMode: 'always' } as const;

/** Der Grund, der an gesperrten Aktionen der Führung steht (`aria-describedby`). */
function OhneNetzGrund({ id }: { id: string }) {
  return (
    <Typography.Text id={id} type="secondary" data-lfh="fuehrung-ohne-netz">
      {OHNE_VERBINDUNG_NICHT_AENDERBAR}
    </Typography.Text>
  );
}

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
 * Paneel. Beide mit Rückfrage; Widersprechen ist die Rückübernahme. Im Konflikt (LLH-1669) nennt
 * der Hub eine andere ELW als Führer und nähme keinen Widerspruch an: nur Bestätigen.
 */
export function UebernahmeEntscheidung({
  fuehrung,
  einsatzId,
  ohneNetzGrundId,
  onGeaendert,
}: {
  fuehrung: FuehrungAnzeige;
  einsatzId?: number;
  /** Steht der Grund „ohne Verbindung“ schon im umgebenden Paneel, verweisen die Knöpfe dorthin. */
  ohneNetzGrundId?: string;
  /** Der Stand nach einer erfolgreichen Entscheidung, so wie ihn der Server meldet. */
  onGeaendert?: (f: FuehrungAnzeige) => void;
}) {
  const { message } = App.useApp();
  const nach = useNachFuehrung(einsatzId ?? fuehrung.einsatz_id ?? undefined);
  const ort = ortVon(fuehrung);
  const ohneNetz = useOhneVerbindung();
  const eigeneGrundId = useId();
  const grundId = ohneNetzGrundId ?? eigeneGrundId;
  const bestaetigen = useMutation({
    ...SOFORT_ODER_NIE,
    mutationFn: () => bestaetigeUebernahme(ort),
    onSuccess: (f) => {
      nach();
      onGeaendert?.(f);
      message.success(`Führung liegt jetzt bei ${f.fuehrer_name}`);
    },
  });
  const widersprechen = useMutation({
    ...SOFORT_ODER_NIE,
    mutationFn: () => widersprecheUebernahme(ort),
    onSuccess: (f) => {
      nach();
      onGeaendert?.(f);
      message.success('Widersprochen, die Führung bleibt hier');
    },
  });
  const von = fuehrung.offen?.von ?? '';
  const konflikt = fuehrung.offen?.konflikt === true;
  const laeuft = bestaetigen.isPending || widersprechen.isPending;
  const beschrieben = ohneNetz ? grundId : undefined;
  return (
    <Space orientation="vertical" size="small">
      {ohneNetz && ohneNetzGrundId == null && <OhneNetzGrund id={eigeneGrundId} />}
      <Space wrap>
        <Popconfirm
          title={`Übernahme durch ${von} bestätigen?`}
          description={ABGABE_FOLGE}
          okText="Übernahme bestätigen"
          cancelText="Abbrechen"
          onConfirm={() => {
            if (!ohneNetz && !laeuft) bestaetigen.mutate();
          }}
        >
          <Button
            type="primary"
            loading={bestaetigen.isPending}
            disabled={ohneNetz || widersprechen.isPending}
            aria-describedby={beschrieben}
            data-lfh="fuehrung-bestaetigen"
          >
            Übernahme bestätigen
          </Button>
        </Popconfirm>
        {!konflikt && (
          <Popconfirm
            title={`Der Übernahme durch ${von} widersprechen?`}
            description="Die Führung bleibt hier."
            okText="Widersprechen"
            cancelText="Abbrechen"
            okButtonProps={{ danger: true }}
            onConfirm={() => {
              if (!ohneNetz && !laeuft) widersprechen.mutate();
            }}
          >
            <Button
              danger
              loading={widersprechen.isPending}
              disabled={ohneNetz || bestaetigen.isPending}
              aria-describedby={beschrieben}
              data-lfh="fuehrung-widersprechen"
            >
              Widersprechen
            </Button>
          </Popconfirm>
        )}
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

/** Pflichtgrund einer Notübernahme und des Zurückholens, im Formular des jeweiligen Dialogs. */
function GrundFeld() {
  return (
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
  );
}

/**
 * Paneel „Führung“ (LLH-1491): wer führt, mit welcher Epoche, wie es dazu kam, und die Bedienung.
 * Auf der Seite Einsatzdaten für den lokalen Einsatz, auf der Seite „Instanzkopplung“ für einen
 * Einsatz beim Gegenüber. Ohne `darfBedienen` nur der Stand. `darfUnterschreiben`: das Konto ist Admin
 * der Einsatz-Org und darf mit eigener Unterschrift übernehmen; sonst bietet die Notübernahme nur den Code (LLH-1676).
 */
export default function FuehrungPaneel({
  fuehrung,
  darfBedienen,
  darfUnterschreiben = false,
  titel = 'Führung',
  style,
  onGeaendert,
  onLaeuft,
}: {
  fuehrung: FuehrungAnzeige;
  darfBedienen: boolean;
  darfUnterschreiben?: boolean;
  titel?: string;
  style?: React.CSSProperties;
  /**
   * Der Stand nach einer erfolgreichen Aktion, so wie ihn der Server meldet (LLH-1670). Für einen
   * Ort, der die Akte nicht selbst nachlädt: „Einsätze beim Gegenüber“ hält sie fest, auch wenn
   * sie danach aus der Liste fällt.
   */
  onGeaendert?: (f: FuehrungAnzeige) => void;
  /** Ob gerade eine Aktion läuft; ein umgebender Dialog sperrt so lange sein Schließen. */
  onLaeuft?: (laeuft: boolean) => void;
}) {
  const { token, rollen } = useRollen();
  const { message } = App.useApp();
  const { konventionen: konv } = useAnzeigeKonventionen();
  const zeit = (wert: string) => zeitKurz(wert, konv);
  const nach = useNachFuehrung(fuehrung.einsatz_id ?? undefined);
  const ort = ortVon(fuehrung);
  const moeglich = fuehrungMoeglich(fuehrung, { darfUnterschreiben });
  const [neuerCode, setNeuerCode] = useState<FuehrungCodeAntwort | null>(null);
  const [notOffen, setNotOffen] = useState(false);
  // Der Name der Führung beim Öffnen: der Dialog folgt nicht der Live-Akte, auch nicht während er
  // ausblendet (Review LLH-1850).
  const [zurueckOffen, setZurueckOffen] = useState(false);
  const [zurueckVon, setZurueckVon] = useState('');
  const [form] = Form.useForm<NotuebernahmeWerte>();
  const [zurueckForm] = Form.useForm<NotuebernahmeWerte>();
  const beweisWahl = Form.useWatch('beweis', form);
  const ohneNetz = useOhneVerbindung();
  const grundId = useId();

  const uebergeben = useMutation({
    ...SOFORT_ODER_NIE,
    mutationFn: (an: string) => uebergebeFuehrung(ort, an),
    onSuccess: (f) => {
      nach();
      onGeaendert?.(f);
      message.success(`Führung an ${f.fuehrer_name} übergeben`);
    },
  });
  const perCode = useMutation({
    ...SOFORT_ODER_NIE,
    mutationFn: (an: string) => gibFuehrungPerCodeAb(ort, an),
    onSuccess: (c) => {
      nach();
      onGeaendert?.(c.fuehrung);
      setNeuerCode(c);
    },
  });
  const anfragen = useMutation({
    ...SOFORT_ODER_NIE,
    mutationFn: () => frageFuehrungAn(ort),
    onSuccess: (f) => {
      nach();
      onGeaendert?.(f);
      message.success('Führung angefragt');
    },
  });
  const notuebernahme = useMutation({
    ...SOFORT_ODER_NIE,
    mutationFn: (w: NotuebernahmeWerte) => {
      const grund = (w.grund ?? '').trim();
      if (!moeglich.notuebernahmeMitBeweis) return uebernimmFuehrung(ort, grund);
      return !moeglich.unterschrift || w.beweis === 'code'
        ? uebernimmFuehrungMitCode(ort, grund, w.code ?? '')
        : uebernimmFuehrungMitUnterschrift(ort, grund);
    },
    onSuccess: (f) => {
      nach();
      onGeaendert?.(f);
      message.success('Führung übernommen');
    },
  });
  // Nur am lokalen Einsatz (LLH-1850): `moeglich.zurueckholen` verlangt ihn.
  const zurueckholen = useMutation({
    ...SOFORT_ODER_NIE,
    mutationFn: (w: NotuebernahmeWerte) =>
      holeFuehrungZurueck(fuehrung.einsatz_id ?? 0, (w.grund ?? '').trim()),
    onSuccess: (f) => {
      nach();
      onGeaendert?.(f);
      message.success('Führung zurückgeholt');
    },
  });
  // Eine Aktion zur Zeit (LLH-1670): eine zweite während der ersten endete mit 409 neben dem Erfolg.
  const laeuft =
    uebergeben.isPending ||
    perCode.isPending ||
    anfragen.isPending ||
    notuebernahme.isPending ||
    zurueckholen.isPending;
  useEffect(() => {
    onLaeuft?.(laeuft);
  }, [laeuft, onLaeuft]);
  // Geht das Zurückholen nicht mehr (ein anderer hat zurückgeholt, die Kopplung gilt wieder),
  // schließt der Dialog und leert sein Formular wie jeder andere Weg hinaus; ein laufendes Senden
  // endet mit seiner eigenen Antwort.
  const canZurueckholen = moeglich.zurueckholen;
  const isZurueckholenPending = zurueckholen.isPending;
  useEffect(() => {
    if (canZurueckholen || isZurueckholenPending) return;
    zurueckForm.resetFields();
    setZurueckOffen(false);
  }, [canZurueckholen, isZurueckholenPending, zurueckForm]);
  /** Gesperrt, außer es ist die Aktion, die gerade läuft (die zeigt ihren Ladezustand). */
  const sperre = (selbst: boolean) => ohneNetz || (laeuft && !selbst);
  const beschrieben = ohneNetz ? grundId : undefined;
  const hatAktionen =
    moeglich.uebergeben.length > 0 ||
    moeglich.perCode.length > 0 ||
    moeglich.anfragen ||
    moeglich.notuebernahme ||
    moeglich.notuebernahmeMitBeweis ||
    moeglich.zurueckholen;

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

      {fuehrung.fuehrer_beendet_at && !fuehrung.fuehrend && (
        <Typography.Paragraph
          style={{ color: rollen.achtungText, marginBlock: `${token.marginMD}px 0` }}
          data-lfh="fuehrung-beendet"
        >
          {kopplungBeendetText(fuehrung.fuehrer_name)} · {zeit(fuehrung.fuehrer_beendet_at)}
        </Typography.Paragraph>
      )}

      {darfBedienen && ohneNetz && (hatAktionen || fuehrung.offen) && (
        <div style={{ marginBlockStart: token.marginMD }}>
          <OhneNetzGrund id={grundId} />
        </div>
      )}

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
            {offeneUebernahmeTitel(fuehrung.offen, fuehrung.art)}
          </Typography.Text>
          {/* Im Konflikt gehören Grund und Unterzeichner einer anderen ELW: weglassen. */}
          {!fuehrung.offen.konflikt && (
            <Datenraster spalten={2}>
              <Datenfeld label="Grund" breit>
                {fuehrung.offen.grund ?? '—'}
              </Datenfeld>
              <Datenfeld label="Unterzeichnet von">{fuehrung.offen.unterzeichner ?? '—'}</Datenfeld>
              <Datenfeld label="Erklärt">
                {fuehrung.offen.zeitpunkt ? zeit(fuehrung.offen.zeitpunkt) : '—'}
              </Datenfeld>
            </Datenraster>
          )}
          {darfBedienen && (
            <div style={{ marginBlockStart: token.marginSM }}>
              <UebernahmeEntscheidung
                fuehrung={fuehrung}
                ohneNetzGrundId={grundId}
                onGeaendert={onGeaendert}
              />
            </div>
          )}
        </div>
      )}

      {darfBedienen && (
        <Space wrap style={{ marginBlockStart: token.marginMD }}>
          {moeglich.uebergeben.map((g) => {
            const selbst = uebergeben.isPending && uebergeben.variables === g.kennung;
            return (
              <Popconfirm
                key={`u-${g.kennung}`}
                title={`Führung an ${g.name} übergeben?`}
                description={ABGABE_FOLGE}
                okText="Führung übergeben"
                cancelText="Abbrechen"
                okButtonProps={{ danger: true }}
                // Die Rückfrage kann offen sein, während das Netz wegfällt: dann geht nichts hinaus.
                onConfirm={() => {
                  if (!sperre(false)) uebergeben.mutate(g.kennung);
                }}
              >
                <Button
                  loading={selbst}
                  disabled={sperre(selbst)}
                  aria-describedby={beschrieben}
                  data-lfh="fuehrung-uebergeben"
                >
                  Führung an {g.name} übergeben
                </Button>
              </Popconfirm>
            );
          })}
          {moeglich.perCode.map((g) => {
            const selbst = perCode.isPending && perCode.variables === g.kennung;
            return (
              <Popconfirm
                key={`c-${g.kennung}`}
                title={`Führung per Code an ${g.name} abgeben?`}
                description={ABGABE_FOLGE}
                okText="Code erzeugen"
                cancelText="Abbrechen"
                okButtonProps={{ danger: true }}
                onConfirm={() => {
                  if (!sperre(false)) perCode.mutate(g.kennung);
                }}
              >
                <Button
                  loading={selbst}
                  disabled={sperre(selbst)}
                  aria-describedby={beschrieben}
                  data-lfh="fuehrung-code"
                >
                  Führung per Code abgeben
                </Button>
              </Popconfirm>
            );
          })}
          {moeglich.anfragen && (
            <Button
              loading={anfragen.isPending}
              disabled={sperre(anfragen.isPending)}
              aria-describedby={beschrieben}
              onClick={() => {
                if (!sperre(false)) anfragen.mutate();
              }}
              data-lfh="fuehrung-anfragen"
            >
              Führung anfragen
            </Button>
          )}
          {(moeglich.notuebernahme || moeglich.notuebernahmeMitBeweis) && (
            <Button
              danger
              disabled={sperre(false)}
              aria-describedby={beschrieben}
              onClick={() => {
                notuebernahme.reset();
                setNotOffen(true);
              }}
              data-lfh="fuehrung-notuebernahme"
            >
              Notübernahme …
            </Button>
          )}
          {moeglich.zurueckholen && (
            <Button
              danger
              disabled={sperre(false)}
              aria-describedby={beschrieben}
              onClick={() => {
                zurueckholen.reset();
                setZurueckVon(fuehrung.fuehrer_name);
                setZurueckOffen(true);
              }}
              data-lfh="fuehrung-zurueckholen"
            >
              Führung zurückholen …
            </Button>
          )}
        </Space>
      )}
      {/* Zwei Gegenstellen können gleich heißen: der Name taugt nicht als Key (Review LLH-1497). */}
      {moeglich.vorOrt.map((name, i) => (
        <Typography.Paragraph
          key={`vo-${i}`}
          style={{ color: rollen.gedaempft, marginBlock: token.marginXS }}
          data-lfh="fuehrung-vor-ort"
        >
          {vorOrtHinweis(name)}
        </Typography.Paragraph>
      ))}
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
        // Fällt das Netz bei offenem Dialog weg, bleibt der getippte Grund stehen, das Absenden
        // ist gesperrt, bis die Verbindung zurück ist (LLH-1670).
        gesperrt={ohneNetz}
        // Der Grund steht am gesperrten Knopf (die Zeile trägt `aria-describedby`).
        zusammenfassung={ohneNetz ? OHNE_VERBINDUNG_NICHT_AENDERBAR : undefined}
        speicherung={notuebernahme}
        speicherFehlerTitel="Nicht übernommen"
        initialValues={{ beweis: moeglich.unterschrift ? 'unterschrift' : 'code' }}
        onErfassen={(w) => notuebernahme.mutateAsync(w)}
        onFertig={() => setNotOffen(false)}
        onAbbrechen={() => {
          notuebernahme.reset();
          setNotOffen(false);
        }}
      >
        <GrundFeld />
        {moeglich.notuebernahmeMitBeweis && (
          <>
            {moeglich.unterschrift && (
              <Form.Item label="Beweis" name="beweis">
                <Radio.Group
                  optionType="button"
                  options={[
                    { value: 'unterschrift', label: 'Eigene Unterschrift' },
                    { value: 'code', label: 'Code des Gegenübers' },
                  ]}
                />
              </Form.Item>
            )}
            {(!moeglich.unterschrift || beweisWahl === 'code') && (
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

      <ErfassungsModal<NotuebernahmeWerte>
        offen={zurueckOffen}
        titel={`Führung von ${zurueckVon} zurückholen`}
        form={zurueckForm}
        erfassenText="Führung zurückholen"
        unumkehrbar
        laeuft={zurueckholen.isPending}
        gesperrt={ohneNetz}
        zusammenfassung={
          ohneNetz
            ? OHNE_VERBINDUNG_NICHT_AENDERBAR
            : 'Danach führt diese Installation den Einsatz.'
        }
        speicherung={zurueckholen}
        speicherFehlerTitel="Nicht zurückgeholt"
        onErfassen={(w) => zurueckholen.mutateAsync(w)}
        onFertig={() => setZurueckOffen(false)}
        onAbbrechen={() => {
          zurueckholen.reset();
          setZurueckOffen(false);
        }}
      >
        <GrundFeld />
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
