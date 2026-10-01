import { App, Breadcrumb, Button, Checkbox, Form, Input, Space, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { useCallback, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfEinsatzLeiten, darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import {
  etbPfad,
  parseRouteId,
  pressemitteilungPfad,
  pressePfad,
  stabPfad,
} from '../routing/deeplinks';
import { einsatzKeys } from '../api/queryKeys';
import {
  aktualisierePressemitteilung,
  gibPressemitteilungFrei,
  ladePressemitteilung,
  schreibePressemitteilungFort,
} from '../api/presse';
import type { Pressemitteilung, PressemitteilungAbschnitt } from '../api/types';
import type { AbschnittDef } from '../lageberichte/vorlagen';
import { mitteilungVorlage } from '../presse/vorlagen';
import { AbschnittsText } from '../lageberichte/LageberichtText';
import {
  AbschnittsAkkordeon,
  befuellungsKette,
  mengeAusKette,
} from '../lageberichte/AbschnittsAkkordeon';
import MarkdownEditor from '../components/MarkdownEditor';
import { useEntwurfVerlustschutz } from '../entwurf/useEntwurfVerlustschutz';
import FormularEingehaengt from '../components/FormularEingehaengt';
import Einstiegsfokus, { einstiegsAbschnitt } from '../entwurf/Einstiegsfokus';
import FreigabeDialog from '../entwurf/FreigabeDialog';
import { RechteHinweis, SpeicherFehler } from '../components/SpeicherHinweis';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import { alsBackendZeit, alsZeitpunkt } from '../anzeige/zeitEingabe';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import EinsatzSeite from '../components/EinsatzSeite';
import Druckkopf from '../components/druck/Druckkopf';
import DruckKnopf from '../components/druck/DruckKnopf';
import { Paneel, monoStil, useRollen } from '../components/instrument';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import StatusTag from '../components/StatusTag';
import { pressemitteilungStatus } from '../theme/statusFarben';
import { useFehlerMeldung } from '../components/useFehlerMeldung';
import { FREIGABE_NUR_LEITUNG } from '../presse/rechteText';
import { stabFreigabeAnzeige, useStabFreigabe } from '../stab/useStabFreigabe';
// Dieselben Druck-Eigenheiten wie der Lagebericht: Akkordeon-Entwurf, Bedienung ausgeblendet.
import './lageberichtPrint.css';

/**
 * Pressemitteilung des Sachgebiets S5 (LFH-554): Entwurf nach Vorlage, Freigabe nur durch die
 * Einsatzleitung, ETB-Snapshot, Fortschreibung und Druck. Herleitung:
 * `openspec/changes/archive/2026-09-30-lfh-554-presse-medienarbeit-s5/design.md` (D4).
 *
 * Zwilling von `LageberichtDetailPage` und `BefehlDetailPage` (dasselbe Muster: Verlustschutz,
 * Einstiegsfokus, Akkordeon, Freigabedialog). Eine gemeinsame Hülle für alle drei ist ein eigener
 * Umbau; die Begründungen der einzelnen Riegel stehen dort.
 *
 * Abweichungen vom Lagebericht:
 * - **Freigeben** nur mit `darfEinsatzLeiten`. Führungspersonal sieht den Knopf gesperrt und
 *   den Grund darüber (M16); der Server antwortet ohnehin 403.
 * - **Ort:** Unterroute des Stabs, die Seite prüft die Stab-Freigabe selbst.
 */
type FormWerte = { titel: string; zeitstand?: Dayjs } & Record<string, string | Dayjs | undefined>;

const SEITE = { titel: 'Pressemitteilung', mitArtikel: 'die Pressemitteilung' };

export default function PressemitteilungDetailPage() {
  const { mitteilungId } = useParams();
  // Remount je Mitteilung: der Verlustschutz-Merker gehört zu einem Datensatz (Fortschreiben →
  // neuer Entwurf unter derselben Komponente).
  return <PressemitteilungDetail key={mitteilungId} />;
}

function PressemitteilungDetail() {
  const { id, mitteilungId } = useParams();
  const einsatzId = Number(id);
  const pmId = Number(mitteilungId);
  const idGueltig = parseRouteId(mitteilungId) != null;
  const { benutzer } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form] = Form.useForm<FormWerte>();
  const { token } = useRollen();
  const werte = Form.useWatch([], form) as Record<string, unknown> | undefined;
  const [offenerAbschnitt, setOffenerAbschnitt] = useState<string | null>(null);
  const [vorschauNeben, setVorschauNeben] = useState(false);
  const [einstieg, setEinstieg] = useState<{ feld: string | null } | null>(null);
  const stabFreigabe = useStabFreigabe(einsatzId);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const pmQuery = useQuery({
    queryKey: einsatzKeys.pressemitteilung(einsatzId, pmId),
    queryFn: () => ladePressemitteilung(einsatzId, pmId),
    enabled: idGueltig && stabFreigabe.zustand === 'frei',
  });
  const vorlageDef = pmQuery.data ? mitteilungVorlage(pmQuery.data.vorlage) : undefined;
  // Über ein Primitiv memoisiert, damit das `memo`-Akkordeon nicht je Anschlag neu rendert
  // (Begründung in `LageberichtDetailPage`).
  const befuelltKette = befuellungsKette(werte, vorlageDef?.abschnitte ?? []);
  const befuellt = useMemo(
    () => mengeAusKette(befuelltKette, vorlageDef?.abschnitte ?? []),
    [befuelltKette, vorlageDef],
  );

  if (einstieg === null && pmQuery.data && vorlageDef) {
    const geladen = pmQuery.data;
    setEinstieg({
      feld:
        einstiegsAbschnitt(
          vorlageDef.abschnitte.map((a) => a.schluessel),
          (schluessel) => geladen.abschnitte.find((x) => x.schluessel === schluessel)?.text,
        ) ?? null,
    });
  }

  const abschnittsEditor = useCallback(
    (a: AbschnittDef) => (
      <Form.Item label={a.label} name={a.schluessel} labelCol={{ style: { display: 'none' } }}>
        <MarkdownEditor
          layout={vorschauNeben ? 'split' : 'toggle'}
          druckfassung
          unterEbene={1}
          variante="dokument"
          autoSize={{ minRows: 6 }}
        />
      </Form.Item>
    ),
    [vorschauNeben],
  );

  // Liste, Detail und Presseseite hängen unter demselben Prefix.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: einsatzKeys.presse(einsatzId) });
  };
  const fehler = useFehlerMeldung();

  const speichern = (w: FormWerte) => {
    const v = mitteilungVorlage(pmQuery.data!.vorlage)!;
    const abschnitte: PressemitteilungAbschnitt[] = v.abschnitte.map((a) => {
      const text = w[a.schluessel];
      return { schluessel: a.schluessel, text: typeof text === 'string' ? text : '' };
    });
    return aktualisierePressemitteilung(einsatzId, pmId, {
      titel: w.titel,
      ...(w.zeitstand ? { zeitstand: alsBackendZeit(w.zeitstand) } : {}),
      abschnitte,
    });
  };

  const schutz = useEntwurfVerlustschutz<Pressemitteilung, FormWerte>({
    daten: pmQuery.data,
    istEntwurf: pmQuery.data?.status === 'entwurf',
    form,
    werteAus: (pm) => {
      const w: FormWerte = { titel: pm.titel, zeitstand: alsZeitpunkt(pm.zeitstand) };
      for (const a of pm.abschnitte) w[a.schluessel] = a.text;
      return w;
    },
    speichern,
    onGespeichert: invalidate,
  });

  const speichernMutation = useMutation({
    mutationFn: (w: FormWerte) => schutz.speichereJetzt(w),
    onSuccess: () => message.success('Entwurf gespeichert'),
  });

  const [freigabeWerte, setFreigabeWerte] = useState<FormWerte | null>(null);
  const freigebenMutation = useMutation({
    mutationFn: () => gibPressemitteilungFrei(einsatzId, pmId),
    onSuccess: () => {
      invalidate();
      message.success('Pressemitteilung freigegeben');
    },
  });

  const fortschreibenMutation = useMutation({
    mutationFn: () => schreibePressemitteilungFort(einsatzId, pmId),
    onSuccess: (neu: Pressemitteilung) => {
      invalidate();
      navigate(pressemitteilungPfad(einsatzId, neu.id));
    },
    onError: fehler,
  });

  if (!idGueltig) return <Navigate to={pressePfad(einsatzId)} replace />;
  if (stabFreigabe.zustand !== 'frei') return stabFreigabeAnzeige(stabFreigabe, SEITE, einsatzId);
  if (einsatzQuery.isLoading || pmQuery.isLoading) return <SeitenSkeleton />;
  if (pmQuery.isError || !pmQuery.data || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Pressemitteilung nicht gefunden oder kein Zugriff"
        ursache={pmQuery.error ?? einsatzQuery.error}
        onWiederholen={() => void pmQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;
  const pm = pmQuery.data;
  const v = mitteilungVorlage(pm.vorlage);
  const istEntwurf = pm.status === 'entwurf';
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);
  const darfFreigeben = darfEinsatzLeiten(einsatz, benutzer);
  const status = pressemitteilungStatus[pm.status];

  const freigabeBestaetigen = async () => {
    let w: FormWerte;
    try {
      w = await form.validateFields();
    } catch {
      return;
    }
    freigebenMutation.reset();
    setFreigabeWerte(w);
  };

  // Erst speichern, dann freigeben: `/freigeben` prüft den persistierten Stand.
  const freigabeAusfuehren = async () => {
    if (freigabeWerte === null) return;
    try {
      await schutz.speichereJetzt(freigabeWerte);
    } catch {
      return;
    }
    try {
      await freigebenMutation.mutateAsync();
    } catch {
      return;
    }
    setFreigabeWerte(null);
  };

  return (
    <div className="lagebericht-print-root" data-lfh="druckwurzel">
      <FreigabeDialog
        offen={freigabeWerte !== null}
        titel="Pressemitteilung freigeben?"
        warnung="Die Freigabe ist endgültig: Die Mitteilung wird als ETB-Eintrag festgehalten und gilt als veröffentlicht. Korrekturen sind danach nur als Folgemeldung möglich."
        speicherFehler={schutz.speicherFehler}
        freigabeFehler={freigebenMutation.error}
        laeuft={schutz.speichertGerade || freigebenMutation.isPending}
        onAbbrechen={() => setFreigabeWerte(null)}
        onFreigeben={() => void freigabeAusfuehren()}
      />
      <Druckkopf
        dokumentart="Pressemitteilung"
        titel={pm.titel}
        einsatz={einsatz}
        sichtbarkeit="druck"
        zeilen={[
          { etikett: 'Stand', wert: `${status.label} · Version ${pm.version}` },
          { etikett: 'Zeitstand', wert: <ZeitAnzeige wert={pm.zeitstand} /> },
          ...(pm.freigegeben_von_name
            ? [{ etikett: 'Freigegeben von', wert: pm.freigegeben_von_name }]
            : []),
        ]}
      />
      <EinsatzSeite
        breite="schmal"
        titel={pm.titel}
        meta={
          <Space size={6} wrap>
            <StatusTag darstellung={status} />
            <span>{v?.label ?? pm.vorlage}</span>
            <span>v{pm.version}</span>
          </Space>
        }
        breadcrumb={
          <Breadcrumb
            items={[
              { title: <Link to="/einsaetze">Einsätze</Link> },
              { title: einsatz.bezeichnung },
              { title: <Link to={stabPfad(einsatzId)}>Stab</Link> },
              { title: <Link to={pressePfad(einsatzId)}>Pressearbeit</Link> },
              { title: pm.titel },
            ]}
          />
        }
        aktionen={
          <div className="lagebericht-no-print">
            <Space wrap>
              <DruckKnopf />
              {!istEntwurf && pm.etb_eintrag_id != null && (
                <Link to={etbPfad(einsatzId, { eintrag: pm.etb_eintrag_id })}>Zum ETB-Eintrag</Link>
              )}
              {!istEntwurf && darfSchreiben && (
                <Button
                  onClick={() => fortschreibenMutation.mutate()}
                  loading={fortschreibenMutation.isPending}
                >
                  Folgemeldung schreiben
                </Button>
              )}
              {istEntwurf && darfSchreiben && (
                <>
                  <Typography.Text type="secondary">
                    {schutz.ungespeichert
                      ? 'ungespeicherte Änderungen'
                      : schutz.zuletztGespeichert &&
                        `zuletzt gespeichert ${schutz.zuletztGespeichert}`}
                  </Typography.Text>
                  <Button onClick={() => form.submit()} loading={speichernMutation.isPending}>
                    Entwurf speichern
                  </Button>
                  <Button
                    type="primary"
                    onClick={freigabeBestaetigen}
                    loading={freigebenMutation.isPending}
                    disabled={!darfFreigeben}
                  >
                    Freigeben
                  </Button>
                </>
              )}
            </Space>
          </div>
        }
      >
        {istEntwurf && darfSchreiben && !darfFreigeben && (
          <div className="lagebericht-no-print" style={{ marginBottom: token.marginSM }}>
            <RechteHinweis sichtbar text={FREIGABE_NUR_LEITUNG} />
          </div>
        )}
        {schutz.speicherFehler != null && (
          <div className="lagebericht-no-print" style={{ marginBottom: token.marginSM }}>
            <SpeicherFehler fehler={schutz.speicherFehler} />
          </div>
        )}
        {!(istEntwurf && darfSchreiben) && (
          <Typography.Paragraph type="secondary" style={monoStil(12)}>
            Zeitstand: <ZeitAnzeige wert={pm.zeitstand} />
          </Typography.Paragraph>
        )}
        {istEntwurf && darfSchreiben ? (
          <Form
            form={form}
            layout="vertical"
            onValuesChange={schutz.markiereGeaendert}
            onBlur={schutz.autosaveJetzt}
            onFinish={(w) => speichernMutation.mutate(w as FormWerte)}
          >
            {/* Erst wenn das `<Form>` hängt, übernimmt der Verlustschutz den Serverstand
                (LFH-627, `entwurf/useEntwurfVerlustschutz.ts` (4)). */}
            <FormularEingehaengt onWechsel={schutz.formularEingehaengt} />
            <Form.Item label="Titel" name="titel" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item label="Zeitstand" name="zeitstand">
              <ZeitpunktEingabe
                allowClear={false}
                format="DD.MM.YYYY HH:mm"
                style={{ width: '100%' }}
              />
            </Form.Item>
            <Checkbox
              className="lagebericht-no-print"
              checked={vorschauNeben}
              onChange={(e) => setVorschauNeben(e.target.checked)}
              style={{ marginBottom: token.margin }}
            >
              Vorschau neben dem Text
            </Checkbox>
            {v && (
              <AbschnittsAkkordeon
                abschnitte={v.abschnitte}
                befuellt={befuellt}
                offen={offenerAbschnitt ?? einstieg?.feld ?? v.abschnitte[0].schluessel}
                onOffen={setOffenerAbschnitt}
                editor={abschnittsEditor}
              />
            )}
            <Einstiegsfokus form={form} feld={einstieg?.feld ?? undefined} />
          </Form>
        ) : (
          <Paneel
            titel="Mitteilung"
            meta={`${v?.abschnitte.length ?? 0} Abschnitte`}
            koerperPolster
          >
            <div className="lagebericht-druck">
              <AbschnittsText
                gliederung={v?.abschnitte ?? []}
                abschnitte={pm.abschnitte}
                unterEbene={2}
              />
            </div>
          </Paneel>
        )}
      </EinsatzSeite>
    </div>
  );
}
