import StatusTag from '../components/StatusTag';
import { useSprungSperre } from '../einsatz/useSprungSperre';
import { Alert, App, Breadcrumb, Button, Form, Input, Modal, Space, Spin, theme } from 'antd';
import { SCHADEN_BESCHREIBUNG_MAX, SCHADEN_ORT_MAX } from '../api/eingabegrenzen';
import { zeichenGrenze, zeichenRegel } from '../components/zeichenGrenze';
import { EinsatzOrtsfeld } from '../anzeige/EinsatzOrtsfeld';
import type { OrtsfeldWert } from '../anzeige/Ortsfeld';
import { ortFelder, ortRegeln, ortsfeldAusGespeichert } from '../anzeige/ortsfeldFormular';
import EinsatzSeite from '../components/EinsatzSeite';
import { StatusChip, monoStil } from '../components/instrument';
import { MenueAusloeser } from '../components/MenueAusloeser';
import { Select } from '../components/Select';
import { SeitenFehler } from '../components/SeitenZustand';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import {
  aktualisiereSchaden,
  ladeSchaden,
  schadenRegistrierAnzeige,
  schliesseSchadenAb,
  storniereSchaden,
  uebergebeSchaden,
  type SchadenPatch,
} from '../api/einsatzSchaden';
import { istKonflikt } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import { parseRouteId, schaedenPfad } from '../routing/deeplinks';
import type { Ausmass, SchadenStatus, SchadenTyp } from '../api/types';
import GeschaedigtPicker, { type GeschaedigtWert } from './schaeden/GeschaedigtPicker';
import SchadenDaten from './schaeden/SchadenDaten';
import { GefahrAuswahlImFormular, SchadensgradAuswahl } from './schaeden/GefahrAuswahl';
import SchadenAnhaenge from './schaeden/SchadenAnhaenge';
import { useEditSitzung, type CasBasis } from '../components/useEditSitzung';
import {
  ABSCHLUSS_GRUENDE,
  AUSMASS_META,
  STATUS_META,
  TYP_LABEL,
  geschaedigtAusSchaden,
  geschaedigtFelder,
} from './schaeden/schadenHelfer';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { ErfassungsModal } from '../components/Erfassung';
import { useSpeicherLeiste } from '../components/speicherLeiste';
import VerlassenRueckfrage from '../components/VerlassenRueckfrage';
import { useFormularVerlassenSchutz } from '../components/useFormularVerlassenSchutz';

const TYP_OPTIONS = (Object.keys(TYP_LABEL) as SchadenTyp[]).map((t) => ({
  value: t,
  label: TYP_LABEL[t],
}));
const AUSMASS_OPTIONS = (Object.keys(AUSMASS_META) as Ausmass[]).map((a) => ({
  value: a,
  label: AUSMASS_META[a].label,
}));

type EditWerte = Omit<SchadenPatch, 'ort' | 'lat' | 'lon'> & {
  ort?: OrtsfeldWert;
  geschaedigt?: GeschaedigtWert;
};

/**
 * Eine ändernde Aktion der Kopfleiste (LLH-1105, Vorbild `PersonenDetailPage.tsx`). Deskriptor statt
 * `ReactNode`, damit dieselbe Beschreibung als Primärknopf oder als Menüeintrag gerendert wird und
 * die Rangfolge an einer Stelle entschieden ist.
 */
interface Kopfaktion {
  art: 'uebergeben' | 'abschliessen' | 'stornieren';
  key: string;
  /** Nennt die Handlung, nie ein Statuswort („übergeben“ ist eins, `frontend/AGENTS.md`, Aktionen). */
  label: string;
  /** Rot und hinter dem einen Trenner des Menüs (`components/MenueAusloeser.tsx`). */
  gefahr?: true;
}

const UEBERGEBEN: Kopfaktion = { art: 'uebergeben', key: 'uebergeben', label: 'Schaden übergeben' };
const ABSCHLIESSEN: Kopfaktion = {
  art: 'abschliessen',
  key: 'abschliessen',
  label: 'Schaden abschließen',
};
const STORNIEREN: Kopfaktion = {
  art: 'stornieren',
  key: 'stornieren',
  label: 'Stornieren',
  gefahr: true,
};

