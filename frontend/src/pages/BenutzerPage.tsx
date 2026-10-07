import { Button, Collapse, Flex, Form, Input, Space } from 'antd';
import KatalogTabelle, {
  KENNUNG_SCHMAL_BREITE,
  type KatalogSpalte,
} from '../components/KatalogTabelle';
import { MenueAusloeser } from '../components/MenueAusloeser';
import { useViewport } from '../components/useViewport';
import { ErfassungsModal } from '../components/Erfassung';
import { SeitenFehler } from '../components/SeitenZustand';
import { Select } from '../components/Select';
import AdminPage from '../components/AdminPage';
import { StatusChip, monoStil, useRollen } from '../components/instrument';
import { useEffect, useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router';
import type { BenutzerAnzeige, OrgRolle, SystemRolle } from '../api/types';
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
import { SeitenHinweise, SpeicherFehler } from '../components/SpeicherHinweis';
import { EIGENES_KONTO, LETZTER_ADMIN } from '../stammdaten/rechteText';

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
  const [offen, setOffen] = useState(false);
  const [form] = Form.useForm<NeuerBenutzer>();
  const [zuBearbeiten, setZuBearbeiten] = useState<BenutzerAnzeige | null>(null);
  const [editForm] = Form.useForm<BearbeitenWerte>();
  const { istSchmal } = useViewport();

  const benutzerQuery = useQuery({
    queryKey: globalKeys.benutzer(),
    queryFn: listeBenutzer,
  });
  const benutzerListe = benutzerQuery.data ?? [];

  /*
   * Kein `onError`-Toast (LFH-966, `frontend/AGENTS.md`, „Speicherfehler an die Seite, Erfolg an
   * den Toast“): die Dialoge zeigen ihren Fehler im Dialog, die Zeilenaktionen über der Tabelle.
   * Der Grund steht, bis zum nächsten Absenden — react-query räumt `error` beim nächsten `mutate`.
   */
  const anlegen = useMutation({
    mutationFn: (b: NeuerBenutzer) => legeBenutzerAn(b),
    // Nur invalidieren: das Schließen macht `onFertig`, das Leeren die Hülle.
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.benutzer() }),
  });

  const deaktivieren = useMutation({
    mutationFn: (id: number) => deaktiviereBenutzer(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.benutzer() }),
  });

  // Der Bearbeiten-Dialog. Das Schließen macht `onFertig` an der Hülle, nicht dieser Erfolgszweig.
  const bearbeiten = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: PatchBenutzer }) =>
      bearbeiteBenutzer(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.benutzer() }),
  });

  // „Reaktivieren" in der Zeile — eigene Mutation, damit sein Fehler an der Seite steht und
  // nicht im Bearbeiten-Dialog (und umgekehrt).
  const reaktivieren = useMutation({
    mutationFn: (id: number) => bearbeiteBenutzer(id, { aktiv: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.benutzer() }),
  });

  /** Zeilenaktionen teilen EINEN Hinweis: die neue räumt den Fehler der anderen. */
  const zeilenAktion = (aktion: 'deaktivieren' | 'reaktivieren', id: number) => {
    if (aktion === 'deaktivieren') {
      reaktivieren.reset();
      deaktivieren.mutate(id);
    } else {
      deaktivieren.reset();
      reaktivieren.mutate(id);
    }
  };

  /**
   * Gesperrtes „Deaktivieren" (LFH-966): beim letzten aktiven Admin lehnte der Server ab
   * (`routes/benutzer.rs`, `verweigere_admin_lockout`), beim eigenen Konto endete die eigene
   * Sitzung ohne Rückweg. Statt einer Aktion, die nie gelingt, steht der Grund in der Zeile.
   */
  const aktiveAdmins = benutzerListe.filter((b) => b.aktiv && b.system_rolle === 'admin').length;
  const sperrGrund = (b: BenutzerAnzeige): { kurz: string; text: string } | null => {
    if (b.aktiv && b.system_rolle === 'admin' && aktiveAdmins <= 1) return LETZTER_ADMIN;
    if (b.id === angemeldeterBenutzer?.id) return EIGENES_KONTO;
    return null;
  };

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

  /**
   * Breiten nach der Regel „Fließende Spalte" (LFH-523, `frontend/AGENTS.md`): genau eine Spalte
   * fließt, alle übrigen tragen eine Zahl, sonst bleibt die Tabelle inhaltsgetrieben.
   *
   * Die fixierte Namensspalte ist gedeckelt (LFH-819). Ohne Zahl wuchs sie mit dem längsten
   * Anzeigenamen; auf 390 px blieb rechts daneben zu wenig Raum, und beim Tabben lag
   * „Bearbeiten" vollständig unter ihr (WCAG 2.4.11, `e2e/fokus-verdeckung.spec.ts`). Die Zahl ist
   * gegen die schmalste Fläche (mobil, 390 px) gewählt; der Name bricht um, statt gekürzt zu
   * werden — die menschenlesbare Kennung bleibt ganz lesbar.
   *
   * Unter `md` fallen Benutzername und Rollen weg (der Spaltenschalter zählt sie), Status und
   * Aktionen stehen rechts fixiert, die Aktionen dort im Menü (LFH-980): Name, Status und Menü
   * passen in 390 px, zwei Knöpfe nicht.
   */
  const spalten: KatalogSpalte<BenutzerAnzeige>[] = [
    {
      title: 'Name',
      dataIndex: 'anzeigename',
      key: 'anzeigename',
      width: KENNUNG_SCHMAL_BREITE,
      // Leitspalte: am Anzeigenamen sucht ein Mensch das Konto. Ein Angebot, keine Voreinstellung —
      // `routes/benutzer.rs` liefert ORDER BY id.
      sorter: (a, b) => a.anzeigename.localeCompare(b.anzeigename, 'de'),
      render: (t: string) => <span style={{ overflowWrap: 'anywhere' }}>{t}</span>,
    },
    // Die Suche liest den Rohwert der Spalte: das führende „@" ist Darstellung, gesucht wird „eva".
    {
      title: 'Benutzername',
      dataIndex: 'benutzername',
      key: 'benutzername',
      // Die Fließspalte: ein Benutzername ist ein Wort ohne Bruchstelle und bricht notfalls
      // mitten im Wort, statt die Summe zu sprengen.
      mindestBreite: 160,
      abBreite: 'md',
      // Kennung in Mono.
      render: (t) => <span style={{ ...monoStil(13), overflowWrap: 'anywhere' }}>@{t}</span>,
    },
    {
      title: 'Rollen',
      key: 'rollen',
      width: 140,
      abBreite: 'lg',
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
      width: 128,
      immerSichtbar: true,
      fixed: 'right',
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
      // Unter `md` nur der Menüauslöser: Steuerhöhe plus Zellpolster.
      width: istSchmal ? 80 : 256,
      immerSichtbar: true,
      fixed: 'right',
      render: (_, b) => {
        const grund = sperrGrund(b);
        const onBearbeiten = () => {
          bearbeiten.reset();
          setZuBearbeiten(b);
        };
        if (istSchmal) {
          return (
            <MenueAusloeser
              eintraege={[
                { key: 'bearbeiten', label: 'Bearbeiten' },
                b.aktiv
                  ? grund
                    ? // Der Grund steht im Eintrag selbst: im Menü gibt es keine Zeile darunter.
                      {
                        key: 'aktiv',
                        label: `Deaktivieren gesperrt: ${grund.kurz}`,
                        gesperrt: true,
                      }
                    : { key: 'aktiv', label: 'Deaktivieren', gefahr: true }
                  : { key: 'aktiv', label: 'Reaktivieren' },
              ]}
              zugaenglicherName={`Aktionen zu Benutzer ${b.anzeigename}`}
              laeuft={
                (deaktivieren.isPending && deaktivieren.variables === b.id) ||
                (reaktivieren.isPending && reaktivieren.variables === b.id)
              }
              onWahl={(aktion) => {
                if (aktion === 'bearbeiten') onBearbeiten();
                else if (b.aktiv) zeilenAktion('deaktivieren', b.id);
                else zeilenAktion('reaktivieren', b.id);
              }}
            />
          );
        }
        return (
          <BenutzerAktionen
            benutzer={b}
            sperrGrund={grund?.text ?? null}
            deaktiviert={deaktivieren.isPending && deaktivieren.variables === b.id}
            reaktiviert={reaktivieren.isPending && reaktivieren.variables === b.id}
            onBearbeiten={onBearbeiten}
            onDeaktivieren={() => zeilenAktion('deaktivieren', b.id)}
            onReaktivieren={() => zeilenAktion('reaktivieren', b.id)}
          />
        );
      },
    },
  ];

  return (
    <AdminPage
      titel="Benutzer"
      aktionen={
        <Button
          type="primary"
          onClick={() => {
            anlegen.reset();
            setOffen(true);
          }}
        >
          Benutzer anlegen
        </Button>
      }
      hinweis={
        <SeitenHinweise
          fehler={deaktivieren.error ?? reaktivieren.error}
          fehlerTitel={deaktivieren.isError ? 'Nicht deaktiviert' : 'Nicht reaktiviert'}
        />
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
          spaltenSchalter={{ bezeichnung: 'Benutzer' }}
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
        onAbbrechen={() => {
          anlegen.reset();
          setOffen(false);
        }}
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
        <SpeicherFehler
          fehler={anlegen.error}
          titel="Benutzer nicht angelegt"
          fallback="Anlegen fehlgeschlagen"
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
        laeuft={bearbeiten.isPending}
        // Werfen statt stillem `return`: ein aufgelöstes Versprechen läse die Hülle als Erfolg und
        // schlösse den Dialog, ohne dass etwas gesendet wurde.
        onErfassen={async (w) => {
          if (!zuBearbeiten) throw new Error('Kein Benutzer zum Bearbeiten');
          await bearbeiten.mutateAsync({ id: zuBearbeiten.id, patch: w });
        }}
        onFertig={() => setZuBearbeiten(null)}
        onAbbrechen={() => {
          bearbeiten.reset();
          setZuBearbeiten(null);
        }}
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
        {/* Auch eine abgelehnte Herabstufung des letzten Admins steht hier (LFH-966). */}
        <SpeicherFehler fehler={bearbeiten.error} />
      </ErfassungsModal>
    </AdminPage>
  );
}

