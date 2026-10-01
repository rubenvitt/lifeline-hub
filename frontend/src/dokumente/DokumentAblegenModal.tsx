import { useRef, useState } from 'react';
import { App, Collapse, Form, Input, type UploadFile } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Select } from '../components/Select';
import { ErfassungsModal } from '../components/Erfassung';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import UploadFortschrittAnzeige from '../components/UploadFortschritt';
import { AusgangUnbekannt, NetzFehler, fehlerText, type UploadFortschritt } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import DateiFeld from '../components/DateiFeld';
import {
  DOKUMENT_ACCEPT,
  legeDokumentAb,
  type DokumentAblage,
  type DokumentBezugTyp,
} from '../api/dokumente';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import { listeEtb } from '../api/etb';
import type { DokumentKategorie } from '../api/types';
import { DOKUMENT_KATEGORIEN, DOKUMENT_KATEGORIE_REIHENFOLGE } from './kategorien';

interface Props {
  einsatzId: number;
  offen: boolean;
  onSchliessen: () => void;
}

interface AblageFormular {
  datei?: UploadFile[];
  kategorie: DokumentKategorie;
  titel: string;
  /** `abschnitt:<id>` · `einheit:<id>` · `etb_eintrag:<id>` — getrennt wird beim Absenden. */
  bezug?: string;
}

/** So viele ETB-Einträge stehen als Bezug zur Wahl (die jüngsten). Eigener Filter im Key, damit
 *  die Abfrage nicht das Cache-Fach der Infinite-Query von `EtbPage` teilt. */
const ETB_BEZUG_DECKEL = 100;
const BEZUG_TYPEN: readonly DokumentBezugTyp[] = ['abschnitt', 'einheit', 'etb_eintrag'];
const kuerze = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * Fortschritt nur vorwärts (Spec `dokumentenablage`, „Fortschritt beim Ablegen“): nach der
 * Prüfphase zählt kein spätes `progress` mehr, und ein kleinerer Anteil senkt die Zahl nicht.
 */
function weiter(alt: UploadFortschritt | null, neu: UploadFortschritt): UploadFortschritt {
  if (alt?.phase === 'pruefen') return alt;
  if (neu.phase === 'senden' && alt?.phase === 'senden' && alt.anteil != null) {
    return { phase: 'senden', anteil: Math.max(alt.anteil, neu.anteil ?? alt.anteil) };
  }
  return neu;
}

/**
 * Überschrift und Text eines Ablage-Fehlers nach der Phase des Abbruchs (LFH-654): ohne Antwort
 * VOR dem letzten Byte ist nichts abgelegt, DANACH ist der Ausgang unbekannt. Eine Ablehnung des
 * Servers trägt dessen Meldung (`SpeicherFehler`).
 */
function fehlerKopf(fehler: unknown): { titel: string; fallback?: string } {
  if (fehler instanceof AusgangUnbekannt)
    return { titel: 'Ablage unklar', fallback: fehlerText(fehler) };
  if (fehler instanceof NetzFehler)
    return { titel: 'Nicht abgelegt', fallback: fehlerText(fehler) };
  return { titel: 'Nicht abgelegt' };
}

/** Formularwerte → API-Eingabe. Ein unbekannter Präfix fällt weg, statt einen halben Bezug
 *  zu senden. */
function zuAblage(werte: AblageFormular): DokumentAblage {
  const datei = werte.datei?.[0]?.originFileObj as File;
  const ablage: DokumentAblage = { datei, titel: werte.titel, kategorie: werte.kategorie };
  if (werte.bezug) {
    const trenner = werte.bezug.lastIndexOf(':');
    const typ = werte.bezug.slice(0, trenner) as DokumentBezugTyp;
    const id = Number(werte.bezug.slice(trenner + 1));
    if (BEZUG_TYPEN.includes(typ) && Number.isInteger(id) && id > 0) ablage.bezug = { typ, id };
  }
  return ablage;
}

/**
 * Ablegen-Dialog der Dokumentenablage auf der Erfassungs-Hülle.
 *
 * Drei sichtbare Pflichtfelder — Datei, Kategorie, Titel. Der optionale Bezug liegt
 * eingeklappt mit `forceRender`. Die Kategorie hat KEINE Vorbelegung: ein Foto, das als
 * „Sonstiges" durchrutscht, findet später niemand. Der Titel wird aus dem Dateinamen
 * vorbelegt, überschreibt aber keinen getippten Titel.
 *
 * `mutateAsync`, damit eine Ablehnung die Felder stehen lässt; der Fehler steht als
 * `SpeicherFehler` im Dialog. Die ETB-Einträge lädt der Dialog erst beim Aufklappen des Bezugs.
 *
 * Rückmeldung (LFH-654, Prüfliste LFH-632 Zeile 2 · 3): während der Übertragung Prozent aus den
 * Bytes, danach „Datei wird geprüft“ (`components/UploadFortschritt`). Ohne Verbindung wird
 * NICHTS vorgemerkt — kein Blob in IndexedDB, keine Offline-Queue (Entscheidung und Gründe:
 * Change `lfh-654-dokumentenablage-rueckmeldung`, design.md D5); der Dialog bleibt mit Datei
 * und Feldern stehen, „Ablegen“ versucht es erneut.
 */
