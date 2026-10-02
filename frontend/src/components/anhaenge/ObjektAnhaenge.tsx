import { IkoneHochladen, IkoneMuelleimer } from '../../ikonen';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { App, Button, Popconfirm, Space } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { einsatzKeys } from '../../api/queryKeys';
import {
  Paneel,
  PaneelZeile,
  PaneelZustand,
  paneelMetaStil,
  useRollen,
  type PaneelDatenzustand,
} from '../instrument';
import DownloadAnker from '../DownloadAnker';
import { istBildMime, originalPfad } from '../../api/anhangFassung';
import { useDarfOriginalLaden } from '../../einsatz/useDarfOriginalLaden';
import { SpeicherFehler } from '../SpeicherHinweis';
import ZeitAnzeige from '../../anzeige/ZeitAnzeige';
import { formatGroesse } from '../../karten/formatGroesse';
import AnhangAblegenModal from './AnhangAblegenModal';

export const ANHAENGE_TITEL = 'Fotos und Dateien';

/** Was der Block von einem Anhang braucht — Schaden- und Personen-DTO tragen es beide. */
export interface ErfassungsAnhang {
  /** Linker-id, nie `anhang.id`. */
  id: number;
  dateiname: string;
  mime: string;
  groesse: number;
  abgelegt_von_name?: string | null;
  abgelegt_at: string;
}

/**
 * Die Routen eines Fachmoduls für seine Anhänge. Jede Datei ist nur über die modul-gegatete Route
 * ladbar (nie `/anhaenge/{aid}` des Einsatzes, dort ist sie 404).
 */
export interface AnhangQuelle {
  queryKey: readonly unknown[];
  liste: () => Promise<ErfassungsAnhang[]>;
  ablegen: (datei: File) => Promise<unknown>;
  entfernen: (id: number) => Promise<void>;
  downloadPfad: (id: number) => string;
  /** Kennung des Objekts für zugängliche Namen und Titel: „Schaden S-003“, „Person R-007“. */
  kennung: string;
}

interface Props {
  einsatzId: number;
  quelle: AnhangQuelle;
  /** Ablegen und Entfernen erlaubt — Schreibrecht und nicht storniert, vom Aufrufer bestimmt. */
  darfSchreiben: boolean;
  /**
   * `paneel` (Vorgabe): eigenes `Paneel` mit „Datei ablegen“ im Kopf (Schaden-Detailseite).
   * `abschnitt`: ohne eigenen Rahmen, „Datei ablegen“ über der Liste — für einen Abschnitt, dessen
   * Kopf einem anderen Baustein gehört (aufklappbarer Abschnitt der Personen-Detailseite).
   */
  huelle?: 'paneel' | 'abschnitt';
}

/**
 * Block „Fotos und Dateien“ eines Erfassungsobjekts (Schaden LFH-21, Person LFH-757) — eine Liste,
 * keine Tabelle. Jede Zeile ist ein nativer Download-Anker auf die Route des Fachmoduls, mit
 * Zeilenkennung im zugänglichen Namen.
 *
 * Entfernen ist serverseitig ein Soft-Delete ohne Rückweg in der Oberfläche, also Rückfrage mit
 * rotem OK-Knopf und kein Rückgängig-Toast. Scheitert es, trägt die Zeile `data-fehler` und der
 * Alert nennt die Datei (die Serverantwort nennt keinen Namen). Nach dem Erfolg hängt die Zeile
 * aus; der Fokus geht auf den Anker der nächsten (sonst vorigen) Zeile bzw. auf „Datei ablegen“,
 * statt auf `<body>` zu fallen.
 *
 * „Datei ablegen“ steht genau einmal, auch im Leerzustand: zwei gleichnamige Ziele wären für
 * Vorlesende nicht unterscheidbar. Ohne Schreibrecht bleibt die Liste nur lesbar.
 */
