import { App, Button, Form, Input, Popconfirm } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Dayjs } from 'dayjs';
import { useUhr } from '../abloesung/useUhr';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import { alsBackendZeit, alsZeitpunkt } from '../anzeige/zeitEingabe';
import { PROGRAMMPUNKT_BEZEICHNUNG_MAX } from '../api/eingabegrenzen';
import {
  aendereProgrammpunkt,
  ladeProgrammpunkte,
  legeProgrammpunktAn,
  loescheProgrammpunkt,
  type ProgrammpunktEingabe,
} from '../api/programmpunkte';
import { einsatzKeys } from '../api/queryKeys';
import type { Programmpunkt } from '../api/types';
import { ErfassungsModal } from '../components/Erfassung';
import { InlineAngabe } from '../components/InlineAngabe';
import { useFeldKonflikt } from '../components/useFeldKonflikt';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { Feld, Paneel, PaneelZeile, useRollen } from '../components/instrument';
import PaneelZustand from '../components/instrument/PaneelZustand';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { IconMuelleimer } from '../icons';
import { istVerstrichen } from './programmpunkt';

interface FormWerte {
  zeitpunkt: Dayjs | null;
  bezeichnung: string;
}

/** Gleiche Zeitpunkte, wenn derselbe Instant (wie `gleicherZeitpunkt` der Einsatzdaten). */
function gleicherZeitpunkt(a: Dayjs | null, b: Dayjs | null): boolean {
  return a === null || b === null ? a === b : a.valueOf() === b.valueOf();
}

/** Schreibwege des Ablaufs: am Einsatz oder an einer Planung (LLH-1583). */
export interface AblaufSchreiben {
  anlegen: (daten: ProgrammpunktEingabe) => Promise<unknown>;
  /** `erwartet`: Wert beim Öffnen je geänderter Angabe; nur gesetzt, wenn `ladeFrisch` da ist. */
  aendern: (
    id: number,
    daten: Partial<ProgrammpunktEingabe>,
    erwartet?: Partial<ProgrammpunktEingabe>,
  ) => Promise<unknown>;
  loeschen: (id: number) => Promise<unknown>;
  /**
   * Lädt die Programmpunkte frisch (am Cache vorbei). Gesetzt, wenn der Weg den Feld-CAS kennt
   * (am Einsatz, LLH-1945): dann geht je Angabe der Wert beim Öffnen mit, ein 409 fragt
   * „Zwischenzeitlich geändert“. Die Planung speichert ohne Altwert.
   */
  ladeFrisch?: () => Promise<readonly Programmpunkt[]>;
}

/** Wire-Form einer Angabe, wie sie der Vergleich nach einem 409 braucht. */
function angabeWire(p: Programmpunkt, angabe: keyof ProgrammpunktEingabe): string {
  if (angabe === 'bezeichnung') return p.bezeichnung;
  const z = alsZeitpunkt(p.zeitpunkt_at);
  return z ? alsBackendZeit(z) : p.zeitpunkt_at;
}

/**
 * Paneel „Ablauf“ der Einsatzdaten (LLH-1570, Spec `ablaufplan`, design.md D2): die Programmpunkte
 * der Veranstaltung nach Zeit. Uhrzeit und Bezeichnung werden je Zeile in der Ansicht bearbeitet
 * (`InlineAngabe`), angelegt wird im Dialog. Verstrichene Punkte bleiben gedämpft stehen, sie sind
 * der Ablauf des Abends; nur die Marken im Überblick und auf dem Lagemonitor lassen sie fallen.
 */
export default function AblaufPaneel({
  einsatzId,
  darfSchreiben,
}: {
  einsatzId: number;
  darfSchreiben: boolean;
}) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: einsatzKeys.programmpunkte(einsatzId),
    queryFn: () => ladeProgrammpunkte(einsatzId),
  });
  const auffrischen = () =>
    qc.invalidateQueries({ queryKey: einsatzKeys.programmpunkte(einsatzId) });
  const schreiben: AblaufSchreiben = {
    anlegen: (daten) => legeProgrammpunktAn(einsatzId, daten).then(auffrischen),
    aendern: (id, daten, erwartet) =>
      aendereProgrammpunkt(einsatzId, id, daten, erwartet).then((p) => {
        void auffrischen();
        return p;
      }),
    loeschen: (id) => loescheProgrammpunkt(einsatzId, id).then(auffrischen),
    ladeFrisch: () =>
      qc.fetchQuery({
        queryKey: einsatzKeys.programmpunkte(einsatzId),
        queryFn: () => ladeProgrammpunkte(einsatzId),
        staleTime: 0,
      }),
  };
  const punkte = query.data ?? [];
  return (
    <AblaufListe
      punkte={punkte}
      zustand={
        query.isPending
          ? 'laden'
          : query.isError
            ? 'fehler'
            : punkte.length === 0
              ? 'leer'
              : 'daten'
      }
      onNeuladen={() => void query.refetch()}
      darfSchreiben={darfSchreiben}
      schreiben={schreiben}
    />
  );
}

