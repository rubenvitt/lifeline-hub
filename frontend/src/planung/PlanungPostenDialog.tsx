import { Form, Input, InputNumber, theme } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { loadEinheitVorlagen } from '../api/einheitVorlagen';
import {
  PLANUNG_ABSCHNITT_MAX,
  PLANUNG_BEZEICHNUNG_MAX,
  SCHICHTPLAN_PERSONEN_MAX,
} from '../api/eingabegrenzen';
import { listeFahrzeuge } from '../api/fahrzeuge';
import { globalKeys } from '../api/queryKeys';
import type {
  PlanungPosten,
  PlanungPostenAendernBody,
  PlanungPostenBody,
  Staerke,
  UhsTyp,
} from '../api/types';
import { dauerFeldText, dauerMinuten } from '../abloesung/dauer';
import { ErfassungsModal, type Speicherung } from '../components/Erfassung';
import { Select } from '../components/Select';
import { teilwortSuche } from '../components/teilwortSuche';
import { mitVorgabe } from '../components/vorgabeText';
import QualiSollFeld, { vollstaendig, type QualiSollZeile } from '../kraefte/QualiSollFeld';
import { gleichesQualiSoll, qualiSollEingabe, qualiSollText } from '../kraefte/qualiSoll';
import { uhsTyp } from '../theme/statusFarben';
import { schichtlaengeRegeln } from './planungRegeln';

/** Woher ein neuer Posten kommt; danach bleibt sie (der Server ändert sie nicht). */
export type PostenHerkunft = 'frei' | 'vorlage' | 'fahrzeug' | 'uhs';

const HERKUNFT_OPTIONEN: { value: PostenHerkunft; label: string }[] = [
  { value: 'frei', label: 'Frei' },
  { value: 'vorlage', label: 'Einheitenvorlage' },
  { value: 'fahrzeug', label: 'Stamm-Fahrzeug' },
  { value: 'uhs', label: 'UHS' },
];

const UHS_TYPEN = Object.keys(uhsTyp) as UhsTyp[];

export interface PostenWerte {
  herkunft: PostenHerkunft;
  vorlage_id?: number;
  fahrzeug_id?: number;
  uhs_typ?: UhsTyp;
  bezeichnung: string;
  abschnitt?: string;
  schichtlaenge?: string;
  soll?: number | null;
  quali?: QualiSollZeile[];
}

export type PostenSpeichern =
  | { art: 'anlegen'; body: PlanungPostenBody }
  | { art: 'aendern'; postenId: number; body: PlanungPostenAendernBody };

const staerkeSumme = (s: Staerke | null | undefined) =>
  s ? s.fuehrer + s.unterfuehrer + s.mannschaft : null;

/** Herkunft eines gelesenen Postens als Text („Einheitenvorlage SEG Nord“). */
export function herkunftText(p: PlanungPosten): string {
  if (p.art === 'uhs') return p.uhs_typ ? `UHS · ${uhsTyp[p.uhs_typ].label}` : 'UHS';
  if (p.einheit_vorlage_id != null)
    return `Einheitenvorlage ${p.einheit_vorlage_name ?? ''}`.trim();
  if (p.fahrzeug_id != null) return `Stamm-Fahrzeug ${p.fahrzeug_funkrufname ?? ''}`.trim();
  return 'Frei';
}

/** Nur Geändertes (frontend/AGENTS.md, „Bearbeiten in der Ansicht“, Punkt 4). */
export function postenAenderung(p: PlanungPosten, w: PostenWerte): PlanungPostenAendernBody {
  const body: PlanungPostenAendernBody = {};
  const bezeichnung = w.bezeichnung.trim();
  if (bezeichnung !== p.bezeichnung) body.bezeichnung = bezeichnung;
  const abschnitt = w.abschnitt?.trim() || null;
  if (abschnitt !== (p.abschnitt ?? null)) body.abschnitt = abschnitt;
  const laenge = dauerMinuten(w.schichtlaenge);
  if (laenge !== (p.schichtlaenge_minuten ?? null)) body.schichtlaenge_minuten = laenge;
  if ((w.soll ?? null) !== (p.soll_anzahl ?? null)) body.soll_anzahl = w.soll ?? null;
  const quali = vollstaendig(w.quali);
  if (!gleichesQualiSoll(quali, qualiSollEingabe(p.quali_soll)))
    body.quali_soll = quali.length > 0 ? quali : null;
  return body;
}

