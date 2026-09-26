import { useEffect, useRef, useState } from 'react';
import { App, Button, Popconfirm, Space } from 'antd';
import { DeleteOutlined, UploadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  entferneSchadenAnhang,
  listeSchadenAnhaenge,
  schadenAnhangDownloadPfad,
  schadenRegistrierAnzeige,
} from '../../api/einsatzSchaden';
import { einsatzKeys } from '../../api/queryKeys';
import type { Schaden, SchadenAnhang } from '../../api/types';
import {
  Paneel,
  PaneelZeile,
  PaneelZustand,
  useRollen,
  type PaneelDatenzustand,
} from '../../components/instrument';
import DownloadAnker from '../../components/DownloadAnker';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import ZeitAnzeige from '../../anzeige/ZeitAnzeige';
import { formatGroesse } from '../../karten/formatGroesse';
import SchadenAnhangAblegenModal from './SchadenAnhangAblegenModal';

const TITEL = 'Fotos und Dateien';

interface Props {
  einsatzId: number;
  schaden: Pick<Schaden, 'id' | 'registrier_nr' | 'storniert_at'>;
  /** Schreibrecht im Einsatz (Rolle + aktiver Einsatz), wie die übrigen Aktionen der Seite. */
  darfSchreiben: boolean;
}

/**
 * Paneel „Fotos und Dateien“ auf der Schaden-Detailseite (LFH-21, design.md D9).
 *
 * Eine LISTE, keine Tabelle: die Frage ist „was ist mit diesem Schaden?“, nicht „welche
 * Datei ist die richtige?“ (LFH-330). Jede Zeile ist ein nativer Download-Anker auf die
 * modul-gegatete Schadensroute — nie auf `/anhaenge/{aid}` des Einsatzes, dort ist die Datei
 * 404 — mit Zeilenkennung im zugänglichen Namen.
 *
 * ENTFERNEN — erst die Umkehrbarkeit (LFH-363/343): serverseitig ein Soft-Delete, aber ohne
 * Wiederherstellen in der Oberfläche, aus Bediensicht also unumkehrbar. Deshalb Rückfrage mit
 * rotem OK-Knopf und KEIN Rückgängig-Toast (es gibt keinen Rückweg, der nicht 404 liefert).
 * Der Knopf ist icon-only, rot, und steht mit Abstand `middle` neben dem Anker.
 *
 * Bis zur Serverantwort lädt der Entfernen-Knopf DER Zeile (Rückmeldung vor der Antwort);
 * scheitert es, trägt die Zeile `data-fehler` und die Alarmkante, und der Alert nennt die Datei
 * (Muster H15/LFH-345: die Serverantwort nennt keinen Dateinamen). Nach dem Erfolg hängt die
 * Zeile samt Knopf aus — der Fokus geht deshalb gezielt auf den Anker der nächsten Zeile
 * (sonst der vorigen), bei leerer Liste auf „Datei ablegen“, statt auf `<body>` zu fallen.
 *
 * „Datei ablegen“ steht NUR im Paneelkopf, auch im Leerzustand: zwei gleichnamige Ziele mit
 * derselben Wirkung wären für Vorlesende nicht unterscheidbar (Review C2).
 *
 * Ohne Schreibrecht und am stornierten Schaden entfallen Ablegen und Entfernen; die Liste
 * bleibt lesbar (Spec „Stornierter Schaden bleibt lesbar“).
 */
export default function SchadenAnhaenge({ einsatzId, schaden, darfSchreiben }: Props) {
  const { message } = App.useApp();
  const { rollen } = useRollen();
  const qc = useQueryClient();
  const listeRef = useRef<HTMLDivElement>(null);
  const kopfKnopf = useRef<HTMLButtonElement>(null);
  /** Wohin der Fokus nach einem erfolgreichen Entfernen geht — vor dem Abschicken aus der
   *  aktuellen Liste bestimmt, nach dem Refetch eingelöst. */
  const fokusNach = useRef<{ entfernt: number; ziel: number | 'kopf' } | null>(null);
  const [ablegenOffen, setAblegenOffen] = useState(false);
  const nr = schadenRegistrierAnzeige(schaden.registrier_nr);
  const aktionen = darfSchreiben && !schaden.storniert_at;

  const query = useQuery({
    queryKey: einsatzKeys.schadenAnhaenge(einsatzId, schaden.id),
    queryFn: () => listeSchadenAnhaenge(einsatzId, schaden.id),
  });
  const entfernen = useMutation({
    mutationFn: (anhangId: number) => entferneSchadenAnhang(einsatzId, schaden.id, anhangId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.schadenAnhaenge(einsatzId, schaden.id) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
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
    (anker ?? kopfKnopf.current)?.focus();
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

  const zeile = (a: SchadenAnhang) => (
    <div
      key={a.id}
      data-lfh="schaden-anhang-zeile"
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
            href={schadenAnhangDownloadPfad(einsatzId, schaden.id, a.id)}
            dateiname={a.dateiname}
            groesse={a.groesse}
            zusatz={
              <>
                {a.abgelegt_von_name ?? 'unbekannt'} · <ZeitAnzeige wert={a.abgelegt_at} />
              </>
            }
            zugaenglicherName={`${a.dateiname}, ${formatGroesse(a.groesse)}, Datei von Schaden ${nr} herunterladen`}
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
                aria-label={`Datei ${a.dateiname} von Schaden ${nr} entfernen`}
                icon={
                  <span aria-hidden="true">
                    <DeleteOutlined />
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
                <UploadOutlined />
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
        <div ref={listeRef}>{liste.map(zeile)}</div>
      </PaneelZustand>
      {aktionen && (
        <SchadenAnhangAblegenModal
          einsatzId={einsatzId}
          schadenId={schaden.id}
          registrierNr={schaden.registrier_nr}
          offen={ablegenOffen}
          onSchliessen={() => setAblegenOffen(false)}
        />
      )}
    </Paneel>
  );
}
