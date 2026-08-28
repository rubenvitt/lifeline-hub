import { App, Breadcrumb, Button, Checkbox, DatePicker, Flex, Form, Input, Space, Spin, Tag, Typography, theme } from 'antd';
import type { Dayjs } from 'dayjs';
import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { parseRouteId, lageberichtePfad, lageberichtDetailPfad, etbPfad } from '../routing/deeplinks';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import {
  aktualisiereLagebericht,
  gibLageberichtFrei,
  ladeLagebericht,
  schreibeLageberichtFort,
} from '../api/lageberichte';
import type { LageberichtAbschnitt, LageberichtAnzeige } from '../api/types';
import { vorlage } from '../lageberichte/vorlagen';
import { AbschnittsAkkordeon, befuellteAbschnitte } from '../lageberichte/AbschnittsAkkordeon';
import Markdown from '../components/Markdown';
import MarkdownEditor from '../components/MarkdownEditor';
import { useEntwurfVerlustschutz } from '../entwurf/useEntwurfVerlustschutz';
import { alsBackendZeit, alsOrtszeit } from '../etb/filterZeit';
import './lageberichtPrint.css';

/**
 * Formularwerte des Entwurfs: Titel, Zeitstand (lokale Picker-Zeit, UTC erst beim Senden —
 * `etb/filterZeit.ts`) und je Abschnitt der Markdown-Text unter seinem Schlüssel.
 */
type FormWerte = { titel: string; zeitstand?: Dayjs } & Record<string, string | Dayjs | undefined>;

export default function LageberichtDetailPage() {
  const { lbId } = useParams();
  // Remount je Bericht: der Verlustschutz-Merker gehört zu EINEM Datensatz. Ohne den Key
  // trüge ein Routenwechsel auf dieselbe Komponente (Fortschreiben → neuer Entwurf) den
  // Riegel des alten Berichts mit und hielte den neuen Serverstand fern (getestet).
  return <LageberichtDetail key={lbId} />;
}

