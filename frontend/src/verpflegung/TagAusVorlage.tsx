import { App, Breadcrumb, Checkbox, Flex, Form, InputNumber, Typography } from 'antd';
import type { FormInstance } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useUhr } from '../abloesung/useUhr';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { uhrzeitAmTag } from '../anzeige/uhrzeit';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import { heuteInZone, tagInZone } from '../anzeige/zeitEingabe';
import { adminSektionPfad } from '../admin/adminNav';
import { ladeEinsatz, ladeModulFreigaben } from '../api/einsaetze';
import { VERPFLEGUNG_AUS_VORLAGE_MAX } from '../api/eingabegrenzen';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { ModulFreigaben, TagAusVorlageEingabe } from '../api/types';
import { createTagAusVorlage, ladeVerpflegung } from '../api/verpflegung';
import { listVerpflegungVorlagen } from '../api/verpflegungVorlagen';
import { useAuth } from '../auth/AuthContext';
import EinsatzSeite from '../components/EinsatzSeite';
import { ErfassungsFormular } from '../components/Erfassung';
import { Paneel, monoStil, useRollen } from '../components/instrument';
import { einsatzRechteGrund } from '../components/nurAnsicht';
import { SeitenFehler, SeitenLeer, SeitenSkeleton } from '../components/SeitenZustand';
import { RechteHinweis } from '../components/SpeicherHinweis';
import { modulName } from '../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { serverJetzt } from '../offline/serveruhr';
import { parseVerpflegungTag, verpflegungPfad } from '../routing/deeplinks';
import {
  buildTagAusVorlageEingabe,
  buildTagFenster,
  isAnlegbar,
  quittungText,
  tagText,
  type TagFenster,
} from './tagAusVorlageKern';
import { useBedarfsvorschlag } from './useBedarfsvorschlag';
import { VERPFLEGUNGSART_LABEL, zeitraumText } from './verpflegungText';

/**
 * Tag aus Vorlage anlegen (LLH-1058, Spec `kraefte-verpflegung`, „Tag aus der Vorlage in der
 * Oberfläche“): ein Nebenweg der Verpflegungsseite. Tag wählen (`?tag=`, Vorgabe heute in der
 * Anzeigezone) → je aktiver Mahlzeit des Verpflegungsplans ein Fenster mit vorgeschlagenem Bedarf
 * → „Zeitfenster anlegen“. Danach zurück zur Verpflegung, die Quittung nennt Übersprungenes.
 *
 * Eigene Seite statt Dialog (UI-Form-Leitlinie): je Fenster zwei Bedarfsfelder, bei vier
 * Mahlzeiten acht Felder, weit über dem Feldbudget eines Modals; die Adresse mit `?tag=` taugt als
 * Lesezeichen. Weitere Personen, Sonderkost und Stellen trägt die Karte danach („Bedarf
 * bearbeiten“), wie der Server sie ohne Stellen anlegt.
 *
 * Der Vorschlag kommt aus `useBedarfsvorschlag` wie beim Einzelanlegen, je Fenster zu seinem
 * Beginn; ohne Quelle bleibt das Feld leer, nie 0, und eine eigene Zahl überschreibt kein
 * nachziehender Vorschlag. Die Zonenrechnung steht rein in `tagAusVorlageKern.ts`.
 *
 * Keine Serie und kein Automatismus: es entstehen gewöhnliche Zeitfenster. Nur mit Netz; die
 * Seite liegt nicht im Lagebild ohne Netz, und das Verpflegungsgerät hat sie nicht.
 */
export default function TagAusVorlage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const [params, setParams] = useSearchParams();
  const { konventionen } = useAnzeigeKonventionen();
  const zone = konventionen.zeitzone;
  // Vorgabe heute nach der Serveruhr, im Kalender der Anzeigezone (Spec `zeiteingabe`).
  const [heute] = useState(() => heuteInZone(zone, serverJetzt()));
  const tag = parseVerpflegungTag(params) ?? heute;
  const waehleTag = (neu: string) => setParams({ tag: neu }, { replace: true });
  // Ein anderer Tag oder Einsatz ist eine neue Vorschau: Wahl, Felder und Gründe beginnen neu.
  return (
    <TagAusVorlageInhalt
      key={`${einsatzId}-${tag}`}
      einsatzId={einsatzId}
      tag={tag}
      zone={zone}
      onTag={waehleTag}
    />
  );
}

/** Formularwerte: Bedarf je Mahlzeit (Kennung der Vorlage als Schlüssel). */
interface Werte {
  fenster?: Record<string, { bedarf_kraefte?: number | null; bedarf_betreute?: number | null }>;
}