/**
 * Was der Kopf je Status anbietet: genau eine Primäraktion, der Rest ins Menü. Spiegel von
 * `darf_uebergehen` (`src/schaden/mod.rs`): offen → übergeben oder direkt abgeschlossen,
 * übergeben → abgeschlossen, abgeschlossen ist endgültig. Was ein Status nie erlaubt, entfällt,
 * statt gesperrt dazustehen; Stornieren geht in jedem Status.
 */
const KOPFAKTIONEN: Record<SchadenStatus, { primaer: Kopfaktion | null; weitere: Kopfaktion[] }> = {
  offen: {
    primaer: UEBERGEBEN,
    weitere: [{ ...ABSCHLIESSEN, label: 'Ohne Übergabe abschließen' }, STORNIEREN],
  },
  uebergeben: { primaer: ABSCHLIESSEN, weitere: [STORNIEREN] },
  abgeschlossen: { primaer: null, weitere: [STORNIEREN] },
};

export default function SchaedenDetailPage() {
  const { id, schadenId: schadenIdParam } = useParams();
  const einsatzId = Number(id);
  const { token } = theme.useToken();
  // Verortungsauftrag nur in eine freie Lagekarte (LFH-888, design.md D4).
  const karteGesperrt = useSprungSperre(einsatzId)('lagekarte');
  const schadenId = Number(schadenIdParam);
  const idGueltig = parseRouteId(schadenIdParam) != null;
  const navigate = useNavigate();

  const qc = useQueryClient();
  const { modal } = App.useApp();
  const [editForm] = Form.useForm<EditWerte>();
  const editSitzung = useEditSitzung<EditWerte>(editForm);
  // Als `const` herausgezogen, damit TypeScript im Formularzweig auf „Sitzung offen" verengt:
  // `basis` ist dort nicht optional. Mit `editSitzung.sitzung?.basis` wäre der unmögliche Fall
  // still ein Schreiben ohne Lock.
  const sitzung = editSitzung.sitzung;
  const bearbeiten = sitzung != null;
  const speicherLeiste = useSpeicherLeiste({ hasAbbrechen: true });
  // Verlassen-Schutz (LLH-1101, `frontend/AGENTS.md` „Formularseiten“): aktiv, solange die
  // Bearbeiten-Sitzung offen ist. Der `schluessel` hängt an der Sitzung, nicht nur an der ID: eine
  // abgebrochene Eingabe zählt beim nächsten „Bearbeiten“ nicht als offene Änderung.
  const schutz = useFormularVerlassenSchutz({
    aktiv: bearbeiten,
    schluessel: bearbeiten ? schadenId : null,
  });
  const [uebergebenOffen, setUebergebenOffen] = useState(false);
  const [abschlussOffen, setAbschlussOffen] = useState(false);
  /**
   * Die Storno-Rückfrage als `<Modal>` außerhalb des Menüs (kein `Popconfirm`, `frontend/AGENTS.md`,
   * Aktionen). Sie gehört dem Schaden, für den sie geöffnet wurde: der Wechsel auf einen anderen
   * (gleiche Route, kein `key`) schließt sie, statt den neuen zu stornieren.
   */
  const [stornoFuer, setStornoFuer] = useState<number | null>(null);
  const stornoOffen = stornoFuer === schadenId;
  const [uebergebForm] = Form.useForm<{ uebergeben_an: string }>();
  const [abschlussForm] = Form.useForm<{ abschluss_grund: string; notiz?: string }>();

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.schaeden(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  function invalidateDetail() {
    invalidate();
    qc.invalidateQueries({ queryKey: einsatzKeys.schaden(einsatzId, schadenId) });
  }

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const detailQuery = useQuery({
    queryKey: einsatzKeys.schaden(einsatzId, schadenId),
    queryFn: () => ladeSchaden(einsatzId, schadenId),
    enabled: idGueltig,
  });

  // Optimistisches Lock: `basis` trägt den beim Öffnen der Maske eingefrorenen geaendert_at-Stand
  // (aus den Live-Query-Daten gelesen hebelte ein Hintergrund-Refetch das Lock aus); ein 409 öffnet
  // den Konfliktdialog, statt still zu überschreiben.
  const editMutation = useMutation({
    // `basis` ist eine `CasBasis` und nur aus `useEditSitzung` zu bekommen: ein blanker
    // `s.geaendert_at` bricht hier den Typcheck.
    mutationFn: (v: { daten: SchadenPatch; basis?: CasBasis; overwrite?: boolean }) =>
      aktualisiereSchaden(einsatzId, schadenId, v.daten, v.overwrite ? undefined : v.basis),
    onSuccess: () => {
      invalidateDetail();
      editSitzung.beende();
    },
    onError: (e, v) => {
      // Nur der erste 409 (Save mit Baseline) ist der Sperrkonflikt. Die Schaden-Route kennt einen
      // zweiten 409, den Storno-Guard vor der CAS, den `overwrite` nicht umgeht. Ein 409 auf den
      // Overwrite zeigt deshalb die Servermeldung, sonst wäre „Überschreiben" ein toter Knopf.
      if (istKonflikt(e) && !v.overwrite) {
        modal.confirm({
          title: 'Zwischenzeitlich geändert',
          content: 'Seit dem Öffnen von jemand anderem gespeichert.',
          okText: 'Überschreiben',
          okButtonProps: { danger: true },
          cancelText: 'Verwerfen und neu laden',
          onOk: () => editMutation.mutate({ daten: v.daten, overwrite: true }),
          onCancel: () => {
            detailQuery.refetch();
            editSitzung.beende();
          },
        });
      }
    },
  });
  const uebergebMutation = useMutation({
    mutationFn: (an: string) => uebergebeSchaden(einsatzId, schadenId, an),
    // Schliessen und Leeren besorgt die Erfassungshülle (`onFertig`).
    onSuccess: invalidateDetail,
  });
  const abschlussMutation = useMutation({
    mutationFn: (v: { abschluss_grund: string; notiz?: string }) =>
      schliesseSchadenAb(einsatzId, schadenId, v.abschluss_grund, v.notiz),
    onSuccess: invalidateDetail,
  });
  const stornoMutation = useMutation({
    mutationFn: () => storniereSchaden(einsatzId, schadenId),
    // Die Rückfrage schließt erst hier; eine Ablehnung steht in ihr.
    onSuccess: () => {
      setStornoFuer(null);
      invalidate();
      navigate(schaedenPfad(einsatzId));
    },
  });

  /*
   * Jede Ablehnung steht an ihrem Ort, kein Toast (LFH-1077, `frontend/AGENTS.md`, „Rückwege und
   * Fehler“): Bearbeiten am Formular, Übergeben, Abschließen und Storno im Dialog. Den
   * Sperrkonflikt beantwortet weiter der Konfliktdialog.
   */
  const sperrkonflikt = istKonflikt(editMutation.error) && !editMutation.variables?.overwrite;
  const editFehler = sperrkonflikt ? null : editMutation.error;

  // Die Route hat keinen `key`: der Wechsel zu einem anderen Schaden behält die Seite, nicht die
  // Gründe und nicht die Bearbeiten-Sitzung (ihre Werte und ihr Lock-Stand gehören dem vorigen).
  const { reset: editReset } = editMutation;
  const { reset: stornoReset } = stornoMutation;
  const { beende: beendeSitzung } = editSitzung;
  useEffect(() => {
    editReset();
    stornoReset();
    beendeSitzung();
    // Dialoge gehören dem Schaden, für den sie geöffnet wurden; auch die Rückfrage, sonst stünde
    // sie beim Rückweg auf den vorigen ungefragt wieder da.
    setUebergebenOffen(false);
    setAbschlussOffen(false);
    setStornoFuer(null);
  }, [schadenId, editReset, stornoReset, beendeSitzung]);

  // Bad-ID-Guard nach allen Hooks (Rules-of-Hooks): ungültige Route-ID → zurück auf die Liste.
  if (!idGueltig) {
    return <Navigate to={schaedenPfad(einsatzId)} replace />;
  }
  if (einsatzQuery.isLoading || detailQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const zurueck = schaedenPfad(einsatzId);

  if (detailQuery.isError) {
    return (
      <SeitenFehler
        text="Schaden konnte nicht geladen werden"
        ursache={detailQuery.error}
        onWiederholen={() => void detailQuery.refetch()}
      />
    );
  }
  if (!detailQuery.data) {
    return <Alert type="error" title="Schaden nicht gefunden" showIcon />;
  }
  const s = detailQuery.data;
  const orgId = einsatz.org_id ?? 0;

  const darfSchreiben = darfImEinsatzSchreiben(einsatz);
  const kennung = schadenRegistrierAnzeige(s.registrier_nr);

  // Ohne Schreibrecht, am stornierten Schaden und während der Bearbeitung trägt der Kopf nichts.
  const aktionenPlan =
    darfSchreiben && !s.storniert_at && !bearbeiten ? KOPFAKTIONEN[s.status] : null;
  const primaer = aktionenPlan?.primaer;

  function fuehreKopfaktionAus(aktion: Kopfaktion) {
    if (aktion.art === 'uebergeben') setUebergebenOffen(true);
    else if (aktion.art === 'abschliessen') setAbschlussOffen(true);
    else setStornoFuer(schadenId);
  }

  const detailAnsicht = (
    <SchadenDaten
      schaden={s}
      einsatzId={einsatzId}
      verortenLink={darfSchreiben}
      karteGesperrt={karteGesperrt}
      // Im Bearbeiten-Modus wird jede Zelle eine `DatenfeldEingabe` (LLH-1101): benannt, und eine
      // Regel meldet sich sichtbar am Feld statt das Speichern still zu verhindern.
      eingabe={
        bearbeiten
          ? {
              typ: { feld: <Select style={{ minWidth: 200 }} options={TYP_OPTIONS} /> },
              ausmass: { feld: <Select style={{ minWidth: 160 }} options={AUSMASS_OPTIONS} /> },
              gefahrenart: { feld: <GefahrAuswahlImFormular /> },
              schadensgrad: { feld: <SchadensgradAuswahl /> },
              // Ortsfeld mit Vorschau (LLH-1121): ein Treffer verortet, eine Textkorrektur behält
              // einen gespeicherten Punkt (design.md D3).
              ort: {
                feld: (
                  <EinsatzOrtsfeld
                    einsatzId={einsatzId}
                    etikett="Schadensort"
                    exclude={`schaden:${s.id}`}
                    count={zeichenGrenze(SCHADEN_ORT_MAX)}
                  />
                ),
                rules: ortRegeln(SCHADEN_ORT_MAX, 'Ort', { meldung: 'Ort ist Pflicht' }),
              },
              // Eine ältere, längere Beschreibung bleibt stehen: der Zähler nennt die Überlänge,
              // Speichern scheitert an der Regel, bis gekürzt ist (LFH-937, design.md Risiken).
              beschreibung: {
                feld: <Input.TextArea rows={2} count={zeichenGrenze(SCHADEN_BESCHREIBUNG_MAX)} />,
                rules: [zeichenRegel(SCHADEN_BESCHREIBUNG_MAX, 'Beschreibung')],
              },
              geschaedigt: {
                feld: (
                  <GeschaedigtPicker
                    einsatzId={einsatzId}
                    orgName={einsatz.org_name ?? 'Eigene Organisation'}
                  />
                ),
              },
            }
          : undefined
      }
    />
  );

  return (
    <EinsatzSeite
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: <Link to={zurueck}>Schäden</Link> },
            { title: kennung },
          ]}
        />
      }
      titel={
        <Space wrap size={8}>
          <span>
            Schaden <span style={monoStil(14, 500)}>{kennung}</span>
          </span>
          <StatusTag darstellung={STATUS_META[s.status]} />
          {s.storniert_at && <StatusChip ton="neutral" wort="storniert" />}
        </Space>
      }
      dataUpdatedAt={detailQuery.dataUpdatedAt}
      aktionen={
        /**
         * Genau eine Primäraktion je Status, „Bearbeiten“ sekundär daneben, der Rest im Menü
         * (LLH-1105). Einen „Zurück zur Liste“-Knopf gibt es nicht: die Brotkrume trägt denselben
         * Weg; nach dem Stornieren springt die Seite selbst zurück.
         */
        aktionenPlan && (
          // Zielabstand der Dichte-Staffel (LLH-1273): `marginSM` = 7 / 11 / 16 px, antds Vorgabe
          // `paddingXS` ließ 3 / 5 / 7 px.
          <Space wrap size={token.marginSM}>
            {primaer && (
              <Button type="primary" onClick={() => fuehreKopfaktionAus(primaer)}>
                {primaer.label}
              </Button>
            )}
            <Button
              onClick={() => {
                if (!editMutation.isPending) editMutation.reset();
                editSitzung.starte(s, {
                  typ: s.typ,
                  ausmass: s.ausmass,
                  gefahrenart: s.gefahrenart ?? null,
                  schadensgrad: s.schadensgrad ?? null,
                  ort: ortsfeldAusGespeichert(s.ort, s.lat, s.lon),
                  beschreibung: s.beschreibung,
                  geschaedigt: geschaedigtAusSchaden(s),
                });
              }}
            >
              Bearbeiten
            </Button>
            <MenueAusloeser
              eintraege={aktionenPlan.weitere}
              // Die Kennung im Namen: auf einer Seite mit mehreren Menüs lieferten gleichnamige
              // Knöpfe kein Ziel.
              zugaenglicherName={`Weitere Aktionen zu Schaden ${kennung}`}
              onWahl={(key) => {
                const eintrag = aktionenPlan.weitere.find((w) => w.key === key);
                if (eintrag) fuehreKopfaktionAus(eintrag);
              }}
            />
          </Space>
        )
      }
    >
      <VerlassenRueckfrage ungespeichert={schutz.ungespeichert} />
      {sitzung ? (
        <Form
          form={editForm}
          onValuesChange={schutz.geaendert}
          // Nach gescheiterter Prüfung steht der Fokus im ersten Feld mit Meldung (LLH-1101).
          scrollToFirstError={{ focus: true }}
          onFinish={(daten) => {
            const ort = ortFelder(daten.ort);
            const vorher = ortFelder(sitzung.werte.ort);
            const patch: SchadenPatch = {
              typ: daten.typ,
              ausmass: daten.ausmass,
              // Leeren heißt „keine Angabe“: `null` leert am Server (PATCH dreiwertig).
              gefahrenart: daten.gefahrenart ?? null,
              schadensgrad: daten.schadensgrad ?? null,
              ort: ort.text ?? '',
              // Das Paar nur bei Änderung: ein „Auf Karte verorten“ von anderswo bleibt sonst stehen.
              ...(ort.lat !== vorher.lat || ort.lon !== vorher.lon
                ? { lat: ort.lat, lon: ort.lon }
                : {}),
              beschreibung: daten.beschreibung,
              // Geschädigt XOR: immer alle vier Felder explizit senden (das nicht gewählte ist null).
              ...geschaedigtFelder(daten.geschaedigt ?? null, orgId),
            };
            const fassung = schutz.fassung();
            editMutation.mutate(
              { daten: patch, basis: sitzung.basis },
              { onSuccess: () => schutz.gespeichert(fassung) },
            );
          }}
        >
          {detailAnsicht}
          {editFehler != null && (
            <div style={{ marginTop: 16 }}>
              <SpeicherFehler fehler={editFehler} />
            </div>
          )}
          {/* Stehende Leiste im `<form>` (`frontend/AGENTS.md`, „Formularseiten“): bei langer
              Beschreibung scrollten die Knöpfe sonst aus dem Bild. */}
          <div {...speicherLeiste} style={{ ...speicherLeiste.style, marginTop: 16 }}>
            <Button type="primary" htmlType="submit" loading={editMutation.isPending}>
              Speichern
            </Button>
            {/* Bis zur Antwort gesperrt: ihre Ablehnung braucht das Formular als Ort. */}
            <Button disabled={editMutation.isPending} onClick={editSitzung.beende}>
              Abbrechen
            </Button>
          </div>
        </Form>
      ) : (
        detailAnsicht
      )}

      {/* Fotos und Dateien: unter dem Datenraster und außerhalb des Bearbeiten-<Form> — der
          Ablegen-Dialog trägt ein eigenes Formular, verschachtelt schickte es beim Absenden das
          äußere nativ ab. Im Bearbeiten-Modus bleibt es sichtbar. */}
      <div style={{ marginTop: 16 }}>
        <SchadenAnhaenge einsatzId={einsatzId} schaden={s} darfSchreiben={darfSchreiben} />
      </div>

      {/* Beide Status-Dialoge auf der Erfassungshülle (`frontend/AGENTS.md`, Erfassungs-Norm). */}
      <ErfassungsModal<{ uebergeben_an: string }>
        offen={uebergebenOffen}
        titel="Schaden übergeben"
        form={uebergebForm}
        erfassenText={UEBERGEBEN.label}
        laeuft={uebergebMutation.isPending}
        speicherung={uebergebMutation}
        speicherFehlerTitel="Nicht übergeben"
        speicherFehlerFallback="Übergeben fehlgeschlagen"
        onErfassen={(v) => uebergebMutation.mutateAsync(v.uebergeben_an)}
        onFertig={() => setUebergebenOffen(false)}
        onAbbrechen={() => setUebergebenOffen(false)}
      >
        <Form.Item
          label="Übergeben an"
          name="uebergeben_an"
          rules={[{ required: true, message: 'Adressat ist Pflicht' }]}
        >
          <Input placeholder="z. B. Stadtwerke, Bauhof, Umweltamt" />
        </Form.Item>
      </ErfassungsModal>

      <ErfassungsModal<{ abschluss_grund: string; notiz?: string }>
        offen={abschlussOffen}
        titel="Schaden abschließen"
        form={abschlussForm}
        erfassenText={ABSCHLIESSEN.label}
        laeuft={abschlussMutation.isPending}
        speicherung={abschlussMutation}
        speicherFehlerTitel="Nicht abgeschlossen"
        speicherFehlerFallback="Abschließen fehlgeschlagen"
        onErfassen={(v) => abschlussMutation.mutateAsync(v)}
        onFertig={() => setAbschlussOffen(false)}
        onAbbrechen={() => setAbschlussOffen(false)}
      >
        <Form.Item
          label="Abschlussgrund"
          name="abschluss_grund"
          rules={[{ required: true, message: 'Grund ist Pflicht' }]}
        >
          <Select options={ABSCHLUSS_GRUENDE} />
        </Form.Item>
        <Form.Item label="Notiz (optional)" name="notiz">
          <Input.TextArea rows={2} />
        </Form.Item>
      </ErfassungsModal>

      {/* Wartet auf die Antwort: schließt erst beim Erfolg, bis dahin sind die Auswege gesperrt,
          und eine Ablehnung steht in ihr (Vorbild `PersonenDetailPage.tsx`). */}
      <Modal
        open={stornoOffen}
        title={`Schaden ${kennung} stornieren?`}
        okText="Schaden stornieren"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true }}
        confirmLoading={stornoMutation.isPending}
        cancelButtonProps={{ disabled: stornoMutation.isPending }}
        closable={stornoMutation.isPending ? { disabled: true } : true}
        mask={{ closable: !stornoMutation.isPending }}
        keyboard={!stornoMutation.isPending}
        onOk={() => stornoMutation.mutate()}
        onCancel={() => {
          if (stornoMutation.isPending) return;
          // Abbrechen räumt den Grund; das nächste Öffnen beginnt ohne ihn.
          if (stornoMutation.error != null) stornoMutation.reset();
          setStornoFuer(null);
        }}
      >
        Der Schaden verschwindet aus der Liste. Das Einsatztagebuch vermerkt das Stornieren.
        {stornoMutation.error != null && (
          <div style={{ marginTop: 16 }}>
            <SpeicherFehler
              fehler={stornoMutation.error}
              titel="Nicht storniert"
              fallback="Stornieren fehlgeschlagen"
            />
          </div>
        )}
      </Modal>
    </EinsatzSeite>
  );
}
