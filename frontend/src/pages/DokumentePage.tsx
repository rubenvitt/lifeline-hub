import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Breadcrumb, Button, Popconfirm, Space, Typography, theme } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { einsatzKeys } from '../api/queryKeys';
import { ladeEinsatz } from '../api/einsaetze';
import { dokumentDownloadPfad, entferneDokument, listeDokumente } from '../api/dokumente';
import type { Dokument, EinsatzStatus } from '../api/types';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
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

/**
 * Dokumentenablage eines Einsatzes (LFH-632), strukturgleich zu `SchaedenPage`.
 *
 * ── DER TITEL IST EIN NATIVER DOWNLOAD-ANKER, UND ZWAR IN BEIDEN ZWEIGEN ──────────
 *
 * Der Kartenplan kennt `titel.ziel` — das rendert aber einen react-router-`<Link>`, also
 * eine CLIENT-Navigation. Ein Ziel unter `/api/…/datei` liefe damit in den Router statt in
 * den Download (die Seite zeigte den Fangzweig, keine Datei). `titel.ziel` ist hier also
 * unbrauchbar und bleibt UNGESETZT.
 *
 * Ohne `ziel` nimmt der Kartenzweig den Titel aus demselben Spalten-`render` wie die Tabelle
 * (`zelle(titelSpalte, …)` in `Datensicht`). Deshalb trägt das `render` der Titelspalte den
 * echten `<a href download>` — Lesende UND Schreibende bekommen den Download in Tabelle und
 * Karte, ohne Ausweich-Primäraktion. Die Regel „trägt `titel.ziel` einen Wert, darf das
 * `render` keinen Anker erzeugen" greift nicht: `ziel` ist leer, es gibt keinen zweiten Link
 * und nichts zu verschachteln. Ein `onZeileKlick` gibt es nicht — der Anker-Riegel der
 * Datensicht hätte also nichts zu entscheiden; eine Zeile, deren Klick eine Datei zieht,
 * wäre ohnehin eine Überraschung.
 *
 * Der Anker trägt die Höhe aus `controlHeight` selbst (`DownloadAnker`): ein Inline-`<a>`
 * erbt keine Steuerhöhe (gemessen 17 px, LFH-396). Die Bauform (`inline-flex` + `minHeight`)
 * ist die des Titel-Links, den das Primitiv bei gesetztem `ziel` selbst rendert.
 *
 * ── ENTFERNEN ─────────────────────────────────────────────────────────────────
 *
 * Eine einzige Zeilenaktion, also keine Bündelung. Sie ist aus Sicht der Oberfläche
 * UNUMKEHRBAR (es gibt keinen Wiederherstellen-Weg), deshalb Rückfrage mit rotem OK-Knopf.
 * Im Kartenzweig trägt die Aktion das Primitiv (`PrimaerAktion` mit `bestaetigung`) — dort
 * bewusst ohne Gefahren-Anstrich, das ist der Vertrag von `Datensicht` („Rot bedient
 * nichts"), nicht eine Auslassung dieser Seite.
 */

const rechteText = (status: EinsatzStatus) =>
  status !== 'aktiv'
    ? 'Der Einsatz ist abgeschlossen — die Dokumente stehen nur noch zum Nachlesen bereit.'
    : 'Nur Einsatzleitung und Führungspersonal können Dokumente ablegen und entfernen — zum Nachlesen und Herunterladen stehen sie hier bereit.';

function DownloadAnker({ einsatzId, dokument }: { einsatzId: number; dokument: Dokument }) {
  const { token } = theme.useToken();
  return (
    <a
      href={dokumentDownloadPfad(einsatzId, dokument.id)}
      download={dokument.dateiname}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: token.controlHeight,
        fontWeight: 600,
      }}
    >
      {dokument.titel}
    </a>
  );
}

function bezugText(d: Dokument): string | null {
  return (
    d.bezug_abschnitt_name ??
    d.bezug_einheit_name ??
    (d.bezug_etb_lfd_nr != null ? `ETB ${d.bezug_etb_lfd_nr}` : null)
  );
}

