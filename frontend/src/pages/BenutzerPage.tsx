import { App, Button, Collapse, Form, Input, Modal, Space } from 'antd';
import KatalogTabelle, {
  KENNUNG_SCHMAL_BREITE,
  type KatalogSpalte,
} from '../components/KatalogTabelle';
import { MenueAusloeser, type MenueEintrag } from '../components/MenueAusloeser';
import { ErfassungsModal } from '../components/Erfassung';
import { SeitenFehler } from '../components/SeitenZustand';
import { Select } from '../components/Select';
import AdminPage from '../components/AdminPage';
import { StatusChip, monoStil } from '../components/instrument';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router';
import type { BenutzerAnzeige, OrgRolle, SystemRolle } from '../api/types';
import { PASSWORT_MIN_LAENGE } from '../api/auth';
import {
  bearbeiteBenutzer,
  deaktiviereBenutzer,
  legeBenutzerAn,
  listeBenutzer,
  vergibEinmalpasswort,
  setzeZweitfaktorZurueck,
  type NeuerBenutzer,
  type PatchBenutzer,
} from '../api/benutzer';
import { useAuth } from '../auth/AuthContext';
import SitzungsListe from '../auth/SitzungsListe';
import EinmalpasswortVergeben from '../auth/EinmalpasswortVergeben';
import { beendeAlleSitzungenVon, beendeSitzungVon, ladeSitzungenVon } from '../api/sitzungen';
import { globalKeys } from '../api/queryKeys';
import { SeitenHinweise, SpeicherFehler } from '../components/SpeicherHinweis';
import {
  EIGENES_KONTO,
  LETZTER_ADMIN,
  ORG_ROLLE_FELD,
  ORG_ROLLE_TEXT,
  SYSTEM_ROLLE_FELD,
  SYSTEM_ROLLE_TEXT,
} from '../stammdaten/rechteText';

interface BearbeitenWerte {
  anzeigename: string;
  system_rolle: SystemRolle;
  org_rolle: OrgRolle;
}

const SYSTEM_ROLLEN = [
  { value: 'keiner', label: SYSTEM_ROLLE_TEXT.keiner },
  { value: 'admin', label: SYSTEM_ROLLE_TEXT.admin },
];
/** Die Einträge des Aktionsmenüs einer Zeile. */
type ZeilenAktion = 'bearbeiten' | 'anmeldungen' | 'zweitfaktor' | 'aktiv';

/** Nur der Menüauslöser: Steuerhöhe plus Zellpolster. */
const AKTIONEN_BREITE = 80;

const ORG_ROLLEN = [
  { value: 'keine', label: ORG_ROLLE_TEXT.keine },
  { value: 'fuehrungskraft', label: `${ORG_ROLLE_TEXT.fuehrungskraft} (darf Einsätze anlegen)` },
];

