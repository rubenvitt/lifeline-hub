import { IkoneMuelleimer, IkoneStift } from '../ikonen';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Breadcrumb, Button, Modal, Popconfirm, Space, Typography } from 'antd';
import { einsatzKeys } from '../api/queryKeys';
import { ladeEinsatz } from '../api/einsaetze';
import { dokumentDownloadPfad, entferneDokument, listeDokumente } from '../api/dokumente';
import type { Dokument, EinsatzStatus } from '../api/types';
import { darfImEinsatzSchreiben, darfOriginalLaden } from '../einsatz/schreibrecht';
import { istBildMime, originalPfad } from '../api/anhangFassung';
import { useAuth } from '../auth/AuthContext';
import Datensicht, { spaltenFuer, type Kartenplan } from '../components/Datensicht';
import { SeitenFehler, SeitenSkeleton, SeitenStandVeraltet } from '../components/SeitenZustand';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import EinsatzSeite from '../components/EinsatzSeite';
import StatusTag from '../components/StatusTag';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { formatGroesse } from '../karten/formatGroesse';
import { einsatzStatus } from '../theme/statusFarben';
import { DOKUMENT_KATEGORIEN, DOKUMENT_KATEGORIE_REIHENFOLGE } from '../dokumente/kategorien';
import DokumentAblegenModal from '../dokumente/DokumentAblegenModal';
import DokumentBearbeitenModal from '../dokumente/DokumentBearbeitenModal';
import DownloadAnker from '../components/DownloadAnker';

/**
 * Dokumentenablage eines Einsatzes (LFH-632), strukturgleich zu `SchaedenPage`.
 *
 * ── Der Titel ist ein nativer Download-Anker, in beiden Zweigen ──
 *
 * `titel.ziel` rendert einen react-router-`<Link>`, also eine Client-Navigation; ein Ziel unter
 * `/api/…/datei` liefe in den Router statt in den Download. `titel.ziel` bleibt deshalb ungesetzt.
 *
 * Ohne `ziel` nimmt der Kartenzweig den Titel aus demselben Spalten-`render` wie die Tabelle
 * (`zelle(titelSpalte, …)` in `Datensicht`). Deshalb trägt das `render` der Titelspalte den echten
 * `<a href download>` — Lesende und Schreibende bekommen den Download in Tabelle und Karte. Die
 * Regel „trägt `titel.ziel` einen Wert, darf das `render` keinen Anker erzeugen" greift nicht: es
 * gibt keinen zweiten Link. Ein `onZeileKlick` gibt es nicht; eine Zeile, deren Klick eine Datei
 * zieht, wäre eine Überraschung.
 *
 * Der Anker trägt die Höhe aus `controlHeight` selbst (`components/DownloadAnker`): ein
 * Inline-`<a>` erbt keine Steuerhöhe.
 *
 * ── Bearbeiten und Entfernen ──
 *
 * Zwei ändernde Zeilenaktionen, also noch keine Bündelung (sie greift ab drei, LFH-365). In der
 * Tabelle stehen „Bearbeiten“ (neutral) und „Entfernen“ (rot) in `<Space size="middle">` — Rot
 * steht nicht bündig neben Neutralem. „Bearbeiten“ öffnet `DokumentBearbeitenModal` (LFH-656):
 * Titel, Kategorie und Bezug, die Datei bleibt.
 *
 * Entfernen ist für die Oberfläche unumkehrbar (kein Wiederherstellen-Weg), deshalb Rückfrage mit
 * rotem OK-Knopf. Der Kartenplan kennt genau eine Primäraktion: das ist „Bearbeiten“ (häufiger,
 * umkehrbar); „Entfernen“ steht als Gefahr-Eintrag in `weitere`. Dessen Rückfrage ist ein
 * `<Modal>` auf Seitenebene, außerhalb der Zeilen-`map` (Bündelungsregel), nicht ein
 * `Popconfirm` im Menü. `zugaenglicherName` trägt je Aktion den Titel, damit n Karten nicht n
 * gleichnamige Knöpfe liefern.
 *
 * Zwischen Bestätigung und Serverantwort (LFH-654, Prüfliste LFH-632 Zeile 1 · 3) bleibt die Zeile
 * stehen: ihr Entfernen-Auslöser lädt — in der Tabelle der Mülleimer, in der Karte der Menü-Knopf
 * (`WeitereAktionen.laeuft`) —, und neben dem Titel steht „wird entfernt“ als Text — NEBEN dem
 * Anker, damit sein zugänglicher Name gleich bleibt. Kein optimistisches Ausblenden: die Zeilen
 * darunter rückten unter dem Zeiger weg (Kriterium 12). Die Menge `entferntGerade` räumt erst,
 * wenn die Liste nach dem Erfolg neu geladen ist (`onSuccess` wartet auf die Invalidierung), sonst
 * stünde die Zeile kurz ohne Zusatz da.
 */

