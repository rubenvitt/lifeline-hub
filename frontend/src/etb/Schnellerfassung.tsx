import { Alert, Button, Card, Space } from 'antd';
import { Select } from '../components/Select';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NeuerEintrag } from '../api/etb';
import type { EinsatzAnzeige, EtbBaustein, EtbEintragAnzeige, EtbTyp, MeldeWeg } from '../api/types';
import { ERFASSBARE_TYPEN, TYP_LABEL } from './typFarben';
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
}

const TYP_OPTIONEN = ERFASSBARE_TYPEN.map((t) => ({ value: t, label: TYP_LABEL[t] }));

export default function Schnellerfassung({
  erfassen, berichtigungZu, onBerichtigungAbbrechen, bausteine, einsatz, initialWerte, onWerteChange,
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
      setInhalt(''); setMetadaten({}); setEditFeld(null); setMenuOffen(false);
      if (berichtigungZu) onBerichtigungAbbrechen();
      fokusInsFeld();
    } finally {
      setSendet(false);
    }
  }

  return (
    <Card size="small" className="etb-erfassung-card">
      {berichtigungZu && (
        <Alert
          type="warning" showIcon style={{ marginBottom: 12 }}
          title={`Berichtigung zu #${berichtigungZu.lfd_nr}`}
          action={<Button size="small" onClick={onBerichtigungAbbrechen}>Abbrechen</Button>}
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
          size="small"
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