export default function DokumentAblegenModal({ einsatzId, offen, onSchliessen }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<AblageFormular>();
  const [bezugOffen, setBezugOffen] = useState(false);
  /** Welcher Titel zuletzt AUTOMATISCH gesetzt wurde. Nur solange das Feld genau diesen Wert
   *  trägt, darf eine neue Dateiwahl ihn ersetzen — ein getippter Titel bleibt immer stehen. */
  const autoTitel = useRef<string | null>(null);
  const [fortschritt, setFortschritt] = useState<UploadFortschritt | null>(null);
  /** Zählt die Läufe. „Abbrechen“ lässt eine Übertragung serverseitig weiterlaufen; ihre späten
   *  Meldungen dürfen nicht in die Anzeige eines neuen Laufs schreiben. */
  const lauf = useRef(0);

  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
    enabled: offen,
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: offen,
  });
  const etbQuery = useQuery({
    queryKey: einsatzKeys.etbListe(einsatzId, { limit: ETB_BEZUG_DECKEL }),
    queryFn: () => listeEtb(einsatzId, { limit: ETB_BEZUG_DECKEL }),
    enabled: offen && bezugOffen,
  });

  const mutation = useMutation({
    mutationFn: (eingabe: DokumentAblage) => {
      const dieser = ++lauf.current;
      // Sofort ein Balken ohne Zahl: bis zum ersten Byte-Ereignis (Verbindungsaufbau über
      // Mobilfunk) vergeht Zeit, und ≤ 100 ms soll etwas zu sehen sein (MIL 5.4.6.4).
      setFortschritt({ phase: 'senden', anteil: null });
      return legeDokumentAb(einsatzId, eingabe, (stand) => {
        if (dieser === lauf.current) setFortschritt((alt) => weiter(alt, stand));
      });
    },
    onSettled: () => setFortschritt(null),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.dokumente(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      message.success('Dokument abgelegt');
    },
  });

  function schliessen() {
    setBezugOffen(false);
    autoTitel.current = null;
    lauf.current += 1;
    setFortschritt(null);
    mutation.reset();
    onSchliessen();
  }

  const bezugOptionen = [
    {
      label: 'Abschnitte',
      options: (abschnitteQuery.data ?? []).map((a) => ({
        value: `abschnitt:${a.id}`,
        label: a.name,
      })),
    },
    {
      label: 'Einheiten',
      options: (einheitenQuery.data ?? []).map((e) => ({
        value: `einheit:${e.id}`,
        label: e.name,
      })),
    },
    {
      label: 'ETB-Einträge',
      options: (etbQuery.data ?? []).map((e) => ({
        value: `etb_eintrag:${e.id}`,
        label: `ETB ${e.lfd_nr} · ${kuerze(e.inhalt, 60)}`,
      })),
    },
  ];

  return (
    <ErfassungsModal<AblageFormular>
      offen={offen}
      titel="Dokument ablegen"
      form={form}
      onErfassen={(werte) => mutation.mutateAsync(zuAblage(werte))}
      onFertig={schliessen}
      onAbbrechen={schliessen}
      laeuft={mutation.isPending}
      erfassenText="Ablegen"
    >
      <SpeicherFehler fehler={mutation.error} {...fehlerKopf(mutation.error)} />
      <UploadFortschrittAnzeige stand={mutation.isPending ? fortschritt : null} />
      {/* Dateifeld samt Vorab-Größenprüfung und Anfangsfokus: `components/DateiFeld`. */}
      <DateiFeld
        accept={DOKUMENT_ACCEPT}
        onDateiWahl={(file) => {
          const aktuell: string | undefined = form.getFieldValue('titel');
          if (!aktuell || aktuell === autoTitel.current) {
            const neu = file.name.replace(/\.[^.]+$/, '');
            autoTitel.current = neu;
            form.setFieldValue('titel', neu);
          }
        }}
      />
      <Form.Item
        name="kategorie"
        label="Kategorie"
        rules={[{ required: true, message: 'Bitte eine Kategorie wählen' }]}
      >
        <Select
          options={DOKUMENT_KATEGORIE_REIHENFOLGE.map((k) => ({
            value: k,
            label: DOKUMENT_KATEGORIEN[k].label,
          }))}
        />
      </Form.Item>
      <Form.Item
        name="titel"
        label="Titel"
        rules={[{ required: true, whitespace: true, message: 'Bitte einen Titel angeben' }]}
      >
        <Input maxLength={200} />
      </Form.Item>
      <Collapse
        activeKey={bezugOffen ? ['bezug'] : []}
        onChange={(schluessel) => setBezugOffen(schluessel.includes('bezug'))}
        items={[
          {
            key: 'bezug',
            label: 'Bezug (optional)',
            forceRender: true,
            children: (
              <Form.Item name="bezug" label="Bezug">
                <Select
                  allowClear
                  loading={bezugOffen && etbQuery.isLoading}
                  options={bezugOptionen}
                />
              </Form.Item>
            ),
          },
        ]}
      />
    </ErfassungsModal>
  );
}