const rechteText = (status: EinsatzStatus) =>
  status !== 'aktiv'
    ? 'Der Einsatz ist abgeschlossen — die Dokumente stehen nur noch zum Nachlesen bereit.'
    : 'Nur Einsatzleitung und Führungspersonal können Dokumente ablegen und entfernen — zum Nachlesen und Herunterladen stehen sie hier bereit.';

const ENTFERNEN_TEXT = 'Es verschwindet aus der Liste; der ETB-Nachweis bleibt.';

function bezugText(d: Dokument): string | null {
  return (
    d.bezug_abschnitt_name ??
    d.bezug_einheit_name ??
    (d.bezug_etb_lfd_nr != null ? `ETB ${d.bezug_etb_lfd_nr}` : null)
  );
}

/**
 * Das eine Spaltenregister (Bauform `SchaedenPage`). Funktion von `einsatzId` (Download-Pfad) und
 * Schreibrecht (Aktionsspalte), durch `spaltenFuer<Dokument>()` geführt, nie annotiert — sonst
 * weitete sich `K` auf `string` und der Kartenplan nähme Tippfehler an.
 */
const dokumentSpalten = (
  einsatzId: number,
  darfSchreiben: boolean,
  onBearbeiten: (d: Dokument) => void,
  onEntfernen: (d: Dokument) => void,
  entferntGerade: ReadonlySet<number>,
  darfOriginal: boolean,
) =>
  spaltenFuer<Dokument>()([
    {
      title: 'Titel',
      key: 'titel',
      immerSichtbar: true,
      sortWert: (d) => d.titel,
      suchText: (d) => `${d.titel} ${d.dateiname}`,
      render: (_, d) => {
        const anker = (
          <DownloadAnker
            href={dokumentDownloadPfad(einsatzId, d.id)}
            dateiname={d.dateiname}
            text={d.titel}
            originalHref={
              darfOriginal && istBildMime(d.mime)
                ? originalPfad(dokumentDownloadPfad(einsatzId, d.id))
                : undefined
            }
            originalKennung={`${d.dateiname}, Dokument ${d.titel}`}
          />
        );
        return entferntGerade.has(d.id) ? (
          <span>
            {anker}
            <span> · wird entfernt</span>
          </span>
        ) : (
          anker
        );
      },
    },
    {
      title: 'Kategorie',
      key: 'kategorie',
      sortWert: (d) => DOKUMENT_KATEGORIE_REIHENFOLGE.indexOf(d.kategorie),
      filter: {
        werte: DOKUMENT_KATEGORIE_REIHENFOLGE.map((k) => ({
          text: DOKUMENT_KATEGORIEN[k].label,
          value: k,
        })),
        trifft: (d, wert) => d.kategorie === wert,
      },
      render: (_, d) => DOKUMENT_KATEGORIEN[d.kategorie].label,
    },
    {
      title: 'Bezug',
      key: 'bezug',
      abBreite: 'lg',
      sortWert: (d) => bezugText(d),
      suchText: (d) => bezugText(d),
      filter: {
        werte: [
          { text: 'mit Bezug', value: 'mit' },
          { text: 'ohne Bezug', value: 'ohne' },
        ],
        trifft: (d, wert) => (bezugText(d) != null) === (wert === 'mit'),
      },
      render: (_, d) => bezugText(d) ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: 'Datei',
      key: 'datei',
      abBreite: 'xl',
      sortWert: (d) => d.groesse,
      render: (_, d) => `${d.dateiname} · ${formatGroesse(d.groesse)}`,
    },
    {
      title: 'Abgelegt',
      key: 'abgelegt',
      sortWert: (d) => d.abgelegt_at,
      suchText: (d) => d.abgelegt_von_name,
      render: (_, d) => (
        <span>
          {d.abgelegt_von_name ?? '—'} · <ZeitAnzeige wert={d.abgelegt_at} />
        </span>
      ),
    },
    ...(darfSchreiben
      ? [
          {
            title: 'Aktionen',
            key: 'aktionen' as const,
            immerSichtbar: true,
            render: (_: unknown, d: Dokument) => (
              <Space size="middle">
                <Button
                  type="text"
                  icon={<IkoneStift />}
                  aria-label={`Dokument ${d.titel} bearbeiten`}
                  onClick={() => onBearbeiten(d)}
                />
                <Popconfirm
                  title="Dokument entfernen?"
                  description={ENTFERNEN_TEXT}
                  okText="Entfernen"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => onEntfernen(d)}
                  disabled={entferntGerade.has(d.id)}
                >
                  <Button
                    danger
                    type="text"
                    icon={<IkoneMuelleimer />}
                    loading={entferntGerade.has(d.id)}
                    aria-label={`Dokument ${d.titel} entfernen`}
                  />
                </Popconfirm>
              </Space>
            ),
          },
        ]
      : []),
  ]);