/**
 * Das Paneel „Ablauf“ ohne Datenquelle: dieselbe Ansicht für den Einsatz und für die Planung
 * (LLH-1583), die Programmpunkte und Schreibwege kommen von außen.
 */
export function AblaufListe({
  punkte,
  zustand,
  onNeuladen,
  darfSchreiben,
  schreiben,
}: {
  punkte: readonly Programmpunkt[];
  zustand: 'laden' | 'fehler' | 'leer' | 'daten';
  onNeuladen: () => void;
  darfSchreiben: boolean;
  schreiben: AblaufSchreiben;
}) {
  const { token } = useRollen();
  const { message } = App.useApp();
  const jetzt = useUhr(30_000);
  const [anlegenOffen, setAnlegenOffen] = useState(false);
  const [form] = Form.useForm<FormWerte>();

  const anlegen = useMutation({
    mutationFn: (w: FormWerte) =>
      schreiben.anlegen({
        bezeichnung: w.bezeichnung.trim(),
        zeitpunkt_at: alsBackendZeit(w.zeitpunkt!),
      }),
  });
  const aendern = useMutation({
    mutationFn: ({
      id,
      daten,
      erwartet,
    }: {
      id: number;
      daten: Partial<ProgrammpunktEingabe>;
      erwartet?: Partial<ProgrammpunktEingabe>;
    }) => schreiben.aendern(id, daten, erwartet),
    onSuccess: () => {
      message.success('Programmpunkt gespeichert');
    },
  });
  /*
   * Eine Angabe einer Zeile (LLH-1945, `components/useFeldKonflikt`): mit `ladeFrisch` geht ihr
   * Wert beim Öffnen als Altwert mit, ein 409 fragt mit dem frischen Stand. „Verwerfen“ und
   * Escape melden nichts als gespeichert.
   */
  const konflikt = useFeldKonflikt();
  const { zeitKurz } = useAnzeigeKonventionen();
  const updateAngabe = (
    id: number,
    angabe: keyof ProgrammpunktEingabe,
    neu: string,
    beimOeffnen: string,
  ) => {
    const daten = { [angabe]: neu };
    const ladeFrisch = schreiben.ladeFrisch;
    if (!ladeFrisch) return aendern.mutateAsync({ id, daten });
    return konflikt<string, Programmpunkt | undefined>({
      etikett: angabe === 'bezeichnung' ? 'Bezeichnung' : 'Zeitpunkt',
      erwartet: beimOeffnen,
      speichern: async (alt) => {
        await aendern.mutateAsync({
          id,
          daten,
          erwartet: alt === undefined ? undefined : { [angabe]: alt },
        });
      },
      ladeFrisch: async () => (await ladeFrisch()).find((x) => x.id === id),
      aktuell: (frisch) => frisch && { wert: angabeWire(frisch, angabe) },
      text: (w) => (angabe === 'zeitpunkt_at' ? zeitKurz(w) : w),
    });
  };
  const loeschen = useMutation({
    mutationFn: (id: number) => schreiben.loeschen(id),
  });

  return (
    <Paneel
      titel="Ablauf"
      meta={punkte.length > 0 ? punkte.length : undefined}
      aktion={
        darfSchreiben ? (
          <Button onClick={() => setAnlegenOffen(true)}>Programmpunkt</Button>
        ) : undefined
      }
    >
      <PaneelZustand
        zustand={zustand}
        titel="Ablauf"
        // Ohne Aktion: der Ausweg „Programmpunkt“ steht im Paneelkopf.
        leerText="Kein Programmpunkt"
        onNeuladen={onNeuladen}
      >
        {punkte.map((p) => (
          <AblaufZeile
            key={p.id}
            punkt={p}
            verstrichen={istVerstrichen(p, jetzt)}
            darfSchreiben={darfSchreiben}
            loeschtGerade={loeschen.isPending && loeschen.variables === p.id}
            onAendern={(angabe, neu, beimOeffnen) => updateAngabe(p.id, angabe, neu, beimOeffnen)}
            onLoeschen={() => loeschen.mutate(p.id)}
          />
        ))}
      </PaneelZustand>
      {loeschen.error != null && (
        <div style={{ padding: token.paddingSM }}>
          <SpeicherFehler fehler={loeschen.error} titel="Programmpunkt nicht gelöscht" />
        </div>
      )}
      <ErfassungsModal<FormWerte>
        offen={anlegenOffen}
        titel="Programmpunkt anlegen"
        form={form}
        erfassenText="Anlegen"
        laeuft={anlegen.isPending}
        speicherung={anlegen}
        onErfassen={(w) => anlegen.mutateAsync(w)}
        onFertig={() => setAnlegenOffen(false)}
        onAbbrechen={() => setAnlegenOffen(false)}
      >
        <Feld
          label="Zeitpunkt"
          name="zeitpunkt"
          rules={[{ required: true, message: 'Zeitpunkt ist erforderlich' }]}
        >
          <ZeitpunktEingabe art="frist" style={{ width: '100%' }} />
        </Feld>
        <Feld
          label="Bezeichnung"
          name="bezeichnung"
          rules={[{ required: true, whitespace: true, message: 'Bezeichnung ist erforderlich' }]}
        >
          <Input maxLength={PROGRAMMPUNKT_BEZEICHNUNG_MAX} placeholder="Feuerwerk" />
        </Feld>
      </ErfassungsModal>
    </Paneel>
  );
}

