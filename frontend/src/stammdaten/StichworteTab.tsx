import { Button, Popconfirm } from 'antd';
import AdminPage from '../components/AdminPage';
import SchnellAnlegen from '../components/SchnellAnlegen';
import { SeitenHinweise, ZeilenFehler } from '../components/SpeicherHinweis';
import KatalogTabelle, { type KatalogSpalte } from '../components/KatalogTabelle';
import { Select } from '../components/Select';
import { useZeilenFehler } from '../components/useZeilenFehler';
import { SeitenFehler } from '../components/SeitenZustand';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import {
  legeStichwortVorschlagAn,
  listeStichwortVorschlaege,
  loescheStichwortVorschlag,
  setzeStichwortVorlage,
} from '../api/stichwortVorschlaege';
import { listeEinsatzVorlagen } from '../api/einsatzVorlagen';
import type { StichwortVorschlag } from '../api/types';
import { globalKeys } from '../api/queryKeys';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';
import { auswahlWert, vorlageAusWert, vorlagenOptionen } from './einsatzVorlageModule';

export default function StichworteTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();

  const vorschlaegeQuery = useQuery({
    queryKey: globalKeys.stichwortVorschlaege(),
    queryFn: listeStichwortVorschlaege,
  });

  // Die Vorlagen für die Auswahl je Zeile (LLH-1375); lesen darf sie jede angemeldete Person.
  const vorlagenQuery = useQuery({
    queryKey: globalKeys.einsatzVorlagen(),
    queryFn: listeEinsatzVorlagen,
  });
  const vorlagen = vorlagenQuery.data ?? [];
  const vorlagenNamen = new Map(vorlagen.map((v) => [v.id, v.bezeichnung]));
  const vorlagenAuswahl = vorlagenOptionen(vorlagen, 'keine');

  /**
   * Kopplung an eine Einsatz-Vorlage, sofort gespeichert (LLH-1375). Die Wahl steht gleich in der
   * Zeile (Cache vorab gesetzt); eine Ablehnung nennt ihren Grund an der Zeile
   * (`useZeilenFehler`, LFH-1077), und der Serverstand kommt per Abgleich zurück. Die Callbacks
   * laufen je Aufruf, `mutation.error` kennte nur den letzten.
   */
  const zeilen = useZeilenFehler<number>();
  const vorlageMutation = useMutation({
    mutationFn: ({ id, vorlageId }: { id: number; vorlageId: number | null }) =>
      setzeStichwortVorlage(id, vorlageId),
    onMutate: ({ id, vorlageId }) => {
      zeilen.beginne(id);
      qc.setQueryData<StichwortVorschlag[]>(globalKeys.stichwortVorschlaege(), (alt) =>
        alt?.map((v) => (v.id === id ? { ...v, vorlage_id: vorlageId } : v)),
      );
    },
    onError: (fehler, { id }) => {
      zeilen.melde(id, fehler, 'Vorlage nicht gespeichert');
      void qc.invalidateQueries({ queryKey: globalKeys.stichwortVorschlaege() });
    },
    onSuccess: (neu) => {
      qc.setQueryData<StichwortVorschlag[]>(globalKeys.stichwortVorschlaege(), (alt) =>
        alt?.map((v) => (v.id === neu.id ? neu : v)),
      );
    },
  });

  const anlegenMutation = useMutation({
    mutationFn: (text: string) => legeStichwortVorschlagAn(text),
    // Kein `setNeuerText('')`: das Leeren gehört `SchnellAnlegen`, und zwar BEDINGT — nur wenn im
    // Feld noch der abgeschickte Text steht. Ein unbedingtes Leeren fräße die nächste Eingabe,
    // wenn jemand weitertippt, während der vorherige Eintrag noch unterwegs ist.
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.stichwortVorschlaege() }),
  });

  const loeschenMutation = useMutation({
    mutationFn: (id: number) => loescheStichwortVorschlag(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.stichwortVorschlaege() }),
  });

  /**
   * Beide Mutationen OHNE `onError` (LFH-473): ein Toast wäre nach drei Sekunden weg, danach sagte
   * nichts mehr, dass und warum die Handlung scheiterte. Der Fehler steht im `SeitenHinweise`-Slot.
   *
   * EIN Slot, zwei Handlungen: wer eine auslöst, räumt den Fehler der anderen (`reset`). Sonst
   * stünde nach dem nächsten Versuch ein alter Grund über der Seite, denn react-query räumt
   * `error` nur beim eigenen `mutate()`.
   */
  const seitenFehler = loeschenMutation.error
    ? {
        fehler: loeschenMutation.error,
        titel: 'Nicht gelöscht',
        fallback: 'Löschen fehlgeschlagen',
      }
    : {
        fehler: anlegenMutation.error,
        titel: 'Nicht angelegt',
        fallback: 'Hinzufügen fehlgeschlagen',
      };

  const vorschlaege = vorschlaegeQuery.data ?? [];

  const spalten: KatalogSpalte<StichwortVorschlag>[] = [
    {
      title: 'Stichwort',
      dataIndex: 'text',
      key: 'text',
      /**
       * Leitspalte: das Stichwort ist das einzige fachliche Merkmal des Datensatzes
       * (`{ id, text }`), an ihm sucht ein Mensch — nicht an der DB-Kennung.
       *
       * `numeric: true`, weil die Stichworte durchnummeriert sind (H1, H2, … H10); rein
       * lexikografisch stünde H10 vor H2 [abgeleitet].
       *
       * KEIN `defaultSortOrder`: das Backend liefert `ORDER BY sortier, text`, eine gepflegte
       * fachliche Reihenfolge. Die Antwort trägt `sortier` nicht mit — einmal weggeworfen, könnte
       * das Frontend sie nicht wiederherstellen; nur der dritte Kopfklick holt sie zurück.
       */
      sorter: (a, b) => a.text.localeCompare(b.text, 'de', { numeric: true }),
    },
    {
      title: 'Vorlage',
      key: 'vorlage',
      /**
       * Gekoppelte Einsatz-Vorlage (LLH-1375): wählt der Anlegedialog dieses Stichwort, stellt sie
       * sich ein. Leer = keine. Bedienen nur der Admin; die übrigen lesen den Namen.
       */
      suchText: (v) => (v.vorlage_id != null ? vorlagenNamen.get(v.vorlage_id) : undefined),
      render: (_, v: StichwortVorschlag) => {
        const name = v.vorlage_id != null ? vorlagenNamen.get(v.vorlage_id) : undefined;
        if (!istAdmin) return name ?? '—';
        const grund = zeilen.grund(v.id);
        return (
          <>
            {/* „keine“ ist ein Eintrag, kein Leeren: so bleibt die Auswahl immer kontrolliert
               (antd liest `value={undefined}` als unkontrolliert), und ein abgelehnter Wechsel
               springt mit dem Serverstand zurück. */}
            <Select<number>
              aria-label={`Vorlage zu ${v.text}`}
              value={auswahlWert(v.vorlage_id)}
              options={vorlagenAuswahl}
              loading={vorlagenQuery.isLoading}
              style={{ width: '100%', minWidth: 180 }}
              onChange={(wert) =>
                vorlageMutation.mutate({ id: v.id, vorlageId: vorlageAusWert(wert) })
              }
            />
            {grund && <ZeilenFehler fehler={grund.fehler} fallback={grund.fallback} />}
          </>
        );
      },
    },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            width: 120,
            /**
             * Die einzige UNUMKEHRBARE Aktion der Stammdaten (LFH-363): jede andere destruktive Aktion
             * heißt „Außer Dienst"/„Deaktivieren" und trägt ihre Umkehrung daneben. Deshalb steht nur
             * hier eine Rückfrage. Einen Abstand braucht es nicht: die Zelle trägt nur diese eine Aktion.
             */
            render: (_, v: StichwortVorschlag) => (
              <Popconfirm
                title="Stichwort löschen?"
                okText="Stichwort löschen"
                cancelText="Abbrechen"
                okButtonProps={{ danger: true }}
                onConfirm={() => {
                  anlegenMutation.reset();
                  loeschenMutation.mutate(v.id);
                }}
              >
                {/* Der Lauf gehört GENAU der gelöschten Zeile (LFH-346): an `isPending` drehte der Spinner in
                   JEDER Zeile. `variables` ist hier die nackte id. */}
                <Button
                  danger
                  loading={loeschenMutation.isPending && loeschenMutation.variables === v.id}
                >
                  Löschen
                </Button>
              </Popconfirm>
            ),
          },
        ] as KatalogSpalte<StichwortVorschlag>[])
      : []),
  ];

  return (
    <AdminPage
      titel="Einsatz-Stichworte"
      hinweis={
        <SeitenHinweise
          fehler={seitenFehler.fehler}
          fehlerTitel={seitenFehler.titel}
          fehlerFallback={seitenFehler.fallback}
          rechteFehlt={!istAdmin}
          rechteText={STAMMDATEN_RECHTE_TEXT}
        />
      }
    >
      {/* KEIN `aktionen`-Slot: der Anlegen-Weg ist die Schnellerfassungszeile am Inhalt. Ein zweiter
         Knopf im Kopf wären zwei Primäraktionen für dieselbe Sache. */}
      {/* Der Fehler tauscht die Tabelle aus (LFH-331): `Datensicht` führt den Kartenzweig an
         `Liste`, und `ListeProps` kennt keinen Fehlerbegriff. Ohne diese Weiche behauptete „Noch
         keine Stichworte" einen leeren Katalog, wenn bloß die Verbindung abgerissen ist. */}
      {vorschlaegeQuery.isError ? (
        <SeitenFehler
          text="Stichworte konnten nicht geladen werden"
          ursache={vorschlaegeQuery.error}
          onWiederholen={() => void vorschlaegeQuery.refetch()}
        />
      ) : (
        <KatalogTabelle
          rowKey="id"
          loading={vorschlaegeQuery.isLoading}
          dataSource={vorschlaege}
          columns={spalten}
          locale={{ emptyText: 'Noch keine Stichworte' }}
          // `text` und der Name der Vorlage (über `suchText`) tragen die Suche; die Aktionsspalte
          // ist render-only (dokumentierte Grenze im Kopf von `KatalogTabelle`).
          suche={{ platzhalter: 'Stichwort oder Vorlage' }}
        />
      )}

      {/* Auf dem Primitiv `SchnellAnlegen` — mit bedingtem Reset, `mutateAsync`-Vertrag und
         Beschriftung. Die Zeile steht IMMER, ohne Recht gesperrt; den Grund nennt der
         `RechteHinweis` im `hinweis`-Slot. Sie bleibt UNTER der Tabelle, anders als in den
         Schwestersektionen: ein Ortswechsel wäre eine Gestaltungsänderung ohne Anlass, und außerhalb
         der Fehlerweiche steht sie auch hier. */}
      <SchnellAnlegen
        beschriftung="Neues Stichwort"
        // Der Platzhalter wiederholt die Beschriftung NICHT — er ergänzt sie um das
        // Beispiel. „Neues Stichwort" stünde sonst zweimal übereinander.
        platzhalter="z. B. H1Y"
        knopfText="Hinzufügen"
        onAnlegen={(text) => {
          loeschenMutation.reset();
          return anlegenMutation.mutateAsync(text);
        }}
        laeuft={anlegenMutation.isPending}
        gesperrt={!istAdmin}
      />
    </AdminPage>
  );
}
