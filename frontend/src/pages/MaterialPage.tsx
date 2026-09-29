import {
  Alert,
  App,
  Breadcrumb,
  Button,
  Collapse,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Space,
  Tag,
} from 'antd';
import EinsatzSeite from '../components/EinsatzSeite';
import { Select } from '../components/Select';
import { BemerkungZelle } from '../components/BemerkungZelle';
import { ErfassungsModal } from '../components/Erfassung';
import Datensicht, { spaltenFuer } from '../components/Datensicht';
import {
  nichtGefundenInhalt,
  SeitenFehler,
  SeitenSkeleton,
  SeitenStandVeraltet,
} from '../components/SeitenZustand';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { listeMaterial } from '../api/material';
import {
  aktualisiereDisposition,
  disponiereAdhoc,
  disponiereMaterial,
  entferneDisposition,
  listeEinsatzMaterial,
  type MaterialAdhocEingabe,
} from '../api/einsatzMaterial';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { EinsatzMaterial, MaterialStatus } from '../api/types';
import { kraefteuebersichtPfad } from '../routing/deeplinks';
import Verdichtungszeile from '../kraefte/Verdichtungszeile';
import StatusWahl, { type StatusOption } from '../components/StatusWahl';
import { einsatzStatus, materialStatus, type StatusDarstellung } from '../theme/statusFarben';
import StatusTag from '../components/StatusTag';
import { useFehlerMeldung } from '../components/useFehlerMeldung';
import { useOptimistischesZeilenUpdate } from '../kraefte/useOptimistischesZeilenUpdate';

/**
 * Die Farbentscheidung für den Materialstatus liegt in `theme/statusFarben.ts` (`materialStatus`).
 * Diese Datei hält nur Reihenfolge und Filterwerte, abgeleitet aus der Vertragskarte — ein
 * Behandlungsweg für dieses Enum, gemeinsam mit `pages/uhs/MaterialTab.tsx`.
 */
const STATUS_REIHENFOLGE = Object.keys(materialStatus) as MaterialStatus[];

/** Menüwerte mit `darstellung` — der Farbpunkt im Statusmenü kommt aus dem Vertrag. */
const STATUS_OPTIONEN: StatusOption<MaterialStatus>[] = STATUS_REIHENFOLGE.map((s) => ({
  wert: s,
  label: materialStatus[s].label,
  darstellung: materialStatus[s],
}));

function statusDarstellung(em: EinsatzMaterial): StatusDarstellung {
  return materialStatus[em.status];
}
/** Filterwerte auf der eigenen Materialachse (fünf Werte), nicht auf der Kräfte-Kategorie. */
const STATUS_FILTER_WERTE = STATUS_REIHENFOLGE.map((s) => ({
  value: s,
  text: materialStatus[s].label,
}));

/** Inline-Mengen-Editor: lokaler Zustand, committet erst bei Blur/Enter (min 1). */
function MengeZelle({ em, onChange }: { em: EinsatzMaterial; onChange: (menge: number) => void }) {
  const [wert, setWert] = useState<number>(em.menge);
  const pendingRef = useRef(false);
  useEffect(() => {
    setWert(em.menge);
    pendingRef.current = false;
  }, [em.menge]);
  const commit = () => {
    if (pendingRef.current || wert < 1 || wert === em.menge) return;
    pendingRef.current = true;
    onChange(wert);
  };
  return (
    // Die Höhe kommt aus `controlHeight` und zieht mit der Dichtestufe mit. Die Breite bleibt fest:
    // sie trägt eine zweistellige Menge, keine Trefffläche.
    <InputNumber
      min={1}
      style={{ width: 80 }}
      value={wert}
      onChange={(v) => setWert(v ?? 1)}
      onBlur={commit}
      onPressEnter={commit}
    />
  );
}