function AblaufZeile({
  punkt,
  verstrichen,
  darfSchreiben,
  loeschtGerade,
  onAendern,
  onLoeschen,
}: {
  punkt: Programmpunkt;
  verstrichen: boolean;
  darfSchreiben: boolean;
  loeschtGerade: boolean;
  /** Neue Wire-Form der Angabe und ihre Wire-Form beim Öffnen (Altwert des Feld-CAS). */
  onAendern: (
    angabe: keyof ProgrammpunktEingabe,
    neu: string,
    beimOeffnen: string,
  ) => Promise<unknown>;
  onLoeschen: () => void;
}) {
  const { token, rollen } = useRollen();
  return (
    <PaneelZeile
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(96px, auto) minmax(0, 1fr) auto',
        gap: token.margin,
        alignItems: 'baseline',
        color: verstrichen ? rollen.gedaempft : rollen.text,
      }}
    >
      <span data-lfh="ablauf-zeit">
        <InlineAngabe<Dayjs | null>
          etikett="Zeitpunkt"
          kennung={punkt.bezeichnung}
          wert={alsZeitpunkt(punkt.zeitpunkt_at) ?? null}
          anzeige={<ZeitAnzeige wert={punkt.zeitpunkt_at} rolle="kurz" />}
          leer={(d) => d === null}
          gleich={gleicherZeitpunkt}
          pflicht
          darfSchreiben={darfSchreiben}
          onSpeichern={(d, { beimOeffnen }) =>
            onAendern(
              'zeitpunkt_at',
              alsBackendZeit(d!),
              beimOeffnen ? alsBackendZeit(beimOeffnen) : punkt.zeitpunkt_at,
            )
          }
          eingabe={({ feld, popup, value, onChange }) => (
            <ZeitpunktEingabe
              art="frist"
              {...feld}
              {...popup}
              style={{ width: '100%' }}
              value={value}
              onChange={(d) => onChange(d ?? null)}
            />
          )}
        />
      </span>
      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        <InlineAngabe<string>
          etikett="Bezeichnung"
          kennung={punkt.bezeichnung}
          wert={punkt.bezeichnung}
          anzeige={punkt.bezeichnung}
          leer={(w) => w.trim() === ''}
          gleich={(a, b) => a.trim() === b.trim()}
          pflicht
          darfSchreiben={darfSchreiben}
          onSpeichern={(w, { beimOeffnen }) =>
            onAendern('bezeichnung', w.trim(), beimOeffnen.trim())
          }
          eingabe={({ feld, value, onChange }) => (
            <Input
              {...feld}
              maxLength={PROGRAMMPUNKT_BEZEICHNUNG_MAX}
              value={value}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        />
      </span>
      {darfSchreiben ? (
        <Popconfirm
          title="Programmpunkt löschen?"
          okText="Löschen"
          cancelText="Abbrechen"
          okButtonProps={{ danger: true }}
          onConfirm={onLoeschen}
        >
          <Button
            type="text"
            danger
            loading={loeschtGerade}
            aria-label={`${punkt.bezeichnung} löschen`}
            icon={
              <span aria-hidden="true">
                <IconMuelleimer />
              </span>
            }
          />
        </Popconfirm>
      ) : (
        <span />
      )}
    </PaneelZeile>
  );
}
