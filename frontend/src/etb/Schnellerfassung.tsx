import { Alert, Button, Card, Checkbox, Space } from 'antd';
import { Select } from '../components/Select';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import type { NeuerEintrag } from '../api/etb';
import type { EinsatzAnzeige, EtbBaustein, EtbEintragAnzeige, EtbTyp, MeldeWeg } from '../api/types';
import { ERFASSBARE_TYPEN } from './typFarben';
import { etbTyp } from '../theme/statusFarben';
import type { BausteinFelder } from './bausteinEinsetzen';
import MarkdownEditor, { type TextAreaRef } from '../components/MarkdownEditor';
import MetaChip from './MetaChip';
import { useFunkrufnamen } from './funkrufnamen';
import SlashMenu, { type SlashMenuHandle } from './SlashMenu';
import BausteinPlatzhalterModal from './BausteinPlatzhalterModal';
import {
  baueEintrag, erkenneSlashTrigger, METADATEN_FELDER,
  type MetadatenWerte, type MetaFeld, type SlashEintrag,
} from './schnellerfassungModell';
import type { EntwurfWerte } from './entwuerfe/entwurfModell';

interface Props {
  erfassen: (eintrag: NeuerEintrag) => Promise<void>;
  berichtigungZu: EtbEintragAnzeige | null;
  onBerichtigungAbbrechen: () => void;
  bausteine: EtbBaustein[];
  einsatz: EinsatzAnzeige;
  initialWerte?: EntwurfWerte;
  onWerteChange?: (werte: EntwurfWerte) => void;
  /**
   * Zustand des Schalters „Werte behalten" (LFH-332/H61). Er liegt bewusst beim
   * Aufrufer: `EtbEntwurfsTabs` schliesst nach erfolgreichem Erfassen den Entwurfs-Tab
   * und erzwingt über `key` einen Remount — ein Zustand im `useState` dieser Komponente
   * überlebte das nicht.
   */
  werteBehalten?: boolean;
  /** Fehlt der Callback, rendert die Steuerzeile den Schalter nicht (Berichtigung, Bestandsaufrufer). */
  onWerteBehaltenChange?: (behalten: boolean) => void;
}

const TYP_OPTIONEN = ERFASSBARE_TYPEN.map((t) => ({ value: t, label: etbTyp[t].label }));

/**
 * Die Wiederholfelder, die ein Absenden überleben, solange „Werte behalten" an ist
 * (LFH-332/H61: eine Standard-Funkmeldung kostete 19 Tastenanschläge reines Gerüst,
 * weil Von/An/Meldeweg nach jedem Senden verworfen wurden).
 *
 * `veranlassung` und `ereigniszeit` gehören ABSICHTLICH nicht dazu — die sind je Eintrag
 * verschieden, eine stehengebliebene Ereigniszeit wäre eine falsche Tatsachenbehauptung.
 *
 * Die Funktion ist der einzige Ort, der diese Auswahl trifft; `EtbEntwurfsTabs` reicht
 * denselben Filter über die Remount-Grenze.
 */
export function nurUebernahme(quelle: Pick<MetadatenWerte, 'von' | 'an' | 'meldeweg'>): MetadatenWerte {
  return { von: quelle.von, an: quelle.an, meldeweg: quelle.meldeweg };
}

