import {
  App,
  AutoComplete,
  Breadcrumb,
  Button,
  Collapse,
  DatePicker,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Space,
  Typography,
  theme,
} from 'antd';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { Select } from '../components/Select';
import EinsatzSeite from '../components/EinsatzSeite';
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
  type KopfdatenUpdate,
} from '../api/einsaetze';
import { listeStichwortVorschlaege } from '../api/stichwortVorschlaege';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { useAuth } from '../auth/AuthContext';
import {
  darfImEinsatzSchreiben,
  darfEinsatzLeiten,
  istEinsatzLeitung,
} from '../einsatz/schreibrecht';
import type { Einsatzart } from '../api/types';
import MitgliederAbschnitt from './MitgliederAbschnitt';
import { leerZuNull } from '../api/patchTriState';
import { EINSATZART_LABELS, EINSATZART_OPTIONEN } from '../einsatz/einsatzart';
import StatusTag from '../components/StatusTag';
import { einsatzStatus } from '../theme/statusFarben';

// Idempotent (mehrfaches extend ist unschädlich) — robust bei isoliertem Import.
dayjs.extend(utc);

/**
 * UTC-Wirestring → Dayjs für den DatePicker, in LOKALER Zeit.
 *
 * `dayjs(wire)` läse den naiven Wirestring als lokale Zeit und landete damit auf einem
 * anderen Instant (in Europe/Berlin um 2 h daneben). Das `.local()` ist ebenso wenig
 * verzichtbar: es hält den Picker auf derselben Wanduhrzeit, die `ZeitAnzeige` daneben
 * rendert (`anzeige/format.ts:inZone` → `dayjs.utc(x).local()`); ein Dayjs im UTC-Modus
 * zeigte die UTC-Wanduhrzeit und widerspräche der Descriptions-Zelle direkt daneben.
 * Nebeneffekt: antds generateConfig bleibt durchgehend im Lokal-Modus, auch wenn der
 * Nutzer einen neuen Wert wählt.
 */
export function wireZuPicker(wire: string): Dayjs {
  return dayjs.utc(wire).local();
}

/** Lokale Picker-Zeit → UTC-Wireformat 'YYYY-MM-DD HH:mm:ss' (rein, testbar). */
export function pickerZuWire(d: Dayjs): string {
  return d.utc().format('YYYY-MM-DD HH:mm:ss');
}

/** Werte des Bearbeiten-Formulars (begonnen_at als lokale Picker-Zeit vor der UTC-Wandlung). */
interface FormWerte {
  bezeichnung: string;
  stichwort?: string;
  einsatzart: Einsatzart;
  einsatznummer_intern?: string;
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
 * Mindestbreite einer Kopfangabe. KEIN neuer Wert — dasselbe Mass wie
 * `flaeche.kachelMinKlein` (220). Es steht hier lokal statt als sechster Schlüssel in
 * `flaeche`: das trägt die gemessenen §2.2-Baselines und ist als geschlossene Menge
 * gepinnt, und eine Kopfleiste ist kein Nebenraster. Präzedenz für die lokale Konstante
 * mit genau dieser Begründung: `KACHEL_MIN_HOEHE` in `EinsaetzePage`.
 *
 * Die Wirkung ist die Staffelung ohne Umbruchregel: `auto-fit` legt bei ~900 px
 * Lesebreite vier Spalten nebeneinander (Fükw), auf dem Handschirm (~390 px minus
 * Seitenrinne) genau eine.
 */
const KOPF_MIN_BREITE = 220;

/**
 * Eine Angabe der Kopfleiste: gedämpftes Etikett, darunter der Wert mit Gewicht.
 *
 * Die Gewichtung IST der Befund (M14): zwölf gleich schwere `Descriptions`-Zeilen
 * beantworten die Frage „was ist hier los?" genauso langsam wie eine Volltextsuche.
 * Vier Angaben sind herausgestellt, weil sie im Fükw zuerst gebraucht werden —
 * Stichwort, Alarmzeit, Einsatzort, Einsatzleitung.
 *
 * Ein leerer Wert lässt den Platz stehen und zeigt „—", statt die Angabe wegzulassen:
 * eine Kopfleiste mit wechselnder Spaltenzahl wäre bei jedem Einsatz anders zu lesen.
 * (Die Karten auf `EinsaetzePage` lassen ihre Ortszeile weg — das ist eine Karte in
 * einem Raster, keine feste Vierergruppe, und die Regel überträgt sich nicht.)
 *
 * Nichts hier ist bedienbar, also gilt die Zwei-Angaben-Regel für handgebaute
 * Bedienziele (LFH-365) NICHT — es gibt kein Ziel.
 */
function KopfAngabe({ etikett, wert }: { etikett: string; wert: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <div>
      <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM, display: 'block' }}>
        {etikett}
      </Typography.Text>
      <div style={{ fontSize: token.fontSizeLG, fontWeight: token.fontWeightStrong }}>{wert}</div>
    </div>
  );
}

