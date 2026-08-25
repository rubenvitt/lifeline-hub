import {
  App, Button, Form, Input, InputNumber, Popconfirm, Space, type TableColumnsType,
} from 'antd';
import AdminPage from '../components/AdminPage';
import { ErfassungsModal } from '../components/Erfassung';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import KatalogTabelle from '../components/KatalogTabelle';
import SchnellAnlegen from '../components/SchnellAnlegen';
import { SeitenFehler } from '../components/SeitenZustand';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import {
  aktualisiereTyp, deaktiviereTyp, legeTypAn, listeEinheitTypen, type TypEingabe,
} from '../api/einheitTypen';
import type { EinheitTyp, Staerke } from '../api/types';
import StaerkeAnzeige from '../anzeige/StaerkeAnzeige';
import StaerkeEingabe from '../anzeige/StaerkeEingabe';
import { globalKeys } from '../api/queryKeys';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';

interface FormWerte {
  label: string;
  soll?: Staerke | null;
  sortier: number;
}

export default function EinheitTypenTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerte>();
  // Der Offen-Zustand des Dialogs IST der zu bearbeitende Datensatz (LFH-332 · B4):
  // seit das Anlegen in der Schnellerfassung sitzt, gibt es kein „offen ohne
  // Datensatz" mehr. Ein zweites `modalOffen` daneben könnte nur noch von diesem
  // hier abweichen.
  const [bearbeite, setBearbeite] = useState<EinheitTyp | null>(null);

  const typenQuery = useQuery({ queryKey: globalKeys.einheitTypen(), queryFn: listeEinheitTypen });

  const speichern = useMutation({
    mutationFn: ({ id, werte }: { id: number; werte: FormWerte }) => {
      const daten: TypEingabe = {
        label: werte.label.trim(),
        soll_fuehrer: werte.soll?.fuehrer ?? null,
        soll_unterfuehrer: werte.soll?.unterfuehrer ?? null,
        soll_mannschaft: werte.soll?.mannschaft ?? null,
        sortier: werte.sortier ?? 0,
      };
      return aktualisiereTyp(id, daten);
    },
    // Nur noch invalidieren: das Schliessen macht `onFertig`, das Leeren die Hülle.
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.einheitTypen() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  /**
   * Schnellerfassung (LFH-332 · B4, Befund M43). Pflicht ist allein das Label.
   * Die Soll-Stärke bleibt leer — `TypEingabe` lässt alle drei Teile `null` zu,
   * und die Tabelle zeigt dafür „—"; `sortier: 0` ist byte-genau die Vorbelegung
   * des gestrichenen Anlege-Zweigs (`form.setFieldsValue({ sortier: 0 })`).
   * Beides trägt man bei Bedarf im Bearbeiten-Dialog nach.
   *
   * KEINE Erfolgsmeldung: die neue Zeile in der Tabelle ist die Rückmeldung.
   */
  const schnellAnlegen = useMutation({
    mutationFn: (label: string) => legeTypAn({
      label,
      soll_fuehrer: null,
      soll_unterfuehrer: null,
      soll_mannschaft: null,
      sortier: 0,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.einheitTypen() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Anlegen fehlgeschlagen'),
  });

  const deaktivieren = useMutation({
    mutationFn: (id: number) => deaktiviereTyp(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.einheitTypen() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Deaktivieren fehlgeschlagen'),
  });

  // VORBELEGUNG, kein Zurücksetzen (LFH-332 · B4, Regel 3): das Leeren macht
  // `ErfassungsModal` auf allen vier Auswegen selbst. Ein Reset hier wäre doppelt
  // und verdeckte, ob die Hülle ihre Zusicherung überhaupt einlöst.
  useEffect(() => {
    if (bearbeite) {
      form.setFieldsValue({
        label: bearbeite.label,
        soll: bearbeite.soll,
        sortier: bearbeite.sortier,
      });
    }
  }, [bearbeite, form]);

  // Keine Filterspalte in diesem Katalog: `EinheitTyp` trägt weder Status noch Kategorie, und
  // `einheit/typ_repo.rs` liefert ohnehin nur `WHERE aktiv = 1` — eine Aktiv-Achse gäbe es hier
  // also nicht einmal in den Daten. Erfunden wird sie nicht.
  const spalten: TableColumnsType<EinheitTyp> = [
    {
      title: 'Label',
      dataIndex: 'label',
      key: 'label',
      // Leitspalte: am Label sucht ein Mensch den Typ. Die Sortierung ist ein ANGEBOT ohne
      // `defaultSortOrder` — voreingestellt bleibt die fachliche Reihenfolge des Backends
      // (`einheit/typ_repo.rs`: ORDER BY sortier, id), die die Zug-vor-Gruppe-Ordnung hält.
      sorter: (a, b) => a.label.localeCompare(b.label, 'de'),
    },
    { title: 'Soll-Stärke (F/UF/M//Σ)', key: 'soll', render: (_, t) => <StaerkeAnzeige wert={t.soll ?? null} /> },
    {
      title: 'Sortierung',
      dataIndex: 'sortier',
      key: 'sortier',
      // Numerisch vergleichen, nicht über die Zeichenkette: nur so steht 5 vor 40.
      sorter: (a, b) => a.sortier - b.sortier,
    },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, t: EinheitTyp) => (
              <Space size="middle">
                <Button onClick={() => setBearbeite(t)}>Bearbeiten</Button>
                <Popconfirm
                  title="Typ deaktivieren?"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => deaktivieren.mutate(t.id)}
                >
                  <Button danger>Deaktivieren</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ] as TableColumnsType<EinheitTyp>)
      : []),
  ];

  return (
    <AdminPage
      titel="Einheitstypen"
      hinweis={<SeitenHinweise rechteFehlt={!istAdmin} rechteText={STAMMDATEN_RECHTE_TEXT} />}
    >
    {/* KEIN `aktionen`-Slot (LFH-346 · A3): der Anlegen-Weg dieser Sektion ist die
        SchnellAnlegen Schnellerfassungszeile am Inhalt. Ein zweiter Knopf im Kopf wären
        zwei Primäraktionen für dieselbe Sache — und der Dialog, den er öffnete, wäre für
        einen Katalog, der am Stück gepflegt wird, das falsche Werkzeug. */}
      {/* Die Schnellerfassung steht ÜBER der Tabelle — dort, wo bis LFH-332 der Knopf
          „Typ anlegen" stand, und bewusst AUSSERHALB der Fehlerweiche darunter: ein
          gescheiterter Abruf der Liste ist kein Grund, die einzige Schreibmöglichkeit
          der Seite verschwinden zu lassen.
          Der Platzhalter nennt NICHT „Label" — diesen Wortlaut trägt bereits das
          Suchfeld der Tabelle, und ein zweiter Knoten mit demselben Platzhalter machte
          den Griff darauf mehrdeutig. */}
      {istAdmin && (
        <SchnellAnlegen
          beschriftung="Neuer Einheitstyp"
          platzhalter="z. B. Zug"
          knopfText="Typ anlegen"
          onAnlegen={(label) => schnellAnlegen.mutateAsync(label)}
          laeuft={schnellAnlegen.isPending}
        />
      )}
      {/* Der Fehler tauscht die Tabelle aus, statt durch sie hindurchgereicht zu werden
          (LFH-331 · B3): `Datensicht` führt den Kartenzweig an `Liste`, und `ListeProps`
          kennt keinen Fehlerbegriff — ein Prop am Tabellen-Primitiv wirkte nur in einer
          der beiden Formen. Ohne diese Weiche behauptet „Kein Einheitstyp" auch dann
          einen leeren Katalog, wenn bloß die Verbindung abgerissen ist. */}
      {typenQuery.isError ? (
        <SeitenFehler
          text="Einheitstypen konnten nicht geladen werden"
          ursache={typenQuery.error}
          onWiederholen={() => void typenQuery.refetch()}
        />
      ) : (
        <KatalogTabelle
          rowKey="id"
          loading={typenQuery.isLoading}
          dataSource={typenQuery.data ?? []}
          columns={spalten}
          locale={{ emptyText: 'Kein Einheitstyp' }}
          // Der Platzhalter nennt das Feld, das man tippt. Die Spalte „Sortierung" fällt über ihren
          // `dataIndex` technisch mit in den Suchkorpus (gemessen: „4" trifft Zug über `sortier: 40`) —
          // harmlos, aber kein Grund, sie in den Platzhalter zu schreiben.
          suche={{ platzhalter: 'Label' }}
        />
      )}
      {/* Nur noch Bearbeiten (LFH-332 · B4). Angelegt wird über die Zeile oben.

          Auf der Hülle seit LFH-346 · A6: der Absende-Knopf liegt damit IM `<form>`,
          also sendet Enter ab (Befund H69) — vorher stand er in antds Fusszeile und
          war ein DOM-Geschwister ausserhalb. KEIN `serie`: hier wird bearbeitet,
          nicht in Serie erfasst. Die Feldzahl bleibt unverändert. */}
      <ErfassungsModal<FormWerte>
        offen={bearbeite !== null}
        titel="Typ bearbeiten"
        form={form}
        erfassenText="Speichern"
        laeuft={speichern.isPending}
        // `mutateAsync`, nicht `mutate`: bei Ablehnung MUSS die Zusage brechen,
        // sonst leert die Hülle die Felder, obwohl der Datensatz nie ankam. Der
        // Wurf im Leerfall ist derselbe Gedanke — ein stilles `return` läse sich
        // für die Hülle als Erfolg und schlösse den Dialog ohne Request.
        onErfassen={async (w) => {
          if (!bearbeite) throw new Error('Kein Datensatz zum Bearbeiten');
          await speichern.mutateAsync({ id: bearbeite.id, werte: w });
        }}
        onFertig={() => setBearbeite(null)}
        onAbbrechen={() => setBearbeite(null)}
      >
        <Form.Item label="Label" name="label" rules={[{ required: true, whitespace: true }]}>
          <Input placeholder="z. B. Zug" />
        </Form.Item>
        <Form.Item label="Soll-Stärke (vollständig oder leer lassen)" name="soll">
          <StaerkeEingabe />
        </Form.Item>
        <Form.Item label="Sortierung" name="sortier"><InputNumber min={0} style={{ width: '100%', maxWidth: 120 }} /></Form.Item>
      </ErfassungsModal>
    </AdminPage>
  );
}
