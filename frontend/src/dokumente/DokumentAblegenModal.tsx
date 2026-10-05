import { useEffect, useMemo, useRef, useState } from 'react';
import { App, Collapse, Form, Input, type UploadFile } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Select } from '../components/Select';
import { ErfassungsModal } from '../components/Erfassung';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import UploadFortschrittAnzeige from '../components/UploadFortschritt';
import { ablageFehlerKopf, useUploadFortschritt } from '../components/useUploadFortschritt';
import { einsatzKeys } from '../api/queryKeys';
import DateiFeld from '../components/DateiFeld';
import { DOKUMENT_ACCEPT, legeDokumentAb, type DokumentAblage } from '../api/dokumente';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import { listeEtb } from '../api/etb';
import type { DokumentKategorie, EtbEintragAnzeige } from '../api/types';
import { DOKUMENT_KATEGORIEN, DOKUMENT_KATEGORIE_REIHENFOLGE } from './kategorien';
import { bezugAusWert } from './bezug';
import {
  ETB_BEZUG_DECKEL,
  sucheEtbBezuege,
  useStandWaehrendOffen,
  waehleEtbEintraege,
  type EtbSuchTreffer,
} from './bezugswahl';

interface BezugOption {
  value: string;
  label: string;
}

interface BezugGruppe {
  label: string;
  options: BezugOption[];
}

