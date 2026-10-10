import StatusTag from '../components/StatusTag';
import { useSprungSperre } from '../einsatz/useSprungSperre';
import { Alert, App, Breadcrumb, Button, Form, Input, Popconfirm, Space, Spin, Tag } from 'antd';
import { SCHADEN_BESCHREIBUNG_MAX, SCHADEN_ORT_MAX } from '../api/eingabegrenzen';
import { zeichenGrenze, zeichenRegel } from '../components/zeichenGrenze';
import EinsatzSeite from '../components/EinsatzSeite';
import { monoStil } from '../components/instrument';
import { Select } from '../components/Select';
import { SeitenFehler } from '../components/SeitenZustand';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
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
import type { Ausmass, SchadenTyp } from '../api/types';
import GeschaedigtPicker, { type GeschaedigtWert } from './schaeden/GeschaedigtPicker';
import SchadenDaten from './schaeden/SchadenDaten';
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
import { SeitenHinweise, SpeicherFehler } from '../components/SpeicherHinweis';
import { ErfassungsModal } from '../components/Erfassung';

const TYP_OPTIONS = (Object.keys(TYP_LABEL) as SchadenTyp[]).map((t) => ({
  value: t,
  label: TYP_LABEL[t],
}));
const AUSMASS_OPTIONS = (Object.keys(AUSMASS_META) as Ausmass[]).map((a) => ({
  value: a,
  label: AUSMASS_META[a].label,
}));

type EditWerte = SchadenPatch & { geschaedigt?: GeschaedigtWert };