export default function EinsatzdatenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token } = theme.useToken();
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
    // KEIN `onError`-Toast mehr (LFH-345 · C10, H14): der Fehler hängt an `mutation.error`
    // und steht als `<SpeicherFehler>` über dem Formular. Ein Toast verfällt nach ~3 s,
    // das ausgefüllte Formular stand danach unverändert da und wirkte gespeichert.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId) });
      qc.invalidateQueries({ queryKey: globalKeys.einsaetze() });
      setBearbeiten(false);
      message.success('Einsatzdaten gespeichert');
    },
  });

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
      einsatznummer_intern: einsatz.einsatznummer_intern ?? undefined,
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
      einsatznummer_intern: leerZuNull(werte.einsatznummer_intern),
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
      titel={
        <Space>
          {einsatz.bezeichnung}
          {/* Vorher stand hier der ROHE Wire-Wert in einem `Tag color="green"` — also
              „aktiv"/„abgeschlossen" klein geschrieben und mit einer Farbe, die an
              keiner Rolle hing. Beides kommt jetzt aus `theme/statusFarben.ts`
              (Beschriftung als zweiter Kanal) über `StatusTag` (Rollenfarbe auf Rand
              und Text, nie als Fläche). */}
          <StatusTag darstellung={einsatzStatus[einsatz.status]} />
        </Space>
      }
      breadcrumb={
        <Breadcrumb
          items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }]}
        />
      }
      aktionen={
        !bearbeiten && darfBearbeiten ? (
          <Button type="primary" onClick={bearbeitenStarten}>
            Bearbeiten
          </Button>
        ) : undefined
      }
    >
      {bearbeiten ? (
        <Form<FormWerte> form={form} layout="vertical" onFinish={speichern}>
          <Form.Item
            label="Bezeichnung"
            name="bezeichnung"
            rules={[
              { required: true, whitespace: true, message: 'Bezeichnung darf nicht leer sein' },
            ]}
          >
            {/* Der Knopf, der hierher geführt hat, verschwindet im selben Rendern — ohne
                `autoFocus` fiele der Fokus auf `<body>` und die Tastaturbedienung finge
                wieder ganz oben an. Das Formular wird beim Wechsel frisch eingehängt,
                also genügt Reacts Mount-Fokus; das `requestAnimationFrame` aus dem
                Erfassungs-Primitiv braucht es nur, wo ein Dialog stehen BLEIBT. */}
            <Input autoFocus />
          </Form.Item>
          <Form.Item label="Einsatzstichwort" name="stichwort">
            <AutoComplete options={stichwortOptionen} allowClear placeholder="z. B. H1, MANV …" />
          </Form.Item>
          <Form.Item label="Einsatzart" name="einsatzart" rules={[{ required: true }]}>
            <Select options={EINSATZART_OPTIONEN} />
          </Form.Item>
          <Form.Item label="Einsatznummer (intern)" name="einsatznummer_intern">
            <Input />
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
          <Form.Item label="Nächste Lagebesprechung (optional)" name="naechste_lagebesprechung_at">
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
          {/* Der Fehler steht ÜBER dem Knopf, an dem er entsteht — dort ist der Blick nach
              dem Klick, und dort bleibt er stehen, bis das nächste Absenden ihn räumt. */}
          <SpeicherFehler fehler={speichernMutation.error} />
          <Space style={{ marginTop: token.margin }}>
            <Button type="primary" htmlType="submit" loading={speichernMutation.isPending}>
              Speichern
            </Button>
            <Button onClick={() => setBearbeiten(false)}>Abbrechen</Button>
          </Space>
        </Form>
      ) : (
        <>
          {/* KOPFLEISTE — die vier Angaben, die im Fükw zuerst gebraucht werden.
              Sie stehen NICHT zusätzlich in der Tabelle darunter: doppelter Text hiesse
              zweimal dieselbe Frage beantworten, und im Test lieferte `findByText` dann
              zwei Treffer statt einem. */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(auto-fit, minmax(${KOPF_MIN_BREITE}px, 1fr))`,
              gap: token.margin,
              marginBottom: token.marginLG,
            }}
          >
            <KopfAngabe etikett="Einsatzstichwort" wert={einsatz.stichwort ?? '—'} />
            <KopfAngabe
              etikett="Alarmzeit"
              wert={<ZeitAnzeige wert={einsatz.begonnen_at} format="dtgVoll" />}
            />
            <KopfAngabe etikett="Einsatzort" wert={einsatz.einsatzort ?? '—'} />
            <KopfAngabe etikett="Einsatzleitung" wert={leitung || '—'} />
          </div>

          <Descriptions bordered column={1} size="middle">
            <Descriptions.Item label="Einsatzart">
              {EINSATZART_LABELS[einsatz.einsatzart]}
            </Descriptions.Item>
            <Descriptions.Item label="Nächste Lagebesprechung">
              {einsatz.naechste_lagebesprechung_at ? (
                <ZeitAnzeige wert={einsatz.naechste_lagebesprechung_at} format="dtgVoll" />
              ) : (
                '—'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Koordinate">
              {einsatz.einsatzort_lat != null && einsatz.einsatzort_lon != null ? (
                <KoordinatenAnzeige
                  lat={einsatz.einsatzort_lat}
                  lon={einsatz.einsatzort_lon}
                  einsatzId={einsatzId}
                  exclude={`einsatzort:${einsatzId}`}
                />
              ) : (
                '—'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Meldende Stelle">
              {einsatz.meldende_stelle ?? '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Sachverhalt / Meldebild">
              {einsatz.sachverhalt ?? '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Anzahl Betroffene (initial)">
              {einsatz.anzahl_betroffene_initial ?? '—'}
            </Descriptions.Item>
          </Descriptions>

          {/* TECHNISCHE ANGABEN — Aktenzeichen und der Anlege-Zeitstempel. Sie werden
              gebraucht, wenn jemand nachweist oder rückfragt, nicht wenn jemand führt;
              eingeklappt kosten sie keine Zeile im Blickfeld.
              KEIN `forceRender`: hier wird keine Feldzahl gezählt (die Falle aus der
              Erfassungs-Norm), und der eingeklappte Zustand IST die Aussage — mit
              `forceRender` stünde der Inhalt im Baum und die Gegenprobe „vorher nicht
              sichtbar" wäre nicht mehr formulierbar. */}
          <Collapse
            style={{ marginTop: token.margin }}
            items={[
              {
                key: 'technik',
                label: 'Technische Angaben',
                children: (
                  <Descriptions bordered column={1} size="middle">
                    <Descriptions.Item label="Einsatznummer (intern)">
                      {einsatz.einsatznummer_intern ?? '—'}
                    </Descriptions.Item>
                    <Descriptions.Item label="Leitstellen-Nr.">
                      {einsatz.leitstellen_nr ?? '—'}
                    </Descriptions.Item>
                    <Descriptions.Item label="Angelegt am (techn.)">
                      <ZeitAnzeige wert={einsatz.angelegt_at} format="dtgVoll" />
                    </Descriptions.Item>
                  </Descriptions>
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