type DokumentSpaltenKey = ReturnType<typeof dokumentSpalten>[number]['key'];

const dokumentKarte = (
  darfSchreiben: boolean,
  onBearbeiten: (d: Dokument) => void,
  onEntfernenWahl: (d: Dokument) => void,
  entferntGerade: ReadonlySet<number>,
): Kartenplan<Dokument, DokumentSpaltenKey> => ({
  art: 'plan',
  // KEIN `ziel` — siehe Dateikopf: der Download-Anker kommt aus dem Spalten-`render`.
  titel: { spalte: 'titel' },
  status: (d) => ({ rolle: 'neutral', label: DOKUMENT_KATEGORIEN[d.kategorie].label }),
  sekundaer: ['bezug', 'datei', 'abgelegt'],
  aktion: darfSchreiben
    ? {
        etikett: 'Bearbeiten',
        zugaenglicherName: (d) => `Dokument ${d.titel} bearbeiten`,
        onKlick: onBearbeiten,
      }
    : undefined,
  // Ohne Schreibrecht liefert `eintraege` nichts — dann gibt es keinen Auslöser (Datensicht).
  weitere: {
    eintraege: () =>
      darfSchreiben ? [{ key: 'entfernen', label: 'Entfernen', gefahr: true }] : [],
    zugaenglicherName: (d) => `Aktionen zu Dokument ${d.titel}`,
    onWahl: (_key, d) => onEntfernenWahl(d),
    laeuft: (d) => entferntGerade.has(d.id),
  },
});