export default function SchaedenDetailPage() {
  const { id, schadenId: schadenIdParam } = useParams();
  const einsatzId = Number(id);
  // Verortungsauftrag nur in eine freie Lagekarte (LFH-888, design.md D4).
  const karteGesperrt = useSprungSperre(einsatzId)('lagekarte');
  const { benutzer } = useAuth();
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
  const [uebergebenOffen, setUebergebenOffen] = useState(false);
  const [abschlussOffen, setAbschlussOffen] = useState(false);
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
    onSuccess: () => {
      invalidate();
      navigate(schaedenPfad(einsatzId));
    },
  });

  /*
   * Jede Ablehnung steht an ihrem Ort, kein Toast (LFH-1077, `frontend/AGENTS.md`, „Rückwege und
   * Fehler“): Bearbeiten am Formular, Übergeben und Abschließen im Dialog, Storno im
   * Seitenhinweis. Den Sperrkonflikt beantwortet weiter der Konfliktdialog.
   */
  const sperrkonflikt = istKonflikt(editMutation.error) && !editMutation.variables?.overwrite;
  const editFehler = sperrkonflikt ? null : editMutation.error;

  // Die Route hat keinen `key`: der Wechsel zu einem anderen Schaden behält die Seite, nicht die
  // Gründe.
  const { reset: editReset } = editMutation;
  const { reset: stornoReset } = stornoMutation;
  useEffect(() => {
    editReset();
    stornoReset();
  }, [schadenId, editReset, stornoReset]);

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

  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  // Eine Eingabe-Zelle: im Edit-Modus ein noStyle-Form.Item an der Stelle der Anzeige — dasselbe
  // Datenraster bleibt stehen. Die Regeln bleiben am Formular der Seite.
  const feld = (name: string, input: React.ReactNode, rules?: object[]) => (
    <Form.Item name={name} noStyle rules={rules}>
      {input}
    </Form.Item>
  );

  const detailAnsicht = (
    <SchadenDaten
      schaden={s}
      einsatzId={einsatzId}
      verortenLink={darfSchreiben}
      karteGesperrt={karteGesperrt}
      eingabe={
        bearbeiten
          ? {
              typ: feld('typ', <Select style={{ minWidth: 200 }} options={TYP_OPTIONS} />),
              ausmass: feld(
                'ausmass',
                <Select style={{ minWidth: 160 }} options={AUSMASS_OPTIONS} />,
              ),
              ort: feld(
                'ort',
                <Input
                  placeholder="z. B. Hauptstr. 17 oder L 235 km 12,5"
                  maxLength={SCHADEN_ORT_MAX}
                />,
                [{ required: true, message: 'Ort ist Pflicht' }],
              ),
              // Eine ältere, längere Beschreibung bleibt stehen: der Zähler nennt die Überlänge,
              // Speichern scheitert an der Regel, bis gekürzt ist (LFH-937, design.md Risiken).
              beschreibung: feld(
                'beschreibung',
                <Input.TextArea rows={2} count={zeichenGrenze(SCHADEN_BESCHREIBUNG_MAX)} />,
                [zeichenRegel(SCHADEN_BESCHREIBUNG_MAX, 'Beschreibung')],
              ),
              geschaedigt: feld(
                'geschaedigt',
                <GeschaedigtPicker
                  einsatzId={einsatzId}
                  orgName={einsatz.org_name ?? 'Eigene Organisation'}
                />,
              ),
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
            { title: schadenRegistrierAnzeige(s.registrier_nr) },
          ]}
        />
      }
      titel={
        <Space wrap size={8}>
          <span>
            Schaden{' '}
            <span style={monoStil(14, 500)}>{schadenRegistrierAnzeige(s.registrier_nr)}</span>
          </span>
          <StatusTag darstellung={STATUS_META[s.status]} />
          {s.storniert_at && <Tag color="default">storniert</Tag>}
        </Space>
      }
      dataUpdatedAt={detailQuery.dataUpdatedAt}
      aktionen={
        <Space wrap>
          {darfSchreiben && !s.storniert_at && !bearbeiten && (
            <Space wrap size="middle">
              <Button disabled={s.status !== 'offen'} onClick={() => setUebergebenOffen(true)}>
                Übergeben
              </Button>
              <Button
                disabled={s.status === 'abgeschlossen'}
                onClick={() => setAbschlussOffen(true)}
              >
                Abschließen
              </Button>
              <Button
                onClick={() => {
                  if (!editMutation.isPending) editMutation.reset();
                  editSitzung.starte(s, {
                    typ: s.typ,
                    ausmass: s.ausmass,
                    ort: s.ort,
                    beschreibung: s.beschreibung,
                    geschaedigt: geschaedigtAusSchaden(s),
                  });
                }}
              >
                Bearbeiten
              </Button>
              <Popconfirm
                title="Schaden stornieren?"
                onConfirm={() => stornoMutation.mutate()}
                okText="Stornieren"
                okButtonProps={{ danger: true }}
              >
                <Button danger>Stornieren</Button>
              </Popconfirm>
            </Space>
          )}
          <Button onClick={() => navigate(zurueck)}>Zurück zur Liste</Button>
        </Space>
      }
      // Nur mit Inhalt gesetzt: ein leerer Slot rendert in `EinsatzSeite` trotzdem seinen Rahmen.
      hinweis={
        stornoMutation.error != null && (
          <SeitenHinweise
            fehler={stornoMutation.error}
            fehlerTitel="Nicht storniert"
            fehlerFallback="Stornieren fehlgeschlagen"
          />
        )
      }
    >
      {sitzung ? (
        <Form
          form={editForm}
          onFinish={(daten) => {
            const patch: SchadenPatch = {
              typ: daten.typ,
              ausmass: daten.ausmass,
              ort: daten.ort,
              beschreibung: daten.beschreibung,
              // Geschädigt XOR: immer alle vier Felder explizit senden (das nicht gewählte ist null).
              ...geschaedigtFelder(daten.geschaedigt ?? null, orgId),
            };
            editMutation.mutate({ daten: patch, basis: sitzung.basis });
          }}
        >
          {detailAnsicht}
          {editFehler != null && (
            <div style={{ marginTop: 16 }}>
              <SpeicherFehler fehler={editFehler} />
            </div>
          )}
          <Space style={{ marginTop: 16 }}>
            <Button type="primary" htmlType="submit" loading={editMutation.isPending}>
              Speichern
            </Button>
            {/* Bis zur Antwort gesperrt: ihre Ablehnung braucht das Formular als Ort. */}
            <Button disabled={editMutation.isPending} onClick={editSitzung.beende}>
              Abbrechen
            </Button>
          </Space>
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
        erfassenText="Übergeben"
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
        erfassenText="Abschließen"
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
    </EinsatzSeite>
  );
}