function TagAusVorlageInhalt({
  einsatzId,
  tag,
  zone,
  onTag,
}: {
  einsatzId: number;
  tag: string;
  zone: string | null | undefined;
  onTag: (tag: string) => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { benutzer } = useAuth();
  const { token } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const jetzt = useUhr();
  const [form] = Form.useForm<Werte>();
  /** Abgewählte Mahlzeiten; gewählt ist jede andere anlegbare (auch eine live hinzugekommene). */
  const [abgewaehlt, setAbgewaehlt] = useState<ReadonlySet<number>>(new Set());
  // Steht die Seite noch? Sonst bleibt der Bediener, wo er hingegangen ist (Muster
  // `EinheitAusVorlagePage`).
  const stehtRef = useRef(true);
  useEffect(() => {
    stehtRef.current = true;
    return () => {
      stehtRef.current = false;
    };
  }, []);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  const verpflegungQuery = useQuery({
    queryKey: einsatzKeys.verpflegung(einsatzId),
    queryFn: () => ladeVerpflegung(einsatzId),
  });
  const planQuery = useQuery({
    queryKey: globalKeys.verpflegungVorlagenListe('aktiv'),
    queryFn: () => listVerpflegungVorlagen('aktiv'),
  });

  const aktuell = useMemo(
    () =>
      planQuery.data && verpflegungQuery.data
        ? buildTagFenster(planQuery.data, tag, zone, verpflegungQuery.data.zeitfenster)
        : null,
    [planQuery.data, tag, zone, verpflegungQuery.data],
  );
  // Die Vorschau steht, sobald sie Fenster hat (`frontend/AGENTS.md`, „Live-Updates springen
  // nicht unter dem Cursor“): ein live hinzukommendes gleichnamiges Zeitfenster nimmt keinem
  // Fenster die Felder unter der Hand, eine neue Mahlzeit schiebt nichts ein. Was inzwischen am
  // Tag besteht, überspringt der Server, und die Quittung nennt es. Ein anderer Tag ist eine neue
  // Vorschau (`key`).
  const [stand, setStand] = useState<TagFenster[] | null>(null);
  if (stand == null && aktuell != null && aktuell.length > 0) setStand(aktuell);
  const fenster = stand ?? aktuell ?? [];
  const gewaehlt = fenster.filter((f) => isAnlegbar(f) && !abgewaehlt.has(f.vorlage.id));

  const anlegen = useMutation({
    mutationFn: (body: TagAusVorlageEingabe) => createTagAusVorlage(einsatzId, body),
    onSuccess: (ergebnis) => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.verpflegung(einsatzId) });
      if (ergebnis.angelegt.length > 0) {
        void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      }
      const text = quittungText(ergebnis, tag);
      if (ergebnis.angelegt.length > 0) message.success(text);
      else message.info(text);
      if (stehtRef.current) void navigate(verpflegungPfad(einsatzId));
    },
  });

  // Der Tag als Zeitpunkt für das Datumsfeld: 12:00 des Tages, fern jeder Tagesgrenze.
  const tagWert = useMemo(() => uhrzeitAmTag(tag, '12:00', zone), [tag, zone]);

  if (einsatzQuery.isLoading || planQuery.isLoading || verpflegungQuery.isLoading) {
    return <SeitenSkeleton />;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz);
  const titel = 'Tag aus Vorlage anlegen';
  const breadcrumb = (
    <Breadcrumb
      items={[
        { title: <Link to="/einsaetze">Einsätze</Link> },
        { title: einsatz.bezeichnung },
        { title: <Link to={verpflegungPfad(einsatzId)}>{modulName('verpflegung')}</Link> },
        { title: 'Tag aus Vorlage' },
      ]}
    />
  );

  const tagFeld = (
    <Form layout="vertical" component="div">
      <Form.Item label="Tag" htmlFor="verpflegung-tag" style={{ maxWidth: 280 }}>
        <ZeitpunktEingabe
          id="verpflegung-tag"
          showTime={false}
          format="DD.MM.YYYY"
          allowClear={false}
          value={tagWert}
          onChange={(z) => z && onTag(tagInZone(z, zone))}
          style={{ width: '100%' }}
        />
      </Form.Item>
    </Form>
  );

  const zuViele = gewaehlt.length > VERPFLEGUNG_AUS_VORLAGE_MAX;
  const vorhanden = fenster.filter((f) => f.vorhanden).length;

  let inhalt;
  if (planQuery.isError || verpflegungQuery.isError) {
    inhalt = (
      <SeitenFehler
        text="Verpflegungsplan nicht geladen"
        ursache={planQuery.error ?? verpflegungQuery.error}
        onWiederholen={() => {
          void planQuery.refetch();
          void verpflegungQuery.refetch();
        }}
      />
    );
  } else if (fenster.length === 0) {
    inhalt = (
      <SeitenLeer
        titel="Kein Verpflegungsplan"
        aktion={
          benutzer?.system_rolle === 'admin'
            ? {
                label: 'Verpflegungsplan öffnen',
                pfad: adminSektionPfad('stammdaten', 'verpflegungsplan'),
              }
            : undefined
        }
      />
    );
  } else {
    inhalt = (
      <ErfassungsFormular<Werte>
        form={form}
        erfassenText="Zeitfenster anlegen"
        laeuft={anlegen.isPending}
        gesperrt={!darfSchreiben || gewaehlt.length === 0 || zuViele}
        speicherung={anlegen}
        speicherFehlerTitel="Nicht angelegt"
        speicherFehlerFallback="Anlegen fehlgeschlagen"
        onErfassen={(werte) =>
          anlegen.mutateAsync(
            buildTagAusVorlageEingabe(
              tag,
              zone,
              gewaehlt.map((f) => {
                const w = werte.fenster?.[String(f.vorlage.id)];
                return {
                  fenster: f,
                  bedarf_kraefte: w?.bedarf_kraefte ?? 0,
                  bedarf_betreute: w?.bedarf_betreute ?? 0,
                };
              }),
            ),
          )
        }
        // Der Weg zurück hängt am Ergebnis und steht deshalb in `onSuccess`.
        onFertig={() => {}}
        onAbbrechen={() => void navigate(verpflegungPfad(einsatzId))}
        zusammenfassung={
          <>
            {gewaehlt.length === 1 ? '1 Zeitfenster' : `${gewaehlt.length} Zeitfenster`} am{' '}
            {tagText(tag)}
            {vorhanden > 0 && ` · ${vorhanden} schon angelegt`}
            {zuViele && (
              <Typography.Text type="danger" style={{ display: 'block' }}>
                Höchstens {VERPFLEGUNG_AUS_VORLAGE_MAX} Zeitfenster je Tag
              </Typography.Text>
            )}
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM }}>
          {fenster.map((f) => (
            <FensterPaneel
              key={f.vorlage.id}
              form={form}
              einsatzId={einsatzId}
              fenster={f}
              zeitraum={zeitraumText(f, konventionen)}
              gewaehlt={!abgewaehlt.has(f.vorlage.id)}
              gesperrt={!darfSchreiben}
              freigaben={freigabenQuery.data}
              jetzt={jetzt}
              onWahl={(an) =>
                setAbgewaehlt((alt) => {
                  const neu = new Set(alt);
                  if (an) neu.delete(f.vorlage.id);
                  else neu.add(f.vorlage.id);
                  return neu;
                })
              }
            />
          ))}
        </div>
      </ErfassungsFormular>
    );
  }

  return (
    <EinsatzSeite
      breadcrumb={breadcrumb}
      titel={titel}
      meta={tagText(tag)}
      breite="schmal"
      dataUpdatedAt={planQuery.dataUpdatedAt}
      hinweis={
        darfSchreiben ? undefined : (
          <RechteHinweis sichtbar text={einsatzRechteGrund(einsatz.status)} />
        )
      }
    >
      {/* Ein Griff für Bildlauf und e2e: Tag und Vorschau zusammen. */}
      <div data-lfh="tag-aus-vorlage">
        {tagFeld}
        {inhalt}
      </div>
    </EinsatzSeite>
  );
}

