import { App, Button, Modal, Space, Typography } from 'antd';
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate } from 'react-router';
import AdminPage from '../components/AdminPage';
import { useViewport } from '../components/useViewport';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import { Datenfeld, Datenraster, Paneel, useRollen } from '../components/instrument';
import { entferneDemoDaten, importiereDemoDaten, importiereDemoDatenNeu } from '../api/demoDaten';
import { globalKeys } from '../api/queryKeys';
import type {
  DemoBerichtZeile,
  DemoDatenStatus,
  DemoLage,
  DemoLageStatus,
  DemoStammdatenArt,
  DemoVorgang,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { istAdmin } from '../einsatz/schreibrecht';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { verweisStil } from '../etb/zeitachseModell';
import { einsatzPfad } from '../routing/deeplinks';
import { invalidiereNachDemoVorgang, useDemoDatenStatus } from './useDemoDaten';

/**
 * Verwaltungssektion „Demo-Daten“.
 *
 * ── Wer sie sieht ─────────────────────────────────────────────────────────────────────
 * Nur der System-Admin, und nur bei 200 von `GET /api/demo-daten`. Die Seite schützt sich
 * selbst (wie `BenutzerPage`): das `AdminLayout` lässt auch Führungskräfte herein.
 *
 * ── Bedienung ─────────────────────────────────────────────────────────────────────────
 * Je Lage ein Paneel (LLH-1576), in der Reihenfolge des Status. Ohne aktiven Import der Lage
 * steht dort „Importieren“; mit aktivem Import „Neu importieren“ und „Entfernen“, beide `danger`
 * hinter einer `danger`-Rückfrage, die die Lage nennt: beide löschen den Demo-Einsatz dieser
 * Lage samt Änderungen — unumkehrbar. Kein Knopf im Kopf: zwei gleichrangige Lagen haben keine
 * eine Primäraktion. Die Rückfrage schließt beim Bestätigen sofort; ein Fehler steht dann an der
 * Seite, nicht hinter der Maske eines offenen Dialogs.
 *
 * ── Fehler und Erfolg ─────────────────────────────────────────────────────────────────
 * EINE Mutation, verzweigt nach Vorgang und Lage: react-query räumt `error` nur beim nächsten
 * Lauf DERSELBEN Mutation; mit mehreren bliebe ein 409 vom Import nach gelungenem Entfernen
 * stehen. Der Fehler steht über `SeitenHinweise` an der Seite, der Erfolg geht als Toast. Ein
 * laufender Vorgang sperrt die Knöpfe beider Lagen: sie teilen sich die Stammdaten.
 *
 * ── Doppeltes Senden ──────────────────────────────────────────────────────────────────
 * Der Riegel `sendetRef` sitzt in der Absende-Funktion: antds `loading` sperrt erst einen Takt
 * nach dem Klick, zwei Klicks im selben Takt erreichen den Knopf beide.
 */

type Vorgang = 'import' | 'neu' | 'entfernen';

interface Auftrag {
  vorgang: Vorgang;
  lage: DemoLage;
  /** Einsatz des aktiven Imports der Lage VOR dem Vorgang. Die DELETE-Antwort nennt ihn nicht
   *  mehr. */
  altEinsatzId: number | null;
}

const AUSFUEHREN: Record<Vorgang, (lage: DemoLage) => Promise<DemoDatenStatus>> = {
  import: importiereDemoDaten,
  neu: importiereDemoDatenNeu,
  entfernen: entferneDemoDaten,
};

/** Anzeigename je Lage. Die Wire-Werte stehen im Pfad, nicht in der Oberfläche. */
const LAGE_LABEL: Record<DemoLage, string> = {
  starkregen: 'Starkregen',
  stadtfest: 'Stadtfest',
};

const ERFOLG: Record<Vorgang, (lage: string) => string> = {
  import: (l) => `Demo-Lage ${l} importiert`,
  neu: (l) => `Demo-Lage ${l} neu importiert`,
  entfernen: (l) => `Demo-Lage ${l} entfernt`,
};

/** Überschrift des Seitenalerts. `SeitenHinweise` sagt sonst „Nicht gespeichert“. */
const FEHLER_TITEL: Record<Vorgang, (lage: string) => string> = {
  import: (l) => `Import ${l} fehlgeschlagen`,
  neu: (l) => `Neu-Import ${l} fehlgeschlagen`,
  entfernen: (l) => `Entfernen ${l} fehlgeschlagen`,
};

/**
 * Text für einen Fehler, den weder Server noch Netzschicht benennen. Ohne ihn stünde unter
 * „Import fehlgeschlagen“ der Standardsatz „Speichern fehlgeschlagen“ aus `fehlerText`. Netzfehler
 * und unklarer Ausgang tragen ihren eigenen Wortlaut aus `api/client` (LFH-1077).
 */
const NETZ_FEHLER = 'Der Server hat nicht geantwortet. Bitte erneut versuchen.';

type Rueckfrage = Exclude<Vorgang, 'import'>;

/**
 * Der OK-Knopf heißt bewusst anders als der auslösende Knopf, sonst stünde bei offenem Dialog
 * zweimal „Entfernen“ im Baum. Der Text ist genau EIN kurzer Satz zur Folge (LFH-1078).
 */
const RUECKFRAGE: Record<
  Rueckfrage,
  { titel: (lage: string) => string; text: string; ok: string }
> = {
  neu: {
    titel: (l) => `Demo-Lage ${l} neu importieren?`,
    text: 'Der Demo-Einsatz wird samt Änderungen unwiderruflich ersetzt.',
    ok: 'Ersetzen',
  },
  entfernen: {
    titel: (l) => `Demo-Lage ${l} entfernen?`,
    text: 'Der Demo-Einsatz wird samt Änderungen unwiderruflich gelöscht, ungenutzte Demo-Stammdaten ebenso.',
    ok: 'Endgültig entfernen',
  },
};

const ART_LABEL: Record<DemoStammdatenArt, string> = {
  fahrzeug: 'Fahrzeuge',
  personal: 'Personal',
  material: 'Material',
  einheit_vorlage: 'Einheiten-Vorlagen',
  schichtmodell: 'Schichtmodelle',
  planung: 'Planungen',
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

export default function DemoDatenPage() {
  const { benutzer, laedt: authLaedt } = useAuth();
  // Wire-Zeit als Zeitpunkt über den Formatkern (LLH-1061), außerhalb eines Einsatzes mit den
  // Konventionen der Organisation bzw. der Vorgabe.
  const { zeitpunkt } = useAnzeigeKonventionen();
  const demo = useDemoDatenStatus();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token, rollen } = useRollen();
  const { abBreite } = useViewport();
  // Art und Lage bleiben beim Schließen stehen, damit der Dialog während der Ausblende-Animation
  // nicht ohne Titel dasteht.
  const [rueckfrage, setRueckfrage] = useState<{ vorgang: Rueckfrage; lage: DemoLage }>({
    vorgang: 'entfernen',
    lage: 'starkregen',
  });
  const [rueckfrageOffen, setRueckfrageOffen] = useState(false);
  const sendetRef = useRef(false);

  const vorgang = useMutation({
    mutationFn: ({ vorgang: v, lage }: Auftrag) => AUSFUEHREN[v](lage),
    onSuccess: (neu, { lage, altEinsatzId }) => {
      // Die Antwort IST der neue Stand (dieselbe Transaktion); die Invalidierung danach holt
      // ihn trotzdem neu, damit Menü und Einsatzliste an derselben Quelle hängen.
      qc.setQueryData(globalKeys.demoDaten(), neu);
      const jetzt = neu.lagen.find((l) => l.lage === lage);
      void invalidiereNachDemoVorgang(qc, [altEinsatzId, jetzt?.import?.einsatz_id]);
    },
    // Nach JEDEM Fehler neu laden: ein 409 heißt, der Stand ist anderswo geändert worden; nach einem
    // Netzfehler oder Timeout (15 s in `apiSend`) kann der Vorgang trotzdem committet sein. Darum
    // dieselben Fächer wie nach einem Erfolg. Der Alert bleibt stehen, `vorgang.error` hängt nicht
    // an der Abfrage.
    onError: (_e, { altEinsatzId }) => {
      void invalidiereNachDemoVorgang(qc, [altEinsatzId]);
    },
  });

  async function ausloesen(v: Vorgang, lage: DemoLage) {
    if (sendetRef.current) return;
    sendetRef.current = true;
    try {
      const vorher = demo.status?.lagen.find((l) => l.lage === lage);
      await vorgang.mutateAsync({
        vorgang: v,
        lage,
        altEinsatzId: vorher?.import?.einsatz_id ?? null,
      });
      message.success(ERFOLG[v](LAGE_LABEL[lage]));
    } catch {
      // Der Grund steht über `vorgang.error` an der Seite, nicht im Toast.
    } finally {
      sendetRef.current = false;
    }
  }

  function frage(v: Rueckfrage, lage: DemoLage) {
    setRueckfrage({ vorgang: v, lage });
    setRueckfrageOffen(true);
  }

  function bestaetigen() {
    setRueckfrageOffen(false);
    void ausloesen(rueckfrage.vorgang, rueckfrage.lage);
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

  // Status-Abfrage gescheitert (≠ 404): Fehlerbild mit „Erneut abrufen“, KEINE Aktion und KEINE
  // Umleitung — eine Umleitung sähe aus wie „nicht freigeschaltet“.
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

  const laufend = vorgang.isPending ? vorgang.variables : undefined;
  const fehlerAuftrag = vorgang.variables;

  function lagePaneele(l: DemoLageStatus) {
    const label = LAGE_LABEL[l.lage];
    const kopf = l.import ?? null;
    const bericht = l.bericht ?? null;
    const laeuft = (v: Vorgang) => laufend?.lage === l.lage && laufend.vorgang === v;
    return (
      <div key={l.lage} data-lfh="demo-lage" style={{ display: 'grid', gap: token.marginLG }}>
        <Paneel titel={label} koerperPolster>
          <Datenraster beschriftung={`Stand ${label}`}>
            <Datenfeld label="Status">{l.importiert ? 'Importiert' : 'Nicht importiert'}</Datenfeld>
            {kopf && (
              <Datenfeld label="Importiert am" mono>
                {zeitpunkt(kopf.importiert_at)}
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
                  // Verwaister Kopf: der Einsatz des aktiven Imports existiert nicht mehr (Aufbewahrung).
                  // Entfernen und Neu-Import räumen ihn auf; ein Link ins Leere hülfe nicht.
                  <Typography.Text type="secondary">Einsatz nicht mehr vorhanden</Typography.Text>
                )}
              </Datenfeld>
            )}
          </Datenraster>
          {/* `middle`: Rot steht nicht bündig neben einer weiteren Aktion. */}
          <Space size="middle" wrap style={{ marginBlockStart: token.margin }}>
            {l.importiert ? (
              <>
                <Button
                  danger
                  loading={laeuft('neu')}
                  disabled={vorgang.isPending}
                  onClick={() => frage('neu', l.lage)}
                >
                  Neu importieren
                </Button>
                <Button
                  danger
                  loading={laeuft('entfernen')}
                  disabled={vorgang.isPending}
                  onClick={() => frage('entfernen', l.lage)}
                >
                  Entfernen
                </Button>
              </>
            ) : (
              <Button
                loading={laeuft('import')}
                disabled={vorgang.isPending}
                onClick={() => void ausloesen('import', l.lage)}
              >
                Importieren
              </Button>
            )}
          </Space>
        </Paneel>

        {bericht && (
          <Paneel
            titel={`Letzter Vorgang ${label}`}
            meta={`${VORGANG_LABEL[bericht.vorgang]} · ${zeitpunkt(bericht.zeitpunkt)}`}
            koerperPolster
          >
            <Datenraster beschriftung={`Bericht je Stammdatenart ${label}`}>
              {bericht.je_art.map((z) => (
                <Datenfeld key={z.art} label={ART_LABEL[z.art]} mono>
                  {berichtZeile(z, bericht.vorgang)}
                </Datenfeld>
              ))}
            </Datenraster>
          </Paneel>
        )}
      </div>
    );
  }

  return (
    <AdminPage
      titel="Demo-Daten"
      hinweis={
        vorgang.error && fehlerAuftrag ? (
          <SeitenHinweise
            fehler={vorgang.error}
            fehlerTitel={FEHLER_TITEL[fehlerAuftrag.vorgang](LAGE_LABEL[fehlerAuftrag.lage])}
            fehlerFallback={NETZ_FEHLER}
          />
        ) : undefined
      }
    >
      {/* Zwei Spalten, sobald beide Lagen nebeneinander Platz haben; schmal untereinander. */}
      <div
        data-lfh="demo-lagen"
        style={{
          display: 'grid',
          gap: token.marginLG,
          gridTemplateColumns: abBreite('lg')
            ? `repeat(${status.lagen.length}, minmax(0, 1fr))`
            : 'minmax(0, 1fr)',
          alignItems: 'start',
        }}
      >
        {status.lagen.map(lagePaneele)}
      </div>

      {/* EIN Dialog für alle Rückfragen, State außerhalb jeder Liste. */}
      <Modal
        open={rueckfrageOffen}
        title={RUECKFRAGE[rueckfrage.vorgang].titel(LAGE_LABEL[rueckfrage.lage])}
        okText={RUECKFRAGE[rueckfrage.vorgang].ok}
        cancelText="Abbrechen"
        okButtonProps={{ danger: true }}
        onOk={bestaetigen}
        onCancel={() => setRueckfrageOffen(false)}
      >
        {RUECKFRAGE[rueckfrage.vorgang].text}
      </Modal>
    </AdminPage>
  );
}