/** Was die Bezugswahl geladen hat — eingefroren wird dieser Stand, gefiltert erst danach. */
interface BezugDaten {
  abschnitte: BezugOption[];
  einheiten: BezugOption[];
  fenster: EtbEintragAnzeige[];
  treffer: EtbSuchTreffer | null;
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
const kuerze = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Formularwerte → API-Eingabe. Ein unbekannter Präfix fällt weg (`bezugAusWert`), statt einen
 *  halben Bezug zu senden. */
function zuAblage(werte: AblageFormular): DokumentAblage {
  const datei = werte.datei?.[0]?.originFileObj as File;
  const ablage: DokumentAblage = { datei, titel: werte.titel, kategorie: werte.kategorie };
  const bezug = bezugAusWert(werte.bezug);
  if (bezug) ablage.bezug = bezug;
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
 * ETB-Eintrag oder Abschnitt erscheint erst beim nächsten Öffnen. ETB-Einträge sucht zusätzlich
 * der Server (`sucheEtbBezuege`, auch per laufender Nummer), zusammengeführt in
 * `waehleEtbEintraege`; Abschnitte und Einheiten filtert der Client.
 *
 * Rückmeldung (LFH-654, Prüfliste LFH-632 Zeile 2 · 3): während der Übertragung Prozent aus den
 * Bytes, danach „Datei wird geprüft“ (`components/UploadFortschritt`). Ohne Verbindung wird
 * NICHTS vorgemerkt — kein Blob in IndexedDB, keine Offline-Queue (Spec `dokumentenablage`;
 * Gründe: `openspec/changes/archive/2026-10-01-lfh-654-dokumentenablage-rueckmeldung/design.md`,
 * D5); der Dialog bleibt mit Datei und Feldern stehen, „Ablegen“ versucht es erneut.
 */
export default function DokumentAblegenModal({ einsatzId, offen, onSchliessen }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<AblageFormular>();
  const [bezugOffen, setBezugOffen] = useState(false);
  const [listeOffen, setListeOffen] = useState(false);
  const [suche, setSuche] = useState('');
  const [etbSuche, setEtbSuche] = useState('');
  /** Der gewählte Bezug mit seinem Label: ein ETB-Treffer aus einer Suche steht nach dem Leeren
   *  der Suche nicht mehr unter den Optionen, und das Feld zeigte sonst den rohen Schlüssel
   *  `etb_eintrag:<id>`. Antds Label-Cache trägt das nicht — er füllt sich nur, wenn Wert und
   *  Option einmal gemeinsam gerendert wurden, und das Leeren wirkt im selben Takt wie die Wahl. */
  const [gewaehlt, setGewaehlt] = useState<BezugOption | null>(null);
  /** Welcher Titel zuletzt AUTOMATISCH gesetzt wurde. Nur solange das Feld genau diesen Wert
   *  trägt, darf eine neue Dateiwahl ihn ersetzen — ein getippter Titel bleibt immer stehen. */
  const autoTitel = useRef<string | null>(null);
  const fortschritt = useUploadFortschritt();

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
  // Entprellt wird nur das Tippen; Leeren wirkt sofort (`leereSuche`), sonst zeigte ein schnelles
  // Wiederöffnen die alten Treffer und baute sich nach der Frist unter dem Cursor um.
  useEffect(() => {
    const begriff = suche.trim();
    if (!begriff || begriff === etbSuche) return;
    const frist = setTimeout(() => setEtbSuche(begriff), ENTPRELLUNG_MS);
    return () => clearTimeout(frist);
  }, [suche, etbSuche]);
  function leereSuche() {
    setSuche('');
    setEtbSuche('');
  }
  // Eigene Filter im Key, damit die Abfragen nicht das Cache-Fach der Infinite-Query von
  // `EtbPage` teilen; unter `einsatzKeys.etb` bleiben sie, damit Live-Updates sie erreichen.
  const fensterQuery = useQuery({
    queryKey: einsatzKeys.etbListe(einsatzId, { limit: ETB_BEZUG_DECKEL }),
    queryFn: () => listeEtb(einsatzId, { limit: ETB_BEZUG_DECKEL }),
    enabled: offen && bezugOffen,
  });
  const sucheQuery = useQuery({
    queryKey: einsatzKeys.etbListe(einsatzId, { limit: ETB_BEZUG_DECKEL, bezug: etbSuche }),
    queryFn: () => sucheEtbBezuege(einsatzId, etbSuche),
    enabled: offen && bezugOffen && etbSuche !== '',
  });

  const mutation = useMutation({
    mutationFn: (eingabe: DokumentAblage) =>
      fortschritt.begleite((onFortschritt) => legeDokumentAb(einsatzId, eingabe, onFortschritt)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.dokumente(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      message.success('Dokument abgelegt');
    },
  });

  function schliessen() {
    setBezugOffen(false);
    setListeOffen(false);
    leereSuche();
    setGewaehlt(null);
    autoTitel.current = null;
    mutation.reset();
    onSchliessen();
  }

  const trefferDaten = sucheQuery.data;
  const trefferGescheitert = sucheQuery.isError;
  const liveDaten = useMemo<BezugDaten>(
    () => ({
      abschnitte: (abschnitteQuery.data ?? []).map((a) => ({
        value: `abschnitt:${a.id}`,
        label: a.name,
      })),
      einheiten: (einheitenQuery.data ?? []).map((e) => ({
        value: `einheit:${e.id}`,
        label: e.name,
      })),
      fenster: fensterQuery.data ?? [],
      treffer: !etbSuche
        ? null
        : trefferDaten
          ? { begriff: etbSuche, eintraege: trefferDaten }
          : trefferGescheitert
            ? { begriff: etbSuche, eintraege: null }
            : null,
    }),
    [
      abschnitteQuery.data,
      einheitenQuery.data,
      fensterQuery.data,
      etbSuche,
      trefferDaten,
      trefferGescheitert,
    ],
  );
  // „Geladen" heißt abgeschlossen, nicht erfolgreich: ohne Modulrecht antwortet eine Quelle mit
  // 403 und bliebe sonst für immer „unterwegs" — das Einfrieren wäre damit still abgeschaltet.
  const geladen =
    !abschnitteQuery.isPending &&
    !einheitenQuery.isPending &&
    !fensterQuery.isPending &&
    (etbSuche === '' || !sucheQuery.isPending);
  const daten = useStandWaehrendOffen(liveDaten, listeOffen, geladen ? etbSuche : null);

  // Gefiltert wird NACH dem Einfrieren: was der Mensch tippt, darf die Liste ändern.
  const begriff = suche.trim().toLowerCase();
  const passt = (o: BezugOption) => !begriff || o.label.toLowerCase().includes(begriff);
  const bezugOptionen: BezugGruppe[] = [
    { label: 'Abschnitte', options: daten.abschnitte.filter(passt) },
    { label: 'Einheiten', options: daten.einheiten.filter(passt) },
    {
      label: 'ETB-Einträge',
      options: waehleEtbEintraege(daten.fenster, daten.treffer, suche).map((e) => ({
        value: `etb_eintrag:${e.id}`,
        label: `ETB ${e.lfd_nr} · ${kuerze(e.inhalt, 60)}`,
      })),
    },
  ].filter((g) => g.options.length > 0);
  const etbLaedt =
    bezugOffen &&
    (fensterQuery.isLoading ||
      (suche.trim() !== '' && (suche.trim() !== etbSuche || sucheQuery.isLoading)));

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
      <SpeicherFehler fehler={mutation.error} {...ablageFehlerKopf(mutation.error)} />
      <UploadFortschrittAnzeige stand={mutation.isPending ? fortschritt.stand : null} />
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
                  showSearch={{
                    filterOption: false,
                    onSearch: (wert) => (wert.trim() ? setSuche(wert) : leereSuche()),
                  }}
                  onOpenChange={(auf) => {
                    setListeOffen(auf);
                    if (!auf) leereSuche();
                  }}
                  onChange={(_wert, option) => {
                    leereSuche();
                    const o = Array.isArray(option) ? undefined : option;
                    setGewaehlt(
                      o && 'value' in o ? { value: String(o.value), label: String(o.label) } : null,
                    );
                  }}
                  labelRender={({ value, label }) =>
                    value === gewaehlt?.value ? gewaehlt.label : label
                  }
                />
              </Form.Item>
            ),
          },
        ]}
      />
    </ErfassungsModal>
  );
}