type Bedarfsfeld = 'bedarf_kraefte' | 'bedarf_betreute';

const ANZAHL_PFLICHT = 'Bitte eine Anzahl angeben — 0, wenn niemand';

/**
 * Ein Fenster der Vorschau: Kopf mit Bezeichnung, rechts die Wahl; im Körper Zeitraum und Art,
 * darunter Einsatzkräfte und Betreute mit Vorschlag und Herkunft. Vorhanden oder in der Zeitumstellung
 * steht statt der Wahl der Zustand, und es gibt keine Felder.
 */
function FensterPaneel({
  form,
  einsatzId,
  fenster: f,
  zeitraum,
  gewaehlt,
  gesperrt,
  freigaben,
  jetzt,
  onWahl,
}: {
  form: FormInstance<Werte>;
  einsatzId: number;
  fenster: TagFenster;
  zeitraum: string;
  gewaehlt: boolean;
  gesperrt: boolean;
  freigaben: ModulFreigaben | undefined;
  jetzt: ReturnType<typeof useUhr>;
  onWahl: (an: boolean) => void;
}) {
  const { token } = useRollen();
  const name = f.vorlage.bezeichnung;
  const anlegbar = isAnlegbar(f);
  const art = f.vorlage.verpflegungsart ? VERPFLEGUNGSART_LABEL[f.vorlage.verpflegungsart] : null;
  const zustand = f.vorhanden
    ? 'schon angelegt'
    : f.zeitumstellung
      ? 'fällt in die Zeitumstellung'
      : null;
  return (
    <Paneel
      titel={name}
      ueberschrift="h2"
      aktion={
        zustand != null ? (
          <Typography.Text type="secondary" data-lfh="tag-fenster-zustand">
            {zustand}
          </Typography.Text>
        ) : (
          <Checkbox
            checked={gewaehlt}
            disabled={gesperrt}
            aria-label={`${name} anlegen`}
            onChange={(e) => onWahl(e.target.checked)}
          >
            anlegen
          </Checkbox>
        )
      }
      koerperPolster
    >
      {/* Der Zeitraum im Körper, nicht im Meta des Kopfs: dort kürzte er bei 390 px neben der
          Wahl mit Auslassung, und er ist die Angabe, um die es geht. */}
      <div style={{ marginBottom: anlegbar ? token.marginSM : 0 }}>
        <span style={monoStil(13)}>{zeitraum}</span>
        {art && <Typography.Text type="secondary"> · {art}</Typography.Text>}
      </div>
      {anlegbar && (
        <BedarfsFelder
          form={form}
          einsatzId={einsatzId}
          fenster={f}
          aktiv={gewaehlt && !gesperrt}
          pflicht={gewaehlt}
          freigaben={freigaben}
          jetzt={jetzt}
          abstand={token.margin}
        />
      )}
    </Paneel>
  );
}

