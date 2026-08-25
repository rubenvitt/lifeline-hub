import {
  App, Button, Collapse, Form, Input, Popconfirm, Space, Tag, type TableColumnsType,
} from 'antd';
import KatalogTabelle from '../components/KatalogTabelle';
import { ErfassungsModal } from '../components/Erfassung';
import { SeitenFehler } from '../components/SeitenZustand';
import { Select } from '../components/Select';
import AdminPage from '../components/AdminPage';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router';
import type { BenutzerAnzeige, OrgRolle, SystemRolle } from '../api/types';
import { ApiError } from '../api/client';
import {
  bearbeiteBenutzer,
  deaktiviereBenutzer,
  legeBenutzerAn,
  listeBenutzer,
  type NeuerBenutzer,
  type PatchBenutzer,
} from '../api/benutzer';
import { useAuth } from '../auth/AuthContext';
import { globalKeys } from '../api/queryKeys';

interface BearbeitenWerte {
  anzeigename: string;
  system_rolle: SystemRolle;
  org_rolle: OrgRolle;
}

const SYSTEM_ROLLEN = [
  { value: 'keiner', label: 'Benutzer' },
  { value: 'admin', label: 'Admin' },
];
const ORG_ROLLEN = [
  { value: 'keine', label: 'Keine' },
  { value: 'fuehrungskraft', label: 'Führungskraft (darf Einsätze anlegen)' },
];

