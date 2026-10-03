import { Alert, App, Form, Input, Typography, theme } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { stelleSchwaerzungsantrag } from '../api/aufbewahrung';
import { globalKeys } from '../api/queryKeys';
import type { AntragZielArt, NeuerSchwaerzungsantrag } from '../api/types';
import { ErfassungsModal } from '../components/Erfassung';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { ZIEL_ART } from './archivText';

/**
 * Rückfrage vor einem Löschersuchen nach Art. 17 (LFH-751, Spec `aufbewahrung-loeschersuchen`,
 * „Rückfrage vor dem Antrag“).
 *
 * Das Ziel steht nur pseudonym im Dialog (Einsatznummer bzw. `R-042`, `EK-17` …). Pflicht sind
 * das Aktenzeichen und das Eintippen der Kennung; erst wenn beides passt, lässt sich absenden
 * (`gesperrt`). Rot (`unumkehrbar`): nach 24 Stunden vollzieht der Purge-Lauf ohne Rückweg.
 * Beim Personen-Antrag nennt der Dialog, was bleibt — Erwähnungen in Freitexten und im ETB —
 * und den Einsatz-Antrag als Weg zur vollständigen Entfernung.
 *
 * Fehler (409, 422) stehen mit dem Wortlaut des Servers im Dialog; `mutateAsync` lehnt ab, die
 * Hülle lässt die Felder stehen.
 */

/** Ziel des Antrags, wie Akte bzw. Personensuche es kennen. */
export interface AntragZielWahl {
  art: AntragZielArt;
  /** Fehlt beim Einsatz. */
  id?: number;
  /** Einsatznummer bzw. Kennung der Person — einzutippen. */
  kennung: string;
}

interface AntragWerte {
  aktenzeichen?: string;
  bestaetigung?: string;
}

/** Frühester Vollzug, gerechnet ab dem Öffnen der Rückfrage (UTC, DB-Format). Der Server
 *  rechnet ab dem Antrag; die Anzeige liegt also höchstens um die Bedenkzeit davor. */
export function vollzugAb(jetzt: Date): string {
  return new Date(jetzt.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

/** Ob die eingetippte Kennung passt — wie der Server: getrimmt, exakt. */
export function kennungPasst(eingabe: string | undefined, kennung: string): boolean {
  return (eingabe ?? '').trim() === kennung;
}

/** Reiner Body-Bau — ohne Render prüfbar. */
export function antragBody(ziel: AntragZielWahl, werte: AntragWerte): NeuerSchwaerzungsantrag {
  return {
    ziel: ziel.id == null ? { art: ziel.art } : { art: ziel.art, id: ziel.id },
    aktenzeichen: (werte.aktenzeichen ?? '').trim(),
    bestaetigung: (werte.bestaetigung ?? '').trim(),
  };
}

interface SchwaerzungsantragDialogProps {
  einsatzId: number;
  ziel: AntragZielWahl;
  onSchliessen: () => void;
}

export default function SchwaerzungsantragDialog({
  einsatzId,
  ziel,
  onSchliessen,
}: SchwaerzungsantragDialogProps) {
  const qc = useQueryClient();
  const { token } = theme.useToken();
  const [faellig] = useState(() => vollzugAb(new Date()));
  const { message } = App.useApp();
  const [form] = Form.useForm<AntragWerte>();
  const aktenzeichen = Form.useWatch('aktenzeichen', form);
  const bestaetigung = Form.useWatch('bestaetigung', form);
  const istEinsatz = ziel.art === 'einsatz';
  const zielText = `${ZIEL_ART[ziel.art]} ${ziel.kennung}`;
  const bereit = (aktenzeichen ?? '').trim().length > 0 && kennungPasst(bestaetigung, ziel.kennung);

  const mutation = useMutation({
    mutationFn: (body: NeuerSchwaerzungsantrag) => stelleSchwaerzungsantrag(einsatzId, body),
    onSuccess: () => {
      // Präfix: Übersicht, Akte (Zustand, Register) und Antragsliste.
      void qc.invalidateQueries({ queryKey: globalKeys.aufbewahrung() });
      message.success('Löschersuchen erfasst — Vollzug in 24 Stunden');
    },
  });

  return (
    <ErfassungsModal<AntragWerte>
      offen
      titel={`Löschersuchen: ${zielText}`}
      form={form}
      initialValues={{ aktenzeichen: '', bestaetigung: '' }}
      erfassenText={istEinsatz ? 'Einsatz schwärzen lassen' : 'Person schwärzen lassen'}
      unumkehrbar
      gesperrt={!bereit}
      laeuft={mutation.isPending}
      onErfassen={async (werte) => {
        await mutation.mutateAsync(antragBody(ziel, werte));
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: token.margin }}
        title={
          <span data-lfh="antrag-faellig">
            Nach 24 Stunden unwiderruflich — Vollzug ab etwa <ZeitAnzeige wert={faellig} />
          </span>
        }
        description={
          istEinsatz
            ? 'Der Purge-Lauf schwärzt 24 Stunden nach dem Antrag alle personenbezogenen Angaben des Einsatzes, unabhängig von Frist und Karenz. Bis dahin lässt sich der Antrag zurücknehmen. Das Einsatztagebuch bleibt im Wortlaut erhalten.'
            : 'Der Purge-Lauf entfernt 24 Stunden nach dem Antrag Name, Kontakt, Adresse und Notizen dieser Person. Bis dahin lässt sich der Antrag zurücknehmen.'
        }
      />
      {!istEinsatz && (
        <Typography.Paragraph type="secondary" data-lfh="antrag-freitext-hinweis">
          Erwähnungen der Person in Freitexten — im Einsatztagebuch, in Chat-Nachrichten und in den
          Führungsmodulen — bleiben stehen. Wer sie ebenfalls entfernen muss, stellt den Antrag für
          den ganzen Einsatz.
        </Typography.Paragraph>
      )}
      <Form.Item
        label="Aktenzeichen des Löschersuchens"
        name="aktenzeichen"
        extra="Ohne Namen — das Aktenzeichen steht im Einsatztagebuch und bleibt als Nachweis."
        rules={[
          { required: true, whitespace: true, message: 'Aktenzeichen angeben' },
          { max: 64, message: 'Höchstens 64 Zeichen' },
        ]}
      >
        <Input autoComplete="off" />
      </Form.Item>
      <Form.Item
        label={`Zur Bestätigung „${ziel.kennung}“ eintippen`}
        name="bestaetigung"
        rules={[
          {
            validator: (_, wert: string | undefined) =>
              kennungPasst(wert, ziel.kennung)
                ? Promise.resolve()
                : Promise.reject(new Error(`Die Kennung lautet ${ziel.kennung}`)),
          },
        ]}
      >
        <Input autoComplete="off" />
      </Form.Item>
      <SpeicherFehler fehler={mutation.error} titel="Löschersuchen nicht erfasst" />
    </ErfassungsModal>
  );
}
