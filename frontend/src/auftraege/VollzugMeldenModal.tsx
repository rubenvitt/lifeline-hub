import { Input, Modal } from 'antd';
import { ETB_INHALT_MAX } from '../api/eingabegrenzen';
import type { Speicherung } from '../components/Erfassung';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { useVerwerfenSchutz } from '../components/VerlassenRueckfrage';
import { istZuLang, zeichenGrenze } from '../components/zeichenGrenze';
import { useRollen } from '../components/instrument';
import { IconWarndreieck } from '../icons';
import { useEffect, useId, useRef, useState } from 'react';
import type { TextAreaRef } from 'antd/es/input/TextArea';

export default function VollzugMeldenModal({
  offen,
  onAbbrechen,
  onBestaetigen,
  speicherung,
}: {
  offen: boolean;
  onAbbrechen: () => void;
  /**
   * Melden. **Muss bei Ablehnung ablehnen** (`mutateAsync`): erst der Erfolg leert den Text, eine
   * Ablehnung lässt ihn stehen (LFH-1077, design.md D3).
   */
  onBestaetigen: (vollzugsmeldung: string) => Promise<unknown>;
  /**
   * Die Melde-Mutation: ihr Fehler steht im Dialog bis zum nächsten Absenden; Öffnen und
   * Abbrechen räumen ihn (`frontend/AGENTS.md`, „Rückwege und Fehler“).
   */
  speicherung?: Speicherung;
}) {
  const { token, rollen } = useRollen();
  const [text, setText] = useState('');
  // Kein antd-Formular: die Grenze des ETB-Inhalts sperrt den Knopf, der Zähler nennt die
  // Überlänge; der Text bleibt stehen (LFH-937, `components/zeichenGrenze.tsx`). Eine leere
  // Rückmeldung sperrt NICHT stumm (LLH-1771): der Knopf bleibt frei, ein Klick nennt den Grund am
  // Feld und setzt den Fokus hinein. Eine Prüfung ohne Server ist kein Speicherfehler (LFH-1077).
  const zuLang = istZuLang(text, ETB_INHALT_MAX);
  const leer = text.trim() === '';
  const [leerGemeldet, setLeerGemeldet] = useState(false);
  const feldRef = useRef<TextAreaRef>(null);
  const feldId = useId();
  const grundId = useId();

  // Ref, damit Öffnen und Abbrechen die AKTUELLE Mutation räumen, ohne dass ein neues
  // Mutationsobjekt je Render den Effekt auslöst. Eine laufende bleibt unberührt: `reset()`
  // hängte ihr Ergebnis ab (wie `raeumeSpeicherFehler` der Erfassungs-Hülle).
  const speicherungRef = useRef(speicherung);
  speicherungRef.current = speicherung;
  const raeume = () => {
    const s = speicherungRef.current;
    if (s && !s.isPending && s.error != null) s.reset();
  };
  useEffect(() => {
    const s = speicherungRef.current;
    if (offen && s && !s.isPending && s.error != null) s.reset();
  }, [offen]);

  // Ein Abbruch während des Meldens macht dessen Abschluss ungültig: er leert danach nichts mehr.
  const abbruchGeneration = useRef(0);
  // Solange gemeldet wird, sind alle Auswege gesperrt: der Dialog bleibt bis zur Antwort offen,
  // sonst hätte eine Ablehnung keinen Ort mehr (design.md D3). `confirmLoading` hält schon antds
  // `onCancel` zurück; Knopf und Kreuz zeigen die Sperre, Maske und Escape sind ausdrücklich aus.
  const meldet = speicherung?.isPending === true;

  const schutz = useVerwerfenSchutz({
    geaendert: !leer,
    gesperrt: meldet,
    titel: 'Vollzug melden',
    onSchliessen: () => {
      abbruchGeneration.current += 1;
      setText('');
      setLeerGemeldet(false);
      raeume();
      onAbbrechen();
    },
  });

  return (
    <>
      <Modal
        title="Vollzug melden"
        open={offen}
        okText="Vollzug melden"
        cancelText="Abbrechen"
        okButtonProps={{ disabled: zuLang }}
        confirmLoading={meldet}
        cancelButtonProps={{ disabled: meldet }}
        closable={meldet ? { disabled: true } : true}
        // Maske, Kreuz, Escape und Abbrechen über den Schutz (LLH-2010): mit Text erst die Rückfrage.
        {...schutz.modalProps}
        onOk={async () => {
          if (zuLang) return;
          if (leer) {
            setLeerGemeldet(true);
            feldRef.current?.focus();
            return;
          }
          const generation = abbruchGeneration.current;
          try {
            await onBestaetigen(text.trim());
          } catch {
            // Der Grund steht über `speicherung` im Dialog, der Text bleibt stehen.
            return;
          }
          if (generation === abbruchGeneration.current) setText('');
        }}
      >
        <label htmlFor={feldId} style={{ display: 'block', marginBlockEnd: token.marginXS }}>
          Vollzugsmeldung
        </label>
        <Input.TextArea
          id={feldId}
          ref={feldRef}
          rows={3}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value.trim() !== '') setLeerGemeldet(false);
          }}
          placeholder="Rückmeldung zur Erledigung"
          status={leerGemeldet ? 'error' : undefined}
          aria-invalid={leerGemeldet || undefined}
          aria-describedby={leerGemeldet ? grundId : undefined}
          // Die Vollzugsmeldung wird ETB-Eintrag: Grenze des ETB-Inhalts (LFH-937).
          count={zeichenGrenze(ETB_INHALT_MAX)}
        />
        {leerGemeldet && (
          // Zeichen und Wort neben der Farbe (WCAG 1.4.1), wie die Gründe der ETB-Fußzeile.
          <div
            id={grundId}
            role="alert"
            style={{
              color: rollen.alarmText,
              display: 'flex',
              alignItems: 'center',
              gap: token.marginXXS,
              marginTop: token.marginXXS,
            }}
          >
            <IconWarndreieck />
            <span>Vollzugsmeldung fehlt</span>
          </div>
        )}
        {speicherung?.error != null && (
          <div style={{ marginTop: token.marginSM }}>
            <SpeicherFehler
              fehler={speicherung.error}
              titel="Vollzug nicht gemeldet"
              fallback="Melden fehlgeschlagen"
            />
          </div>
        )}
      </Modal>
      {schutz.rueckfrage}
    </>
  );
}