export default function MaterialPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [adhocOffen, setAdhocOffen] = useState(false);
  const [form] = Form.useForm<MaterialAdhocEingabe & { menge: number }>();
  const [poolAuswahl, setPoolAuswahl] = useState<number | null>(null);
  const [poolMenge, setPoolMenge] = useState<number>(1);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const emQuery = useQuery({
    queryKey: einsatzKeys.material(einsatzId),
    queryFn: () => listeEinsatzMaterial(einsatzId),
  });
  const poolQuery = useQuery({
    queryKey: globalKeys.materialListe('im-dienst'),
    queryFn: () => listeMaterial(true),
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.material(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  const fehler = useFehlerMeldung();

  const disponiereMutation = useMutation({
    mutationFn: (v: { materialId: number; menge: number }) =>
      disponiereMaterial(einsatzId, v.materialId, v.menge),
    onSuccess: () => {
      message.success('Material disponiert');
      invalidate();
      setPoolAuswahl(null);
      setPoolMenge(1);
    },
    onError: fehler,
  });
  const adhocMutation = useMutation({
    mutationFn: (w: MaterialAdhocEingabe & { menge: number }) =>
      disponiereAdhoc(
        einsatzId,
        {
          bezeichnung: w.bezeichnung,
          kategorie: w.kategorie,
          bestandsnummer: w.bestandsnummer,
          traegerorganisation: w.traegerorganisation,
        },
        w.menge ?? 1,
      ),
    // Nur invalidieren und melden: geschlossen wird über `onFertig`, geleert von der
    // Erfassungshülle auf allen Wegen, auch beim Abbrechen.
    onSuccess: () => {
      invalidate();
      message.success('Ad-hoc-Material disponiert');
    },
    onError: fehler,
  });
  const mengeMutation = useMutation({
    mutationFn: (v: { emId: number; menge: number }) =>
      aktualisiereDisposition(einsatzId, v.emId, { menge: v.menge }),
    onSuccess: invalidate,
    onError: fehler,
  });
  const statusMutation = useOptimistischesZeilenUpdate<
    EinsatzMaterial,
    { emId: number; status: MaterialStatus }
  >({
    queryKey: einsatzKeys.material(einsatzId),
    mutationFn: (v) => aktualisiereDisposition(einsatzId, v.emId, { status: v.status }),
    zeilenId: (v) => v.emId,
    anwenden: (em, v) => ({ ...em, status: v.status }),
    nochOptimistisch: (em, v) => em.status === v.status,
    zuruecknehmen: (em, vorher) => ({ ...em, status: vorher.status }),
    onFehler: fehler,
    onSettled: invalidate,
  });
  const bemerkungMutation = useMutation({
    mutationFn: (v: { emId: number; bemerkung: string }) =>
      aktualisiereDisposition(einsatzId, v.emId, { bemerkung: v.bemerkung }),
    onSuccess: invalidate,
    onError: fehler,
  });
  const entfernenMutation = useMutation({
    mutationFn: (emId: number) => entferneDisposition(einsatzId, emId),
    onSuccess: invalidate,
    onError: fehler,
  });

  // Seitenzustand: nur `einsatzQuery` — ohne sie tragen weder Breadcrumb noch
  // `darfImEinsatzSchreiben` etwas. Alles andere wird an Ort und Stelle entschieden, nie als
  // Frühausstieg.
  if (einsatzQuery.isLoading) {
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
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  const ems = emQuery.data ?? [];

  /**
   * Gemeinsamer Bedienweg für Tabellen- und Kartenzweig (Herleitung in `FahrzeugePage.tsx`). Ohne
   * `farbe`: `materialStatus` kennt keine Mandantenfarbe (nur `rolle` + `label`).
   */
  const statusBedienungVon = (em: EinsatzMaterial) => {
    const laeuft = statusMutation.isPending && statusMutation.variables?.emId === em.id;
    return {
      optionen: STATUS_OPTIONEN,
      aktuell: laeuft ? statusMutation.variables?.status : em.status,
      kennung: em.bezeichnung,
      laeuft,
      gesperrt: statusMutation.isPending,
      onWaehlen: (wert: string | number) => {
        if (!statusMutation.isPending) {
          statusMutation.mutate({ emId: em.id, status: wert as MaterialStatus });
        }
      },
    };
  };

  /**
   * Listenzustand — der Fehler allein reicht als Bedingung nicht. Ohne Zeilen im Zwischenspeicher
   * tritt der Fehler an die Stelle der Datensicht, sonst behauptete „Noch kein Material disponiert"
   * eine leere Disposition. Mit Zeilen bleiben sie stehen und bekommen ein Banner: echt, nur
   * womöglich alt.
   *
   * Gemessen an `ems`, der ungefilterten Menge: Suche und Filter leben im Primitiv; an ihrer
   * Restmenge gemessen kippte die Seite bei jedem engen Filter in den Fehlerzweig.
   */
  const listeGescheitert = emQuery.isError && ems.length === 0;
  const standVeraltet = emQuery.isError && ems.length > 0;

  // Kein Dedup wie bei Fahrzeugen: dieselbe Material-Art darf mehrfach als getrennte Position
  // disponiert werden (Mengen-Splitting auf Einheiten).
  const poolOptionen = (poolQuery.data ?? []).map((m) => ({
    value: m.id,
    label: `${m.bezeichnung}${m.kategorie ? ` (${m.kategorie})` : ''}`,
  }));

  /**
   * Was ein leeres Auswahlfeld bedeutet, hängt daran, ob die Liste ankam. Scheitert der Abruf,
   * bleibt `poolOptionen` leer, und das Feld behauptete „Kein Material im Dienst". Ohne Fehler
   * bleibt der Bestandswortlaut.
   *
   * Kein `kein403`: die Material-Route ist org-lesbar ohne Admin-Schranke.
   */
  const poolInhalt =
    nichtGefundenInhalt(poolQuery, {
      allgemein: 'Materialliste konnte nicht geladen werden',
    }) ?? 'Kein Material im Dienst';

  /**
   * Kategoriefilter aus den eigenen Daten; `undefined` ohne Werte. Das Feld erscheint erst mit dem
   * ersten gepflegten Wert — ein dauerhaft leeres Filterfeld sieht wie ein Werkzeug aus und ist
   * keins.
   */
  const kategorieWerte = [...new Set(ems.map((m) => m.kategorie).filter((k): k is string => !!k))]
    .sort()
    .map((k) => ({ text: k, value: k }));
  const kategorieFilter =
    kategorieWerte.length > 0
      ? { werte: kategorieWerte, trifft: (m: EinsatzMaterial, w: string) => m.kategorie === w }
      : undefined;

  /**
   * Spaltenregister der Materialseite. `EinsatzMaterialAnzeige` hat kein `status_kategorie`;
   * gruppiert und gefiltert wird auf der eigenen Fünf-Werte-Achse (`MaterialStatus`), dieselbe
   * Grenze wie in `filtereKraefte`.
   */
  const spalten = spaltenFuer<EinsatzMaterial>()([
    {
      title: 'Bezeichnung',
      key: 'bezeichnung',
      immerSichtbar: true,
      sortWert: (m) => m.bezeichnung,
      suchText: (m) => m.bezeichnung,
      render: (_, em) => (
        <Space>
          {em.bezeichnung}
          {em.ist_adhoc && <Tag color="blue">ad-hoc</Tag>}
        </Space>
      ),
    },
    {
      title: 'Kategorie',
      dataIndex: 'kategorie',
      key: 'kategorie',
      filter: kategorieFilter,
      suchText: (m) => m.kategorie,
      render: (t) => t ?? '—',
    },
    {
      title: 'Menge',
      key: 'menge',
      sortWert: (m) => m.menge,
      render: (_, em) =>
        darfSchreiben ? (
          // `MengeZelle` bleibt, wie sie ist.
          <MengeZelle em={em} onChange={(menge) => mengeMutation.mutate({ emId: em.id, menge })} />
        ) : (
          em.menge
        ),
    },
    {
      title: 'Status',
      key: 'status',
      filter: { werte: STATUS_FILTER_WERTE, trifft: (m, w) => m.status === w },
      // Kein `Select` mit Mindestbreite (die 390-px-Karte scheiterte daran). Deskriptor ganz
      // gespreizt — Herleitung in `FahrzeugePage.tsx`.
      render: (_, em) => (
        <StatusWahl
          darstellung={statusDarstellung(em)}
          darfSchreiben={darfSchreiben}
          {...statusBedienungVon(em)}
        />
      ),
    },
    {
      title: 'Bemerkung',
      key: 'bemerkung',
      render: (_, em) => (
        <BemerkungZelle
          wert={em.bemerkung}
          kennung={em.bezeichnung}
          darfSchreiben={darfSchreiben}
          onSpeichern={(val) => bemerkungMutation.mutate({ emId: em.id, bemerkung: val })}
        />
      ),
    },
    ...(darfSchreiben
      ? [
          {
            title: 'Aktionen',
            key: 'aktionen' as const,
            immerSichtbar: true,
            render: (_: unknown, em: EinsatzMaterial) => (
              <Popconfirm
                title="Aus Einsatz entfernen?"
                onConfirm={() => entfernenMutation.mutate(em.id)}
              >
                {/* Ohne `danger`: Rot ist Gefahr, nicht Bedienung. */}
                <Button>Entfernen</Button>
              </Popconfirm>
            ),
          },
        ]
      : []),
  ]);

  return (
    <EinsatzSeite
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: 'Material' },
          ]}
        />
      }
      titel={
        <Space>
          Material
          <StatusTag darstellung={einsatzStatus[einsatz.status]} />
        </Space>
      }
      meta={emQuery.isSuccess ? `${ems.length} Positionen` : undefined}
      dataUpdatedAt={emQuery.dataUpdatedAt}
      hinweis={
        !darfSchreiben &&
        einsatz.status !== 'aktiv' && (
          <Alert type="info" showIcon title="Einsatz ist abgeschlossen — nur Ansicht." />
        )
      }
      /**
       * Der Seitenkopf muss umbrechen: die Disponier-Leiste bringt ein `Select` mit `minWidth:
       * 260`, ein Mengenfeld und zwei Knöpfe mit. `EinsatzSeite` bricht selbst um; `wrap` +
       * `maxWidth` am Block bleiben, weil der Umbruch allein den Block nur unter den Titel schiebt.
       */
      aktionen={
        darfSchreiben && (
          <Space wrap style={{ minWidth: 0 }}>
            <Select
              // `minWidth` als Lesbarkeitsboden, `maxWidth` gegen das Sprengen: sonst drückte das
              // Feld die Reihe über den Schirm hinaus.
              style={{ minWidth: 260, maxWidth: '100%' }}
              placeholder="Stamm-Material wählen …"
              value={poolAuswahl}
              options={poolOptionen}
              notFoundContent={poolInhalt}
              disabled={disponiereMutation.isPending}
              onChange={(v) => setPoolAuswahl(v ?? null)}
            />
            <InputNumber
              min={1}
              value={poolMenge}
              disabled={disponiereMutation.isPending}
              onChange={(v) => setPoolMenge(v ?? 1)}
            />
            <Button
              type="primary"
              disabled={poolAuswahl == null}
              loading={disponiereMutation.isPending}
              onClick={() => {
                if (poolAuswahl != null)
                  disponiereMutation.mutate({ materialId: poolAuswahl, menge: poolMenge });
              }}
            >
              Disponieren
            </Button>
            <Button onClick={() => setAdhocOffen(true)}>Ad-hoc-Material</Button>
          </Space>
        )
      }
    >
      {/* Der Status steht im `karte.status`-Slot mit der Vertragsrolle aus
          `theme/statusFarben.ts` (`materialStatus`), und `statusBedienung` macht das Etikett
          zum Auslöser — nur so ist der Statuswechsel auf der 390-px-Karte erreichbar.

          `titel` ohne `ziel`: Material hat keine Detailroute. */}

      {/* Kein Katalog-Banner: der Materialstatus ist das lokale Enum `MaterialStatus` (fünf
          Werte) und kann nicht ausfallen, anders als der Statuskatalog der Fahrzeug- und
          Personalseite.

          Der Listenfehler tauscht die Datensicht aus: `Datensicht` führt den Kartenzweig an
          `Liste`, und `ListeProps` kennt keinen Fehlerbegriff. */}
      {listeGescheitert ? (
        <SeitenFehler
          text="Disponiertes Material konnte nicht geladen werden"
          ursache={emQuery.error}
          onWiederholen={() => void emQuery.refetch()}
        />
      ) : (
        <>
          {standVeraltet && <SeitenStandVeraltet onWiederholen={() => void emQuery.refetch()} />}
          <Verdichtungszeile einsatzId={einsatzId} pfad={kraefteuebersichtPfad(einsatzId)} />
          <Datensicht
            bezeichnung="Material im Einsatz"
            spalten={spalten}
            daten={ems}
            zeilenSchluessel="id"
            ladend={emQuery.isLoading}
            leerText="Noch kein Material disponiert"
            suche={{ platzhalter: 'Bezeichnung, Kategorie' }}
            standardSortierung={{ spalte: 'bezeichnung', richtung: 'auf' }}
            gruppen={{
              schluessel: (m) => m.status,
              etikett: (w) => materialStatus[w as MaterialStatus]?.label ?? w,
              reihenfolge: STATUS_REIHENFOLGE,
              // Die Gruppenköpfe stehen direkt unter dem Seitentitel (h1).
              unterEbene: 1,
            }}
            karte={{
              art: 'plan',
              titel: { spalte: 'bezeichnung' },
              status: (em) => statusDarstellung(em),
              statusBedienung: (em) => (darfSchreiben ? statusBedienungVon(em) : null),
              // Zwei Sekundärfelder: `status` steht im Slot darüber und stünde sonst doppelt.
              sekundaer: ['kategorie', 'menge'],
              aktion: darfSchreiben
                ? {
                    etikett: 'Entfernen',
                    bestaetigung: 'Aus Einsatz entfernen?',
                    onKlick: (em) => entfernenMutation.mutate(em.id),
                  }
                : undefined,
            }}
          />
        </>
      )}

      {/* Ad-hoc-Erfassung auf der Schnellerfassungs-Hülle.

          Serienmodus, weil Ad-hoc-Material stückweise nachkommt. Wertübernahme auf Kategorie
          und Trägerorganisation — sie bleiben über eine Anlieferung gleich und stehen deshalb
          hinten: was sich je Position ändert (Bezeichnung, Menge), kommt zuerst.

          Feldbudget: höchstens vier sichtbare Felder. Die Bestandsnummer ist das fünfte; bei
          Spenden und Fremdmaterial gibt es sie meist nicht. Sie liegt unter „Weitere Angaben".

          `forceRender` registriert das Feld ab dem ersten Bild im Formular statt erst beim
          Aufklappen. Den eingetippten Wert rettet es nicht — der überlebt das Zuklappen ohnehin
          (antd baut den Bereich nicht ab, `Form.Item` bewahrt per Vorgabe). */}
      <ErfassungsModal<MaterialAdhocEingabe & { menge: number }>
        offen={adhocOffen}
        titel="Ad-hoc-Material disponieren"
        form={form}
        erfassenText="Disponieren"
        serie
        uebernahme={['kategorie', 'traegerorganisation']}
        initialValues={{ menge: 1 }}
        laeuft={adhocMutation.isPending}
        // `mutateAsync`, nicht `mutate`: nur eine abgelehnte Zusage lässt die Hülle die Werte
        // stehen. Den Fehlertext meldet `onError`.
        onErfassen={async (w) => {
          await adhocMutation.mutateAsync(w);
        }}
        onFertig={() => setAdhocOffen(false)}
        onAbbrechen={() => setAdhocOffen(false)}
      >
        <Form.Item
          label="Bezeichnung"
          name="bezeichnung"
          rules={[{ required: true, whitespace: true }]}
        >
          <Input placeholder="z. B. Spende-Decken" />
        </Form.Item>
        <Form.Item label="Menge" name="menge" rules={[{ required: true }]}>
          <InputNumber min={1} style={{ width: 120 }} />
        </Form.Item>
        <Form.Item label="Kategorie" name="kategorie">
          <Input />
        </Form.Item>
        <Form.Item label="Trägerorganisation" name="traegerorganisation">
          <Input placeholder="z. B. THW" />
        </Form.Item>
        <Collapse
          ghost
          items={[
            {
              key: 'weitere',
              label: 'Weitere Angaben',
              forceRender: true,
              children: (
                <Form.Item label="Bestandsnummer" name="bestandsnummer" style={{ marginBottom: 0 }}>
                  <Input />
                </Form.Item>
              ),
            },
          ]}
        />
      </ErfassungsModal>
    </EinsatzSeite>
  );
}
