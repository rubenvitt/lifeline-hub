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
import { Paneel, PaneelZeile, useRollen } from '../components/instrument';
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
  const { token } = useRollen();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const jetzt = useUhr(30_000);
  const [anlegenOffen, setAnlegenOffen] = useState(false);
  const [form] = Form.useForm<FormWerte>();

  const query = useQuery({
    queryKey: einsatzKeys.programmpunkte(einsatzId),
    queryFn: () => ladeProgrammpunkte(einsatzId),
  });
  const auffrischen = () =>
    qc.invalidateQueries({ queryKey: einsatzKeys.programmpunkte(einsatzId) });

  const anlegen = useMutation({
    mutationFn: (w: FormWerte) =>
      legeProgrammpunktAn(einsatzId, {
        bezeichnung: w.bezeichnung.trim(),
        zeitpunkt_at: alsBackendZeit(w.zeitpunkt!),
      }),
    onSuccess: () => auffrischen(),
  });
  const aendern = useMutation({
    mutationFn: ({ id, daten }: { id: number; daten: Partial<ProgrammpunktEingabe> }) =>
      aendereProgrammpunkt(einsatzId, id, daten),
    onSuccess: () => {
      void auffrischen();
      message.success('Programmpunkt gespeichert');
    },
  });
  const loeschen = useMutation({
    mutationFn: (id: number) => loescheProgrammpunkt(einsatzId, id),
    onSuccess: () => auffrischen(),
  });

  const punkte = query.data ?? [];
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
        zustand={
          query.isPending
            ? 'laden'
            : query.isError
              ? 'fehler'
              : punkte.length === 0
                ? 'leer'
                : 'daten'
        }
        titel="Ablauf"
        // Ohne Aktion: der Ausweg „Programmpunkt“ steht im Paneelkopf.
        leerText="Kein Programmpunkt"
        onNeuladen={() => void query.refetch()}
      >
        {punkte.map((p) => (
          <AblaufZeile
            key={p.id}
            punkt={p}
            verstrichen={istVerstrichen(p, jetzt)}
            darfSchreiben={darfSchreiben}
            loeschtGerade={loeschen.isPending && loeschen.variables === p.id}
            onAendern={(daten) => aendern.mutateAsync({ id: p.id, daten })}
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
        <Form.Item
          label="Zeitpunkt"
          name="zeitpunkt"
          rules={[{ required: true, message: 'Zeitpunkt ist erforderlich' }]}
        >
          <ZeitpunktEingabe art="frist" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          label="Bezeichnung"
          name="bezeichnung"
          rules={[{ required: true, whitespace: true, message: 'Bezeichnung ist erforderlich' }]}
        >
          <Input maxLength={PROGRAMMPUNKT_BEZEICHNUNG_MAX} placeholder="Feuerwerk" />
        </Form.Item>
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
  onAendern: (daten: Partial<ProgrammpunktEingabe>) => Promise<unknown>;
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
          onSpeichern={(d) => onAendern({ zeitpunkt_at: alsBackendZeit(d!) })}
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
          onSpeichern={(w) => onAendern({ bezeichnung: w.trim() })}
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
