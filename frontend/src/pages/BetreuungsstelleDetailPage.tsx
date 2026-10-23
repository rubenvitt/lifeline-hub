import { App, Breadcrumb, Button, Form, Input, InputNumber, Space, Tag, Typography } from 'antd';
import { EinsatzOrtsfeld } from '../anzeige/EinsatzOrtsfeld';
import { ortsfeldAusGespeichert } from '../anzeige/ortsfeldFormular';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { FormRule } from 'antd';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import {
  aendereStelle,
  ladeBetreuung,
  meldeBelegung,
  nimmBelegungZurueck,
  storniereStelle,
} from '../api/betreuung';
import { ladeEinsatz } from '../api/einsaetze';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { BETREUUNG_ERREICHBARKEIT_MAX, BETREUUNG_LEITUNG_MAX } from '../api/eingabegrenzen';
import { einsatzKeys } from '../api/queryKeys';
import type {
  BelegungsmeldungEingabe,
  Betreuungsstelle,
  BetreuungsstellePatch,
  BetreuungsstelleStatus,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import {
  ART_OPTIONEN,
  BelegungMeldenDialog,
  StelleSchliessenDialog,
  StornierenDialog,
  hoechstensRegel,
  stellePatchDreiseitig,
  type StelleWerte,
} from '../betreuung/BetreuungDialoge';
import MeldeVerlauf from '../betreuung/MeldeVerlauf';
import StelleBedarf from '../betreuung/StelleBedarf';
import StelleBelegung from '../betreuung/StelleBelegung';
import StelleBetroffene from '../betreuung/StelleBetroffene';
import { GESCHLOSSEN_HINWEIS } from '../betreuung/StellenBlock';
import { ART_LABEL, inBetreuung, personenZahl } from '../betreuung/betreuungText';
import { STATUS_HANDLUNG, schliessenBrauchtLeermeldung } from '../betreuung/stelleStatus';
import EinsatzSeite from '../components/EinsatzSeite';
import {
  Datenfeld,
  DatenfeldEingabe,
  Datenraster,
  Paneel,
  PaneelLink,
  monoStil,
} from '../components/instrument';
import { MenueAusloeser, type MenueEintrag } from '../components/MenueAusloeser';
import { einsatzRechteGrund } from '../components/nurAnsicht';
import { Select } from '../components/Select';
import { SeitenFehler, SeitenSkeleton, SeitenStandVeraltet } from '../components/SeitenZustand';
import { SeitenHinweise, SpeicherFehler } from '../components/SpeicherHinweis';
import StatusTag from '../components/StatusTag';
import VerlassenRueckfrage from '../components/VerlassenRueckfrage';
import { useFormularVerlassenSchutz } from '../components/useFormularVerlassenSchutz';
import { useSpeicherLeiste } from '../components/speicherLeiste';
import { zeichenGrenze, zeichenRegel } from '../components/zeichenGrenze';
import { KEINE_BERECHTIGUNG, modulName } from '../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useModulFreigaben, useSprungSperre } from '../einsatz/useSprungSperre';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import { erfasseBelegungOfflineFaehig } from '../offline/schreiben';
import { betreuungPfad, lagekartePfad, parseRouteId, verpflegungPfad } from '../routing/deeplinks';
import { betreuungsstelleStatus } from '../theme/statusFarben';

type KopfMenue = 'karte' | 'verorten' | 'stornieren';

/** Ein Dialog zur Zeit; jeder frisch montiert. */
type Dialog = 'belegung' | 'schliessen' | 'stornieren';

/** Die offene Bearbeiten-Sitzung: der Stand beim Öffnen (dreiseitiger PATCH) und die Werte. */
interface Sitzung {
  beimOeffnen: Betreuungsstelle;
  werte: StelleWerte;
}

const leer = <Typography.Text type="secondary">—</Typography.Text>;

/** Pflicht, nicht nur Leerzeichen — wie im Anlegen-Dialog. */
const bezeichnungRegel: FormRule = {
  required: true,
  whitespace: true,
  message: 'Bitte eine Bezeichnung angeben',
};

function sitzungsWerte(s: Betreuungsstelle): StelleWerte {
  return {
    bezeichnung: s.bezeichnung,
    art: s.art,
    kapazitaet_personen: s.kapazitaet_personen ?? undefined,
    abschnitt_id: s.abschnitt_id ?? undefined,
    // Eine gespeicherte Koordinate steht als Kartenpunkt im Feld: eine Textkorrektur behält sie
    // (LLH-1121, design.md D3).
    standort: ortsfeldAusGespeichert(s.standort, s.lat, s.lon),
    leitung: s.leitung ?? undefined,
    erreichbarkeit: s.erreichbarkeit ?? undefined,
    notiz: s.notiz ?? undefined,
  };
}

/**
 * Detailseite einer Betreuungsstelle (LLH-1044, Spec `betreuung-evakuierung`): Belegung in
 * Zahlen, Bedarf (LLH-1082), Stammdaten, Meldeverlauf, Betroffene hier und Verpflegung auf einer
 * Seite.
 *
 * Die Stelle kommt aus `GET …/betreuung` (derselbe Cache wie Übersicht und Gerät, live über das
 * `betreuung`-Ereignis); es gibt keinen Einzel-Endpunkt. Eine unbekannte, fremde oder stornierte
 * Stelle führt nach dem Laden zurück auf die Übersicht.
 *
 * Kopf: „Belegung melden" als Primäraktion, der Statuswechsel als Handlungsknopf
 * (`betreuung/stelleStatus.ts`), Karte und Stornieren im Menü. Bearbeiten steht am Paneel
 * „Stelle" — es betrifft nur dessen Felder — und geschieht in der Ansicht (LLH-1101).
 */
export default function BetreuungsstelleDetailPage() {
  const { id, stelleId: stelleParam } = useParams();
  const einsatzId = Number(id);
  const stelleId = parseRouteId(stelleParam);
  if (stelleId == null) return <Navigate replace to={betreuungPfad(einsatzId)} />;
  return <StelleInhalt einsatzId={einsatzId} stelleId={stelleId} />;
}

function StelleInhalt({ einsatzId, stelleId }: { einsatzId: number; stelleId: number }) {
  const navigate = useNavigate();
  const { benutzer } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const gesperrt = useSprungSperre(einsatzId);
  const freigaben = useModulFreigaben(einsatzId);
  const [form] = Form.useForm<StelleWerte>();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [sitzung, setSitzung] = useState<Sitzung | null>(null);
  const bearbeiten = sitzung != null;
  const speicherLeiste = useSpeicherLeiste({ hasAbbrechen: true });
  // Verlassen-Schutz nur bei offener Sitzung; der Schlüssel hängt an der Stelle.
  const schutz = useFormularVerlassenSchutz({
    aktiv: bearbeiten,
    schluessel: bearbeiten ? stelleId : null,
  });
  const schliessen = useCallback(() => setDialog(null), []);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const betreuungQuery = useQuery({
    queryKey: einsatzKeys.betreuung(einsatzId),
    queryFn: () => ladeBetreuung(einsatzId),
  });
  const darfSchreiben = einsatzQuery.data ? darfImEinsatzSchreiben(einsatzQuery.data) : false;
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
    enabled: darfSchreiben,
  });
  const abschnitte = useMemo(
    () => (abschnitteQuery.data ?? []).map((a) => ({ value: a.id, label: a.name })),
    [abschnitteQuery.data],
  );

  const stellen = useMemo(() => betreuungQuery.data?.stellen ?? [], [betreuungQuery.data]);
  const stelle = stellen.find((s) => s.id === stelleId);
  // Ohne Personenrecht liefert die Übersicht kein `namentlich`: Zahl und Paneel entfallen.
  const namentlichListe = betreuungQuery.data?.namentlich;
  const personenFrei = namentlichListe != null;
  const namentlich = personenFrei
    ? (namentlichListe.find((n) => n.stelle_id === stelleId)?.anzahl ?? 0)
    : undefined;

  const invalidiere = useCallback(() => {
    void qc.invalidateQueries({ queryKey: einsatzKeys.betreuung(einsatzId) });
    void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }, [qc, einsatzId]);

  const belegungZurueckMut = useMutation({
    mutationFn: (meldungId: number) => nimmBelegungZurueck(einsatzId, meldungId),
    onSuccess: (r) => {
      invalidiere();
      message.success(`Meldung zu ${r.stelle.bezeichnung} zurückgenommen`);
    },
    onError: invalidiere,
  });
  const { reset: resetBelegungZurueck, mutate: belegungZuruecknehmen } = belegungZurueckMut;
  const belegungMut = useMutation({
    // Die Funktion merkt ohne Netz selbst vor (LFH-705).
    networkMode: 'always',
    mutationFn: ({ ziel, body }: { ziel: Betreuungsstelle; body: BelegungsmeldungEingabe }) => {
      if (!benutzer) throw new Error('Nicht angemeldet');
      return erfasseBelegungOfflineFaehig(benutzer.id, einsatzId, ziel, body);
    },
    onMutate: () => resetBelegungZurueck(),
    onSuccess: (ergebnis, { ziel, body }) => {
      if (ergebnis.zustand === 'vorgemerkt') {
        message.warning(`Offline vorgemerkt: Belegungsmeldung ${ziel.bezeichnung}`);
        return;
      }
      const r = ergebnis.daten;
      invalidiere();
      zeigeRueckgaengig(
        message,
        `Belegung ${r.stelle.bezeichnung} gemeldet: ${personenZahl(body.belegt)} untergebracht`,
        () => belegungZuruecknehmen(r.meldung_id),
      );
    },
  });
  const statusMut = useMutation({
    mutationFn: (status: BetreuungsstelleStatus) => aendereStelle(einsatzId, stelleId, { status }),
    onSuccess: (s) => {
      invalidiere();
      message.success(
        `Betreuungsstelle ${s.bezeichnung}: ${betreuungsstelleStatus[s.status].label}`,
      );
    },
  });
  // Die Leermeldung vor dem Schließen: ohne Rückgängig-Toast — ein Rückweg auf die alte Zahl
  // ließe eine geschlossene, belegte Stelle zu (der Server lehnt das mit 422 ab).
  const leermeldungMut = useMutation({
    mutationFn: () => meldeBelegung(einsatzId, stelleId, { belegt: 0 }),
    onSuccess: invalidiere,
  });
  const schliessenMut = useMutation({
    mutationFn: (patch: BetreuungsstellePatch) => aendereStelle(einsatzId, stelleId, patch),
    onSuccess: (s) => {
      invalidiere();
      message.success(`Betreuungsstelle ${s.bezeichnung}: geschlossen`);
    },
  });
  const speichernMut = useMutation({
    mutationFn: (patch: BetreuungsstellePatch) => aendereStelle(einsatzId, stelleId, patch),
    onSuccess: (s) => {
      invalidiere();
      message.success(`Betreuungsstelle ${s.bezeichnung} gespeichert`);
    },
  });
  const stornoMut = useMutation({
    mutationFn: () => storniereStelle(einsatzId, stelleId),
    onSuccess: (s) => {
      invalidiere();
      message.success(`Betreuungsstelle ${s.bezeichnung} storniert`);
      navigate(betreuungPfad(einsatzId));
    },
  });

  // Die Route hat keinen `key`: der Wechsel zu einer anderen Stelle beendet Sitzung, Dialoge und
  // Gründe der vorigen.
  const { reset: resetStatus } = statusMut;
  const { reset: resetSpeichern } = speichernMut;
  useEffect(() => {
    resetStatus();
    resetSpeichern();
    resetBelegungZurueck();
    setSitzung(null);
    setDialog(null);
  }, [stelleId, resetStatus, resetSpeichern, resetBelegungZurueck]);

  if (einsatzQuery.isLoading || betreuungQuery.isLoading) return <SeitenSkeleton />;
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  if (betreuungQuery.data == null) {
    return (
      <SeitenFehler
        text="Betreuungsstelle konnte nicht geladen werden"
        ursache={betreuungQuery.error}
        onWiederholen={() => void betreuungQuery.refetch()}
      />
    );
  }
  // Unbekannt, fremd oder storniert: die Übersicht trägt sie nicht.
  if (!stelle) return <Navigate replace to={betreuungPfad(einsatzId)} />;

  const einsatz = einsatzQuery.data;
  const s = stelle;
  const geschlossen = s.status === 'geschlossen';
  const verortet = s.lat != null && s.lon != null;
  const karteGesperrt = gesperrt('lagekarte');
  const handlung = STATUS_HANDLUNG[s.status];
  const veraltet = betreuungQuery.isError;

  function statusWechsel() {
    resetStatus();
    if (schliessenBrauchtLeermeldung(handlung.ziel, s.belegung?.belegt)) {
      leermeldungMut.reset();
      schliessenMut.reset();
      setDialog('schliessen');
      return;
    }
    statusMut.mutate(handlung.ziel);
  }

  function starteBearbeiten() {
    resetSpeichern();
    setSitzung({ beimOeffnen: s, werte: sitzungsWerte(s) });
  }

  const menue: MenueEintrag<KopfMenue>[] = [
    verortet
      ? karteGesperrt
        ? { key: 'karte', label: `Auf Karte zeigen (${KEINE_BERECHTIGUNG})`, gesperrt: true }
        : { key: 'karte', label: 'Auf Karte zeigen' }
      : karteGesperrt
        ? { key: 'verorten', label: `Auf Karte verorten (${KEINE_BERECHTIGUNG})`, gesperrt: true }
        : { key: 'verorten', label: 'Auf Karte verorten' },
    { key: 'stornieren', label: 'Stornieren', gefahr: true },
  ];
  function menueWahl(key: KopfMenue) {
    if (key === 'karte' && verortet) {
      navigate(lagekartePfad(einsatzId, { zentrum: { lat: s.lat!, lon: s.lon! } }));
    } else if (key === 'verorten') {
      // Platziermodus der Lagekarte; „Zurück zu …“ führt danach hierher (LLH-1125).
      navigate(
        lagekartePfad(einsatzId, {
          platzieren: { typ: 'betreuungsstelle', id: s.id, zurueck: true },
        }),
      );
    } else if (key === 'stornieren') {
      stornoMut.reset();
      setDialog('stornieren');
    }
  }

  const kopfAktionen = darfSchreiben && !bearbeiten && (
    <Space wrap size="middle">
      <Button
        type="primary"
        disabled={geschlossen}
        onClick={() => {
          belegungMut.reset();
          setDialog('belegung');
        }}
      >
        Belegung melden
      </Button>
      {/* Der Grund steht sichtbar daneben, nicht nur im Tooltip (LFH-1078). */}
      {geschlossen && <Typography.Text type="secondary">Stelle geschlossen</Typography.Text>}
      <Button loading={statusMut.isPending} onClick={statusWechsel}>
        {handlung.text}
      </Button>
      <MenueAusloeser
        eintraege={menue}
        zugaenglicherName={`Weitere Aktionen zu Stelle ${s.bezeichnung}`}
        onWahl={menueWahl}
      />
    </Space>
  );

  // Eine Zelle: in der Sitzung eine benannte Eingabe mit Prüffehler darunter, sonst die Anzeige.
  const zelle = (
    name: keyof StelleWerte,
    label: string,
    eingabe: ReactElement<{ id?: string }>,
    anzeige: ReactNode,
    {
      breit = false,
      mono = false,
      rules,
    }: { breit?: boolean; mono?: boolean; rules?: FormRule[] } = {},
  ) =>
    bearbeiten ? (
      <DatenfeldEingabe label={label} name={name} rules={rules} breit={breit}>
        {eingabe}
      </DatenfeldEingabe>
    ) : (
      <Datenfeld label={label} mono={mono} breit={breit}>
        {anzeige}
      </Datenfeld>
    );

  const stammdaten = (
    <Datenraster spalten={3} beschriftung="Stammdaten der Stelle">
      {zelle('bezeichnung', 'Bezeichnung', <Input />, s.bezeichnung, {
        rules: [bezeichnungRegel],
      })}
      {zelle('art', 'Art', <Select options={ART_OPTIONEN} />, ART_LABEL[s.art], {
        rules: [{ required: true, message: 'Bitte eine Art wählen' }],
      })}
      {zelle(
        'kapazitaet_personen',
        'Kapazität (Personen)',
        <InputNumber min={1} precision={0} placeholder="keine Angabe" style={{ width: '100%' }} />,
        s.kapazitaet_personen != null ? personenZahl(s.kapazitaet_personen) : leer,
        { mono: true, rules: [hoechstensRegel] },
      )}
      {zelle(
        'abschnitt_id',
        'Einsatzabschnitt',
        <Select
          allowClear
          placeholder="ohne Abschnitt"
          options={abschnitte}
          notFoundContent="Keine Einsatzabschnitte angelegt"
        />,
        s.abschnitt_name ?? leer,
      )}
      {/* Ortsfeld mit Vorschau (LLH-1121): ein Treffer, eine getippte Koordinate oder ein Punkt auf
          der Karte verortet die Stelle; beim Bearbeiten zeigt die Vorschau den Punkt. */}
      {zelle(
        'standort',
        'Standort',
        <EinsatzOrtsfeld
          einsatzId={einsatzId}
          etikett="Standort"
          exclude={`betreuungsstelle:${s.id}`}
        />,
        s.standort ?? leer,
        { breit: bearbeiten },
      )}
      {!bearbeiten && (
        <Datenfeld label="Koordinate">
          {verortet ? (
            <Space wrap size="small">
              <span style={monoStil(14)}>
                {s.lat!.toFixed(5)}, {s.lon!.toFixed(5)}
              </span>
              {!karteGesperrt && (
                <Link to={lagekartePfad(einsatzId, { zentrum: { lat: s.lat!, lon: s.lon! } })}>
                  Auf Karte zeigen
                </Link>
              )}
            </Space>
          ) : (
            <Typography.Text type="secondary">nicht verortet</Typography.Text>
          )}
        </Datenfeld>
      )}
      {zelle(
        'leitung',
        'Leitung',
        <Input count={zeichenGrenze(BETREUUNG_LEITUNG_MAX)} />,
        s.leitung ?? leer,
        { rules: [zeichenRegel(BETREUUNG_LEITUNG_MAX, 'Leitung')] },
      )}
      {zelle(
        'erreichbarkeit',
        'Kontakt',
        <Input count={zeichenGrenze(BETREUUNG_ERREICHBARKEIT_MAX)} />,
        s.erreichbarkeit ?? leer,
        { mono: true, rules: [zeichenRegel(BETREUUNG_ERREICHBARKEIT_MAX, 'Kontakt')] },
      )}
      {zelle('notiz', 'Notiz', <Input.TextArea autoSize={{ minRows: 2 }} />, s.notiz ?? leer, {
        breit: true,
      })}
    </Datenraster>
  );

  const gesamt = inBetreuung(stellen);
  const verpflegungGesperrt = gesperrt('verpflegung');

  const fehlerHinweis =
    statusMut.error != null
      ? { fehler: statusMut.error, titel: 'Status nicht geändert' }
      : { fehler: belegungZurueckMut.error, titel: 'Meldung konnte nicht zurückgenommen werden' };

  return (
    <EinsatzSeite
      titel={
        <Space wrap size={8}>
          <span>Betreuungsstelle {s.bezeichnung}</span>
          <Tag>{ART_LABEL[s.art]}</Tag>
          <StatusTag darstellung={betreuungsstelleStatus[s.status]} />
        </Space>
      }
      dataUpdatedAt={betreuungQuery.dataUpdatedAt}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: <Link to={betreuungPfad(einsatzId)}>{modulName('betreuung')}</Link> },
            { title: s.bezeichnung },
          ]}
        />
      }
      aktionen={kopfAktionen || undefined}
      hinweis={
        <SeitenHinweise
          rechteFehlt={!darfSchreiben}
          rechteText={einsatzRechteGrund(einsatz.status)}
          fehler={fehlerHinweis.fehler}
          fehlerTitel={fehlerHinweis.titel}
        />
      }
    >
      <VerlassenRueckfrage ungespeichert={schutz.ungespeichert} />
      <Space orientation="vertical" size="large" style={{ width: '100%' }}>
        {veraltet && <SeitenStandVeraltet onWiederholen={() => void betreuungQuery.refetch()} />}
        <StelleBelegung stelle={s} namentlich={namentlich} />
        {/* Was die Stelle braucht, direkt unter dem, was sie hat (LLH-1082). */}
        <StelleBedarf
          einsatzId={einsatzId}
          stelleId={s.id}
          freigaben={freigaben}
          darfSchreiben={darfSchreiben}
        />

        <Paneel
          titel="Stelle"
          koerperPolster
          aktion={
            darfSchreiben && !bearbeiten ? (
              <Button onClick={starteBearbeiten}>Bearbeiten</Button>
            ) : undefined
          }
        >
          {sitzung ? (
            <Form<StelleWerte>
              form={form}
              layout="vertical"
              initialValues={sitzung.werte}
              // Ohne `preserve` überlebten die Werte einer abgebrochenen Sitzung im Formularspeicher
              // und gingen beim nächsten „Bearbeiten“ den `initialValues` vor.
              preserve={false}
              onValuesChange={schutz.geaendert}
              // Nach gescheiterter Prüfung steht der Fokus im ersten Feld mit Meldung (LLH-1101).
              scrollToFirstError={{ focus: true }}
              onFinish={(werte) => {
                // Dreiseitig: nur, was hier geändert wurde UND vom aktuellen Stand abweicht.
                const patch = stellePatchDreiseitig(sitzung.beimOeffnen, s, werte);
                if (Object.keys(patch).length === 0) {
                  setSitzung(null);
                  return;
                }
                const fassung = schutz.fassung();
                speichernMut.mutate(patch, {
                  onSuccess: () => {
                    schutz.gespeichert(fassung);
                    setSitzung(null);
                  },
                });
              }}
            >
              {stammdaten}
              {speichernMut.error != null && (
                <div style={{ marginTop: 16 }}>
                  <SpeicherFehler
                    fehler={speichernMut.error}
                    titel="Betreuungsstelle konnte nicht gespeichert werden"
                  />
                </div>
              )}
              <div {...speicherLeiste} style={{ ...speicherLeiste.style, marginTop: 16 }}>
                <Button type="primary" htmlType="submit" loading={speichernMut.isPending}>
                  Speichern
                </Button>
                {/* Bis zur Antwort gesperrt: ihre Ablehnung braucht das Formular als Ort. */}
                <Button disabled={speichernMut.isPending} onClick={() => setSitzung(null)}>
                  Abbrechen
                </Button>
              </div>
            </Form>
          ) : (
            stammdaten
          )}
        </Paneel>

        <Paneel titel="Meldeverlauf" koerperPolster>
          <MeldeVerlauf
            einsatzId={einsatzId}
            art="stelle"
            objektId={s.id}
            darfZuruecknehmen={darfSchreiben && !geschlossen}
            // Ohne Schreibrecht nennt der Rechtehinweis über der Seite den Grund.
            sperrHinweis={darfSchreiben && geschlossen ? GESCHLOSSEN_HINWEIS : undefined}
          />
        </Paneel>

        {personenFrei ? (
          <Paneel
            titel="Betroffene hier"
            meta={namentlich ? `namentlich ${personenZahl(namentlich)}` : undefined}
          >
            <StelleBetroffene einsatzId={einsatzId} stelleId={s.id} />
          </Paneel>
        ) : (
          // Benannt statt stumm (M16): das Paneel fehlt, die Zeile sagt warum.
          <Typography.Text type="secondary" data-lfh="betroffene-ohne-recht">
            Betroffene hier · {KEINE_BERECHTIGUNG}
          </Typography.Text>
        )}

        <Paneel
          titel="Verpflegung"
          koerperPolster
          aktion={
            verpflegungGesperrt ? undefined : (
              <PaneelLink
                label={`Zur ${modulName('verpflegung')}`}
                onKlick={() => navigate(verpflegungPfad(einsatzId))}
              />
            )
          }
        >
          {s.belegung == null ? (
            <Typography.Text type="secondary">keine Meldung</Typography.Text>
          ) : (
            <Typography.Text>
              Belegt <span style={monoStil(14)}>{personenZahl(s.belegung.belegt)}</span> von{' '}
              <span style={monoStil(14)}>{personenZahl(gesamt ?? s.belegung.belegt)}</span> in
              Betreuung
            </Typography.Text>
          )}
        </Paneel>
      </Space>

      {dialog === 'belegung' && (
        <BelegungMeldenDialog
          stelle={s}
          laeuft={belegungMut.isPending}
          fehler={belegungMut.error}
          onErfassen={(body) => belegungMut.mutateAsync({ ziel: s, body })}
          onSchliessen={schliessen}
        />
      )}
      {dialog === 'schliessen' && (
        <StelleSchliessenDialog
          stelle={s}
          laeuft={schliessenMut.isPending || leermeldungMut.isPending}
          fehler={leermeldungMut.error ?? schliessenMut.error}
          onLeermeldung={() => leermeldungMut.mutateAsync()}
          onErfassen={(patch) => schliessenMut.mutateAsync(patch)}
          onSchliessen={schliessen}
        />
      )}
      {dialog === 'stornieren' && (
        <StornierenDialog
          titel={`Betreuungsstelle ${s.bezeichnung} stornieren?`}
          text="Nur für Fehlanlagen. Nicht umkehrbar; der ETB-Nachweis bleibt."
          stattdessen={
            geschlossen
              ? undefined
              : {
                  text: 'Stattdessen schließen',
                  onKlick: () => {
                    setDialog(null);
                    if (schliessenBrauchtLeermeldung('geschlossen', s.belegung?.belegt)) {
                      leermeldungMut.reset();
                      schliessenMut.reset();
                      setDialog('schliessen');
                    } else {
                      resetStatus();
                      statusMut.mutate('geschlossen');
                    }
                  },
                }
          }
          laeuft={stornoMut.isPending}
          fehler={stornoMut.error}
          onBestaetigen={() => stornoMut.mutate()}
          onSchliessen={schliessen}
        />
      )}
    </EinsatzSeite>
  );
}
