import { App, Button, Flex, Modal, Space, Typography } from 'antd';
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate } from 'react-router';
import AdminPage from '../components/AdminPage';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import { Datenfeld, Datenraster, Paneel, useRollen } from '../components/instrument';
import { entferneDemoDaten, importiereDemoDaten, importiereDemoDatenNeu } from '../api/demoDaten';
import { globalKeys } from '../api/queryKeys';
import type {
  DemoBerichtZeile,
  DemoDatenStatus,
  DemoStammdatenArt,
  DemoVorgang,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { istAdmin } from '../einsatz/schreibrecht';
import { alsOrtszeit } from '../etb/filterZeit';
import { verweisStil } from '../etb/zeitachseModell';
import { einsatzPfad } from '../routing/deeplinks';
import { invalidiereNachDemoVorgang, useDemoDatenStatus } from './useDemoDaten';

/**
 * Verwaltungssektion „Demo-Daten“ (LFH-690, design.md D13; Spec „Verwaltungssektion
 * Demo-Daten“).
 *
 * ── Wer sie sieht ─────────────────────────────────────────────────────────────────────
 * Nur der System-Admin, und nur, wenn `GET /api/demo-daten` mit 200 antwortet. Die Seite
 * schützt sich selbst mit derselben Umleitung wie `BenutzerPage`: das `AdminLayout` lässt
 * auch Führungskräfte herein, und ein Deeplink auf `/admin/demo-daten` bei 404 wäre sonst eine
 * leere Seite ohne Aussage.
 *
 * ── Bedienung ─────────────────────────────────────────────────────────────────────────
 * Genau EINE Primäraktion im Kopf, „Importieren“, und nur ohne aktiven Import (LFH-340 · C5).
 * Mit aktivem Import stehen „Neu importieren“ und „Entfernen“ beim Stand im Inhalt, beide
 * `danger` und beide hinter einer Rückfrage mit `danger`-Knopf: beide löschen den Demo-Einsatz
 * samt allem, was seit dem Import an ihm geändert wurde — unumkehrbar (LFH-363).
 * Die Rückfrage schließt beim Bestätigen sofort. Ein Fehler steht dann an der Seite und
 * nicht hinter der Maske eines offen gehaltenen Dialogs (die Falle aus LFH-535).
 *
 * ── Fehler und Erfolg (LFH-345) ───────────────────────────────────────────────────────
 * EINE Mutation, verzweigt nach dem Vorgang, statt dreier: react-query räumt `error` nur beim
 * nächsten Lauf DERSELBEN Mutation. Mit drei Mutationen bliebe ein 409 vom Import stehen,
 * nachdem ein späteres Entfernen gelungen ist. Der Fehler steht über `SeitenHinweise` an der
 * Seite, der Erfolg geht als Toast.
 *
 * ── Doppeltes Senden ──────────────────────────────────────────────────────────────────
 * Der Riegel `sendetRef` sitzt in der Absende-Funktion, nicht am Knopf. antds `loading` sperrt
 * erst, wenn react-query `pending` gemeldet hat, und das geschieht einen Takt nach dem Klick —
 * zwei Klicks im selben Takt erreichen den Knopf beide.
 */

type Vorgang = 'import' | 'neu' | 'entfernen';

interface Auftrag {
  vorgang: Vorgang;
  /** Einsatz des aktiven Imports VOR dem Vorgang. Die DELETE-Antwort nennt ihn nicht mehr. */
  altEinsatzId: number | null;
}

const AUSFUEHREN: Record<Vorgang, () => Promise<DemoDatenStatus>> = {
  import: importiereDemoDaten,
  neu: importiereDemoDatenNeu,
  entfernen: entferneDemoDaten,
};

const ERFOLG: Record<Vorgang, string> = {
  import: 'Demo-Daten importiert',
  neu: 'Demo-Daten neu importiert',
  entfernen: 'Demo-Daten entfernt',
};

/** Überschrift des Seitenalerts. `SeitenHinweise` sagt sonst „Nicht gespeichert“. */
const FEHLER_TITEL: Record<Vorgang, string> = {
  import: 'Import fehlgeschlagen',
  neu: 'Neu-Import fehlgeschlagen',
  entfernen: 'Entfernen fehlgeschlagen',
};

type Rueckfrage = Exclude<Vorgang, 'import'>;

/**
 * Die beiden Rückfragen. Der OK-Knopf heißt bewusst anders als der auslösende Knopf: sonst
 * stünde, solange der Dialog offen ist, zweimal „Entfernen“ im Baum.
 */
const RUECKFRAGE: Record<Rueckfrage, { titel: string; text: string; ok: string }> = {
  neu: {
    titel: 'Demo-Daten neu importieren?',
    text:
      'Der bisherige Demo-Einsatz wird samt allen Einträgen gelöscht, auch mit Änderungen seit ' +
      'dem Import. Danach entsteht ein neuer Demo-Einsatz mit frischer Zeitachse. Das lässt ' +
      'sich nicht rückgängig machen.',
    ok: 'Ersetzen',
  },
  entfernen: {
    titel: 'Demo-Daten entfernen?',
    text:
      'Der Demo-Einsatz wird samt allen Einträgen gelöscht, auch mit Änderungen seit dem ' +
      'Import. Demo-Stammdaten, die nirgends mehr verwendet werden, werden gelöscht; die ' +
      'übrigen bleiben als normale Stammdaten stehen. Das lässt sich nicht rückgängig machen.',
    ok: 'Endgültig entfernen',
  },
};

const ART_LABEL: Record<DemoStammdatenArt, string> = {
  fahrzeug: 'Fahrzeuge',
  personal: 'Personal',
  material: 'Material',
};

const VORGANG_LABEL: Record<DemoVorgang, string> = {
  importiert: 'Import',
  entfernt: 'Entfernen',
};

/**
 * Die Zahlen einer Art. Beim Import zählen `angelegt`/`mitbenutzt`, beim Entfernen
 * `entfernt`/`behalten`; die übrigen stehen auf 0 und würden nur rauschen.
 */
function berichtZeile(z: DemoBerichtZeile, vorgang: DemoVorgang): string {
  return vorgang === 'importiert'
    ? `${z.angelegt} angelegt · ${z.mitbenutzt} mitbenutzt`
    : `${z.entfernt} entfernt · ${z.behalten} behalten`;
}

/**
 * Wire-Zeit (UTC ohne Zone) in Ortszeit. Über `alsOrtszeit`, nie `dayjs(s)`: das läse den
 * String als Ortszeit und verschöbe ihn um den Zonenversatz (`etb/filterZeit.ts`).
 */
function ortszeit(s: string): string {
  return alsOrtszeit(s)?.format('DD.MM.YYYY HH:mm') ?? s;
}

export default function DemoDatenPage() {
  const { benutzer, laedt: authLaedt } = useAuth();
  const demo = useDemoDatenStatus();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token, rollen } = useRollen();
  // Die Art bleibt beim Schließen stehen, damit der Dialog während der Ausblende-Animation
  // nicht ohne Titel und Text dasteht.
  const [rueckfrage, setRueckfrage] = useState<Rueckfrage>('entfernen');
  const [rueckfrageOffen, setRueckfrageOffen] = useState(false);
  const sendetRef = useRef(false);

  const vorgang = useMutation({
    mutationFn: ({ vorgang: v }: Auftrag) => AUSFUEHREN[v](),
    onSuccess: (neu, { altEinsatzId }) => {
      // Die Antwort IST der neue Stand (dieselbe Transaktion); die Invalidierung danach holt
      // ihn trotzdem neu, damit Menü und Einsatzliste an derselben Quelle hängen.
      qc.setQueryData(globalKeys.demoDaten(), neu);
      void invalidiereNachDemoVorgang(qc, [altEinsatzId, neu.import?.einsatz_id]);
    },
  });

  async function ausloesen(v: Vorgang) {
    if (sendetRef.current) return;
    sendetRef.current = true;
    try {
      await vorgang.mutateAsync({
        vorgang: v,
        altEinsatzId: demo.status?.import?.einsatz_id ?? null,
      });
      message.success(ERFOLG[v]);
    } catch {
      // Der Grund steht über `vorgang.error` an der Seite (LFH-345), nicht im Toast.
    } finally {
      sendetRef.current = false;
    }
  }

  function frage(v: Rueckfrage) {
    setRueckfrage(v);
    setRueckfrageOffen(true);
  }

  function bestaetigen() {
    setRueckfrageOffen(false);
    void ausloesen(rueckfrage);
  }

  if (!authLaedt && !istAdmin(benutzer)) return <Navigate to="/einsaetze" replace />;
  if (demo.abgeschaltet) return <Navigate to="/einsaetze" replace />;

  if (authLaedt || demo.laedt) {
    return (
      <AdminPage titel="Demo-Daten">
        <SeitenSkeleton />
      </AdminPage>
    );
  }

  const status = demo.status;
  if (!status) {
    return (
      <AdminPage titel="Demo-Daten">
        <SeitenFehler
          text="Der Stand der Demo-Daten konnte nicht geladen werden."
          ursache={demo.fehler}
          onWiederholen={demo.neuLaden}
        />
      </AdminPage>
    );
  }

  const kopf = status.import ?? null;
  const bericht = status.bericht ?? null;
  const laufend = vorgang.isPending ? vorgang.variables?.vorgang : undefined;
  const fehlerVorgang = vorgang.variables?.vorgang;

  return (
    <AdminPage
      titel="Demo-Daten"
      beschreibung="Ein Übungseinsatz samt Stammdaten für Vorführung und Schulung. Er entsteht in Ihrer Organisation und lässt sich wieder entfernen."
      aktionen={
        status.importiert ? undefined : (
          <Button
            type="primary"
            loading={laufend === 'import'}
            onClick={() => void ausloesen('import')}
          >
            Importieren
          </Button>
        )
      }
      hinweis={
        vorgang.error && fehlerVorgang ? (
          <SeitenHinweise fehler={vorgang.error} fehlerTitel={FEHLER_TITEL[fehlerVorgang]} />
        ) : undefined
      }
    >
      <Flex vertical gap={token.marginLG}>
        <Paneel titel="Stand" koerperPolster>
          <Datenraster beschriftung="Stand der Demo-Daten">
            <Datenfeld label="Status">
              {status.importiert ? 'Importiert' : 'Nicht importiert'}
            </Datenfeld>
            {kopf && (
              <Datenfeld label="Importiert am" mono>
                {ortszeit(kopf.importiert_at)}
              </Datenfeld>
            )}
            {kopf && (
              <Datenfeld label="Einsatz">
                {kopf.einsatz_bezeichnung ? (
                  <Link
                    to={einsatzPfad(kopf.einsatz_id)}
                    style={{ ...verweisStil(token), color: rollen.bedienText }}
                  >
                    {kopf.einsatz_bezeichnung}
                  </Link>
                ) : (
                  // Verwaister Kopf: der Einsatz des aktiven Imports existiert nicht mehr
                  // (Aufbewahrungsfrist, block-5-report Bedenken 2). Entfernen und
                  // Neu-Import räumen ihn auf; ein Link ins Leere hülfe dabei nicht.
                  <Typography.Text type="secondary">Einsatz nicht mehr vorhanden</Typography.Text>
                )}
              </Datenfeld>
            )}
          </Datenraster>
          {status.importiert && (
            // `middle`: Rot steht nicht bündig neben einer weiteren Aktion
            // (aktionsabstand.guard.test.ts).
            <Space size="middle" wrap style={{ marginBlockStart: token.margin }}>
              <Button danger loading={laufend === 'neu'} onClick={() => frage('neu')}>
                Neu importieren
              </Button>
              <Button danger loading={laufend === 'entfernen'} onClick={() => frage('entfernen')}>
                Entfernen
              </Button>
            </Space>
          )}
        </Paneel>

        {bericht && (
          <Paneel
            titel="Letzter Vorgang"
            meta={`${VORGANG_LABEL[bericht.vorgang]} · ${ortszeit(bericht.zeitpunkt)}`}
            koerperPolster
          >
            <Datenraster beschriftung="Bericht je Stammdatenart">
              {bericht.je_art.map((z) => (
                <Datenfeld key={z.art} label={ART_LABEL[z.art]} mono>
                  {berichtZeile(z, bericht.vorgang)}
                </Datenfeld>
              ))}
            </Datenraster>
          </Paneel>
        )}
      </Flex>

      {/* EIN Dialog für beide Rückfragen, State außerhalb jeder Liste (LFH-365). */}
      <Modal
        open={rueckfrageOffen}
        title={RUECKFRAGE[rueckfrage].titel}
        okText={RUECKFRAGE[rueckfrage].ok}
        cancelText="Abbrechen"
        okButtonProps={{ danger: true }}
        onOk={bestaetigen}
        onCancel={() => setRueckfrageOffen(false)}
      >
        {RUECKFRAGE[rueckfrage].text}
      </Modal>
    </AdminPage>
  );
}
