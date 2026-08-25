import { App, Button, Popconfirm, Typography, type TableColumnsType } from 'antd';
import AdminPage from '../components/AdminPage';
import SchnellAnlegen from '../components/SchnellAnlegen';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import KatalogTabelle from '../components/KatalogTabelle';
import { SeitenFehler } from '../components/SeitenZustand';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
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
  const { message } = App.useApp();

  const vorschlaegeQuery = useQuery({
    queryKey: globalKeys.stichwortVorschlaege(),
    queryFn: listeStichwortVorschlaege,
  });

  const anlegenMutation = useMutation({
    mutationFn: (text: string) => legeStichwortVorschlagAn(text),
    // KEIN `setNeuerText('')` mehr: das Leeren gehoert seit der Umstellung auf
    // `SchnellAnlegen` dem Primitiv, und zwar BEDINGT — es leert nur, wenn im Feld
    // noch der abgeschickte Text steht. Das unbedingte Leeren hier frass die
    // naechste Eingabe, wenn jemand weitertippte, waehrend der vorherige Eintrag
    // noch unterwegs war.
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.stichwortVorschlaege() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Hinzufügen fehlgeschlagen'),
  });

  const loeschenMutation = useMutation({
    mutationFn: (id: number) => loescheStichwortVorschlag(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.stichwortVorschlaege() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Löschen fehlgeschlagen'),
  });

  const vorschlaege = vorschlaegeQuery.data ?? [];

  const spalten: TableColumnsType<StichwortVorschlag> = [
    {
      title: 'Stichwort',
      dataIndex: 'text',
      key: 'text',
      /**
       * Leitspalte: das Stichwort ist das einzige fachliche Merkmal des Datensatzes
       * (`StichwortVorschlag` = `{ id, text }`), an ihm sucht ein Mensch — nicht an der
       * DB-Kennung.
       *
       * `numeric: true`, weil die Stichworte durchnummeriert sind (H1, H2, … H10);
       * rein lexikografisch stünde H10 vor H2 [abgeleitet].
       *
       * KEIN `defaultSortOrder`: das Backend liefert `ORDER BY sortier, text`
       * (`src/stichwort/mod.rs:17`), also eine gepflegte fachliche Reihenfolge. Sie
       * bleibt die Voreinstellung, die Sortierung ist ein Angebot. Wichtig, weil die
       * Antwort `sortier` gar nicht mitträgt — einmal weggeworfen, könnte das Frontend
       * die fachliche Reihenfolge nicht wiederherstellen; nur der dritte Kopfklick
       * (antd: aufsteigend → absteigend → aus) holt sie zurück.
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
             * Die einzige UNUMKEHRBARE Aktion der Stammdaten (LFH-363 · B5c): jede andere
             * destruktive Aktion heißt „Außer Dienst"/„Deaktivieren" und trägt ihre
             * Umkehrung als Knopf daneben. Deshalb — und nur deshalb — steht hier eine
             * Rückfrage, die dort keine wäre, sondern eine Reibung ohne Gegenwert.
             * Ein Abstand ist hier nichts zu trennen: die Zelle trägt nur diese eine Aktion.
             */
            render: (_, v: StichwortVorschlag) => (
              <Popconfirm
                title="Stichwort löschen?"
                okText="Ja"
                cancelText="Abbrechen"
                okButtonProps={{ danger: true }}
                onConfirm={() => loeschenMutation.mutate(v.id)}
              >
                {/* Der Lauf gehört GENAU der gelöschten Zeile (LFH-346 · A1): am blanken
                    `isPending` drehte der Spinner in JEDER Zeile und behauptete Fortschritt
                    an fremden Datensätzen. `variables` ist hier die nackte id. */}
                <Button danger loading={loeschenMutation.isPending && loeschenMutation.variables === v.id}>
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
      hinweis={<SeitenHinweise rechteFehlt={!istAdmin} rechteText={STAMMDATEN_RECHTE_TEXT} />}
    >
    {/* KEIN `aktionen`-Slot (LFH-346 · A3): der Anlegen-Weg dieser Sektion ist die
        SchnellAnlegen-Schnellerfassungszeile am Inhalt. Ein zweiter Knopf im Kopf wären
        zwei Primäraktionen für dieselbe Sache — und der Dialog, den er öffnete, wäre für
        einen Katalog, der am Stück gepflegt wird, das falsche Werkzeug. */}
      <Typography.Paragraph type="secondary">
        Vorschläge für die Stichwort-Combobox im Einsatzdaten-Modul. Freie Eingabe bleibt im
        Einsatz unabhängig davon möglich.
      </Typography.Paragraph>

      {/* Der Fehler tauscht die Tabelle aus, statt durch sie hindurchgereicht zu werden
          (LFH-331 · B3): `Datensicht` führt den Kartenzweig an `Liste`, und `ListeProps`
          kennt keinen Fehlerbegriff — ein Prop am Tabellen-Primitiv wirkte nur in einer
          der beiden Formen. Ohne diese Weiche behauptet „Noch keine Stichworte" auch dann
          einen leeren Katalog, wenn bloß die Verbindung abgerissen ist. */}
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

      {/* Auf dem Primitiv seit LFH-346 (Nacharbeit zu Befund M45). Diese Zeile WAR das
          Vorbild, aus dem `SchnellAnlegen` herausgehoben wurde (Dateikopf dort) — die
          handgebaute Kopie blieb danach als einzige zurueck und hatte damit weder den
          bedingten Reset noch den `mutateAsync`-Vertrag noch eine Beschriftung.
          Sie steht IMMER, auch ohne Recht — dann gesperrt: sie zu verstecken war die
          vierte Auspraegung von „nur lesen", die M45 abschaffen sollte. Den Grund nennt
          der `RechteHinweis` im `hinweis`-Slot oben.
          Sie bleibt UNTER der Tabelle, anders als in den vier Schwestersektionen: der
          Ortswechsel waere eine Gestaltungsaenderung ohne Anlass, und die Eigenschaft,
          derentwegen die anderen oben stehen (ausserhalb der Fehlerweiche), hat sie hier
          ebenso. */}
      <SchnellAnlegen
        beschriftung="Neues Stichwort"
        // Der Platzhalter wiederholt die Beschriftung NICHT — er ergänzt sie um das
        // Beispiel. „Neues Stichwort" stünde sonst zweimal übereinander.
        platzhalter="z. B. H1Y"
        knopfText="Hinzufügen"
        onAnlegen={(text) => anlegenMutation.mutateAsync(text)}
        laeuft={anlegenMutation.isPending}
        gesperrt={!istAdmin}
      />
    </AdminPage>
  );
}