/** Die zwei Bedarfsfelder eines Fensters, vorbelegt wie im Zeitfensterdialog. */
function BedarfsFelder({
  form,
  einsatzId,
  fenster: f,
  aktiv,
  pflicht,
  freigaben,
  jetzt,
  abstand,
}: {
  form: FormInstance<Werte>;
  einsatzId: number;
  fenster: TagFenster;
  aktiv: boolean;
  pflicht: boolean;
  freigaben: ModulFreigaben | undefined;
  jetzt: ReturnType<typeof useUhr>;
  abstand: number;
}) {
  const id = String(f.vorlage.id);
  const name = f.vorlage.bezeichnung;
  const vorschlag = useBedarfsvorschlag({ einsatzId, vonAt: f.von_at, freigaben, jetzt });
  // Eigener Merker statt `isFieldTouched` (Muster `ZeitfensterDialog`): eine Vorbelegung per
  // `setFieldValue` wäre sonst von der Hand der Person nicht zu trennen.
  const beruehrt = useRef<Record<Bedarfsfeld, boolean>>({
    bedarf_kraefte: false,
    bedarf_betreute: false,
  });
  const { wert: kraefteWert, hinweis: kraefteHinweis } = vorschlag.kraefte;
  const { wert: betreuteWert, hinweis: betreuteHinweis } = vorschlag.betreute;
  // Nur, wenn die Quelle geantwortet hat: während sie lädt, ist `wert` ebenfalls `null`.
  useEffect(() => {
    if (kraefteHinweis == null || beruehrt.current.bedarf_kraefte) return;
    form.setFieldValue(['fenster', id, 'bedarf_kraefte'], kraefteWert ?? undefined);
  }, [form, id, kraefteWert, kraefteHinweis]);
  useEffect(() => {
    if (betreuteHinweis == null || beruehrt.current.bedarf_betreute) return;
    form.setFieldValue(['fenster', id, 'bedarf_betreute'], betreuteWert ?? undefined);
  }, [form, id, betreuteWert, betreuteHinweis]);
  const merke = (feld: Bedarfsfeld) => () => {
    beruehrt.current[feld] = true;
  };

  const feld = (feldName: Bedarfsfeld, label: string, hinweis: string | null) => (
    <Form.Item
      name={['fenster', id, feldName]}
      label={label}
      extra={hinweis ?? undefined}
      rules={[{ required: pflicht, message: ANZAHL_PFLICHT }]}
      style={{ flex: '1 1 160px', marginBottom: 0 }}
    >
      <InputNumber
        min={0}
        precision={0}
        disabled={!aktiv}
        aria-label={`${label} zu ${name}`}
        style={{ width: '100%' }}
        onChange={merke(feldName)}
      />
    </Form.Item>
  );

  return (
    <Flex gap={abstand} wrap>
      {feld('bedarf_kraefte', 'Einsatzkräfte (EP)', kraefteHinweis)}
      {feld('bedarf_betreute', 'Betreute (EP)', betreuteHinweis)}
    </Flex>
  );
}