function LageberichtDetail() {
  const { id, lbId } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const berichtId = Number(lbId);
  const idGueltig = parseRouteId(lbId) != null;
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form] = Form.useForm<FormWerte>();
  const { token } = theme.useToken();
  // Alle Werte beobachten: die Leer-Marke je Kopfzeile folgt dem Tippen, nicht dem Speichern.
  const werte = Form.useWatch([], form) as Record<string, unknown> | undefined;
  /**
   * Genau EIN offener Abschnitt — und die Vorschau nur auf Wunsch NEBEN dem Text (H62).
   * Bestand: acht Split-Editoren à acht Zeilen, 2108 px Scrollstrecke, keine Navigation.
   * „Vorschau neben dem Text" ist eine EINSTELLUNG, keine Aktion, und steht deshalb in
   * einer eigenen Zeile über den Abschnitten, nicht in der Knopfreihe — Vorgabe AUS.
   */
  const [offenerAbschnitt, setOffenerAbschnitt] = useState<string | null>(null);
  const [vorschauNeben, setVorschauNeben] = useState(false);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const berichtQuery = useQuery({
    queryKey: einsatzKeys.lagebericht(einsatzId, berichtId),
    queryFn: () => ladeLagebericht(einsatzId, berichtId),
    enabled: idGueltig,
  });
  // Vor den frühen Rückgaben (Hook-Reihenfolge); `vorlage()` liefert je Schlüssel dasselbe
  // Objekt aus `VORLAGEN`, die Abhängigkeit ist also stabil.
  const vorlageDef = berichtQuery.data ? vorlage(berichtQuery.data.vorlage) : undefined;
  const befuellt = useMemo(
    () => befuellteAbschnitte(werte, vorlageDef?.abschnitte ?? []),
    [werte, vorlageDef],
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: einsatzKeys.lagebericht(einsatzId, berichtId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.lageberichte(einsatzId) });
  };
  const fehler = (e: unknown) =>
    message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  // Persistiert die aktuellen Formularwerte als Entwurf (ohne Erfolgs-Toast) — von der
  // „Entwurf speichern"-Mutation und vom Freigabe-Flow gemeinsam genutzt.
  const speichern = (werte: FormWerte) => {
    const v = vorlage(berichtQuery.data!.vorlage)!;
    const abschnitte: LageberichtAbschnitt[] = v.abschnitte.map((a) => {
      const text = werte[a.schluessel];
      return { schluessel: a.schluessel, text: typeof text === 'string' ? text : '' };
    });
    return aktualisiereLagebericht(einsatzId, berichtId, {
      titel: werte.titel,
      // Leer gelassen → Feld nicht mitschicken; das Backend behält den Bestandswert.
      ...(werte.zeitstand ? { zeitstand: alsBackendZeit(werte.zeitstand) } : {}),
      abschnitte,
    });
  };

  /**
   * Riegel gegen den Fremd-Refetch (Befund H63), Autosave (30 s + Blur) und Reload-Warner —
   * derselbe Hook wie in `BefehlDetailPage`, Begründungen in
   * `entwurf/useEntwurfVerlustschutz.ts`. Das Ticket verlangte einen Effekt an `bericht.id`
   * mit `isFieldsTouched()`-Guard; gebaut ist der C7-Mechanismus, weil `isFieldsTouched` nach
   * dem Speichern nie zurückfällt.
   */
  const schutz = useEntwurfVerlustschutz<LageberichtAnzeige, FormWerte>({
    daten: berichtQuery.data,
    istEntwurf: berichtQuery.data?.status === 'entwurf',
    form,
    werteAus: (b) => {
      const werte: FormWerte = { titel: b.titel, zeitstand: alsOrtszeit(b.zeitstand) };
      for (const a of b.abschnitte) werte[a.schluessel] = a.text;
      return werte;
    },
    speichern,
    onFehler: fehler,
    onGespeichert: invalidate,
  });

  const speichernMutation = useMutation({
    mutationFn: speichern,
    onSuccess: () => {
      schutz.quittiereGespeichert();
      invalidate();
      message.success('Entwurf gespeichert');
    },
    onError: fehler,
  });

  const freigebenMutation = useMutation({
    mutationFn: () => gibLageberichtFrei(einsatzId, berichtId),
    onSuccess: () => {
      invalidate();
      message.success('Bericht freigegeben');
    },
    onError: fehler,
  });

  const fortschreibenMutation = useMutation({
    mutationFn: () => schreibeLageberichtFort(einsatzId, berichtId),
    onSuccess: (neu: LageberichtAnzeige) => {
      qc.invalidateQueries({ queryKey: einsatzKeys.lageberichte(einsatzId) });
      navigate(lageberichtDetailPfad(einsatzId, neu.id));
    },
    onError: fehler,
  });

  // Deeplink-Robustheit (LFH-25): ungültige Lagebericht-ID → zurück zur Liste.
  if (!idGueltig) {
    return <Navigate to={lageberichtePfad(einsatzId)} replace />;
  }
  if (einsatzQuery.isLoading || berichtQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (berichtQuery.isError || !berichtQuery.data || !einsatzQuery.data) {
    return <Typography.Text type="danger">Lagebericht nicht gefunden.</Typography.Text>;
  }
  const einsatz = einsatzQuery.data;
  const bericht = berichtQuery.data;
  const v = vorlage(bericht.vorlage);
  const istEntwurf = bericht.status === 'entwurf';
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  const freigabeBestaetigen = async () => {
    // Pflichtfelder VOR dem Dialog prüfen — sonst landet ein Titel-Fehler hinter dem Modal.
    let werte: FormWerte;
    try {
      werte = await form.validateFields();
    } catch {
      return; // Validierungsfehler werden am Formular angezeigt.
    }
    modal.confirm({
      title: 'Lagebericht freigeben?',
      content:
        'Die Freigabe ist endgültig und unveränderlich: Der Bericht wird als ETB-Eintrag gesnapshottet. Korrekturen sind danach nur per Fortschreibung möglich.',
      okText: 'Freigeben',
      cancelText: 'Abbrechen',
      onOk: async () => {
        // /freigeben validiert den persistierten DB-Stand, nicht den Editor-Inhalt:
        // den aktuellen Inhalt erst speichern, sonst wird ein eben befüllter Entwurf
        // fälschlich als „leer" abgelehnt (und ungespeicherte Edits gingen verloren).
        try {
          await speichern(werte);
        } catch (e) {
          fehler(e);
          throw e; // Dialog offen lassen, Freigabe nicht auslösen.
        }
        // Sonst bliebe der Merker nach der endgültigen Freigabe stehen und der Browser
        // fragte beim Neuladen nach Änderungen an einem Bericht, der nicht mehr editierbar
        // ist (Review LFH-348).
        schutz.quittiereGespeichert();
        await freigebenMutation.mutateAsync();
      },
    });
  };

  return (
    <div className="lagebericht-print-root">
      <Breadcrumb
        className="lagebericht-no-print"
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: <Link to={lageberichtePfad(einsatzId)}>Lageberichte</Link> },
          { title: bericht.titel },
        ]}
      />
      {/* Umbruchfähige Kopfzeile nach dem Muster von `BefehlDetailPage` (C8/M73): ohne
          `wrap` schob der Titel auf 390 px die Aktionen aus dem sichtbaren Bereich. */}
      <Flex
        className="lagebericht-no-print"
        justify="space-between"
        align="center"
        gap={16}
        wrap
        style={{ marginBottom: 16 }}
      >
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {bericht.titel}
          </Typography.Title>
          <Space size={6} wrap style={{ marginTop: 4 }}>
            <Tag color={istEntwurf ? 'default' : 'green'}>{istEntwurf ? 'Entwurf' : 'Freigegeben'}</Tag>
            <Tag>{v?.label ?? bericht.vorlage}</Tag>
            <Tag>v{bericht.version}</Tag>
          </Space>
        </div>
        <Space wrap>
          <Button onClick={() => window.print()}>Drucken / als PDF</Button>
          {!istEntwurf && bericht.etb_eintrag_id != null && (
            <Link to={etbPfad(einsatzId, { eintrag: bericht.etb_eintrag_id })}>Zum ETB-Eintrag</Link>
          )}
          {!istEntwurf && darfSchreiben && (
            <Button onClick={() => fortschreibenMutation.mutate()} loading={fortschreibenMutation.isPending}>
              Fortschreiben
            </Button>
          )}
          {istEntwurf && darfSchreiben && (
            <>
              {/* Der sichtbare Beleg des stillen Autosave. Ohne ihn wäre „gespeichert"
                  von „nicht gespeichert" nicht zu unterscheiden. */}
              <Typography.Text type="secondary">
                {schutz.ungespeichert
                  ? 'ungespeicherte Änderungen'
                  : schutz.zuletztGespeichert && `zuletzt gespeichert ${schutz.zuletztGespeichert}`}
              </Typography.Text>
              <Button onClick={() => form.submit()} loading={speichernMutation.isPending}>
                Entwurf speichern
              </Button>
              <Button type="primary" onClick={freigabeBestaetigen} loading={freigebenMutation.isPending}>
                Freigeben
              </Button>
            </>
          )}
        </Space>
      </Flex>

      {/* Im Entwurf trägt das Picker-Feld den Zeitstand — ein roher UTC-Wirestring direkt
          über einem Feld in Ortszeit zeigte zwei Uhrzeiten für denselben Wert. Die
          Formatierung des Lesezweigs liegt bei LFH-350 (F2). */}
      {!(istEntwurf && darfSchreiben) && (
        <Typography.Paragraph type="secondary">Zeitstand: {bericht.zeitstand}</Typography.Paragraph>
      )}

      {istEntwurf && darfSchreiben ? (
        <Form
          form={form}
          layout="vertical"
          onValuesChange={schutz.markiereGeaendert}
          // Zweiter Auslöser neben der Frist: ein verlassenes Feld ist der Moment, in dem
          // ein Abschnitt fertig gedacht ist. `onBlur` steigt aus den Feldern auf.
          onBlur={schutz.autosaveJetzt}
          onFinish={(werte) => speichernMutation.mutate(werte as FormWerte)}
        >
          <Form.Item label="Titel" name="titel" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          {/* Das Backend nimmt den Zeitstand seit jeher (`routes/lagebericht.rs`), nur die
              UI bot ihn nirgends an (N23). Picker in Ortszeit, Wire in UTC — `etb/filterZeit`. */}
          <Form.Item label="Zeitstand" name="zeitstand">
            {/* Nicht löschbar: `zeitstand` ist serverseitig nicht nullbar, ein leeres Feld
                würde beim Speichern weggelassen und zeigte dauerhaft etwas anderes als die DB. */}
            <DatePicker showTime allowClear={false} format="DD.MM.YYYY HH:mm" style={{ width: '100%' }} />
          </Form.Item>
          <Checkbox
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
              offen={offenerAbschnitt ?? v.abschnitte[0].schluessel}
              onOffen={setOffenerAbschnitt}
              editor={(a) => (
                // Die Kopfzeile trägt den Namen sichtbar; das Etikett des Feldes bleibt für
                // die Zugänglichkeit (Label-Verknüpfung), steht aber nicht ein zweites Mal da.
                <Form.Item label={a.label} name={a.schluessel} labelCol={{ style: { display: 'none' } }}>
                  <MarkdownEditor
                    layout={vorschauNeben ? 'split' : 'toggle'}
                    variante="dokument"
                    autoSize={{ minRows: 6 }}
                  />
                </Form.Item>
              )}
            />
          )}
        </Form>
      ) : (
        <div className="lagebericht-druck">
          {v?.abschnitte.map((a) => {
            const text = bericht.abschnitte.find((x) => x.schluessel === a.schluessel)?.text ?? '';
            return (
              <section key={a.schluessel} style={{ marginBottom: 16 }}>
                <Typography.Title level={5}>{a.label}</Typography.Title>
                {text.trim()
                  ? <Markdown variante="dokument">{text}</Markdown>
                  : <Typography.Paragraph>—</Typography.Paragraph>}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