/**
 * Das EINE Spaltenregister (Bauform `SchaedenPage`). Funktion von `einsatzId` (Download-Pfad)
 * und vom Schreibrecht (Aktionsspalte), durch `spaltenFuer<Dokument>()` geführt, nie
 * annotiert — sonst weitete sich `K` auf `string` und der Kartenplan nähme Tippfehler an.
 */
const dokumentSpalten = (
  einsatzId: number,
  darfSchreiben: boolean,
  onEntfernen: (d: Dokument) => void,
) =>
  spaltenFuer<Dokument>()([
    {
      title: 'Titel',
      key: 'titel',
      immerSichtbar: true,
      sortWert: (d) => d.titel,
      suchText: (d) => `${d.titel} ${d.dateiname}`,
      render: (_, d) => <DownloadAnker einsatzId={einsatzId} dokument={d} />,
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
              <Popconfirm
                title="Dokument entfernen?"
                description="Es verschwindet aus der Liste; der ETB-Nachweis bleibt."
                okText="Entfernen"
                okButtonProps={{ danger: true }}
                onConfirm={() => onEntfernen(d)}
              >
                <Button
                  danger
                  type="text"
                  icon={<DeleteOutlined />}
                  aria-label={`Dokument ${d.titel} entfernen`}
                />
              </Popconfirm>
            ),
          },
        ]
      : []),
  ]);

type DokumentSpaltenKey = ReturnType<typeof dokumentSpalten>[number]['key'];

const dokumentKarte = (
  darfSchreiben: boolean,
  onEntfernen: (d: Dokument) => void,
): Kartenplan<Dokument, DokumentSpaltenKey> => ({
  art: 'plan',
  // KEIN `ziel` — siehe Dateikopf: der Download-Anker kommt aus dem Spalten-`render`.
  titel: { spalte: 'titel' },
  status: (d) => ({ rolle: 'neutral', label: DOKUMENT_KATEGORIEN[d.kategorie].label }),
  sekundaer: ['bezug', 'datei', 'abgelegt'],
  aktion: darfSchreiben
    ? { etikett: 'Entfernen', bestaetigung: 'Dokument entfernen?', onKlick: onEntfernen }
    : undefined,
});

export default function DokumentePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [ablegenOffen, setAblegenOffen] = useState(false);

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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.dokumente(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      message.success('Dokument entfernt');
    },
  });
  const { mutate: entfernen } = entfernenMutation;

  const darfSchreibenRoh = darfImEinsatzSchreiben(einsatzQuery.data, benutzer);
  const spalten = useMemo(
    () => dokumentSpalten(einsatzId, darfSchreibenRoh, (d) => entfernen(d.id)),
    [einsatzId, darfSchreibenRoh, entfernen],
  );
  const karte = useMemo(
    () => dokumentKarte(darfSchreibenRoh, (d) => entfernen(d.id)),
    [darfSchreibenRoh, entfernen],
  );

  // Schnellaktion: ?neu=1 öffnet den Dialog (Command-Palette). Param immer löschen, Dialog
  // nur mit Schreibrecht — Muster `SchaedenPage`.
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (einsatzQuery.isLoading) return;
    if (darfSchreibenRoh) setAblegenOffen(true);
    searchParams.delete('neu');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams, einsatzQuery.isLoading, darfSchreibenRoh]);

  // SEITENZUSTAND — nur `einsatzQuery`: ohne Einsatz gibt es keinen Rahmen (LFH-331 · B3).
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

  // LISTENZUSTAND — an der Stelle der Liste, gemessen an der Vollmenge (LFH-331 · B3, D3).
  const alle = dokumenteQuery.data ?? [];
  const listeGescheitert = dokumenteQuery.isError && alle.length === 0;
  const standVeraltet = dokumenteQuery.isError && alle.length > 0;

  return (
    <EinsatzSeite
      dataUpdatedAt={dokumenteQuery.dataUpdatedAt}
      meta={dokumenteQuery.isSuccess ? `${alle.length} Dokumente` : undefined}
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
      // Gesperrt statt fehlend (LFH-345 · M16): der Rechte-Hinweis darüber nennt den Grund.
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
    </EinsatzSeite>
  );
}
