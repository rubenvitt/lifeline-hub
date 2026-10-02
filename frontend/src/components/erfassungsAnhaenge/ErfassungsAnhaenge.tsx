import { IkoneHochladen, IkoneMuelleimer } from '../../ikonen';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { App, Button, Popconfirm, Space } from 'antd';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { einsatzKeys } from '../../api/queryKeys';
import {
  Paneel,
  PaneelZeile,
  PaneelZustand,
  Sammelbanner,
  useRollen,
  type PaneelDatenzustand,
} from '../instrument';
import DownloadAnker from '../DownloadAnker';
import { istBildMime, originalPfad } from '../../api/anhangFassung';
import { useDarfOriginalLaden } from '../../einsatz/useDarfOriginalLaden';
import { SpeicherFehler } from '../SpeicherHinweis';
import ZeitAnzeige from '../../anzeige/ZeitAnzeige';
import { formatGroesse } from '../../karten/formatGroesse';
import ErfassungsAnhangAblegenModal from './ErfassungsAnhangAblegenModal';
import {
  freigegeben,
  nachgefuehrt,
  OFFENER_ZUFLUSS,
  teileZufluss,
  vorgemerkt,
  zuflussText,
  type AnhangZufluss,
} from './anhangZufluss';

/** Was die Liste von einem Anhang braucht — Schnittmenge der DTOs von Schaden, Tier und UHS. */
export interface ErfassungsAnhangEintrag {
  id: number;
  dateiname: string;
  mime: string;
  groesse: number;
  abgelegt_von_name?: string | null;
  abgelegt_at: string;
}

/**
 * Die Modulroute einer Erfassungs-Ablage (LFH-758). Jede Funktion hängt schon an Einsatz und
 * Besitzer; `anhangId` ist die Linker-id. Der Download-Pfad zeigt nie auf `/anhaenge/{aid}` des
 * Einsatzes — dort ist die Datei 404.
 */
export interface ErfassungsAnhangQuelle {
  queryKey: QueryKey;
  liste: () => Promise<ErfassungsAnhangEintrag[]>;
  ablegen: (datei: File) => Promise<{ id: number }>;
  entfernen: (anhangId: number) => Promise<unknown>;
  downloadPfad: (anhangId: number) => string;
}

interface Props {
  einsatzId: number;
  /** Der Besitzer, wie er in zugänglichen Namen und im Dialogtitel steht: „Schaden S-003“,
   *  „Tier T-007“, „UHS BHP 50“. */
  bezug: string;
  quelle: ErfassungsAnhangQuelle;
  /** Schreibrecht im Einsatz (Rolle + aktiver Einsatz), wie die übrigen Aktionen der Seite. */
  darfSchreiben: boolean;
  /** Storniert: nur lesen. */
  gesperrt: boolean;
  /** Zusatzzeile im Ablegen-Dialog (UHS: „Jeder Abruf … wird protokolliert.“). */
  hinweis?: ReactNode;
  /** `data-lfh` der Zeilen (Testanker je Modul). */
  zeilenKennung?: string;
  /** Unter der Liste, im selben Paneel (UHS: Zugriffsprotokoll der Einsatzleitung). */
  children?: ReactNode;
}

const TITEL = 'Fotos und Dateien';

/**
 * Paneel „Fotos und Dateien“ einer Erfassungs-Ablage (Schaden LFH-21, Tier und UHS LFH-758) —
 * eine Liste, keine Tabelle. Jede Zeile ist ein nativer Download-Anker auf die modul-gegatete
 * Route, mit Zeilenkennung im zugänglichen Namen.
 *
 * Entfernen ist serverseitig ein Soft-Delete ohne Rückweg in der Oberfläche, also Rückfrage mit
 * rotem OK-Knopf und kein Rückgängig-Toast. Scheitert es, trägt die Zeile `data-fehler` und der
 * Alert nennt die Datei (die Serverantwort nennt keinen Namen). Nach dem Erfolg hängt die Zeile
 * aus; der Fokus geht auf den Anker der nächsten (sonst vorigen) Zeile bzw. auf „Datei ablegen“,
 * statt auf `<body>` zu fallen.
 *
 * „Datei ablegen“ steht nur im Paneelkopf, auch im Leerzustand: zwei gleichnamige Ziele wären für
 * Vorlesende nicht unterscheidbar. Ohne Schreibrecht und gesperrt bleibt die Liste nur lesbar.
 *
 * Live-Zufluss (LFH-760, `anhangZufluss.ts`): eine Ablage aus einer anderen Sitzung wartet hinter
 * dem Sammelbanner, statt oben einzuschieben. Das Banner liegt als Überlagerung mit Nullhöhe über
 * der Liste (Muster `InfotelefonPage`) und verschiebt keine Zeile; „anzeigen“ gibt frei und setzt
 * den Fokus auf die oberste Zeile, statt ihn mit dem Banner auf `<body>` fallen zu lassen.
 */