/**
 * Die Aktionszelle einer Zeile. Eigene Komponente, weil der Sperrgrund eine `useId` braucht:
 * der gesperrte Knopf verweist per `aria-describedby` auf seinen sichtbaren Grund.
 */
function BenutzerAktionen({
  benutzer: b,
  sperrGrund,
  deaktiviert,
  reaktiviert,
  onBearbeiten,
  onDeaktivieren,
  onReaktivieren,
}: {
  benutzer: BenutzerAnzeige;
  sperrGrund: string | null;
  deaktiviert: boolean;
  reaktiviert: boolean;
  onBearbeiten: () => void;
  onDeaktivieren: () => void;
  onReaktivieren: () => void;
}) {
  const { token, rollen } = useRollen();
  const grundId = useId();
  return (
    <Flex vertical gap={token.marginXXS} align="flex-start">
      <Space size="middle">
        <Button onClick={onBearbeiten}>Bearbeiten</Button>
        {b.aktiv ? (
          // KEINE Rückfrage (LFH-966, Linie aus LFH-363 wie „Außer Dienst“ in
          // `stammdaten/dienststatus.tsx`): Deaktivieren ist über „Reaktivieren“ umkehrbar.
          // `danger` und Abstand (`size="middle"`) bleiben. Zeilengescopte Ladeanzeige: ohne
          // Rückmeldung lädt der Klick zum zweiten ein.
          <Button
            danger
            loading={deaktiviert}
            disabled={sperrGrund !== null}
            aria-describedby={sperrGrund !== null ? grundId : undefined}
            onClick={() => {
              if (!deaktiviert) onDeaktivieren();
            }}
          >
            Deaktivieren
          </Button>
        ) : (
          <Button
            loading={reaktiviert}
            onClick={() => {
              if (!reaktiviert) onReaktivieren();
            }}
          >
            Reaktivieren
          </Button>
        )}
      </Space>
      {b.aktiv && sperrGrund !== null && (
        <span id={grundId} style={{ fontSize: token.fontSizeSM, color: rollen.text2 }}>
          {sperrGrund}
        </span>
      )}
    </Flex>
  );
}
