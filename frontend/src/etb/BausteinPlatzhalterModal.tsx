// src/etb/BausteinPlatzhalterModal.tsx
import { Form, Input } from 'antd';
import { useEffect } from 'react';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import type { EtbBaustein, EinsatzAnzeige } from '../api/types';
import { ErfassungsModal } from '../components/Erfassung';
import { Feld } from '../components/instrument';
import { ermittlePlatzhalter, setzeBausteinEin, type BausteinFelder } from './bausteinEinsetzen';

interface Props {
  /** Gesetzt = dieser Baustein wird eingesetzt; null = nichts offen. */
  baustein: EtbBaustein | null;
  einsatz: EinsatzAnzeige;
  /** Liefert die fertig substituierten Felder. */
  onEinsetzen: (felder: BausteinFelder) => void;
  /** Modal ohne Einsetzen geschlossen. */
  onAbbrechenAll: () => void;
}

export default function BausteinPlatzhalterModal({
  baustein,
  einsatz,
  onEinsetzen,
  onAbbrechenAll,
}: Props) {
  const [form] = Form.useForm<Record<string, string>>();
  // `{datum}`/`{uhrzeit}` in der Anzeigezone (LFH-692) und der wirksamen Darstellung (LLH-1061).
  const { konventionen } = useAnzeigeKonventionen();
  const offenePlatzhalter = baustein ? ermittlePlatzhalter(baustein, einsatz, konventionen) : [];

  // Bausteine ohne manuelle Platzhalter sofort einsetzen (kein Dialog nötig). Das Formular wird
  // dabei nicht angefasst: antds `Modal` rendert sein `<Form>` erst beim ersten Öffnen (LFH-624).
  useEffect(() => {
    if (!baustein) return;
    if (offenePlatzhalter.length === 0) {
      onEinsetzen(setzeBausteinEin(baustein, einsatz, {}, konventionen));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baustein]);

  const dialogOffen = baustein !== null && offenePlatzhalter.length > 0;

  // Über die Erfassungshülle (LLH-2010, `frontend/AGENTS.md`, „Erfassungs-Norm“): die Maske
  // schließt nie, getippte Werte fragen vor dem Verwerfen, jeder Weg hinaus leert.
  return (
    <ErfassungsModal<Record<string, string>>
      offen={dialogOffen}
      titel="Baustein einsetzen"
      form={form}
      erfassenText="Einsetzen"
      onErfassen={async (werte) => {
        if (!baustein) return;
        onEinsetzen(setzeBausteinEin(baustein, einsatz, werte, konventionen));
      }}
      // Geschlossen hat der Aufrufer schon in `onEinsetzen` (Baustein auf null).
      onFertig={() => {}}
      onAbbrechen={onAbbrechenAll}
    >
      {offenePlatzhalter.map((name, index) => (
        <Feld key={name} name={name} label={name}>
          <Input aria-label={name} autoFocus={index === 0} />
        </Feld>
      ))}
    </ErfassungsModal>
  );
}
