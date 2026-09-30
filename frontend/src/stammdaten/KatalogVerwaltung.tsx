import { Button, Form, Popconfirm, Space, type TableColumnsType } from 'antd';
import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import AdminPage from '../components/AdminPage';
import { ErfassungsModal } from '../components/Erfassung';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import KatalogTabelle from '../components/KatalogTabelle';
import SchnellAnlegen from '../components/SchnellAnlegen';
import { SeitenFehler } from '../components/SeitenZustand';
import { useFehlerMeldung } from '../components/useFehlerMeldung';
import { useAuth } from '../auth/AuthContext';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';

export interface KatalogEintrag {
  id: number;
}

/**
 * Konfiguration einer schlanken Katalogsektion der Stammdaten (Qualifikationen,
 * Einheitstypen, Personal- und Fahrzeug-Status): Liste, Schnellerfassung per Label,
 * Bearbeiten-Dialog und Deaktivieren. Texte und Felder bleiben je Katalog.
 */
export interface KatalogVerwaltungProps<T extends KatalogEintrag, W extends object> {
  /** Seitenkopf; muss dem Menü-Label in `admin/adminNav.tsx` gleichen. */
  titel: string;
  queryKey: QueryKey;
  liste: () => Promise<T[]>;
  /** Schnellerfassung: Pflicht ist allein das Label, der Rest ist Vorbelegung. */
  legeAn: (label: string) => Promise<unknown>;
  aktualisiere: (id: number, werte: W) => Promise<unknown>;
  deaktiviere: (id: number) => Promise<unknown>;
  /** Formularwerte beim Öffnen des Bearbeiten-Dialogs. Identitätsstabil (Modulebene):
   *  sie steht in den Deps des Vorbelegungs-Effekts, der sonst Eingaben überschriebe. */
  vorbelegung: (eintrag: T) => W;
  /** Datenspalten; die Aktionsspalte hängt die Verwaltung selbst an. */
  spalten: TableColumnsType<T>;
  schnell: { beschriftung: string; platzhalter: string; knopfText: string };
  ladefehlerText: string;
  leerText: string;
  bearbeitenTitel: string;
  deaktivierenFrage: string;
  /** Die `Form.Item`s des Bearbeiten-Dialogs. */
  felder: ReactNode;
  /** Optionaler Hinweis über der Tabelle, abgeleitet aus dem geladenen Katalog (erst nach dem
   *  Abruf, nie aus einem leeren Ladezustand). */
  vorTabelle?: (eintraege: readonly T[]) => ReactNode;
}

