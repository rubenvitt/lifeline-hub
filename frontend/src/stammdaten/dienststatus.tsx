import { Button, Space } from 'antd';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import StatusTag from '../components/StatusTag';
import type { KatalogSpalte } from '../components/KatalogTabelle';
import { nachZahl } from '../components/katalogVergleich';
import type { WeitereAktionen } from '../components/Datensicht';
import { ZeilenMenueAusloeser } from '../components/ZeilenMenueAusloeser';
import type { Dienststatus } from '../api/types';
import { VomHubGesperrt } from '../instanz/herkunft';
import { dienststatus } from '../theme/statusFarben';

interface DienststatusVariablen {
  id: number;
  inDienst: boolean;
}

/**
 * In/außer Dienst setzen und danach den Stammdaten-Katalog (`queryKey`) invalidieren.
 *
 * KEIN `onError` (LFH-473): ein Toast wäre nach drei Sekunden weg, danach sagte nichts mehr, dass
 * und warum der Wechsel scheiterte. Der Fehler bleibt an `mutation.error` und steht im
 * `SeitenHinweise`-Slot der Seite, Titel und Ersatztext aus {@link DIENSTSTATUS_FEHLER}.
 */
export function useDienststatusMutation(
  setze: (id: number, inDienst: boolean) => Promise<unknown>,
  queryKey: QueryKey,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: DienststatusVariablen) => setze(v.id, v.inDienst),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
}

/** Wortlaut des stehenden Hinweises; für `<SeitenHinweise {...DIENSTSTATUS_FEHLER} />`. */
export const DIENSTSTATUS_FEHLER = {
  fehlerTitel: 'Dienststatus nicht geändert',
  fehlerFallback: 'Statuswechsel fehlgeschlagen',
} as const;

/**
 * Knopftext je ZIELSTATUS (LFH-959): der Knopf nennt die Handlung, das Etikett daneben den
 * Zustand (`frontend/AGENTS.md`, Bedien-Leitlinie „Aktionen“; Guard
 * `kommunikation/wortlaut.guard.test.ts`).
 */
export const DIENSTSTATUS_HANDLUNG: Record<Dienststatus, string> = {
  ausser_dienst: 'Außer Dienst nehmen',
  in_dienst: 'Wieder in Dienst nehmen',
};

type DienststatusMutation = ReturnType<typeof useDienststatusMutation>;

/** Filterwerte in der Reihenfolge des Vertrags; der Wortlaut kommt von dort, nicht von hier. */
const DIENSTSTATUS_REIHENFOLGE = Object.keys(dienststatus) as Dienststatus[];
const DIENSTSTATUS_FILTER = DIENSTSTATUS_REIHENFOLGE.map((s) => ({
  text: dienststatus[s].label,
  value: s,
}));

export interface DienststatusOptionen<T> {
  mutation: DienststatusMutation;
  istAdmin: boolean;
  onBearbeiten: (eintrag: T) => void;
  schmal: boolean;
  /** Menschenlesbare Kennung der Zeile für den zugänglichen Namen des Aktionsmenüs. */
  kennung: (eintrag: T) => string;
  /** Zeile kommt vom Hub (LLH-1493): statt der Knöpfe steht der Grund, warum es hier nicht geht. */
  vomHub?: (eintrag: T) => boolean;
}

/**
 * Die Aktionen einer Zeile als Beschreibung (LLH-1599, `KatalogTabelle.zeilenMenue`, design.md D5):
 * EINE Quelle für das schmale ⋮ und das Kontextmenü auf jeder Breite. Breit stehen dieselben zwei
 * Handlungen als Knöpfe ({@link dienststatusSpalten}); `verwaltungstabellen.test.tsx` hält beide
 * gleich. Ohne Verwaltungsrecht `undefined`; vom Hub verwaltete Zeilen tragen keine Einträge
 * (Browsermenü, wie ihr gesperrter Platzhalter).
 */
export function dienststatusMenue<T extends { id: number; dienststatus: Dienststatus }>({
  mutation,
  istAdmin,
  onBearbeiten,
  kennung,
  vomHub,
}: DienststatusOptionen<T>): WeitereAktionen<T> | undefined {
  if (!istAdmin) return undefined;
  /**
   * Eine laufende Mutation sperrt GENAU EINE Zeile, nicht die ganze Tabelle. Der Observer kennt nur
   * den jüngsten Aufruf, die Marke wandert also beim Klick auf eine andere Zeile — unschädlich,
   * weil der Endpunkt einen Status SETZT (idempotent), nicht umschaltet.
   */
  const laeuft = (t: T) => mutation.isPending && mutation.variables?.id === t.id;
  return {
    eintraege: (t) => {
      if (vomHub?.(t)) return [];
      // „Außer Dienst nehmen“ bleibt rot (dieselbe Handlung wie der rote Knopf).
      return [
        { key: 'bearbeiten', label: 'Bearbeiten' },
        t.dienststatus === 'in_dienst'
          ? { key: 'dienst', label: DIENSTSTATUS_HANDLUNG.ausser_dienst, gefahr: true }
          : { key: 'dienst', label: DIENSTSTATUS_HANDLUNG.in_dienst },
      ];
    },
    zugaenglicherName: (t) => `Aktionen zu ${kennung(t)}`,
    laeuft,
    onWahl: (aktion, t) => {
      if (aktion === 'bearbeiten') onBearbeiten(t);
      else if (!laeuft(t)) mutation.mutate({ id: t.id, inDienst: t.dienststatus !== 'in_dienst' });
    },
  };
}

