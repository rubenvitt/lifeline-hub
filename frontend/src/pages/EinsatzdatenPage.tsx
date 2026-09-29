import {
  App,
  AutoComplete,
  Breadcrumb,
  Button,
  Collapse,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Space,
} from 'antd';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { Select } from '../components/Select';
import EinsatzSeite from '../components/EinsatzSeite';
import {
  Augenbraue,
  Paneel,
  kennzahlenbandStil,
  monoStil,
  paneelZeileStil,
  useRollen,
} from '../components/instrument';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import KoordinatenAnzeige from '../anzeige/KoordinatenAnzeige';
import KoordinatenEingabe from '../anzeige/KoordinatenEingabe';
import type { LatLon } from '../anzeige/koordinaten';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import {
  aktualisiereEinsatz,
  ladeEinsatz,
  ladeMitglieder,
  patcheEinsatz,
  type KopfdatenPatch,
  type KopfdatenUpdate,
} from '../api/einsaetze';
import { listeStichwortVorschlaege } from '../api/stichwortVorschlaege';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { InlineAngabe } from '../components/InlineAngabe';
import { useAuth } from '../auth/AuthContext';
import {
  darfImEinsatzSchreiben,
  darfEinsatzLeiten,
  istEinsatzLeitung,
} from '../einsatz/schreibrecht';
import type { EinsatzAnzeige, Einsatzart } from '../api/types';
import MitgliederAbschnitt from './MitgliederAbschnitt';
import { leerZuNull } from '../api/patchTriState';
import { EINSATZART_LABELS, EINSATZART_OPTIONEN } from '../einsatz/einsatzart';
import StatusTag from '../components/StatusTag';
import { einsatzStatus } from '../theme/statusFarben';

// Idempotent (mehrfaches extend ist unschädlich) — robust bei isoliertem Import.
dayjs.extend(utc);

/**
 * UTC-Wirestring → Dayjs für den DatePicker, in lokaler Zeit.
 *
 * `dayjs(wire)` läse den naiven Wirestring als lokale Zeit und landete auf einem anderen Instant.
 * Das `.local()` hält den Picker auf derselben Wanduhrzeit, die `ZeitAnzeige` daneben rendert
 * (`anzeige/format.ts:inZone` → `dayjs.utc(x).local()`); ein Dayjs im UTC-Modus widerspräche der
 * Zelle daneben. Nebeneffekt: antds generateConfig bleibt im Lokal-Modus, auch bei neu gewähltem
 * Wert.
 */
export function wireZuPicker(wire: string): Dayjs {
  return dayjs.utc(wire).local();
}

/** Lokale Picker-Zeit → UTC-Wireformat 'YYYY-MM-DD HH:mm:ss' (rein, testbar). */
export function pickerZuWire(d: Dayjs): string {
  return d.utc().format('YYYY-MM-DD HH:mm:ss');
}

/**
 * Zeitpunkte gleich, wenn derselbe Instant (LFH-472, D5) — nicht dasselbe Objekt: jeder Render
 * baut über `wireZuPicker` ein frisches Dayjs, und ein Neuabruf zwischen Öffnen und Speichern
 * machte sonst aus „unverändert" einen PATCH.
 */
export function gleicherZeitpunkt(a: Dayjs | null, b: Dayjs | null): boolean {
  return a === null || b === null ? a === b : a.valueOf() === b.valueOf();
}

/** Leer ist ein Text, der nach dem Trimmen nichts übrig lässt — wie `leerZuNull` beim Senden. */
function leererText(w: string): boolean {
  return w.trim() === '';
}

/**
 * Speichert EIN Feld der Kopfdaten (LFH-472). `etikett` nennt die Angabe in der Erfolgsmeldung;
 * der Patch trägt genau einen Schlüssel.
 */
type FeldSpeichern = (etikett: string, patch: KopfdatenPatch) => Promise<EinsatzAnzeige>;