/** Body eines neuen Postens; leeres Soll = das der Vorlage bzw. des Fahrzeugs (Server). */
export function postenBody(w: PostenWerte): PlanungPostenBody {
  const body: PlanungPostenBody = {
    bezeichnung: w.bezeichnung.trim(),
    art: w.herkunft === 'uhs' ? 'uhs' : 'einheit',
  };
  if (w.herkunft === 'vorlage' && w.vorlage_id != null) body.einheit_vorlage_id = w.vorlage_id;
  if (w.herkunft === 'fahrzeug' && w.fahrzeug_id != null) body.fahrzeug_id = w.fahrzeug_id;
  if (w.herkunft === 'uhs' && w.uhs_typ) body.uhs_typ = w.uhs_typ;
  const abschnitt = w.abschnitt?.trim();
  if (abschnitt) body.abschnitt = abschnitt;
  const laenge = dauerMinuten(w.schichtlaenge);
  if (laenge != null) body.schichtlaenge_minuten = laenge;
  if (w.soll != null) body.soll_anzahl = w.soll;
  const quali = vollstaendig(w.quali);
  if (quali.length > 0) body.quali_soll = quali;
  return body;
}

/**
 * Anlegen und Bearbeiten eines Postens der Planung (LLH-1586): frei, aus einer Einheitenvorlage,
 * aus einem Stamm-Fahrzeug oder als UHS mit Typ. Die Herkunft wählt man nur beim Anlegen; sie gibt
 * Bezeichnung und Soll vor (leer = das der Herkunft, der Platzhalter nennt es). Die Schichtlänge
 * teilt „Schichten erzeugen“ ohne eigene Länge.
 */
