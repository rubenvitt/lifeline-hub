import { Button, Form, Input, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { formatUhrzeitMitTag } from '../anzeige/format';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import { ladeZeitachse, streicheEreignis, trageNach, type KraftArt } from '../api/kraefteZeitachse';
import { einsatzKeys } from '../api/queryKeys';
import type { ZeitachseEreignis, ZeitachseNachtragBody } from '../api/types';
import { useUhr } from '../abloesung/useUhr';
import { ErfassungsModal } from '../components/Erfassung';
import {
  PaneelZustand,
  Sammelbanner,
  Zeitachseneintrag,
  monoStil,
  useRollen,
} from '../components/instrument';
import { Select } from '../components/Select';
import { RechteHinweis, SpeicherFehler } from '../components/SpeicherHinweis';
import { alsBackendZeit } from '../anzeige/zeitEingabe';
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
 *
 * ZUFLUSS (LFH-861, Prüfliste LFH-552 Kriterium 12, WCAG 3.2.5): steht Fokus ODER Zeiger in der
 * Liste, friert die MENGE der Ereignisse ein; ein fremdes neues wartet hinter dem Sammelbanner
 * unter der Liste (darüber verschiebt sich nichts). Der Zeiger zählt mit wie in
 * `abloesung/zufluss.ts`: „Streichen“ trifft man meist mit der Maus. Der Inhalt fließt — eine
 * Streichung ändert nur die Zeile selbst, und die Folge der gezeigten bleibt (append-only, der
 * Zeitpunkt eines Ereignisses ändert sich nie). Der eigene Nachtrag steht sofort: seine Ids
 * (Antwort minus bisheriger Stand) kommen zur gehaltenen Menge. Eine leere Liste friert nicht ein,
 * und die Schleuse gilt je Kraft, nicht je Bauteil.
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

  const schluessel = zeitachseKey(einsatzId, art, id);
  const query = useQuery({
    queryKey: schluessel,
    queryFn: () => ladeZeitachse(einsatzId, art, id),
  });

  // ── Zuflussschleuse (LFH-861) ───────────────────────────────────────────────────────
  const kraft = `${art}:${id}`;
  const liste = useRef<HTMLDivElement>(null);
  const fokusDrin = useRef(false);
  const zeigerDrin = useRef(false);
  const [gefroren, setGefroren] = useState<{ kraft: string; ids: ReadonlySet<number> } | null>(
    null,
  );
  const halt = gefroren?.kraft === kraft ? gefroren.ids : null;
  const alle = query.data?.ereignisse;
  const ereignisse = (halt ? alle?.filter((e) => halt.has(e.id)) : alle) ?? [];
  const zurueckgehalten = (alle?.length ?? 0) - ereignisse.length;

  const friereEin = () => {
    if (alle && alle.length > 0) setGefroren({ kraft, ids: new Set(alle.map((e) => e.id)) });
  };
  const halte = () => {
    if (halt == null) friereEin();
  };
  const gibFrei = () => {
    if (!fokusDrin.current && !zeigerDrin.current) setGefroren(null);
  };
  const fokusVerlassen = (e: FocusEvent<HTMLElement>) => {
    // `focusout` feuert auch beim Sprung zwischen zwei Knöpfen der Liste — das ist kein Verlassen.
    if (e.relatedTarget instanceof Node && liste.current?.contains(e.relatedTarget)) return;
    fokusDrin.current = false;
    gibFrei();
  };

  // Jeder neue Stand prüft nach: WebKit feuert beim Entfernen des fokussierten Knotens (eine fremde
  // Streichung nimmt den Knopf weg) KEIN `focusout`, die Schleuse bliebe sonst gefroren. Und kommt
  // die erste Zeile, während Fokus oder Zeiger schon in der Liste stehen, hält ab jetzt die Menge.
  useEffect(() => {
    if (fokusDrin.current) {
      const aktiv = document.activeElement;
      if (!(aktiv instanceof Node && liste.current?.contains(aktiv))) fokusDrin.current = false;
    }
    const drin = fokusDrin.current || zeigerDrin.current;
    if (halt != null && !drin) setGefroren(null);
    else if (halt == null && drin && alle && alle.length > 0)
      setGefroren({ kraft, ids: new Set(alle.map((e) => e.id)) });
  }, [alle, halt, kraft]);

  // Der Prefix trifft die Listen (Meldebild, Personal-Seite) und alle Einzelsichten mit — ein
  // Nachtrag an der Einheit schreibt per Fan-out auch ihre Personen.
  const invalidiere = () =>
    qc.invalidateQueries({ queryKey: einsatzKeys.kraefteZeitachse(einsatzId) });

  const nachtrag = useMutation({
    mutationFn: (body: ZeitachseNachtragBody) => trageNach(einsatzId, art, id, body),
    onSuccess: (antwort) => {
      // Der eigene Nachtrag steht sofort, auch in gehaltener Liste; was gleichzeitig fremd
      // eintraf, steckt schon im bisherigen Stand und wartet weiter.
      const bisher = new Set(
        qc.getQueryData<typeof antwort>(schluessel)?.ereignisse.map((e) => e.id) ?? [],
      );
      const eigene = antwort.ereignisse.filter((e) => !bisher.has(e.id)).map((e) => e.id);
      setGefroren((g) =>
        g && g.kraft === kraft && eigene.length > 0
          ? { kraft, ids: new Set([...g.ids, ...eigene]) }
          : g,
      );
      qc.setQueryData(schluessel, antwort);
      return invalidiere();
    },
  });
  const streichung = useMutation({
    mutationFn: ({ ereignisId, grund }: { ereignisId: number; grund: string }) =>
      streicheEreignis(einsatzId, art, id, ereignisId, grund),
    onSuccess: invalidiere,
  });

  const dauern = kraftDauern(query.data?.perioden, jetzt.valueOf());
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
        <div
          ref={liste}
          data-lfh="zeitachse-liste"
          onFocus={() => {
            fokusDrin.current = true;
            halte();
          }}
          onBlur={fokusVerlassen}
          onMouseEnter={() => {
            zeigerDrin.current = true;
            halte();
          }}
          onMouseLeave={() => {
            zeigerDrin.current = false;
            gibFrei();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: token.paddingXS }}
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
          {zurueckgehalten > 0 && (
            // Unter der Liste: ein Banner darüber schöbe genau die Zeilen, die es schützen soll.
            <Sammelbanner aktion={{ label: 'anzeigen', onKlick: friereEin }}>
              {zurueckgehalten === 1 ? '1 neues Ereignis' : `${zurueckgehalten} neue Ereignisse`}
            </Sammelbanner>
          )}
        </div>
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
          {/* Zeit und Kalendertag in der Anzeigezone (LFH-692, `keineZukunftstage`). */}
          <ZeitpunktEingabe format={ZEITFORMAT} style={{ width: '100%' }} keineZukunftstage />
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
