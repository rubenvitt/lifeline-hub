import { Alert, Button, Card, Checkbox, Space, Tooltip, Typography } from 'antd';
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
const ENTER_HINWEIS = 'Enter sendet · Shift+Enter neue Zeile · Mehrzeiler mit Cmd/Strg+Enter senden';

/**
 * Eigener Wortlaut, nicht der aus `components/Erfassung.tsx`: hier gibt es keinen
 * Knopf „Speichern und nächste", auf den er sich beziehen könnte — im ETB erfasst
 * jedes Absenden in Serie. Genannt werden die Felder, weil `nurUebernahme` genau
 * drei kennt und die Auswahl sonst geraten werden müsste.
 */
const UEBERNAHME_ERKLAERUNG =
  'Von, An und Meldeweg bleiben nach dem Erfassen für den nächsten Eintrag stehen. '
  + 'Inhalt, Veranlassung und Ereigniszeit werden immer geleert.';

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
  const feldKnopfRef = useRef<HTMLButtonElement>(null);

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

  /**
   * Klick daneben schliesst das Menü. Vorher gab es ohne Auswahl überhaupt keinen Weg
   * hinaus ausser Escape oder einem zweiten Druck auf denselben Knopf.
   *
   * Zwei Ausnahmen, beide notwendig: Das **Menü selbst**, weil seine Einträge über
   * `onMouseDown` wählen und `pointerdown` davor läuft — würde hier geschlossen, wäre
   * der Eintrag beim Klick schon weg und die Auswahl per Maus tot. Und der
   * **Feld-Knopf**, der selbst umschaltet: sonst schlösse dieser Effekt zuerst und der
   * Klick öffnete danach wieder, der Knopf könnte also nie schliessen.
   */
  useEffect(() => {
    if (!menuOffen) return;
    function beiZeigerAb(ereignis: PointerEvent) {
      const ziel = ereignis.target;
      const el = ziel instanceof Element ? ziel : (ziel as Node | null)?.parentElement ?? null;
      if (el?.closest('[data-slash-menu]')) return;
      if (el && feldKnopfRef.current?.contains(el)) return;
      setMenuOffen(false);
    }
    document.addEventListener('pointerdown', beiZeigerAb);
    return () => document.removeEventListener('pointerdown', beiZeigerAb);
  }, [menuOffen]);

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

  /**
   * Entfernt NUR den „/…"-Text, der das Menü ausgelöst hat. Schliesst bewusst nicht
   * mit — das tut `waehleEintrag`. Bis zum 30.07.2026 hing das Schliessen hier mit
   * drin, hinter dem frühen Ausstieg: wer das Menü über den Feld-Knopf öffnete, hatte
   * `triggerStart === -1` (es gibt keinen Trigger-Text), und das Menü blieb nach der
   * Auswahl stehen. Es liegt absolut über der Chip-Leiste und verdeckte damit genau
   * den Chip-Editor, der gerade aufgegangen war.
   */
  function entferneTriggerText() {
    if (triggerStart < 0) return;
    const ta = textRef.current?.resizableTextArea?.textArea;
    const caret = ta?.selectionStart ?? inhalt.length;
    setInhalt(inhalt.slice(0, triggerStart) + inhalt.slice(caret));
  }

  function waehleEintrag(e: SlashEintrag) {
    entferneTriggerText();
    // Auf JEDEM Weg hinaus, unabhängig davon, wie das Menü aufging.
    setMenuOffen(false);
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
    if (e.defaultPrevented || e.nativeEvent.isComposing) return;
    if (menuOffen && menuRef.current?.handleKey(e.key)) {
      e.preventDefault();
      return;
    }
    const istSendeTaste = e.key === 'Enter'
      && !e.repeat
      && !e.shiftKey
      && !e.altKey
      && (e.ctrlKey || e.metaKey || (inhalt.trim() !== '' && !inhalt.includes('\n')));
    if (istSendeTaste && editFeld == null) {
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
          placeholder={`${ENTER_HINWEIS} · Inhalt … ( / für Felder & Bausteine )`}
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

      <Typography.Text type="secondary">{ENTER_HINWEIS}</Typography.Text>

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
          ref={feldKnopfRef}
          type="dashed"
          icon={<PlusOutlined />}
          onClick={() => { setMenuFilter(''); setTriggerStart(-1); setMenuOffen((o) => !o); }}
        >
          Feld
        </Button>
      </Space>

      {/* EINSTELLUNG — eigene Zeile ÜBER der Steuerzeile, sekundär gesetzt.
          Der Schalter stand bis zum 30.07.2026 zwischen „Erfassen" und dem
          Lagebericht-Link, also inmitten von Aktionen; er ist aber keine, sondern
          eine Vorgabe für das nächste Erfassen. Dieselbe Trennung wie in
          `components/Erfassung.tsx`, deren Dateikopf sie begründet. */}
      {zeigeSchalter && (
        <div style={{ marginTop: 12 }}>
          <Tooltip title={UEBERNAHME_ERKLAERUNG}>
            <Checkbox checked={werteBehalten} onChange={(e) => onWerteBehaltenChange?.(e.target.checked)}>
              <Typography.Text type="secondary">Werte behalten</Typography.Text>
            </Checkbox>
          </Tooltip>
        </div>
      )}

      {/* Steuerzeile */}
      <Space align="center" style={{ marginTop: 12, width: '100%' }}>
        {!berichtigungZu && (
          <Select value={typ} style={{ minWidth: 150 }} options={TYP_OPTIONEN} onChange={(v) => setTyp(v)} />
        )}
        <Button type="primary" loading={sendet} onClick={() => void absenden()}>Erfassen</Button>
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