export default function BenutzerPage() {
  const { benutzer: angemeldeterBenutzer, laedt: authLaedt } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [offen, setOffen] = useState(false);
  const [form] = Form.useForm<NeuerBenutzer>();
  const [zuBearbeiten, setZuBearbeiten] = useState<BenutzerAnzeige | null>(null);
  const [editForm] = Form.useForm<BearbeitenWerte>();

  const benutzerQuery = useQuery({
    queryKey: globalKeys.benutzer(),
    queryFn: listeBenutzer,
  });
  const benutzerListe = benutzerQuery.data ?? [];

  const anlegen = useMutation({
    mutationFn: (b: NeuerBenutzer) => legeBenutzerAn(b),
    // Nur noch invalidieren: das Schliessen macht `onFertig`, das Leeren die Hülle
    // (LFH-346 · A6). Ein `resetFields()` hier wäre der zweite Mechanismus für
    // dieselbe Sache und verdeckte, ob die Hülle ihre Zusicherung einlöst.
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.benutzer() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Anlegen fehlgeschlagen'),
  });

  const deaktivieren = useMutation({
    mutationFn: (id: number) => deaktiviereBenutzer(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.benutzer() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Deaktivieren fehlgeschlagen'),
  });

  const bearbeiten = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: PatchBenutzer }) => bearbeiteBenutzer(id, patch),
    // Diese Mutation trägt ZWEI Wege: den Bearbeiten-Dialog und „Reaktivieren" in der
    // Zeile. Das Schliessen des Dialogs macht deshalb `onFertig` an der Hülle, nicht
    // dieser Erfolgszweig — der lief bisher auch nach einem Reaktivieren mit.
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.benutzer() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  /**
   * VORBELEGUNG, kein `key` (LFH-346 · A6). Bis hierher hängte dieser Dialog über
   * `key={zuBearbeiten.id}` am `<Form>` einen frischen Baum ein, damit der zweite
   * Datensatz nicht die Werte des ersten erbt. Die Hülle löst dasselbe Problem
   * selbst — sie setzt auf allen vier Auswegen zurück —, und zwei Mechanismen für
   * eine Sache sind einer zu viel. Geblieben ist die Vorbelegung, dieselbe Bauform
   * wie in `PersonalFormModal` und den vier Stammdaten-Tabs.
   */
  useEffect(() => {
    if (!zuBearbeiten) return;
    editForm.setFieldsValue({
      anzeigename: zuBearbeiten.anzeigename,
      system_rolle: zuBearbeiten.system_rolle,
      org_rolle: zuBearbeiten.org_rolle,
    });
  }, [zuBearbeiten, editForm]);

  if (!authLaedt && angemeldeterBenutzer?.system_rolle !== 'admin') {
    return <Navigate to="/einsaetze" replace />;
  }

  const spalten: TableColumnsType<BenutzerAnzeige> = [
    {
      title: 'Name',
      dataIndex: 'anzeigename',
      key: 'anzeigename',
      // Leitspalte: am Anzeigenamen sucht ein Mensch das Konto. Ein Angebot, keine neue
      // Voreinstellung — `routes/benutzer.rs` liefert ORDER BY id, also die Anlage-Reihenfolge;
      // die ist keine fachliche Ordnung, aber sie umzustellen ist nicht Teil dieses Umbaus.
      sorter: (a, b) => a.anzeigename.localeCompare(b.anzeigename, 'de'),
    },
    // Die Suche liest den ROHWERT der Spalte, nicht das Gerenderte: das führende „@" ist reine
    // Darstellung, gesucht wird „eva", nicht „@eva".
    { title: 'Benutzername', dataIndex: 'benutzername', key: 'benutzername', render: (t) => `@${t}` },
    {
      title: 'Rollen',
      key: 'rollen',
      render: (_, b) => (
        <Space size={4}>
          {b.system_rolle === 'admin' && <Tag color="gold">Admin</Tag>}
          {b.org_rolle === 'fuehrungskraft' && <Tag color="blue">Führungskraft</Tag>}
          {b.system_rolle !== 'admin' && b.org_rolle !== 'fuehrungskraft' && <Tag>Benutzer</Tag>}
        </Space>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      // Bewusst OHNE `dataIndex`: `onFilter` bekommt den ganzen Datensatz, und ohne Datenbezug
      // fällt das Feld nicht in den Suchkorpus des Primitivs — sonst träfe die Freitextsuche
      // nach „true"/„false" jede aktive bzw. deaktivierte Zeile.
      filters: [
        { text: 'aktiv', value: true },
        { text: 'deaktiviert', value: false },
      ],
      onFilter: (wert, b) => b.aktiv === wert,
      render: (_, b) => (b.aktiv ? <Tag color="green">aktiv</Tag> : <Tag>deaktiviert</Tag>),
    },
    {
      title: 'Aktionen',
      key: 'aktionen',
      render: (_, b) => (
        <Space size="middle">
          <Button onClick={() => setZuBearbeiten(b)}>Bearbeiten</Button>
          {b.aktiv ? (
            <Popconfirm
              title="Benutzer deaktivieren?"
              okText="Ja"
              cancelText="Abbrechen"
              okButtonProps={{ danger: true }}
              onConfirm={() => deaktivieren.mutate(b.id)}
            >
              {/* Zeilengescopte Ladeanzeige (LFH-346 · A1). Vorher trug „Deaktivieren"
                  ÜBERHAUPT keine — anders als „Reaktivieren" daneben —, ein Klick blieb
                  also ohne jede Rückmeldung und lud zum zweiten ein. `variables` ist hier
                  die nackte id. */}
              <Button danger loading={deaktivieren.isPending && deaktivieren.variables === b.id}>
                Deaktivieren
              </Button>
            </Popconfirm>
          ) : (
            <Button
              loading={bearbeiten.isPending && bearbeiten.variables?.id === b.id}
              onClick={() => bearbeiten.mutate({ id: b.id, patch: { aktiv: true } })}
            >
              Reaktivieren
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <AdminPage
      titel="Benutzer"
      beschreibung="System- und Org-Rollen der Benutzerkonten verwalten."
      aktionen={
        <Button type="primary" onClick={() => setOffen(true)}>
          Benutzer anlegen
        </Button>
      }
    >
      {/* Der Fehler tauscht die Tabelle aus, statt durch sie hindurchgereicht zu werden
          (LFH-331 · B3): `Datensicht` führt den Kartenzweig an `Liste`, und `ListeProps`
          kennt keinen Fehlerbegriff — ein Prop am Tabellen-Primitiv wirkte nur in einer
          der beiden Formen. Ohne diese Weiche behauptet „Noch keine Benutzer" auch dann
          einen leeren Katalog, wenn bloß die Verbindung abgerissen ist. */}
      {benutzerQuery.isError ? (
        <SeitenFehler
          text="Benutzer konnten nicht geladen werden"
          ursache={benutzerQuery.error}
          onWiederholen={() => void benutzerQuery.refetch()}
        />
      ) : (
        <KatalogTabelle
          rowKey="id"
          loading={benutzerQuery.isLoading}
          dataSource={benutzerListe}
          columns={spalten}
          locale={{ emptyText: 'Noch keine Benutzer' }}
          suche={{ platzhalter: 'Name oder Benutzername' }}
        />
      )}

      {/* Auf der Hülle seit LFH-346 · A6: der Absende-Knopf liegt damit IM `<form>`,
          also sendet Enter ab (Befund H69) — vorher stand er in antds Fusszeile und
          war ein DOM-Geschwister ausserhalb. KEIN `serie`: ein Benutzerkonto legt man
          nicht im Minutentakt an. Das `autoFocus` am ersten Feld ist weg — den Fokus
          setzt die Hülle, und zwei Quellen dafür sind eine zu viel.

          FELDBUDGET seit A8 (Befund N20): drei sichtbare Felder, zwei eingeklappt.
          Sichtbar bleiben die Pflichtwerte Anzeigename, Benutzername und Passwort;
          die beiden Rollen tragen mit `keiner`/`keine` einen brauchbaren Vorgabewert
          und sind damit die einzigen zwei Felder, die eingeklappt sein DÜRFEN
          (LFH-343 · H49) — die schwächste Rolle ist beim Anlegen zugleich die
          richtige Vorgabe. Der Bearbeiten-Dialog darunter hat drei Felder und bleibt
          unverändert. */}
      <ErfassungsModal<NeuerBenutzer>
        offen={offen}
        titel="Neuen Benutzer anlegen"
        form={form}
        erfassenText="Anlegen"
        laeuft={anlegen.isPending}
        initialValues={{ system_rolle: 'keiner', org_rolle: 'keine' }}
        // `mutateAsync`, nicht `mutate`: bei Ablehnung MUSS die Zusage brechen,
        // sonst leert die Hülle die Felder, obwohl das Konto nie angelegt wurde.
        //
        // Der Formularspeicher statt der `onFinish`-Werte (LFH-346 · A8): ohne
        // `forceRender` sind die beiden Rollen-Selects nicht montiert, und `onFinish`
        // liefert nur montierte Felder. Ohne diesen Griff fehlten `system_rolle` und
        // `org_rolle` im Rumpf, sobald niemand aufklappt — beide sind im DTO optional,
        // der Server setzte also SEINE Vorgabe statt der hier sichtbar zugesagten.
        // `getFieldsValue(true)` liest den Speicher ganz aus; dort stehen die
        // `initialValues` und, nach einem Aufklappen, die getroffene Wahl.
        //
        // Beachten: der Aufruf ist bei antd `any`-typisiert — die Feldnamen prüft
        // nicht er, sondern der Parametertyp von `mutationFn`.
        onErfassen={() => anlegen.mutateAsync(form.getFieldsValue(true))}
        onFertig={() => setOffen(false)}
        onAbbrechen={() => setOffen(false)}
      >
        <Form.Item
          label="Anzeigename"
          name="anzeigename"
          rules={[{ required: true, message: 'Bitte Anzeigename eingeben' }]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          label="Benutzername"
          name="benutzername"
          rules={[{ required: true, message: 'Bitte Benutzername eingeben' }]}
        >
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item
          label="Passwort"
          name="passwort"
          rules={[{ required: true, min: 8, message: 'Mindestens 8 Zeichen' }]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        {/* Bewusst OHNE `forceRender` (wie `AuftragFormular`): nur wenn die
            eingeklappten Felder gar nicht im DOM stehen, ist „im Ausgangszustand drei
            Felder" prüfbar. Begründung und Gegenmittel am `onErfassen` oben. */}
        <Collapse
          ghost
          style={{ marginInline: -8 }}
          items={[{
            key: 'rollen',
            label: 'Weitere Angaben',
            children: (
              <>
                <Form.Item label="System-Rolle" name="system_rolle">
                  <Select options={SYSTEM_ROLLEN} />
                </Form.Item>
                <Form.Item label="Org-Rolle" name="org_rolle">
                  <Select options={ORG_ROLLEN} />
                </Form.Item>
              </>
            ),
          }]}
        />
      </ErfassungsModal>

      {/* Der Dialog steht jetzt UNBEDINGT im Baum (`offen` statt `{zuBearbeiten && …}`):
          `destroyOnHidden` an der Hülle hängt die Felder beim Schliessen ohnehin ab, und
          während der Schliessanimation ist `zuBearbeiten` schon `null` — jeder Lesezugriff
          hier optional. */}
      <ErfassungsModal<BearbeitenWerte>
        offen={zuBearbeiten !== null}
        titel="Benutzer bearbeiten"
        form={editForm}
        erfassenText="Speichern"
        laeuft={bearbeiten.isPending && bearbeiten.variables?.id === zuBearbeiten?.id}
        // Der Wurf im Leerfall statt eines stillen `return`: ein aufgelöstes Versprechen
        // läse die Hülle als Erfolg und schlösse den Dialog, ohne dass etwas gesendet wurde.
        onErfassen={async (w) => {
          if (!zuBearbeiten) throw new Error('Kein Benutzer zum Bearbeiten');
          await bearbeiten.mutateAsync({ id: zuBearbeiten.id, patch: w });
        }}
        onFertig={() => setZuBearbeiten(null)}
        onAbbrechen={() => setZuBearbeiten(null)}
      >
        <Form.Item
          label="Anzeigename"
          name="anzeigename"
          rules={[{ required: true, message: 'Bitte Anzeigename eingeben' }]}
        >
          <Input />
        </Form.Item>
        <Form.Item label="System-Rolle" name="system_rolle">
          <Select options={SYSTEM_ROLLEN} />
        </Form.Item>
        <Form.Item label="Org-Rolle" name="org_rolle">
          <Select options={ORG_ROLLEN} />
        </Form.Item>
      </ErfassungsModal>
    </AdminPage>
  );
}