/** Eine freie Textangabe als Zeile (Stichwort ausgenommen: es hat Vorschläge). */
function TextAngabe({
  etikett,
  wert,
  darfSchreiben,
  mono,
  mehrzeilig,
  speichern,
  zuPatch,
}: {
  etikett: string;
  wert: string | null | undefined;
  darfSchreiben: boolean;
  mono?: boolean;
  mehrzeilig?: boolean;
  speichern: FeldSpeichern;
  zuPatch: (w: string | null) => KopfdatenPatch;
}) {
  const text = wert ?? '';
  return (
    <InlineAngabe<string>
      etikett={etikett}
      wert={text}
      anzeige={mono ? <span style={monoStil(13)}>{text}</span> : text}
      leer={leererText}
      gleich={(a, b) => a.trim() === b.trim()}
      darfSchreiben={darfSchreiben}
      mehrzeilig={mehrzeilig}
      onSpeichern={(w) => speichern(etikett, zuPatch(leerZuNull(w)))}
      eingabe={({ feld, value, onChange }) =>
        mehrzeilig ? (
          <Input.TextArea
            {...feld}
            rows={3}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <Input {...feld} value={value} onChange={(e) => onChange(e.target.value)} />
        )
      }
    />
  );
}

/** Ein Zeitpunkt als Zeile. Hin und zurück über `wireZuPicker`/`pickerZuWire`, keine zweite Wandlung. */
function ZeitpunktAngabe({
  etikett,
  wire,
  pflicht,
  darfSchreiben,
  speichern,
  zuPatch,
}: {
  etikett: string;
  wire: string | null | undefined;
  pflicht?: boolean;
  darfSchreiben: boolean;
  speichern: FeldSpeichern;
  zuPatch: (wire: string | null) => KopfdatenPatch;
}) {
  return (
    <InlineAngabe<Dayjs | null>
      etikett={etikett}
      wert={wire ? wireZuPicker(wire) : null}
      anzeige={wire ? <ZeitAnzeige wert={wire} format="dtgVoll" /> : null}
      leer={(d) => d === null}
      gleich={gleicherZeitpunkt}
      pflicht={pflicht}
      darfSchreiben={darfSchreiben}
      onSpeichern={(d) => speichern(etikett, zuPatch(d ? pickerZuWire(d) : null))}
      eingabe={({ feld, popup, value, onChange }) => (
        <DatePicker
          {...feld}
          {...popup}
          showTime
          format="YYYY-MM-DD HH:mm:ss"
          style={{ width: '100%' }}
          value={value}
          onChange={(d) => onChange(d ?? null)}
        />
      )}
    />
  );
}

/** Werte des Bearbeiten-Formulars (begonnen_at als lokale Picker-Zeit vor der UTC-Wandlung). */
interface FormWerte {
  bezeichnung: string;
  stichwort?: string;
  einsatzart: Einsatzart;
  leitstellen_nr?: string;
  einsatzort?: string;
  einsatzort_koord?: LatLon | null;
  meldende_stelle?: string;
  sachverhalt?: string;
  anzahl_betroffene_initial?: number;
  begonnen_at: Dayjs;
  naechste_lagebesprechung_at?: Dayjs | null;
}

/**
 * Mindestbreite einer Kopfangabe, dasselbe Maß wie `flaeche.kachelMinKlein` (220). Lokal statt als
 * weiterer Schlüssel in `flaeche`: das ist als geschlossene Menge gepinnt, und eine Kopfleiste ist
 * kein Nebenraster.
 *
 * `auto-fit` legt bei ~900 px Lesebreite vier Spalten nebeneinander (Fükw), auf dem Handschirm
 * eine.
 */
const KOPF_MIN_BREITE = 220;

/**
 * Eine Angabe der Kopfleiste: gedämpftes Etikett, darunter der Wert mit Gewicht. Vier Angaben sind
 * herausgestellt, weil sie im Fükw zuerst gebraucht werden — Stichwort, Alarmzeit, Einsatzort,
 * Einsatzleitung.
 *
 * Ein leerer Wert lässt den Platz stehen und zeigt „—": eine Kopfleiste mit wechselnder Spaltenzahl
 * wäre bei jedem Einsatz anders zu lesen.
 *
 * Nichts hier ist bedienbar, die Zwei-Angaben-Regel für handgebaute Bedienziele gilt nicht.
 */
/**
 * Eine Angabe als Zelle im Fugenraster (Augenbraue über dem Wert). Kein `Kennzahl`-Baustein: die
 * Werte sind Wörter — ein Stichwort in Datenwert-Mono läse sich wie ein Messwert.
 */
function KopfAngabe({ etikett, wert, mono }: { etikett: string; wert: ReactNode; mono?: boolean }) {
  const { token, rollen } = useRollen();
  return (
    <div
      style={{
        background: rollen.flaeche,
        paddingBlock: token.paddingSM,
        paddingInline: token.padding,
        minWidth: 0,
      }}
    >
      <Augenbraue style={{ display: 'block', marginBottom: token.marginXXS }}>{etikett}</Augenbraue>
      <div
        style={{
          ...(mono ? monoStil(15, 500) : { fontSize: 15, fontWeight: 500 }),
          color: rollen.text,
          overflowWrap: 'anywhere',
        }}
      >
        {wert}
      </div>
    </div>
  );
}

