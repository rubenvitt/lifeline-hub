import { Input, Modal, theme } from 'antd';
import { ETB_INHALT_MAX } from '../api/eingabegrenzen';
import type { Speicherung } from '../components/Erfassung';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { istZuLang, zeichenGrenze } from '../components/zeichenGrenze';
import { useEffect, useRef, useState } from 'react';

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
  const { token } = theme.useToken();
  const [text, setText] = useState('');
  // Kein antd-Formular: die Grenze des ETB-Inhalts sperrt den Knopf, der Zähler nennt die
  // Überlänge; der Text bleibt stehen (LFH-937, `components/zeichenGrenze.tsx`). Eine leere
  // Rückmeldung sperrt ebenso: eine Prüfung ohne Server ist kein Speicherfehler (LFH-1077).
  const zuLang = istZuLang(text, ETB_INHALT_MAX);
  const leer = text.trim() === '';

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

  return (
    <Modal
      title="Vollzug melden"
      open={offen}
      okText="Vollzug melden"
      cancelText="Abbrechen"
      okButtonProps={{ disabled: zuLang || leer }}
      confirmLoading={meldet}
      cancelButtonProps={{ disabled: meldet }}
      closable={meldet ? { disabled: true } : true}
      mask={{ closable: !meldet }}
      keyboard={!meldet}
      onCancel={() => {
        abbruchGeneration.current += 1;
        setText('');
        raeume();
        onAbbrechen();
      }}
      onOk={async () => {
        if (zuLang || leer) return;
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
      <Input.TextArea
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Rückmeldung zur Erledigung"
        // Die Vollzugsmeldung wird ETB-Eintrag: Grenze des ETB-Inhalts (LFH-937).
        count={zeichenGrenze(ETB_INHALT_MAX)}
      />
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
  );
}