export default function ObjektAnhaenge({
  einsatzId,
  quelle,
  darfSchreiben,
  huelle = 'paneel',
}: Props) {
  const { message } = App.useApp();
  const { rollen } = useRollen();
  const qc = useQueryClient();
  const listeRef = useRef<HTMLDivElement>(null);
  const ablegenKnopf = useRef<HTMLButtonElement>(null);
  /** Wohin der Fokus nach einem erfolgreichen Entfernen geht — vor dem Abschicken aus der
   *  aktuellen Liste bestimmt, nach dem Refetch eingelöst. */
  const fokusNach = useRef<{ entfernt: number; ziel: number | 'kopf' } | null>(null);
  const [ablegenOffen, setAblegenOffen] = useState(false);
  const { kennung } = quelle;
  const darfOriginal = useDarfOriginalLaden(einsatzId);
  const invalidieren = [quelle.queryKey, einsatzKeys.etb(einsatzId)] as const;

  const query = useQuery({ queryKey: quelle.queryKey, queryFn: quelle.liste });
  const entfernen = useMutation({
    mutationFn: (id: number) => quelle.entfernen(id),
    onSuccess: () => {
      for (const queryKey of invalidieren) void qc.invalidateQueries({ queryKey });
      message.success('Datei entfernt');
    },
    onError: () => {
      fokusNach.current = null;
    },
  });

  const liste = query.data ?? [];

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
    (anker ?? ablegenKnopf.current)?.focus();
  }, [query.data]);

  const fehlerId = entfernen.isError ? entfernen.variables : undefined;
  const fehlerName = liste.find((a) => a.id === fehlerId)?.dateiname;
  const zustand: PaneelDatenzustand = query.isLoading
    ? 'laden'
    : query.isError
      ? 'fehler'
      : liste.length === 0
        ? 'leer'
        : 'daten';

  const zeile = (a: ErfassungsAnhang) => (
    <div
      key={a.id}
      data-lfh="anhang-zeile"
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
            originalKennung={`${a.dateiname}, ${kennung}`}
            dateiname={a.dateiname}
            groesse={a.groesse}
            zusatz={
              <>
                {a.abgelegt_von_name ?? 'unbekannt'} · <ZeitAnzeige wert={a.abgelegt_at} />
              </>
            }
            zugaenglicherName={`${a.dateiname}, ${formatGroesse(a.groesse)}, Datei von ${kennung} herunterladen`}
          />
          {darfSchreiben && (
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
                aria-label={`Datei ${a.dateiname} von ${kennung} entfernen`}
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

  const ablegenAktion = darfSchreiben ? (
    <Button
      ref={ablegenKnopf}
      onClick={() => setAblegenOffen(true)}
      icon={
        <span aria-hidden="true">
          <IkoneHochladen />
        </span>
      }
    >
      Datei ablegen
    </Button>
  ) : undefined;
  const meta = query.data
    ? `${liste.length} ${liste.length === 1 ? 'Datei' : 'Dateien'}`
    : undefined;

  const koerper: ReactNode = (
    <>
      <SpeicherFehler
        fehler={entfernen.error}
        titel={fehlerName ? `Datei ${fehlerName} nicht entfernt` : 'Nicht entfernt'}
      />
      <PaneelZustand
        zustand={zustand}
        titel={ANHAENGE_TITEL}
        leerText="Noch keine Fotos oder Dateien"
        onNeuladen={() => void query.refetch()}
      >
        <div ref={listeRef}>{liste.map(zeile)}</div>
      </PaneelZustand>
      {darfSchreiben && (
        <AnhangAblegenModal
          kennung={kennung}
          ablegen={quelle.ablegen}
          invalidieren={invalidieren}
          offen={ablegenOffen}
          onSchliessen={() => setAblegenOffen(false)}
        />
      )}
    </>
  );

  if (huelle === 'abschnitt') {
    return (
      <div role="region" aria-label={ANHAENGE_TITEL} data-lfh="anhaenge-abschnitt">
        {(ablegenAktion || meta) && (
          <Space
            size="middle"
            align="center"
            style={{ width: '100%', justifyContent: 'space-between' }}
          >
            {ablegenAktion ?? <span />}
            {/* Dieselbe Meta wie im Paneelkopf: Mono, `tabular-nums`. */}
            {meta && <span style={paneelMetaStil(rollen)}>{meta}</span>}
          </Space>
        )}
        {koerper}
      </div>
    );
  }
  return (
    <Paneel titel={ANHAENGE_TITEL} meta={meta} aktion={ablegenAktion}>
      {koerper}
    </Paneel>
  );
}