/**
 * Beschriftete Angaben als Zeilen (`dl`) statt umrandeter `Descriptions`-Tabelle: Augenbraue links,
 * Wert rechts, Trenner `flaeche3`.
 */
function Angaben({ zeilen }: { zeilen: { etikett: string; wert: ReactNode }[] }) {
  const { token, rollen } = useRollen();
  return (
    <dl style={{ margin: 0 }}>
      {zeilen.map(({ etikett, wert }) => (
        <div
          key={etikett}
          style={{
            ...paneelZeileStil(rollen, token),
            display: 'grid',
            gridTemplateColumns: 'minmax(140px, 1fr) minmax(0, 2fr)',
            gap: token.margin,
            alignItems: 'baseline',
          }}
        >
          <Augenbraue als="dt">{etikett}</Augenbraue>
          <dd style={{ margin: 0, color: rollen.text2, overflowWrap: 'anywhere' }}>{wert}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function EinsatzdatenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token, rollen } = useRollen();
  const [bearbeiten, setBearbeiten] = useState(false);
  const [form] = Form.useForm<FormWerte>();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const mitgliederQuery = useQuery({
    queryKey: einsatzKeys.mitglieder(einsatzId),
    queryFn: () => ladeMitglieder(einsatzId),
  });
  const vorschlaegeQuery = useQuery({
    queryKey: globalKeys.stichwortVorschlaege(),
    queryFn: listeStichwortVorschlaege,
  });

  const speichernMutation = useMutation({
    mutationFn: (felder: KopfdatenUpdate) => aktualisiereEinsatz(einsatzId, felder),
    // Kein `onError`-Toast: der Fehler steht als `<SpeicherFehler>` über dem Formular. Ein Toast
    // verfällt nach ~3 s, und das Formular wirkte danach gespeichert.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId) });
      qc.invalidateQueries({ queryKey: globalKeys.einsaetze() });
      setBearbeiten(false);
      message.success('Einsatzdaten gespeichert');
    },
  });

  // Zeilenweg (LFH-472): EIN Feld je PATCH. Der Fehler geht an die Zeile (`mutateAsync` lehnt ab,
  // `InlineAngabe` zeigt ihn), deshalb auch hier kein `onError`-Toast.
  const feldMutation = useMutation({
    mutationFn: ({ patch }: { etikett: string; patch: KopfdatenPatch }) =>
      patcheEinsatz(einsatzId, patch),
    onSuccess: (aktualisiert, { etikett }) => {
      // Erst in den Cache, dann erfüllen: die Zeile zeigt den neuen Wert in derselben Runde, in der
      // sie die Eingabe schließt, und die Fokusrückgabe trifft den frischen Wertknopf.
      qc.setQueryData(einsatzKeys.einsatz(einsatzId), aktualisiert);
      qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId) });
      qc.invalidateQueries({ queryKey: globalKeys.einsaetze() });
      message.success(`${etikett} gespeichert`);
    },
  });
  const feldSpeichern: FeldSpeichern = (etikett, patch) =>
    feldMutation.mutateAsync({ etikett, patch });

  if (einsatzQuery.isLoading) {
    return <SeitenSkeleton />;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;

  const darfBearbeiten = darfImEinsatzSchreiben(einsatz, benutzer);

  const leitung = (mitgliederQuery.data ?? [])
    .filter((m) => m.einsatz_rolle === 'einsatzleitung')
    .map((m) => m.anzeigename)
    .join(', ');

  const darfVerwaltenMitglieder = darfEinsatzLeiten(einsatz, benutzer);

  const stichwortOptionen = (vorschlaegeQuery.data ?? []).map((v) => ({ value: v.text }));

  function bearbeitenStarten() {
    form.setFieldsValue({
      bezeichnung: einsatz.bezeichnung,
      stichwort: einsatz.stichwort ?? undefined,
      einsatzart: einsatz.einsatzart,
      leitstellen_nr: einsatz.leitstellen_nr ?? undefined,
      einsatzort: einsatz.einsatzort ?? undefined,
      einsatzort_koord:
        einsatz.einsatzort_lat != null && einsatz.einsatzort_lon != null
          ? { lat: einsatz.einsatzort_lat, lon: einsatz.einsatzort_lon }
          : null,
      meldende_stelle: einsatz.meldende_stelle ?? undefined,
      sachverhalt: einsatz.sachverhalt ?? undefined,
      anzahl_betroffene_initial: einsatz.anzahl_betroffene_initial ?? undefined,
      begonnen_at: wireZuPicker(einsatz.begonnen_at),
      naechste_lagebesprechung_at: einsatz.naechste_lagebesprechung_at
        ? wireZuPicker(einsatz.naechste_lagebesprechung_at)
        : null,
    });
    setBearbeiten(true);
  }

  function speichern(werte: FormWerte) {
    const felder: KopfdatenUpdate = {
      bezeichnung: werte.bezeichnung.trim(),
      stichwort: leerZuNull(werte.stichwort),
      einsatzart: werte.einsatzart,
      leitstellen_nr: leerZuNull(werte.leitstellen_nr),
      einsatzort: leerZuNull(werte.einsatzort),
      einsatzort_lat: werte.einsatzort_koord?.lat ?? null,
      einsatzort_lon: werte.einsatzort_koord?.lon ?? null,
      meldende_stelle: leerZuNull(werte.meldende_stelle),
      sachverhalt: leerZuNull(werte.sachverhalt),
      anzahl_betroffene_initial: werte.anzahl_betroffene_initial ?? null,
      begonnen_at: pickerZuWire(werte.begonnen_at),
      naechste_lagebesprechung_at: werte.naechste_lagebesprechung_at
        ? pickerZuWire(werte.naechste_lagebesprechung_at)
        : null,
    };
    speichernMutation.mutate(felder);
  }

  return (
    <EinsatzSeite
      // Datenblatt und Bearbeitungsformular: ausdrücklich die schmale Lesebreite.
      breite="schmal"
      titel={
        <Space>
          {einsatz.bezeichnung}
          {/* Beschriftung und Rollenfarbe aus `theme/statusFarben.ts` über `StatusTag`, nicht
              der rohe Wire-Wert. */}
          <StatusTag darstellung={einsatzStatus[einsatz.status]} />
        </Space>
      }
      breadcrumb={
        <Breadcrumb
          items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }]}
        />
      }
      dataUpdatedAt={einsatzQuery.dataUpdatedAt}
      aktionen={
        !bearbeiten && darfBearbeiten ? (
          <Button type="primary" onClick={bearbeitenStarten}>
            Bearbeiten
          </Button>
        ) : undefined
      }
    >
      {bearbeiten ? (
        <Paneel titel="Einsatzdaten bearbeiten" koerperPolster>
          <Form<FormWerte> form={form} layout="vertical" onFinish={speichern}>
            <Form.Item
              label="Bezeichnung"
              name="bezeichnung"
              rules={[
                { required: true, whitespace: true, message: 'Bezeichnung darf nicht leer sein' },
              ]}
            >
              {/* Der Knopf, der hierher geführt hat, verschwindet im selben Rendern — ohne
                  `autoFocus` fiele der Fokus auf `<body>`. Das Formular wird frisch eingehängt,
                  Reacts Mount-Fokus genügt; `requestAnimationFrame` braucht es nur, wo ein
                  Dialog stehen bleibt. */}
              <Input autoFocus />
            </Form.Item>
            <Form.Item label="Einsatzstichwort" name="stichwort">
              <AutoComplete options={stichwortOptionen} allowClear placeholder="z. B. H1, MANV …" />
            </Form.Item>
            <Form.Item label="Einsatzart" name="einsatzart" rules={[{ required: true }]}>
              <Select options={EINSATZART_OPTIONEN} />
            </Form.Item>
            <Form.Item label="Leitstellen-Nr." name="leitstellen_nr">
              <Input />
            </Form.Item>
            <Form.Item label="Alarmzeit" name="begonnen_at" rules={[{ required: true }]}>
              <DatePicker showTime format="YYYY-MM-DD HH:mm:ss" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="Einsatzort (Adresse)" name="einsatzort">
              <Input />
            </Form.Item>
            <Form.Item
              label="Nächste Lagebesprechung (optional)"
              name="naechste_lagebesprechung_at"
            >
              <DatePicker showTime format="YYYY-MM-DD HH:mm:ss" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="Koordinate" name="einsatzort_koord">
              <KoordinatenEingabe einsatzId={einsatzId} exclude={`einsatzort:${einsatzId}`} />
            </Form.Item>
            <Form.Item label="Meldende/anfordernde Stelle" name="meldende_stelle">
              <Input />
            </Form.Item>
            <Form.Item label="Sachverhalt / Meldebild" name="sachverhalt">
              <Input.TextArea rows={3} />
            </Form.Item>
            <Form.Item label="Anzahl Betroffene (initial)" name="anzahl_betroffene_initial">
              <InputNumber min={0} style={{ width: 180 }} />
            </Form.Item>
            {/* Der Fehler steht über dem Knopf, an dem er entsteht, bis das nächste Absenden
                ihn räumt. */}
            <SpeicherFehler fehler={speichernMutation.error} />
            <Space style={{ marginTop: token.margin }}>
              <Button type="primary" htmlType="submit" loading={speichernMutation.isPending}>
                Speichern
              </Button>
              <Button onClick={() => setBearbeiten(false)}>Abbrechen</Button>
            </Space>
          </Form>
        </Paneel>
      ) : (
        <>
          {/* Kopfleiste — die vier Angaben, die im Fükw zuerst gebraucht werden. Sie stehen
              nicht zusätzlich in der Tabelle darunter. */}
          <div
            style={{
              ...kennzahlenbandStil(rollen),
              gridTemplateColumns: `repeat(auto-fit, minmax(min(${KOPF_MIN_BREITE}px, 100%), 1fr))`,
              marginBottom: token.margin,
            }}
          >
            <KopfAngabe
              etikett="Einsatzstichwort"
              wert={
                <InlineAngabe<string>
                  etikett="Einsatzstichwort"
                  wert={einsatz.stichwort ?? ''}
                  anzeige={einsatz.stichwort}
                  leer={leererText}
                  gleich={(a, b) => a.trim() === b.trim()}
                  darfSchreiben={darfBearbeiten}
                  onSpeichern={(w) =>
                    feldSpeichern('Einsatzstichwort', { stichwort: leerZuNull(w) })
                  }
                  eingabe={({ feld, popup, value, onChange }) => (
                    <AutoComplete
                      {...feld}
                      {...popup}
                      options={stichwortOptionen}
                      allowClear
                      placeholder="z. B. H1, MANV …"
                      value={value}
                      onChange={(v?: string) => onChange(v ?? '')}
                    />
                  )}
                />
              }
            />
            <KopfAngabe
              etikett="Alarmzeit"
              mono
              wert={
                <ZeitpunktAngabe
                  etikett="Alarmzeit"
                  wire={einsatz.begonnen_at}
                  pflicht
                  darfSchreiben={darfBearbeiten}
                  speichern={feldSpeichern}
                  // Pflicht: `null` erreicht `zuPatch` nie, `InlineAngabe` lehnt leer vorher ab.
                  zuPatch={(wire) => ({ begonnen_at: wire ?? einsatz.begonnen_at })}
                />
              }
            />
            <KopfAngabe
              etikett="Einsatzort"
              wert={
                <TextAngabe
                  etikett="Einsatzort"
                  wert={einsatz.einsatzort}
                  darfSchreiben={darfBearbeiten}
                  speichern={feldSpeichern}
                  zuPatch={(w) => ({ einsatzort: w })}
                />
              }
            />
            <KopfAngabe etikett="Einsatzleitung" wert={leitung || '—'} />
          </div>

          <Paneel titel="Lagedaten">
            <Angaben
              zeilen={[
                {
                  etikett: 'Einsatzart',
                  wert: (
                    <InlineAngabe<Einsatzart>
                      etikett="Einsatzart"
                      wert={einsatz.einsatzart}
                      anzeige={EINSATZART_LABELS[einsatz.einsatzart]}
                      // Pflicht, aber ein `Select` ohne `allowClear` kann nicht leer werden.
                      leer={() => false}
                      darfSchreiben={darfBearbeiten}
                      onSpeichern={(art) => feldSpeichern('Einsatzart', { einsatzart: art })}
                      eingabe={({ feld, popup, value, onChange }) => (
                        <Select<Einsatzart>
                          {...feld}
                          {...popup}
                          options={EINSATZART_OPTIONEN}
                          value={value}
                          onChange={onChange}
                        />
                      )}
                    />
                  ),
                },
                {
                  etikett: 'Nächste Lagebesprechung',
                  wert: (
                    <span style={monoStil(13)}>
                      <ZeitpunktAngabe
                        etikett="Nächste Lagebesprechung"
                        wire={einsatz.naechste_lagebesprechung_at}
                        darfSchreiben={darfBearbeiten}
                        speichern={feldSpeichern}
                        zuPatch={(wire) => ({ naechste_lagebesprechung_at: wire })}
                      />
                    </span>
                  ),
                },
                {
                  etikett: 'Koordinate',
                  wert:
                    einsatz.einsatzort_lat != null && einsatz.einsatzort_lon != null ? (
                      <KoordinatenAnzeige
                        lat={einsatz.einsatzort_lat}
                        lon={einsatz.einsatzort_lon}
                        einsatzId={einsatzId}
                        exclude={`einsatzort:${einsatzId}`}
                      />
                    ) : (
                      '—'
                    ),
                },
                {
                  etikett: 'Meldende Stelle',
                  wert: (
                    <TextAngabe
                      etikett="Meldende Stelle"
                      wert={einsatz.meldende_stelle}
                      darfSchreiben={darfBearbeiten}
                      speichern={feldSpeichern}
                      zuPatch={(w) => ({ meldende_stelle: w })}
                    />
                  ),
                },
                {
                  etikett: 'Sachverhalt / Meldebild',
                  wert: (
                    <TextAngabe
                      etikett="Sachverhalt / Meldebild"
                      wert={einsatz.sachverhalt}
                      mehrzeilig
                      darfSchreiben={darfBearbeiten}
                      speichern={feldSpeichern}
                      zuPatch={(w) => ({ sachverhalt: w })}
                    />
                  ),
                },
                {
                  etikett: 'Anzahl Betroffene (initial)',
                  wert: (
                    <InlineAngabe<number | null>
                      etikett="Anzahl Betroffene (initial)"
                      wert={einsatz.anzahl_betroffene_initial ?? null}
                      anzeige={
                        <span style={monoStil(13)}>{einsatz.anzahl_betroffene_initial}</span>
                      }
                      leer={(n) => n === null}
                      darfSchreiben={darfBearbeiten}
                      onSpeichern={(n) =>
                        feldSpeichern('Anzahl Betroffene (initial)', {
                          anzahl_betroffene_initial: n,
                        })
                      }
                      eingabe={({ feld, value, onChange }) => (
                        <InputNumber<number>
                          {...feld}
                          min={0}
                          precision={0}
                          style={{ width: 180 }}
                          value={value}
                          onChange={(n) => onChange(n ?? null)}
                        />
                      )}
                    />
                  ),
                },
              ]}
            />
          </Paneel>

          {/* Technische Angaben — Aktenzeichen und Anlege-Zeitstempel: gebraucht beim
              Nachweisen, nicht beim Führen, deshalb eingeklappt. Kein `forceRender`: der
              eingeklappte Zustand ist die Aussage, mit `forceRender` wäre die Gegenprobe
              „vorher nicht sichtbar" nicht formulierbar. */}
          <Collapse
            style={{ marginTop: token.margin }}
            items={[
              {
                key: 'technik',
                label: 'Technische Angaben',
                children: (
                  <Angaben
                    zeilen={[
                      {
                        etikett: 'Einsatznummer',
                        wert: (
                          <span style={monoStil(13)}>{einsatz.einsatznummer_intern ?? '—'}</span>
                        ),
                      },
                      {
                        etikett: 'Leitstellen-Nr.',
                        wert: (
                          <TextAngabe
                            etikett="Leitstellen-Nr."
                            wert={einsatz.leitstellen_nr}
                            mono
                            darfSchreiben={darfBearbeiten}
                            speichern={feldSpeichern}
                            zuPatch={(w) => ({ leitstellen_nr: w })}
                          />
                        ),
                      },
                      {
                        etikett: 'Angelegt am (techn.)',
                        wert: (
                          <span style={monoStil(13)}>
                            <ZeitAnzeige wert={einsatz.angelegt_at} format="dtgVoll" />
                          </span>
                        ),
                      },
                    ]}
                  />
                ),
              },
            ]}
          />
        </>
      )}

      <MitgliederAbschnitt
        key={einsatzId}
        einsatzId={einsatzId}
        darfVerwalten={darfVerwaltenMitglieder}
        // mitglied_setzen fordert die Einsatzrolle, ohne System-Admin-Ausnahme.
        darfFuehrungsstelleVerwalten={darfVerwaltenMitglieder && istEinsatzLeitung(einsatz)}
      />
    </EinsatzSeite>
  );
}