/**
 * Status- und (nur für Admins) Aktionsspalte der Stammdaten-Tabellen Fahrzeuge, Personal
 * und Material. Die Farbrolle des Dienststatus steht im Vertrag (`theme/statusFarben.ts`,
 * `dienststatus`, LFH-476) — kein Katalog-Tab setzt sie selbst.
 *
 * Beide Spalten stehen rechts fixiert und sind nicht abwählbar (LFH-980): wer ein Fahrzeug außer
 * Dienst stellt, findet Status und Knopf auf jedem Schirm ohne waagerechtes Wischen. Unter `md`
 * (`schmal`) passen zwei Knöpfe neben der fixierten Kennung und dem Status nicht mehr in 390 px;
 * dort stehen sie im Aktionsmenü, benannt mit der Zeilenkennung (`kennung`).
 */
export function dienststatusSpalten<T extends { id: number; dienststatus: Dienststatus }>(
  optionen: DienststatusOptionen<T>,
): KatalogSpalte<T>[] {
  const { mutation, istAdmin, onBearbeiten, schmal, vomHub } = optionen;
  const menue = dienststatusMenue(optionen);
  const status: KatalogSpalte<T> = {
    title: 'Status',
    key: 'dienststatus',
    immerSichtbar: true,
    fixed: 'right',
    // Bewusst OHNE `dataIndex`: `onFilter` liest den Datensatz selbst, ein Bezug zöge den
    // Drahtwert `in_dienst` in die Freitextsuche, die Rohwerte liest. `String(wert)`, weil
    // antd das Filterargument als `React.Key | boolean` typisiert.
    filters: DIENSTSTATUS_FILTER,
    onFilter: (wert, t) => t.dienststatus === String(wert),
    // In der Folge des Vertrags (in Dienst vor außer Dienst), nicht nach dem Wort (LLH-1096).
    sorter: nachZahl((t: T) => DIENSTSTATUS_REIHENFOLGE.indexOf(t.dienststatus)),
    render: (_, t) => <StatusTag darstellung={dienststatus[t.dienststatus]} />,
  };
  if (!istAdmin) return [status];
  return [
    status,
    {
      title: 'Aktionen',
      key: 'aktionen',
      immerSichtbar: true,
      fixed: 'right',
      render: (_, t) => {
        if (vomHub?.(t)) return <VomHubGesperrt />;
        // Dieselben zwei Handlungen wie in der Knopfreihe darunter, aus der Beschreibung.
        if (schmal && menue) return <ZeilenMenueAusloeser menue={menue} zeile={t} />;
        // Eine laufende Mutation sperrt genau eine Zeile (siehe `dienststatusMenue`).
        const laeuft = mutation.isPending && mutation.variables?.id === t.id;
        const inDienst = t.dienststatus === 'in_dienst';
        return (
          <Space size="middle">
            <Button disabled={laeuft} onClick={() => onBearbeiten(t)}>
              Bearbeiten
            </Button>
            {/* KEINE Rückfrage vor „Außer Dienst nehmen" (LFH-477, Linie aus LFH-363/378): die Aktion
                ist umkehrbar. Der Server setzt nur die Spalte `dienststatus`, keine Disposition
                wird gelöst oder gelöscht; bestehende Einsatzzuordnungen zeigen solange ihren
                Snapshot und nach „Wieder in Dienst nehmen" wieder die Stammdaten. Neu disponieren
                lässt sich der Eintrag in der Zeit nicht. Der Rückweg steht im Gegenzweig
                derselben Zelle. Seine Bedingung (409, wenn Funkrufname, Personal- oder
                Bestandsnummer inzwischen aktiv neu vergeben ist) entsteht erst durch eine
                eigene, spätere Anlage — nie durch einen Fehlklick hier. Deshalb `danger` und
                Abstand (`size="middle"`), aber keine Reibung. Gilt für Fahrzeuge, Personal und
                Material zugleich: alle drei Tabs rendern diese eine Spalte. */}
            {inDienst ? (
              <Button
                danger
                loading={laeuft}
                disabled={laeuft}
                onClick={() => {
                  if (!laeuft) mutation.mutate({ id: t.id, inDienst: false });
                }}
              >
                {DIENSTSTATUS_HANDLUNG.ausser_dienst}
              </Button>
            ) : (
              <Button
                loading={laeuft}
                disabled={laeuft}
                onClick={() => {
                  if (!laeuft) mutation.mutate({ id: t.id, inDienst: true });
                }}
              >
                {DIENSTSTATUS_HANDLUNG.in_dienst}
              </Button>
            )}
          </Space>
        );
      },
    },
  ];
}