export default function BenutzerPage() {
  const { benutzer: angemeldeterBenutzer, laedt: authLaedt } = useAuth();
  const qc = useQueryClient();
  const [offen, setOffen] = useState(false);
  const [form] = Form.useForm<NeuerBenutzer>();
  const [zuBearbeiten, setZuBearbeiten] = useState<BenutzerAnzeige | null>(null);
  const [editForm] = Form.useForm<BearbeitenWerte>();
  // Die Anmeldungen einer Person (LFH-1092), im Dialog außerhalb der Zeilen.
  const [anmeldungenVon, setAnmeldungenVon] = useState<BenutzerAnzeige | null>(null);
  // Die offene Rückfrage vor dem Zurücksetzen des zweiten Faktors (LFH-1122).
  const [zweitfaktorVon, setZweitfaktorVon] = useState<BenutzerAnzeige | null>(null);
  const { message } = App.useApp();

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

  // „Einmalpasswort vergeben“ im Bearbeiten-Dialog (LFH-1121). Hier statt in der Komponente:
  // solange sie läuft, darf der Dialog nicht schließen, und beim Schließen räumt `reset()` das
  // angezeigte Passwort. Nur die Liste neu laden: die Antwort gehört in keinen Cache.
  const einmalpasswort = useMutation({
    mutationFn: (id: number) => vergibEinmalpasswort(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.benutzer() }),
  });

  // „Reaktivieren" in der Zeile — eigene Mutation, damit sein Fehler an der Seite steht und
  // nicht im Bearbeiten-Dialog (und umgekehrt).
  const reaktivieren = useMutation({
    mutationFn: (id: number) => bearbeiteBenutzer(id, { aktiv: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.benutzer() }),
  });

  /*
   * Unumkehrbar (LFH-363): Secret und Wiederherstellungscodes sind fort, die Person richtet im
   * Profil neu ein. Deshalb Rückfrage; ihr Fehler steht im Dialog, der Erfolg im Toast.
   */
  const zweitfaktor = useMutation({
    mutationFn: (b: BenutzerAnzeige) => setzeZweitfaktorZurueck(b.id),
    onSuccess: (_, b) => {
      setZweitfaktorVon(null);
      message.success(`Zweiter Faktor von ${b.anzeigename} zurückgesetzt`);
      return qc.invalidateQueries({ queryKey: globalKeys.benutzer() });
    },
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
   * Sitzung ohne Rückweg. Statt einer Aktion, die nie gelingt, steht der Grund im gesperrten
   * Menüeintrag.
   */
  const aktiveAdmins = benutzerListe.filter((b) => b.aktiv && b.system_rolle === 'admin').length;
  const sperrGrund = (b: BenutzerAnzeige): string | null => {
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
   * Aktionen stehen rechts fixiert (LFH-980): Name, Status und Menü passen in 390 px. Die Aktionen
   * stehen auf jeder Breite im Menü (LFH-1122): mit „Zweiten Faktor zurücksetzen …“ sind es bis
   * zu vier, ab drei wird gebündelt (`frontend/AGENTS.md`, „Datensatz-Aktionen werden gebündelt“).
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
      width: AKTIONEN_BREITE,
      immerSichtbar: true,
      fixed: 'right',
      render: (_, b) => {
        const grund = sperrGrund(b);
        // Umkehrbares zuerst, Unumkehrbares und Entfernendes rot hinter dem Trenner (Spec
        // `datensatz-aktionsmenue`). Deaktivieren bleibt ohne Rückfrage (LFH-966, umkehrbar über
        // „Reaktivieren“), steht aber als entfernende Aktion rot.
        const eintraege: MenueEintrag<ZeilenAktion>[] = [
          { key: 'bearbeiten', label: 'Bearbeiten' },
          // Öffnet nur die Liste; ein deaktiviertes Konto hat keine Anmeldungen.
          ...(b.aktiv ? [{ key: 'anmeldungen' as const, label: 'Anmeldungen' }] : []),
          ...(b.aktiv ? [] : [{ key: 'aktiv' as const, label: 'Reaktivieren' }]),
          // Nur bei aktivem zweiten Faktor: sonst gibt es nichts zurückzusetzen (LFH-1122).
          ...(b.totp_aktiviert
            ? [
                {
                  key: 'zweitfaktor' as const,
                  label: 'Zweiten Faktor zurücksetzen …',
                  gefahr: true as const,
                },
              ]
            : []),
          ...(b.aktiv
            ? [
                grund
                  ? // Der Grund steht im Eintrag selbst: im Menü gibt es keine Zeile darunter.
                    {
                      key: 'aktiv' as const,
                      label: `Deaktivieren gesperrt: ${grund}`,
                      gesperrt: true as const,
                    }
                  : { key: 'aktiv' as const, label: 'Deaktivieren', gefahr: true as const },
              ]
            : []),
        ];
        return (
          <MenueAusloeser
            eintraege={eintraege}
            // Mit Benutzername: Anzeigenamen sind nicht eindeutig, zwei „Kim Beispiel“ trügen sonst
            // zwei gleichnamige Auslöser (Spec `datensatz-aktionsmenue`).
            zugaenglicherName={`Aktionen zu Benutzer ${b.anzeigename} (@${b.benutzername})`}
            // Zeilengescopte Ladeanzeige: ohne Rückmeldung lädt der Klick zum zweiten ein.
            laeuft={
              (deaktivieren.isPending && deaktivieren.variables === b.id) ||
              (reaktivieren.isPending && reaktivieren.variables === b.id)
            }
            onWahl={(aktion) => {
              if (aktion === 'bearbeiten') {
                bearbeiten.reset();
                einmalpasswort.reset();
                setZuBearbeiten(b);
              } else if (aktion === 'anmeldungen') setAnmeldungenVon(b);
              else if (aktion === 'zweitfaktor') {
                zweitfaktor.reset();
                setZweitfaktorVon(b);
              } else if (b.aktiv) zeilenAktion('deaktivieren', b.id);
              else zeilenAktion('reaktivieren', b.id);
            }}
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
                  <Form.Item label={SYSTEM_ROLLE_FELD} name="system_rolle">
                    <Select options={SYSTEM_ROLLEN} />
                  </Form.Item>
                  <Form.Item label={ORG_ROLLE_FELD} name="org_rolle">
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
        // Sperrt jeden Ausweg, solange gespeichert oder ein Einmalpasswort vergeben wird (LFH-1121):
        // schlösse der Dialog vorher, ginge das schon gesetzte Passwort verloren. Die Fehler
        // stehen an ihren eigenen Stellen, deshalb hier keiner.
        speicherung={{
          isPending: bearbeiten.isPending || einmalpasswort.isPending,
          error: null,
          reset: () => {},
        }}
        // Werfen statt stillem `return`: ein aufgelöstes Versprechen läse die Hülle als Erfolg und
        // schlösse den Dialog, ohne dass etwas gesendet wurde.
        onErfassen={async (w) => {
          if (!zuBearbeiten) throw new Error('Kein Benutzer zum Bearbeiten');
          await bearbeiten.mutateAsync({ id: zuBearbeiten.id, patch: w });
        }}
        onFertig={() => {
          einmalpasswort.reset();
          setZuBearbeiten(null);
        }}
        onAbbrechen={() => {
          bearbeiten.reset();
          einmalpasswort.reset();
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
        <Form.Item label={SYSTEM_ROLLE_FELD} name="system_rolle">
          <Select options={SYSTEM_ROLLEN} />
        </Form.Item>
        <Form.Item label={ORG_ROLLE_FELD} name="org_rolle">
          <Select options={ORG_ROLLEN} />
        </Form.Item>
        {/* Auch eine abgelehnte Herabstufung des letzten Admins steht hier (LFH-966). */}
        <SpeicherFehler fehler={bearbeiten.error} />
        {/* Passwort vergessen (LFH-1121): eine eigene Aktion neben dem Formular, kein Feld. */}
        {zuBearbeiten && (
          <Form.Item label="Passwort">
            <EinmalpasswortVergeben
              benutzer={zuBearbeiten}
              eigenesKonto={zuBearbeiten.id === angemeldeterBenutzer?.id}
              vergeben={einmalpasswort}
            />
          </Form.Item>
        )}
      </ErfassungsModal>

      <Modal
        open={anmeldungenVon !== null}
        title={anmeldungenVon ? `Anmeldungen · ${anmeldungenVon.anzeigename}` : 'Anmeldungen'}
        onCancel={() => setAnmeldungenVon(null)}
        footer={<Button onClick={() => setAnmeldungenVon(null)}>Schließen</Button>}
        destroyOnHidden
      >
        {anmeldungenVon && (
          <SitzungsListe
            titel={`Anmeldungen von ${anmeldungenVon.anzeigename}`}
            queryKey={globalKeys.sitzungenVon(anmeldungenVon.id)}
            laden={() => ladeSitzungenVon(anmeldungenVon.id)}
            beendeEine={(kennung) => beendeSitzungVon(anmeldungenVon.id, kennung)}
            beendeAlle={() => beendeAlleSitzungenVon(anmeldungenVon.id)}
            alleText={
              anmeldungenVon.id === angemeldeterBenutzer?.id
                ? 'Alle anderen beenden'
                : 'Alle beenden'
            }
          />
        )}
      </Modal>

      {/* Rückfrage im Dialog, nicht am Menüeintrag (Spec `datensatz-aktionsmenue`). Abbrechen ist
          gesperrt, solange gesendet wird: sonst käme eine Ablehnung unsichtbar an (LFH-1077). */}
      <Modal
        open={zweitfaktorVon !== null}
        title={
          zweitfaktorVon
            ? `Zweiten Faktor von ${zweitfaktorVon.anzeigename} zurücksetzen?`
            : 'Zweiten Faktor zurücksetzen?'
        }
        okText="Zweiten Faktor zurücksetzen"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true, loading: zweitfaktor.isPending }}
        cancelButtonProps={{ disabled: zweitfaktor.isPending }}
        closable={zweitfaktor.isPending ? { disabled: true } : true}
        mask={{ closable: !zweitfaktor.isPending }}
        onOk={() => zweitfaktorVon && zweitfaktor.mutate(zweitfaktorVon)}
        // Escape landet auch hier: der Riegel gilt für jeden Ausweg.
        onCancel={() => {
          if (!zweitfaktor.isPending) setZweitfaktorVon(null);
        }}
        destroyOnHidden
      >
        {zweitfaktorVon && (
          <p>
            {`Alle Anmeldungen von ${zweitfaktorVon.anzeigename} enden, ${
              zweitfaktorVon.id === angemeldeterBenutzer?.id
                ? 'auch die Anmeldung an diesem Gerät, '
                : ''
            }und die Wiederherstellungscodes verfallen. Danach genügt das Passwort; einen neuen zweiten Faktor richtet die Person im Profil ein.`}
          </p>
        )}
        <SpeicherFehler fehler={zweitfaktor.error} titel="Nicht zurückgesetzt" />
      </Modal>
    </AdminPage>
  );
}