export default function KatalogVerwaltung<T extends KatalogEintrag, W extends object>({
  titel,
  queryKey,
  liste,
  legeAn,
  aktualisiere,
  deaktiviere,
  vorbelegung,
  spalten,
  schnell,
  ladefehlerText,
  leerText,
  bearbeitenTitel,
  deaktivierenFrage,
  felder,
  vorTabelle,
}: KatalogVerwaltungProps<T, W>) {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const [form] = Form.useForm<W>();
  // Der Offen-Zustand des Dialogs IST der zu bearbeitende Datensatz.
  const [bearbeite, setBearbeite] = useState<T | null>(null);
  const invalidiere = () => qc.invalidateQueries({ queryKey });

  const query = useQuery({ queryKey, queryFn: liste });
  const speicherFehler = useFehlerMeldung('Speichern fehlgeschlagen');

  // Das Schliessen macht `onFertig`, das Leeren die Hülle.
  //
  // Der Toast BLEIBT hier (LFH-473, eigene Entscheidung für den Dialog): nach einer Ablehnung
  // steht der Dialog offen und der Wortlaut in den Feldern, nichts wirkt gespeichert. Der
  // Seiten-Slot läge hinter der Maske.
  const speichern = useMutation({
    mutationFn: ({ id, werte }: { id: number; werte: W }) => aktualisiere(id, werte),
    onSuccess: invalidiere,
    onError: speicherFehler,
  });

  // KEINE Erfolgsmeldung: die neue Zeile in der Tabelle ist die Rückmeldung.
  const schnellAnlegen = useMutation({
    mutationFn: legeAn,
    onSuccess: invalidiere,
  });

  const deaktivieren = useMutation({
    mutationFn: deaktiviere,
    onSuccess: invalidiere,
  });

  /**
   * Schnellerfassung und Deaktivieren OHNE `onError` (LFH-473): ein Toast wäre nach drei Sekunden
   * weg, danach sagte nichts mehr, dass und warum die Handlung scheiterte. Der Fehler steht im
   * `SeitenHinweise`-Slot.
   *
   * EIN Slot, zwei Handlungen: wer eine auslöst, räumt den Fehler der anderen (`reset`). Sonst
   * stünde nach dem nächsten Versuch ein alter Grund über der Seite, denn react-query räumt
   * `error` nur beim eigenen `mutate()`.
   */
  const seitenFehler = deaktivieren.error
    ? {
        fehler: deaktivieren.error,
        titel: 'Nicht deaktiviert',
        fallback: 'Deaktivieren fehlgeschlagen',
      }
    : { fehler: schnellAnlegen.error, titel: 'Nicht angelegt', fallback: 'Anlegen fehlgeschlagen' };

  // VORBELEGUNG, kein Zurücksetzen: das Leeren macht `ErfassungsModal` auf allen vier
  // Auswegen selbst.
  useEffect(() => {
    if (bearbeite)
      form.setFieldsValue(vorbelegung(bearbeite) as Parameters<typeof form.setFieldsValue>[0]);
  }, [bearbeite, form, vorbelegung]);

  const aktionsSpalte: TableColumnsType<T> = istAdmin
    ? [
        {
          title: 'Aktionen',
          key: 'aktionen',
          render: (_, eintrag: T) => (
            <Space size="middle">
              <Button onClick={() => setBearbeite(eintrag)}>Bearbeiten</Button>
              <Popconfirm
                title={deaktivierenFrage}
                okButtonProps={{ danger: true }}
                onConfirm={() => {
                  schnellAnlegen.reset();
                  deaktivieren.mutate(eintrag.id);
                }}
              >
                <Button danger>Deaktivieren</Button>
              </Popconfirm>
            </Space>
          ),
        },
      ]
    : [];

  return (
    <AdminPage
      titel={titel}
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
      {/* Kein `aktionen`-Slot: der Anlegen-Weg ist die Schnellerfassung. Sie steht
          ausserhalb der Fehlerweiche (ein gescheiterter Abruf nimmt nicht die einzige
          Schreibmöglichkeit) und auch ohne Recht, dann gesperrt — den Grund nennt der
          `RechteHinweis`. */}
      <SchnellAnlegen
        beschriftung={schnell.beschriftung}
        platzhalter={schnell.platzhalter}
        knopfText={schnell.knopfText}
        onAnlegen={(label) => {
          deaktivieren.reset();
          return schnellAnlegen.mutateAsync(label);
        }}
        laeuft={schnellAnlegen.isPending}
        gesperrt={!istAdmin}
      />
      {/* Der Fehler tauscht die Tabelle aus: sonst behauptete der Leertext einen leeren
          Katalog, wenn bloß die Verbindung abgerissen ist. */}
      {query.isError ? (
        <SeitenFehler
          text={ladefehlerText}
          ursache={query.error}
          onWiederholen={() => void query.refetch()}
        />
      ) : (
        <>
          {vorTabelle && query.data ? vorTabelle(query.data) : null}
          <KatalogTabelle
            rowKey="id"
            loading={query.isLoading}
            dataSource={query.data ?? []}
            columns={[...spalten, ...aktionsSpalte]}
            // Genannt wird nur das Label: die Suche liest Rohwerte, und nach den übrigen
            // Spalten tippt niemand (Kategorien bedient ihr Spaltenfilter).
            suche={{ platzhalter: 'Label' }}
            locale={{ emptyText: leerText }}
          />
        </>
      )}
      {/* Nur Bearbeiten, kein `serie`. */}
      <ErfassungsModal<W>
        offen={bearbeite !== null}
        titel={bearbeitenTitel}
        form={form}
        erfassenText="Speichern"
        laeuft={speichern.isPending}
        // `mutateAsync`: bei Ablehnung MUSS die Zusage brechen, sonst leert die Hülle die
        // Felder. Gelesen wird der ganze Formularspeicher, nicht die Werte aus `onFinish`:
        // eingeklappte, nie montierte Felder fehlten dort, und die Eingabe ist Vollersatz —
        // ein nie aufgeklapptes Feld würde still gelöscht.
        onErfassen={async () => {
          if (!bearbeite) throw new Error('Kein Datensatz zum Bearbeiten');
          await speichern.mutateAsync({ id: bearbeite.id, werte: form.getFieldsValue(true) });
        }}
        onFertig={() => setBearbeite(null)}
        onAbbrechen={() => setBearbeite(null)}
      >
        {felder}
      </ErfassungsModal>
    </AdminPage>
  );
}
