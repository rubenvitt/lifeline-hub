import { App, Button, Collapse, Form, Input, Popconfirm, Space, type TableColumnsType } from 'antd';
import KatalogTabelle from '../components/KatalogTabelle';
import { ErfassungsModal } from '../components/Erfassung';
import { SeitenFehler } from '../components/SeitenZustand';
import { Select } from '../components/Select';
import AdminPage from '../components/AdminPage';
import { StatusChip, monoStil } from '../components/instrument';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router';
import type { BenutzerAnzeige, OrgRolle, SystemRolle } from '../api/types';
import { fehlerText } from '../api/client';
import { PASSWORT_MIN_LAENGE } from '../api/auth';
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
    // Nur invalidieren: das Schließen macht `onFertig`, das Leeren die Hülle.
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.benutzer() }),
    onError: (e) => message.error(fehlerText(e, 'Anlegen fehlgeschlagen')),
  });

  const deaktivieren = useMutation({
    mutationFn: (id: number) => deaktiviereBenutzer(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.benutzer() }),
    onError: (e) => message.error(fehlerText(e, 'Deaktivieren fehlgeschlagen')),
  });

  const bearbeiten = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: PatchBenutzer }) =>
      bearbeiteBenutzer(id, patch),
    // Diese Mutation trägt zwei Wege, den Bearbeiten-Dialog und „Reaktivieren" in der Zeile. Das
    // Schließen des Dialogs macht deshalb `onFertig` an der Hülle, nicht dieser Erfolgszweig.
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.benutzer() }),
    onError: (e) => message.error(fehlerText(e, 'Speichern fehlgeschlagen')),
  });

  /**
   * Vorbelegung, kein `key`: die Hülle setzt auf allen vier Auswegen zurück, der zweite Datensatz
   * erbt nicht die Werte des ersten. Dieselbe Bauform wie in `PersonalFormModal` und den
   * Stammdaten-Tabs.
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
      // Leitspalte: am Anzeigenamen sucht ein Mensch das Konto. Ein Angebot, keine Voreinstellung —
      // `routes/benutzer.rs` liefert ORDER BY id.
      sorter: (a, b) => a.anzeigename.localeCompare(b.anzeigename, 'de'),
    },
    // Die Suche liest den Rohwert der Spalte: das führende „@" ist Darstellung, gesucht wird „eva".
    {
      title: 'Benutzername',
      dataIndex: 'benutzername',
      key: 'benutzername',
      // Kennung in Mono.
      render: (t) => <span style={monoStil(13)}>@{t}</span>,
    },
    {
      title: 'Rollen',
      key: 'rollen',
      render: (_, b) => (
        // Rollen sind Zuordnungen, keine Zustände: neutrale Chips, das Wort trägt die Aussage (Blau
        // hieße Bedienung).
        <Space size={4} wrap>
          {b.system_rolle === 'admin' && <StatusChip ton="neutral" wort="Admin" />}
          {b.org_rolle === 'fuehrungskraft' && <StatusChip ton="neutral" wort="Führungskraft" />}
          {b.system_rolle !== 'admin' && b.org_rolle !== 'fuehrungskraft' && (
            <StatusChip ton="neutral" wort="Benutzer" />
          )}
        </Space>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      // Bewusst ohne `dataIndex`: `onFilter` bekommt den ganzen Datensatz, und ohne Datenbezug
      // fällt das Feld nicht in den Suchkorpus — sonst träfe die Suche nach „true"/„false" jede
      // aktive bzw. deaktivierte Zeile.
      filters: [
        { text: 'aktiv', value: true },
        { text: 'deaktiviert', value: false },
      ],
      onFilter: (wert, b) => b.aktiv === wert,
      render: (_, b) =>
        b.aktiv ? (
          <StatusChip ton="normal" wort="aktiv" />
        ) : (
          <StatusChip ton="neutral" wort="deaktiviert" />
        ),
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
              {/* Zeilengescopte Ladeanzeige: ohne Rückmeldung lädt der Klick zum zweiten ein.
                  `variables` ist die nackte id. */}
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
      {/* Der Fehler tauscht die Tabelle aus, statt durch sie gereicht zu werden: `Datensicht`
          führt den Kartenzweig an `Liste`, und `ListeProps` kennt keinen Fehlerbegriff. Ohne
          diese Weiche behauptete „Noch keine Benutzer" einen leeren Katalog, wenn bloß die
          Verbindung abgerissen ist. */}
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

      {/* Auf der Hülle: der Absende-Knopf liegt im `<form>`, Enter sendet ab. Kein `serie` —
          ein Benutzerkonto legt man nicht im Minutentakt an. Den Fokus setzt die Hülle.

          Feldbudget: drei sichtbare Felder (die Pflichtwerte Anzeigename, Benutzername,
          Passwort), zwei eingeklappt. Die Rollen tragen mit `keiner`/`keine` einen brauchbaren
          Vorgabewert und dürfen deshalb eingeklappt sein — die schwächste Rolle ist beim
          Anlegen die richtige Vorgabe. */}
      <ErfassungsModal<NeuerBenutzer>
        offen={offen}
        titel="Neuen Benutzer anlegen"
        form={form}
        erfassenText="Anlegen"
        laeuft={anlegen.isPending}
        initialValues={{ system_rolle: 'keiner', org_rolle: 'keine' }}
        // `mutateAsync`, nicht `mutate`: bei Ablehnung muss die Zusage brechen, sonst leert die
        // Hülle die Felder, obwohl das Konto nie angelegt wurde.
        //
        // Der Formularspeicher statt der `onFinish`-Werte: ohne `forceRender` sind die
        // Rollen-Selects nicht montiert, und `onFinish` liefert nur montierte Felder.
        // `system_rolle` und `org_rolle` fehlten sonst im Rumpf, und der Server setzte seine
        // Vorgabe statt der hier zugesagten. `getFieldsValue(true)` liest den ganzen Speicher:
        // `initialValues` und, nach Aufklappen, die Wahl.
        //
        // Der Aufruf ist bei antd `any`-typisiert — die Feldnamen prüft der Parametertyp von
        // `mutationFn`.
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
          rules={[
            {
              required: true,
              min: PASSWORT_MIN_LAENGE,
              message: `Mindestens ${PASSWORT_MIN_LAENGE} Zeichen`,
            },
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        {/* Bewusst ohne `forceRender` (wie `AuftragFormular`): nur wenn die eingeklappten
            Felder nicht im DOM stehen, ist „drei Felder" prüfbar. Gegenmittel am `onErfassen`
            oben. */}
        <Collapse
          ghost
          style={{ marginInline: -8 }}
          items={[
            {
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
            },
          ]}
        />
      </ErfassungsModal>

      {/* Der Dialog steht unbedingt im Baum (`offen` statt `{zuBearbeiten && …}`):
          `destroyOnHidden` hängt die Felder beim Schließen ohnehin ab, und während der
          Schließanimation ist `zuBearbeiten` schon `null` — jeder Lesezugriff hier optional. */}
      <ErfassungsModal<BearbeitenWerte>
        offen={zuBearbeiten !== null}
        titel="Benutzer bearbeiten"
        form={editForm}
        erfassenText="Speichern"
        laeuft={bearbeiten.isPending && bearbeiten.variables?.id === zuBearbeiten?.id}
        // Werfen statt stillem `return`: ein aufgelöstes Versprechen läse die Hülle als Erfolg und
        // schlösse den Dialog, ohne dass etwas gesendet wurde.
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