export default function ErfassungsAnhaenge({
  einsatzId,
  bezug,
  quelle,
  darfSchreiben,
  gesperrt,
  hinweis,
  zeilenKennung = 'erfassung-anhang-zeile',
  children,
}: Props) {
  const { message } = App.useApp();
  const { rollen } = useRollen();
  const qc = useQueryClient();
  const listeRef = useRef<HTMLDivElement>(null);
  const kopfKnopf = useRef<HTMLButtonElement>(null);
  /** Wohin der Fokus nach einem erfolgreichen Entfernen geht — vor dem Abschicken aus der
   *  aktuellen Liste bestimmt, nach dem Refetch eingelöst. */
  const fokusNach = useRef<{ entfernt: number; ziel: number | 'kopf' } | null>(null);
  const [ablegenOffen, setAblegenOffen] = useState(false);
  /** Die Schleuse gehört zu EINEM Besitzer (Schlüssel = Query-Key der Liste): wechselt er ohne
   *  Neumontage, beginnt sie offen. */
  const besitzer = JSON.stringify(quelle.queryKey);
  const [zuflussZustand, setZuflussZustand] = useState<AnhangZufluss & { besitzer: string }>({
    besitzer,
    ...OFFENER_ZUFLUSS,
  });
  /** Nach „anzeigen“ auf die oberste Zeile — erst nach dem Render mit der freigegebenen Liste. */
  const fokusNachFreigabe = useRef(false);
  const aktionen = darfSchreiben && !gesperrt;
  const darfOriginal = useDarfOriginalLaden(einsatzId);

  const query = useQuery({ queryKey: quelle.queryKey, queryFn: quelle.liste });
  const entfernen = useMutation({
    mutationFn: (anhangId: number) => quelle.entfernen(anhangId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: quelle.queryKey });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      message.success('Datei entfernt');
    },
    onError: () => {
      fokusNach.current = null;
    },
  });

  const zufluss: AnhangZufluss =
    zuflussZustand.besitzer === besitzer ? zuflussZustand : OFFENER_ZUFLUSS;
  const { sichtbar: liste, zurueckgehalten } = teileZufluss(query.data ?? [], zufluss);
  // Nachführen im Render (Muster `AbloesungPage`), nicht im Effekt: der ließe einen Bildaufbau
  // mit veraltetem Stand durch. `nachgefuehrt` liefert `null`, wenn nichts zu tun ist.
  if (query.data) {
    const neu = nachgefuehrt(zufluss, liste);
    if (neu || zuflussZustand.besitzer !== besitzer) {
      setZuflussZustand({ besitzer, ...(neu ?? zufluss) });
    }
  }
  const aendereZufluss = (f: (z: AnhangZufluss) => AnhangZufluss) =>
    setZuflussZustand((z) => ({
      besitzer,
      ...f(z.besitzer === besitzer ? z : OFFENER_ZUFLUSS),
    }));
  function zeigeZurueckgehaltene() {
    fokusNachFreigabe.current = true;
    aendereZufluss((z) => freigegeben(z, query.data ?? []));
  }

  function entferneMitFokus(id: number) {
    const i = liste.findIndex((a) => a.id === id);
    const nachbar = liste[i + 1] ?? liste[i - 1];
    fokusNach.current = { entfernt: id, ziel: nachbar ? nachbar.id : 'kopf' };
    entfernen.mutate(id);
  }

  // Den Fokus erst setzen, wenn die entfernte Zeile wirklich aus der Liste ist (nach dem
  // Refetch) — vorher stünde das Ziel noch neben dem Knopf, der gleich aushängt.
  useEffect(() => {
    const plan = fokusNach.current;
    if (!plan || !query.data || query.data.some((a) => a.id === plan.entfernt)) return;
    fokusNach.current = null;
    const anker =
      plan.ziel === 'kopf'
        ? null
        : listeRef.current?.querySelector<HTMLElement>(
            `[data-anhang-id="${plan.ziel}"] a[download]`,
          );
    (anker ?? kopfKnopf.current)?.focus();
  }, [query.data]);

  useEffect(() => {
    if (!fokusNachFreigabe.current) return;
    fokusNachFreigabe.current = false;
    listeRef.current?.querySelector<HTMLElement>('a[download]')?.focus();
  }, [zuflussZustand]);

  const fehlerId = entfernen.isError ? entfernen.variables : undefined;
  const fehlerName = liste.find((a) => a.id === fehlerId)?.dateiname;
  const zustand: PaneelDatenzustand = query.isLoading
    ? 'laden'
    : query.isError
      ? 'fehler'
      : liste.length === 0
        ? 'leer'
        : 'daten';

  const zeile = (a: ErfassungsAnhangEintrag) => (
    <div
      key={a.id}
      data-lfh={zeilenKennung}
      data-anhang-id={a.id}
      data-fehler={a.id === fehlerId ? '' : undefined}
      style={a.id === fehlerId ? { borderInlineStart: `3px solid ${rollen.alarm}` } : undefined}
    >
      <PaneelZeile>
        <Space
          size="middle"
          align="center"
          style={{ width: '100%', justifyContent: 'space-between' }}
        >
          <DownloadAnker
            href={quelle.downloadPfad(a.id)}
            originalHref={
              darfOriginal && istBildMime(a.mime)
                ? originalPfad(quelle.downloadPfad(a.id))
                : undefined
            }
            originalKennung={`${a.dateiname}, ${bezug}`}
            dateiname={a.dateiname}
            groesse={a.groesse}
            zusatz={
              <>
                {a.abgelegt_von_name ?? 'unbekannt'} · <ZeitAnzeige wert={a.abgelegt_at} />
              </>
            }
            zugaenglicherName={`${a.dateiname}, ${formatGroesse(a.groesse)}, Datei von ${bezug} herunterladen`}
          />
          {aktionen && (
            <Popconfirm
              title="Datei entfernen?"
              description="Sie verschwindet aus der Liste; der ETB-Nachweis bleibt."
              okText="Entfernen"
              cancelText="Abbrechen"
              okButtonProps={{ danger: true }}
              onConfirm={() => entferneMitFokus(a.id)}
            >
              <Button
                type="text"
                danger
                loading={entfernen.isPending && entfernen.variables === a.id}
                aria-label={`Datei ${a.dateiname} von ${bezug} entfernen`}
                icon={
                  <span aria-hidden="true">
                    <IkoneMuelleimer />
                  </span>
                }
              />
            </Popconfirm>
          )}
        </Space>
      </PaneelZeile>
    </div>
  );

  return (
    <Paneel
      titel={TITEL}
      meta={query.data ? `${liste.length} ${liste.length === 1 ? 'Datei' : 'Dateien'}` : undefined}
      aktion={
        aktionen ? (
          <Button
            ref={kopfKnopf}
            onClick={() => setAblegenOffen(true)}
            icon={
              <span aria-hidden="true">
                <IkoneHochladen />
              </span>
            }
          >
            Datei ablegen
          </Button>
        ) : undefined
      }
    >
      <SpeicherFehler
        fehler={entfernen.error}
        titel={fehlerName ? `Datei ${fehlerName} nicht entfernt` : 'Nicht entfernt'}
      />
      <PaneelZustand
        zustand={zustand}
        titel={TITEL}
        leerText="Noch keine Fotos oder Dateien"
        onNeuladen={() => void query.refetch()}
      >
        <div ref={listeRef} style={{ position: 'relative' }}>
          {/* Überlagerung mit Nullhöhe: das Banner nimmt keinen Platz im Fluss. */}
          <div style={{ position: 'sticky', top: 0, height: 0, zIndex: 5 }}>
            {zurueckgehalten.length > 0 && (
              <Sammelbanner
                aktion={{ label: 'anzeigen', onKlick: zeigeZurueckgehaltene }}
                style={{ position: 'absolute', insetInline: 0, top: 0 }}
              >
                {zuflussText(zurueckgehalten.length)} — oben einsortiert
              </Sammelbanner>
            )}
          </div>
          {liste.map(zeile)}
        </div>
      </PaneelZustand>
      {children}
      {aktionen && (
        <ErfassungsAnhangAblegenModal
          einsatzId={einsatzId}
          bezug={bezug}
          queryKey={quelle.queryKey}
          ablegen={quelle.ablegen}
          hinweis={hinweis}
          offen={ablegenOffen}
          onSchliessen={() => setAblegenOffen(false)}
          onAbgelegt={(a) => aendereZufluss((z) => vorgemerkt(z, a.id))}
        />
      )}
    </Paneel>
  );
}
