import { Button, DatePicker, Form, Input, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { formatUhrzeitMitTag } from '../anzeige/format';
import { ladeZeitachse, streicheEreignis, trageNach, type KraftArt } from '../api/kraefteZeitachse';
import { einsatzKeys } from '../api/queryKeys';
import type { ZeitachseEreignis, ZeitachseNachtragBody } from '../api/types';
import { useUhr } from '../abloesung/useUhr';
import { ErfassungsModal } from '../components/Erfassung';
import { PaneelZustand, Zeitachseneintrag, monoStil, useRollen } from '../components/instrument';
import { Select } from '../components/Select';
import { RechteHinweis, SpeicherFehler } from '../components/SpeicherHinweis';
import { alsBackendZeit } from '../etb/filterZeit';
import {
  ART_WORT,
  HERKUNFT_WORT,
  NACHTRAG_ARTEN,
  ankerText,
  dauerText,
  kraftDauern,
} from './zeitachse';

/**
 * Zeitachse einer Kraft (LFH-552) — Einheit-Detailseite und aufgeklappte Personalzeile teilen
 * dieses Bauteil: Dauerzeile, Ereignisse nach Zeit (gestrichene durchgestrichen mit Grund, die
 * Herkunft als Wort), Nachtrag und Streichung.
 *
 * - Nachtrag: `ErfassungsModal` mit drei Feldern (Art, Zeitpunkt, Notiz); die Ablösung fehlt in
 *   der Auswahl, sie entsteht nur aus dem Vollzug. Ein Fehler (422) steht im Dialog, kein Toast.
 * - Streichung: unumkehrbar und ohne serverseitigen Rückweg, deshalb Rückfrage mit Pflichtgrund
 *   (LFH-343/363); ein Ereignis aus der Ablösung streicht nur deren Rücknahme.
 * - Ohne Schreibrecht nennt `RechteHinweis` den Grund, die Knöpfe stehen gesperrt da (M16).
 */

const ZEITFORMAT = 'YYYY-MM-DD HH:mm';

interface NachtragWerte {
  art: ZeitachseNachtragBody['art'];
  zeitpunkt: Dayjs;
  notiz?: string;
}

interface StreichWerte {
  grund: string;
}

export interface KraftZeitachseProps {
  einsatzId: number;
  art: KraftArt;
  id: number;
  /** Menschenlesbare Kennung der Kraft für Dialogtitel und zugängliche Namen. */
  kennung: string;
  darfSchreiben: boolean;
  /** Grund, wenn nicht geschrieben werden darf. */
  rechteText?: string;
}

export const ZEITACHSE_RECHTE_TEXT =
  'Nachtragen und Streichen brauchen Schreibrecht in einem laufenden Einsatz.';

function zeitachseKey(einsatzId: number, art: KraftArt, id: number) {
  return art === 'einheit'
    ? einsatzKeys.kraefteZeitachseEinheit(einsatzId, id)
    : einsatzKeys.kraefteZeitachsePerson(einsatzId, id);
}

/** „über Einheit «Florian 1»", „aus Status", „nachgetragen" … */
export function herkunftText(e: Pick<ZeitachseEreignis, 'quelle' | 'ursprung_einheit_name'>) {
  const wort = HERKUNFT_WORT[e.quelle];
  return e.quelle === 'einheit' && e.ursprung_einheit_name
    ? `${wort} «${e.ursprung_einheit_name}»`
    : wort;
}

export default function KraftZeitachse({
  einsatzId,
  art,
  id,
  kennung,
  darfSchreiben,
  rechteText = ZEITACHSE_RECHTE_TEXT,
}: KraftZeitachseProps) {
  const qc = useQueryClient();
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const jetzt = useUhr(60_000);
  const zeit = (utc: string) => formatUhrzeitMitTag(utc, konventionen);

  const [nachtragOffen, setNachtragOffen] = useState(false);
  const [streiche, setStreiche] = useState<ZeitachseEreignis | null>(null);
  const [nachtragForm] = Form.useForm<NachtragWerte>();
  const [streichForm] = Form.useForm<StreichWerte>();

  // Vorbelegung „jetzt" bei JEDEM Öffnen, nach dem Einhängen des Dialogs (Muster
  // `KatalogVerwaltung`). Nicht über `initialValues`: der Formularspeicher überlebt das Schließen
  // und hielte sonst den Zeitpunkt des vorigen Nachtrags (Review LFH-552).
  useEffect(() => {
    if (nachtragOffen) nachtragForm.setFieldsValue({ zeitpunkt: dayjs() });
  }, [nachtragOffen, nachtragForm]);

  const query = useQuery({
    queryKey: zeitachseKey(einsatzId, art, id),
    queryFn: () => ladeZeitachse(einsatzId, art, id),
  });
  // Der Prefix trifft die Listen (Meldebild, Personal-Seite) und alle Einzelsichten mit — ein
  // Nachtrag an der Einheit schreibt per Fan-out auch ihre Personen.
  const invalidiere = () =>
    qc.invalidateQueries({ queryKey: einsatzKeys.kraefteZeitachse(einsatzId) });

  const nachtrag = useMutation({
    mutationFn: (body: ZeitachseNachtragBody) => trageNach(einsatzId, art, id, body),
    onSuccess: invalidiere,
  });
  const streichung = useMutation({
    mutationFn: ({ ereignisId, grund }: { ereignisId: number; grund: string }) =>
      streicheEreignis(einsatzId, art, id, ereignisId, grund),
    onSuccess: invalidiere,
  });

  const dauern = kraftDauern(query.data?.perioden, jetzt.valueOf());
  const ereignisse = query.data?.ereignisse ?? [];
  const zustand = query.isPending
    ? 'laden'
    : query.isError
      ? 'fehler'
      : ereignisse.length === 0
        ? 'leer'
        : 'daten';

  const nachtragKnopf = (
    <Button
      disabled={!darfSchreiben}
      onClick={() => {
        nachtrag.reset();
        setNachtragOffen(true);
      }}
    >
      Nachtragen
    </Button>
  );

  return (
    <div
      data-lfh="kraft-zeitachse"
      style={{ display: 'flex', flexDirection: 'column', gap: token.paddingSM }}
    >
      <RechteHinweis text={rechteText} sichtbar={!darfSchreiben} />
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: token.paddingSM,
          justifyContent: 'space-between',
        }}
      >
        <DauerZeile dauern={dauern} zeit={zeit} />
        {nachtragKnopf}
      </div>
      <PaneelZustand
        zustand={zustand}
        titel="Zeitachse"
        leerText="Noch keine Ereignisse. Sie entstehen aus Statuswechseln mit Zeitachsen-Marke oder als Nachtrag."
        onNeuladen={() => void query.refetch()}
      >
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {ereignisse.map((e) => {
            const gestrichen = e.gestrichen_at != null;
            const beschreibung = `${ART_WORT[e.art]} ${zeit(e.zeitpunkt_at)}`;
            return (
              <Zeitachseneintrag
                key={e.id}
                als="li"
                data-lfh="zeitachse-ereignis"
                data-gestrichen={gestrichen || undefined}
                zeit={<span style={monoStil(13)}>{zeit(e.zeitpunkt_at)}</span>}
                typwort={ART_WORT[e.art]}
                meta={herkunftText(e)}
                toenung={gestrichen ? 'berichtigung' : undefined}
                hinweis={gestrichen ? `gestrichen: ${e.streichgrund ?? ''}` : undefined}
                aktionen={
                  // Nach der Art: auch die Kopie an einer Person streicht nur die Rücknahme der Ablösung.
                  !gestrichen && e.art !== 'abloesung' ? (
                    <Button
                      danger
                      disabled={!darfSchreiben}
                      aria-label={`${beschreibung} streichen`}
                      onClick={() => {
                        streichung.reset();
                        setStreiche(e);
                      }}
                    >
                      Streichen
                    </Button>
                  ) : undefined
                }
              >
                {gestrichen ? (
                  <s style={{ color: rollen.gedaempft }}>{e.notiz ?? beschreibung}</s>
                ) : (
                  (e.notiz ?? <span style={{ color: rollen.gedaempft }}>—</span>)
                )}
              </Zeitachseneintrag>
            );
          })}
        </ol>
      </PaneelZustand>

      <ErfassungsModal<NachtragWerte>
        offen={nachtragOffen}
        titel={`Zeitachse nachtragen: ${kennung}`}
        form={nachtragForm}
        erfassenText="Nachtragen"
        laeuft={nachtrag.isPending}
        onErfassen={(w) =>
          nachtrag.mutateAsync({
            art: w.art,
            zeitpunkt_at: alsBackendZeit(w.zeitpunkt),
            notiz: w.notiz?.trim() || undefined,
          })
        }
        onFertig={() => setNachtragOffen(false)}
        onAbbrechen={() => setNachtragOffen(false)}
      >
        <Form.Item<NachtragWerte>
          name="art"
          label="Ereignis"
          rules={[{ required: true, message: 'Bitte ein Ereignis wählen' }]}
        >
          <Select
            placeholder="Ereignis wählen…"
            options={NACHTRAG_ARTEN.map((a) => ({ value: a, label: ART_WORT[a] }))}
          />
        </Form.Item>
        <Form.Item<NachtragWerte>
          name="zeitpunkt"
          label="Zeitpunkt"
          rules={[{ required: true, message: 'Bitte einen Zeitpunkt angeben' }]}
        >
          <DatePicker
            showTime
            format={ZEITFORMAT}
            style={{ width: '100%' }}
            disabledDate={(d) => d.isAfter(dayjs(), 'day')}
          />
        </Form.Item>
        <Form.Item<NachtragWerte> name="notiz" label="Notiz (optional)">
          <Input placeholder="z. B. per Funk gemeldet" />
        </Form.Item>
        <SpeicherFehler fehler={nachtrag.error} titel="Nicht nachgetragen" />
      </ErfassungsModal>

      <ErfassungsModal<StreichWerte>
        offen={streiche !== null}
        titel="Ereignis streichen"
        form={streichForm}
        erfassenText="Streichen"
        unumkehrbar
        laeuft={streichung.isPending}
        onErfassen={(w) =>
          streichung.mutateAsync({ ereignisId: streiche!.id, grund: w.grund.trim() })
        }
        onFertig={() => setStreiche(null)}
        onAbbrechen={() => setStreiche(null)}
      >
        <Typography.Paragraph>
          {streiche && `${ART_WORT[streiche.art]} ${zeit(streiche.zeitpunkt_at)}`} bei {kennung}{' '}
          wird gestrichen. Das lässt sich nicht zurücknehmen; der Eintrag bleibt durchgestrichen
          lesbar
          {art === 'einheit'
            ? ', und die daraus mitgeschriebenen Einträge der Personen fallen mit'
            : ''}
          .
        </Typography.Paragraph>
        <Form.Item<StreichWerte>
          name="grund"
          label="Grund"
          rules={[{ required: true, whitespace: true, message: 'Bitte einen Grund angeben' }]}
        >
          <Input placeholder="z. B. Zeit verwechselt" />
        </Form.Item>
        <SpeicherFehler fehler={streichung.error} titel="Nicht gestrichen" />
      </ErfassungsModal>
    </div>
  );
}

/** „Im Einsatz 7 h 40 · seit Alarmierung 06:10 · gesamt 9 h 15" bzw. „Ruhe 3 h 20". */
function DauerZeile({
  dauern,
  zeit,
}: {
  dauern: ReturnType<typeof kraftDauern>;
  zeit: (utc: string) => string;
}) {
  const { rollen } = useRollen();
  const teile: string[] = [];
  if (dauern.laufend) {
    teile.push(`Im Einsatz ${dauerText(dauern.laufend.minuten)}`);
    teile.push(ankerText(dauern.laufend.anker, zeit(dauern.laufend.beginnAt)));
  }
  if (dauern.ruheMinuten != null) teile.push(`Ruhe ${dauerText(dauern.ruheMinuten)}`);
  if (dauern.gesamtMinuten != null) teile.push(`gesamt ${dauerText(dauern.gesamtMinuten)}`);
  if (teile.length === 0) return <span />;
  return (
    <span data-lfh="kraft-dauer" style={{ ...monoStil(12), color: rollen.text2 }}>
      {teile.join(' · ')}
    </span>
  );
}
