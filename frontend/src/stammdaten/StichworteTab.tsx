import { Button, Popconfirm, Typography, type TableColumnsType } from 'antd';
import AdminPage from '../components/AdminPage';
import SchnellAnlegen from '../components/SchnellAnlegen';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import KatalogTabelle from '../components/KatalogTabelle';
import { SeitenFehler } from '../components/SeitenZustand';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import {
  legeStichwortVorschlagAn,
  listeStichwortVorschlaege,
  loescheStichwortVorschlag,
} from '../api/stichwortVorschlaege';
import type { StichwortVorschlag } from '../api/types';
import { globalKeys } from '../api/queryKeys';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';

export default function StichworteTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();

  const vorschlaegeQuery = useQuery({
    queryKey: globalKeys.stichwortVorschlaege(),
    queryFn: listeStichwortVorschlaege,
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

  const spalten: TableColumnsType<StichwortVorschlag> = [
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
                okText="Ja"
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
        ] as TableColumnsType<StichwortVorschlag>)
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
      <Typography.Paragraph type="secondary">
        Vorschläge für die Stichwort-Combobox im Einsatzdaten-Modul. Freie Eingabe bleibt im Einsatz
        unabhängig davon möglich.
      </Typography.Paragraph>

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
          // Nur `text` hat einen Datenbezug — die Aktionsspalte ist render-only und trägt
          // zur Suche nichts bei (dokumentierte Grenze im Kopf von `KatalogTabelle`).
          // Der Platzhalter benennt deshalb genau dieses eine Feld.
          suche={{ platzhalter: 'Stichwort' }}
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