export default function PlanungPostenDialog({
  posten,
  laeuft,
  speicherung,
  onSpeichern,
  onSchliessen,
}: {
  /** Der bearbeitete Posten; `null` legt an. */
  posten: PlanungPosten | null;
  laeuft: boolean;
  speicherung: Speicherung;
  onSpeichern: (s: PostenSpeichern) => Promise<unknown>;
  onSchliessen: () => void;
}) {
  const [form] = Form.useForm<PostenWerte>();
  const { token } = theme.useToken();
  const herkunft = Form.useWatch('herkunft', form) ?? 'frei';
  const vorlageId = Form.useWatch('vorlage_id', form);
  const fahrzeugId = Form.useWatch('fahrzeug_id', form);

  const vorlagenQuery = useQuery({
    queryKey: globalKeys.einheitVorlagenListe('aktiv'),
    queryFn: () => loadEinheitVorlagen('aktiv'),
    enabled: posten == null && herkunft === 'vorlage',
  });
  const fahrzeugeQuery = useQuery({
    queryKey: globalKeys.fahrzeugeListe('im-dienst'),
    queryFn: () => listeFahrzeuge(true),
    enabled: posten == null && herkunft === 'fahrzeug',
  });

  const anfang: PostenWerte = useMemo(
    () =>
      posten
        ? {
            herkunft: posten.art === 'uhs' ? 'uhs' : 'frei',
            bezeichnung: posten.bezeichnung,
            abschnitt: posten.abschnitt ?? '',
            schichtlaenge: dauerFeldText(posten.schichtlaenge_minuten),
            soll: posten.soll_anzahl ?? null,
            quali: qualiSollEingabe(posten.quali_soll),
          }
        : { herkunft: 'frei', bezeichnung: '', quali: [] },
    [posten],
  );

  const vorlage = vorlagenQuery.data?.find((v) => v.id === vorlageId);
  const fahrzeug = fahrzeugeQuery.data?.find((f) => f.id === fahrzeugId);
  const herkunftSoll =
    posten == null && herkunft === 'vorlage'
      ? staerkeSumme(vorlage?.soll)
      : posten == null && herkunft === 'fahrzeug'
        ? staerkeSumme(fahrzeug?.staerke)
        : null;
  const sollPlatzhalter = herkunftSoll != null ? mitVorgabe(String(herkunftSoll)) : 'kein Soll';
  const qualiVorgabe =
    posten == null && herkunft === 'vorlage' ? qualiSollText(vorlage?.quali_soll) : '';

  // Die Herkunft gibt die Bezeichnung vor, solange keine eigene steht.
  const uebernimmName = (name: string | undefined) => {
    if (name && !form.getFieldValue('bezeichnung')?.trim()) form.setFieldValue('bezeichnung', name);
  };

  const speichern = (w: PostenWerte) => {
    if (!posten) return onSpeichern({ art: 'anlegen', body: postenBody(w) });
    const body = postenAenderung(posten, w);
    if (Object.keys(body).length === 0) return Promise.resolve();
    return onSpeichern({ art: 'aendern', postenId: posten.id, body });
  };

  const zeile = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    columnGap: token.marginSM,
  } as const;

  return (
    <ErfassungsModal<PostenWerte>
      offen
      titel={posten ? `Posten ${posten.bezeichnung}` : 'Posten anlegen'}
      form={form}
      initialValues={anfang}
      erfassenText={posten ? 'Speichern' : 'Posten anlegen'}
      laeuft={laeuft}
      speicherung={speicherung}
      speicherFehlerTitel={posten ? 'Posten nicht gespeichert' : 'Posten nicht angelegt'}
      onErfassen={speichern}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      {!posten && (
        <div style={zeile}>
          <Form.Item<PostenWerte> label="Herkunft" name="herkunft">
            <Select<PostenHerkunft> aria-label="Herkunft" options={HERKUNFT_OPTIONEN} />
          </Form.Item>
          {herkunft === 'vorlage' && (
            <Form.Item<PostenWerte>
              label="Einheitenvorlage"
              name="vorlage_id"
              rules={[{ required: true, message: 'Bitte eine Vorlage wählen' }]}
            >
              <Select<number>
                aria-label="Einheitenvorlage"
                showSearch={teilwortSuche}
                loading={vorlagenQuery.isLoading}
                options={(vorlagenQuery.data ?? []).map((v) => ({ value: v.id, label: v.name }))}
                onChange={(id) => uebernimmName(vorlagenQuery.data?.find((v) => v.id === id)?.name)}
              />
            </Form.Item>
          )}
          {herkunft === 'fahrzeug' && (
            <Form.Item<PostenWerte>
              label="Stamm-Fahrzeug"
              name="fahrzeug_id"
              rules={[{ required: true, message: 'Bitte ein Fahrzeug wählen' }]}
            >
              <Select<number>
                aria-label="Stamm-Fahrzeug"
                showSearch={teilwortSuche}
                loading={fahrzeugeQuery.isLoading}
                options={(fahrzeugeQuery.data ?? []).map((f) => ({
                  value: f.id,
                  label: f.funkrufname,
                }))}
                onChange={(id) =>
                  uebernimmName(fahrzeugeQuery.data?.find((f) => f.id === id)?.funkrufname)
                }
              />
            </Form.Item>
          )}
          {herkunft === 'uhs' && (
            <Form.Item<PostenWerte>
              label="Typ"
              name="uhs_typ"
              rules={[{ required: true, message: 'Bitte einen Typ wählen' }]}
            >
              <Select<UhsTyp>
                aria-label="Typ"
                options={UHS_TYPEN.map((t) => ({ value: t, label: uhsTyp[t].label }))}
              />
            </Form.Item>
          )}
        </div>
      )}
      <Form.Item<PostenWerte>
        label="Bezeichnung"
        name="bezeichnung"
        rules={[{ required: true, whitespace: true, message: 'Bezeichnung darf nicht leer sein' }]}
      >
        <Input placeholder="z. B. RTW 1" maxLength={PLANUNG_BEZEICHNUNG_MAX} />
      </Form.Item>
      <div style={zeile}>
        <Form.Item<PostenWerte> label="Abschnitt" name="abschnitt">
          <Input maxLength={PLANUNG_ABSCHNITT_MAX} />
        </Form.Item>
        <Form.Item<PostenWerte>
          label="Schichtlänge"
          name="schichtlaenge"
          rules={schichtlaengeRegeln}
        >
          <Input placeholder="z. B. 4 h" autoComplete="off" />
        </Form.Item>
        <Form.Item<PostenWerte> label="Soll" name="soll">
          <InputNumber
            min={0}
            max={SCHICHTPLAN_PERSONEN_MAX}
            precision={0}
            placeholder={sollPlatzhalter}
            style={{ width: '100%' }}
          />
        </Form.Item>
      </div>
      <Form.Item<PostenWerte>
        label="Qualifikationssoll"
        name="quali"
        extra={qualiVorgabe ? mitVorgabe(qualiVorgabe) : undefined}
      >
        <QualiSollFeld bekannt={posten?.quali_soll} />
      </Form.Item>
    </ErfassungsModal>
  );
}
