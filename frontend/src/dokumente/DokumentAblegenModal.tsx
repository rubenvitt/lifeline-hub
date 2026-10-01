import { useEffect, useMemo, useRef, useState } from 'react';
import { App, Collapse, Form, Input, type UploadFile } from 'antd';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Select } from '../components/Select';
import { ErfassungsModal } from '../components/Erfassung';
import { SpeicherFehler } from '../components/SpeicherHinweis';
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
import type { DokumentKategorie } from '../api/types';
import { DOKUMENT_KATEGORIEN, DOKUMENT_KATEGORIE_REIHENFOLGE } from './kategorien';
import { ETB_BEZUG_DECKEL, ladeEtbBezuege, useStandWaehrendOffen } from './bezugswahl';

interface BezugOption {
  value: string;
  label: string;
}

interface BezugGruppe {
  label: string;
  options: BezugOption[];
}

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

/** Frist, nach der ein getippter Bezug-Suchbegriff an den Server geht. */
const ENTPRELLUNG_MS = 300;
const BEZUG_TYPEN: readonly DokumentBezugTyp[] = ['abschnitt', 'einheit', 'etb_eintrag'];
const kuerze = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

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
 * Bezugswahl (LFH-655): Die offene Liste steht still (`useStandWaehrendOffen`) — ein neuer
 * ETB-Eintrag oder Abschnitt erscheint erst beim nächsten Öffnen. ETB-Einträge sucht der Server
 * (`ladeEtbBezuege`, auch per laufender Nummer), Abschnitte und Einheiten filtert der Client.
 */
export default function DokumentAblegenModal({ einsatzId, offen, onSchliessen }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<AblageFormular>();
  const [bezugOffen, setBezugOffen] = useState(false);
  const [listeOffen, setListeOffen] = useState(false);
  const [suche, setSuche] = useState('');
  const [etbSuche, setEtbSuche] = useState('');
  /** Welcher Titel zuletzt AUTOMATISCH gesetzt wurde. Nur solange das Feld genau diesen Wert
   *  trägt, darf eine neue Dateiwahl ihn ersetzen — ein getippter Titel bleibt immer stehen. */
  const autoTitel = useRef<string | null>(null);

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
  useEffect(() => {
    const begriff = suche.trim();
    if (begriff === etbSuche) return;
    const frist = setTimeout(() => setEtbSuche(begriff), ENTPRELLUNG_MS);
    return () => clearTimeout(frist);
  }, [suche, etbSuche]);
  // Eigener Filter im Key, damit die Abfrage nicht das Cache-Fach der Infinite-Query von
  // `EtbPage` teilt; unter `einsatzKeys.etb` bleibt sie, damit Live-Updates sie erreichen.
  const etbQuery = useQuery({
    queryKey: einsatzKeys.etbListe(einsatzId, { limit: ETB_BEZUG_DECKEL, bezug: etbSuche }),
    queryFn: () => ladeEtbBezuege(einsatzId, etbSuche),
    enabled: offen && bezugOffen,
    // Während ein neuer Suchbegriff lädt, bleibt der alte Treffer stehen statt einer leeren Gruppe.
    placeholderData: keepPreviousData,
  });

  const mutation = useMutation({
    mutationFn: (eingabe: DokumentAblage) => legeDokumentAb(einsatzId, eingabe),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.dokumente(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      message.success('Dokument abgelegt');
    },
  });

  function schliessen() {
    setBezugOffen(false);
    setListeOffen(false);
    setSuche('');
    setEtbSuche('');
    autoTitel.current = null;
    mutation.reset();
    onSchliessen();
  }

  const liveGruppen = useMemo<BezugGruppe[]>(
    () => [
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
    ],
    [abschnitteQuery.data, einheitenQuery.data, etbQuery.data],
  );
  const geladen =
    abschnitteQuery.isSuccess &&
    einheitenQuery.isSuccess &&
    etbQuery.isSuccess &&
    !etbQuery.isPlaceholderData;
  const gruppen = useStandWaehrendOffen(liveGruppen, listeOffen, geladen ? etbSuche : null);

  // Abschnitte und Einheiten filtert der Client; die ETB-Gruppe IST schon das Suchergebnis des
  // Servers und wird nicht noch einmal am gekürzten Label gefiltert.
  const begriff = suche.trim().toLowerCase();
  const bezugOptionen = gruppen
    .map((g) =>
      g.label === 'ETB-Einträge' || !begriff
        ? g
        : { ...g, options: g.options.filter((o) => o.label.toLowerCase().includes(begriff)) },
    )
    .filter((g) => g.options.length > 0);
  const etbLaedt =
    bezugOffen && (etbQuery.isLoading || etbQuery.isPlaceholderData || suche.trim() !== etbSuche);

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
      <SpeicherFehler fehler={mutation.error} titel="Nicht abgelegt" />
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
                  loading={etbLaedt}
                  options={bezugOptionen}
                  showSearch={{ filterOption: false, onSearch: setSuche }}
                  onOpenChange={(auf) => {
                    setListeOffen(auf);
                    if (!auf) setSuche('');
                  }}
                  // Das Label eines gewählten Suchtreffers hält antd selbst fest, auch wenn er
                  // nach dem Zurückfallen auf das jüngste Fenster nicht mehr unter den Optionen
                  // steht (Test „zeigt den gewählten Eintrag weiter …").
                  onChange={() => setSuche('')}
                />
              </Form.Item>
            ),
          },
        ]}
      />
    </ErfassungsModal>
  );
}