export default function Schnellerfassung({
  erfassen, berichtigungZu, onBerichtigungAbbrechen, bausteine, einsatz, initialWerte, onWerteChange,
  werteBehalten = false, onWerteBehaltenChange,
}: Props) {
  const navigate = useNavigate();
  const textRef = useRef<TextAreaRef>(null);
  const menuRef = useRef<SlashMenuHandle>(null);

  const [inhalt, setInhalt] = useState(initialWerte?.inhalt ?? '');
  const [typ, setTyp] = useState<EtbTyp>(initialWerte?.typ ?? 'meldung');
  const [metadaten, setMetadaten] = useState<MetadatenWerte>(initialWerte?.metadaten ?? {});
  const [editFeld, setEditFeld] = useState<MetaFeld | null>(null);
  const [sendet, setSendet] = useState(false);

  const [menuOffen, setMenuOffen] = useState(false);
  const [menuFilter, setMenuFilter] = useState('');
  const [triggerStart, setTriggerStart] = useState(-1);

  const [bausteinOffen, setBausteinOffen] = useState<EtbBaustein | null>(null);

  // Funkrufnamen disponierter Fahrzeuge/Einheiten als Vorschläge für von/an.
  // Freitext bleibt Fallback (AC#1).
  const funkrufnamen = useFunkrufnamen(einsatz.id);

  // onWerteChange in einer Ref halten: Der Autosave-Effekt darf NUR auf echte
  // Wertänderungen (inhalt/typ/metadaten) feuern — nicht, wenn der Container bei
  // jedem Render eine neue Callback-Referenz liefert. Stünde onWerteChange in den
  // Effekt-Deps, triggerte jedes Container-Re-Render (das entwurfAktualisieren
  // auslöst) den Effekt erneut → Re-Trigger-/Endlosschleife.
  const onWerteChangeRef = useRef(onWerteChange);
  useEffect(() => {
    onWerteChangeRef.current = onWerteChange;
  }, [onWerteChange]);

  const ersterRender = useRef(true);
  useEffect(() => {
    if (ersterRender.current) {
      ersterRender.current = false;
      return; // kein Write beim Mount/initialem Laden
    }
    onWerteChangeRef.current?.({ inhalt, typ, metadaten });
  }, [inhalt, typ, metadaten]);

  // Fokus beim Mount. State-Reset bei Tab-/Modus-Wechsel erfolgt über key-basiertes
  // Remounting im Container (EtbEntwurfsTabs / EtbPage-Berichtigung).
  useEffect(() => {
    textRef.current?.focus();
  }, []);

  const gesetzteFelder = METADATEN_FELDER.map((d) => d.feld).filter((f) => metadaten[f] != null);

  // Der Schalter erscheint nur ausserhalb der Berichtigung und nur, wenn ein Aufrufer den
  // Zustand führt. Ohne sichtbaren Schalter wird auch nichts übernommen — eine unsichtbar
  // wirkende Übernahme wäre für den Erfasser nicht erklärbar.
  const zeigeSchalter = !berichtigungZu && onWerteBehaltenChange != null;
  const uebernahmeAktiv = zeigeSchalter && werteBehalten;

  function fokusInsFeld() {
    requestAnimationFrame(() => textRef.current?.focus());
  }

  function aktualisiereTrigger(text: string, caret: number) {
    const t = erkenneSlashTrigger(text, caret);
    setMenuOffen(t.aktiv);
    setMenuFilter(t.filter);
    setTriggerStart(t.start);
  }

  function onInhaltChange(neu: string) {
    setInhalt(neu);
    // Caret-Position aus dem nativen textarea über die antd-Ref.
    // Falls der Ref-Pfad nicht verfügbar ist (ältere antd-Version), Fallback auf Textende.
    const caret = textRef.current?.resizableTextArea?.textArea?.selectionStart ?? neu.length;
    aktualisiereTrigger(neu, caret);
  }

  function entferneTriggerText() {
    if (triggerStart < 0) return;
    const ta = textRef.current?.resizableTextArea?.textArea;
    const caret = ta?.selectionStart ?? inhalt.length;
    setInhalt(inhalt.slice(0, triggerStart) + inhalt.slice(caret));
    setMenuOffen(false);
  }

  function waehleEintrag(e: SlashEintrag) {
    entferneTriggerText();
    if (e.art === 'feld') {
      setEditFeld(e.key as MetaFeld);
    } else {
      const b = bausteine.find((x) => String(x.id) === e.key) ?? null;
      setBausteinOffen(b);
    }
  }

  function commitFeld(feld: MetaFeld, wert: string | dayjs.Dayjs | MeldeWeg) {
    setMetadaten((m) => ({ ...m, [feld]: wert }));
    setEditFeld(null);
    fokusInsFeld();
  }

  function bausteinEinsetzen(felder: BausteinFelder) {
    setInhalt(felder.inhalt);
    setMetadaten((m) => ({
      ...m,
      ...(felder.meldeweg ? { meldeweg: felder.meldeweg } : {}),
      ...(felder.veranlassung ? { veranlassung: felder.veranlassung } : {}),
    }));
    if (felder.typ) setTyp(felder.typ);
    setBausteinOffen(null);
    fokusInsFeld();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (menuOffen && menuRef.current?.handleKey(e.key)) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && editFeld == null) {
      e.preventDefault();
      void absenden();
    }
  }

  async function absenden() {
    if (sendet || inhalt.trim() === '') return;
    setSendet(true);
    try {
      const eintrag = baueEintrag({
        inhalt, typ, metadaten,
        berichtigungZuId: berichtigungZu ? berichtigungZu.id : undefined,
        jetztIso: new Date().toISOString(),
      });
      await erfassen(eintrag);
      setInhalt('');
      // Wertübernahme: Von/An/Meldeweg bleiben stehen, alles andere fällt weg. Im
      // Berichtigungsmodus bleibt es beim vollständigen Leeren (dort gibt es auch keinen
      // Schalter). Greift für Aufrufer OHNE Remount; `EtbEntwurfsTabs` remountet und setzt
      // dieselben Felder über `initialWerte` wieder ein.
      setMetadaten((m) => (uebernahmeAktiv ? nurUebernahme(m) : {}));
      setEditFeld(null); setMenuOffen(false);
      if (berichtigungZu) onBerichtigungAbbrechen();
      fokusInsFeld();
    } finally {
      setSendet(false);
    }
  }

  return (
    <Card className="etb-erfassung-card">
      {berichtigungZu && (
        <Alert
          type="warning" showIcon style={{ marginBottom: 12 }}
          title={`Berichtigung zu #${berichtigungZu.lfd_nr}`}
          action={<Button onClick={onBerichtigungAbbrechen}>Abbrechen</Button>}
        />
      )}

      <div style={{ position: 'relative' }}>
        <MarkdownEditor
          ref={textRef}
          layout="toggle"
          variante="kompakt"
          placeholder="Inhalt …  ( / für Felder & Bausteine )"
          autoSize={{ minRows: 1, maxRows: 4 }}
          value={inhalt}
          onChange={onInhaltChange}
          onKeyDown={onKeyDown}
        />
        <SlashMenu
          ref={menuRef}
          offen={menuOffen}
          filter={menuFilter}
          // Berichtigung: Felder-Erfassung bleibt verfügbar, nur die Bausteine-Sektion
          // entfällt (leere Liste → SlashMenu rendert die Bausteine-Sektion nicht).
          bausteine={berichtigungZu ? [] : bausteine}
          gesetzteFelder={gesetzteFelder}
          onWahl={waehleEintrag}
          onSchliessen={() => setMenuOffen(false)}
        />
      </div>

      {/* Chip-Leiste */}
      <Space wrap style={{ marginTop: 8 }}>
        {gesetzteFelder.map((feld) => (
          <MetaChip
            key={`${feld}-${editFeld === feld ? 'edit' : 'view'}`}
            feld={feld}
            editing={editFeld === feld}
            wert={metadaten[feld]}
            optionen={feld === 'von' || feld === 'an' ? funkrufnamen : undefined}
            onCommit={commitFeld}
            onCancel={() => { setEditFeld(null); fokusInsFeld(); }}
            onRemove={(f) => setMetadaten((m) => ({ ...m, [f]: undefined }))}
            onEdit={(f) => setEditFeld(f)}
          />
        ))}
        {editFeld != null && metadaten[editFeld] == null && (
          <MetaChip
            key={`${editFeld}-edit-new`}
            feld={editFeld}
            editing
            wert={undefined}
            optionen={editFeld === 'von' || editFeld === 'an' ? funkrufnamen : undefined}
            onCommit={commitFeld}
            onCancel={() => { setEditFeld(null); fokusInsFeld(); }}
            onRemove={() => setEditFeld(null)}
            onEdit={() => {}}
          />
        )}
        <Button
          type="dashed"
          icon={<PlusOutlined />}
          onClick={() => { setMenuFilter(''); setTriggerStart(-1); setMenuOffen((o) => !o); }}
        >
          Feld
        </Button>
      </Space>

      {/* Steuerzeile */}
      <Space align="center" style={{ marginTop: 12, width: '100%' }}>
        {!berichtigungZu && (
          <Select value={typ} style={{ minWidth: 150 }} options={TYP_OPTIONEN} onChange={(v) => setTyp(v)} />
        )}
        <Button type="primary" loading={sendet} onClick={() => void absenden()}>Erfassen</Button>
        {zeigeSchalter && (
          <Checkbox checked={werteBehalten} onChange={(e) => onWerteBehaltenChange?.(e.target.checked)}>
            Werte behalten
          </Checkbox>
        )}
        {!berichtigungZu && typ === 'lage' && (
          <Button type="link" style={{ paddingLeft: 0 }} onClick={() => navigate(`/einsaetze/${einsatz.id}/lageberichte`)}>
            Als strukturierten Lagebericht erfassen →
          </Button>
        )}
      </Space>

      <BausteinPlatzhalterModal
        baustein={bausteinOffen}
        einsatz={einsatz}
        onEinsetzen={bausteinEinsetzen}
        onAbbrechenAll={() => setBausteinOffen(null)}
      />
    </Card>
  );
}