export default function DokumentePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [ablegenOffen, setAblegenOffen] = useState(false);
  const [entferntGerade, setEntferntGerade] = useState<ReadonlySet<number>>(() => new Set());
  const [inBearbeitung, setInBearbeitung] = useState<Dokument | null>(null);
  /** Rückfrage „Entfernen“ aus dem Kartenmenü (die Tabelle fragt per `Popconfirm`). */
  const [zuEntfernen, setZuEntfernen] = useState<Dokument | null>(null);

  // Live gehalten über den Einsatz-Stream (`dokument`-Ereignis → 'einsatz-dokumente').
  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const dokumenteQuery = useQuery({
    queryKey: einsatzKeys.dokumente(einsatzId),
    queryFn: () => listeDokumente(einsatzId),
  });

  const entfernenMutation = useMutation({
    mutationFn: (dokumentId: number) => entferneDokument(einsatzId, dokumentId),
    // Optionsebene statt Aufruf-Rückruf: bei zwei laufenden Löschungen räumt jede ihre eigene ID.
    onMutate: (dokumentId) => setEntferntGerade((alt) => new Set(alt).add(dokumentId)),
    onSettled: (_daten, _fehler, dokumentId) =>
      setEntferntGerade((alt) => {
        const neu = new Set(alt);
        neu.delete(dokumentId);
        return neu;
      }),
    onSuccess: async () => {
      message.success('Dokument entfernt');
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      await qc.invalidateQueries({ queryKey: einsatzKeys.dokumente(einsatzId) });
    },
  });
  const { mutate: entfernen } = entfernenMutation;

  const darfSchreibenRoh = darfImEinsatzSchreiben(einsatzQuery.data, benutzer);
  const darfOriginal = darfOriginalLaden(einsatzQuery.data, benutzer);
  const spalten = useMemo(
    () =>
      dokumentSpalten(
        einsatzId,
        darfSchreibenRoh,
        setInBearbeitung,
        (d) => entfernen(d.id),
        entferntGerade,
        darfOriginal,
      ),
    [einsatzId, darfSchreibenRoh, entfernen, entferntGerade, darfOriginal],
  );
  const karte = useMemo(
    () => dokumentKarte(darfSchreibenRoh, setInBearbeitung, setZuEntfernen, entferntGerade),
    [darfSchreibenRoh, entferntGerade],
  );

  // Schnellaktion: ?neu=1 öffnet den Dialog (Command-Palette). Param immer löschen, Dialog nur mit
  // Schreibrecht.
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (einsatzQuery.isLoading) return;
    if (darfSchreibenRoh) setAblegenOffen(true);
    searchParams.delete('neu');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams, einsatzQuery.isLoading, darfSchreibenRoh]);

  // Seitenzustand — nur `einsatzQuery`: ohne Einsatz gibt es keinen Rahmen.
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

  // Listenzustand — an der Stelle der Liste, gemessen an der Vollmenge.
  const alle = dokumenteQuery.data ?? [];
  const listeGescheitert = dokumenteQuery.isError && alle.length === 0;
  const standVeraltet = dokumenteQuery.isError && alle.length > 0;

  return (
    <EinsatzSeite
      dataUpdatedAt={dokumenteQuery.dataUpdatedAt}
      meta={
        dokumenteQuery.isSuccess
          ? `${alle.length} ${alle.length === 1 ? 'Dokument' : 'Dokumente'}`
          : undefined
      }
      titel={
        <Space>
          Dokumente
          <StatusTag darstellung={einsatzStatus[einsatz.status]} />
        </Space>
      }
      beschreibung="Abgelegte Dateien des Einsatzes: Lagepläne, Befehle, Formulare, Fotos."
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: 'Dokumente' },
          ]}
        />
      }
      // Gesperrt statt fehlend: der Rechte-Hinweis darüber nennt den Grund.
      aktionen={
        <Button type="primary" disabled={!darfSchreiben} onClick={() => setAblegenOffen(true)}>
          Dokument ablegen
        </Button>
      }
      neueZeile={darfSchreiben ? () => setAblegenOffen(true) : undefined}
      hinweis={
        <SeitenHinweise
          fehler={entfernenMutation.error}
          fehlerTitel="Nicht entfernt"
          rechteFehlt={!darfSchreiben}
          rechteText={rechteText(einsatz.status)}
        />
      }
    >
      {listeGescheitert ? (
        <SeitenFehler
          text="Dokumente konnten nicht geladen werden"
          ursache={dokumenteQuery.error}
          onWiederholen={() => void dokumenteQuery.refetch()}
        />
      ) : (
        <>
          {standVeraltet && (
            <SeitenStandVeraltet onWiederholen={() => void dokumenteQuery.refetch()} />
          )}
          <Datensicht
            bezeichnung="Dokumente"
            form="auto"
            spalten={spalten}
            daten={alle}
            zeilenSchluessel={(d) => d.id}
            ladend={dokumenteQuery.isLoading}
            leerText="Noch keine Dokumente abgelegt."
            suche={{ platzhalter: 'Titel, Dateiname, Verfasser' }}
            standardSortierung={{ spalte: 'abgelegt', richtung: 'ab' }}
            karte={karte}
          />
        </>
      )}

      <DokumentAblegenModal
        einsatzId={einsatzId}
        offen={ablegenOffen}
        onSchliessen={() => setAblegenOffen(false)}
      />
      <DokumentBearbeitenModal
        einsatzId={einsatzId}
        dokument={darfSchreiben ? inBearbeitung : null}
        onSchliessen={() => setInBearbeitung(null)}
      />
      <Modal
        open={zuEntfernen !== null}
        title="Dokument entfernen?"
        okText="Entfernen"
        okButtonProps={{ danger: true }}
        onOk={() => {
          if (zuEntfernen) entfernen(zuEntfernen.id);
          setZuEntfernen(null);
        }}
        onCancel={() => setZuEntfernen(null)}
      >
        {zuEntfernen && `„${zuEntfernen.titel}“: ${ENTFERNEN_TEXT}`}
      </Modal>
    </EinsatzSeite>
  );
}
