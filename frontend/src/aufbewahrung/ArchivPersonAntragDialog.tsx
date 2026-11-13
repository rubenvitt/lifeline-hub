import { Alert, App, Form, Input, Typography, theme } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { stelleSchwaerzungsantrag } from '../api/aufbewahrung';
import { globalKeys } from '../api/queryKeys';
import type { AntragZielArt, NeuerSchwaerzungsantrag } from '../api/types';
import { ErfassungsModal } from '../components/Erfassung';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { ZIEL_ART } from './archivText';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { personenUmfang, vollzugAb } from './SchwaerzungsantragDialog';

/**
 * Löschersuchen für eine Person an einem archivierten Einsatz (LLH-1712, Spec
 * `aufbewahrung-loeschersuchen`, „Anträge in der Archivakte“).
 *
 * Am archivierten Einsatz gibt es keine Namen mehr und keine Personensuche. Der Admin findet die
 * Kennung mit dem Befehl `lifeline-hub archiv personen` im Archiv und tippt sie hier ein; das
 * Eintippen ist zugleich die Bestätigung der Rückfrage. Die Art steht im Präfix (`R-`, `EK-`,
 * `IT-`). Nach 24 Stunden vollzieht nicht der Purge-Lauf, sondern der Befehl
 * `lifeline-hub archiv loeschersuchen` mit dem Archiv-Schlüssel der Organisation.
 */

/** Personenart und Kennung, wie der Server sie bildet. */
export interface ArchivPersonZiel {
  art: Exclude<AntragZielArt, 'einsatz' | 'medienkontakt'>;
  kennung: string;
}

const PRAEFIXE: { praefix: string; art: ArchivPersonZiel['art'] }[] = [
  { praefix: 'R', art: 'betroffene' },
  { praefix: 'EK', art: 'externe_kraft' },
  { praefix: 'IT', art: 'infotelefon_anruf' },
];

/** Liest eine Kennung (`R-042`, `ek-17`, …) in der Form, die der Server bildet; `null`, wenn
 *  sie keine ist. Betroffene tragen die Registriernummer dreistellig (`R-042`). */
export function kennungAusEingabe(eingabe: string): ArchivPersonZiel | null {
  const treffer = /^([A-Za-z]+)-(\d+)$/.exec(eingabe.trim());
  if (!treffer) return null;
  const eintrag = PRAEFIXE.find((p) => p.praefix === treffer[1]!.toUpperCase());
  const nr = Number(treffer[2]);
  if (!eintrag || !Number.isSafeInteger(nr) || nr < 1) return null;
  const kennung =
    eintrag.art === 'betroffene' ? `R-${String(nr).padStart(3, '0')}` : `${eintrag.praefix}-${nr}`;
  return { art: eintrag.art, kennung };
}

/** Reiner Body-Bau — ohne Render prüfbar. */
export function archivAntragBody(
  ziel: ArchivPersonZiel,
  aktenzeichen: string | undefined,
): NeuerSchwaerzungsantrag {
  return {
    ziel: { art: ziel.art, kennung: ziel.kennung },
    aktenzeichen: (aktenzeichen ?? '').trim(),
    bestaetigung: ziel.kennung,
  };
}

interface Werte {
  kennung?: string;
  aktenzeichen?: string;
}

export default function ArchivPersonAntragDialog({
  einsatzId,
  onSchliessen,
}: {
  einsatzId: number;
  onSchliessen: () => void;
}) {
  const qc = useQueryClient();
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const [faellig] = useState(() => vollzugAb(new Date()));
  const [form] = Form.useForm<Werte>();
  const kennung = Form.useWatch('kennung', form);
  const aktenzeichen = Form.useWatch('aktenzeichen', form);
  const ziel = kennungAusEingabe(kennung ?? '');
  const bereit = ziel !== null && (aktenzeichen ?? '').trim().length > 0;

  const mutation = useMutation({
    mutationFn: (body: NeuerSchwaerzungsantrag) => stelleSchwaerzungsantrag(einsatzId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: globalKeys.aufbewahrung() });
      message.success('Löschersuchen erfasst — Vollzug nach 24 Stunden per Befehl');
    },
  });

  return (
    <ErfassungsModal<Werte>
      offen
      titel="Löschersuchen: Person im Archiv"
      form={form}
      initialValues={{ kennung: '', aktenzeichen: '' }}
      erfassenText="Person schwärzen lassen"
      unumkehrbar
      gesperrt={!bereit}
      laeuft={mutation.isPending}
      onErfassen={async (werte) => {
        const z = kennungAusEingabe(werte.kennung ?? '');
        if (z) await mutation.mutateAsync(archivAntragBody(z, werte.aktenzeichen));
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
            Nach 24 Stunden unwiderruflich — Vollzug frühestens ab etwa{' '}
            <ZeitAnzeige wert={faellig} />
          </span>
        }
        description={
          <>
            Entfernt {ziel ? personenUmfang(ziel.art) : 'Name, Kontakt, Adresse und Notizen'} aus
            allen Blöcken des Archivs. Vollzogen wird danach mit dem Archiv-Schlüssel der
            Organisation per Befehl{' '}
            <Typography.Text code>lifeline-hub archiv loeschersuchen</Typography.Text> auf dem
            Server. Heruntergeladene Blöcke erreicht das nicht. In den ersten 24 Stunden
            zurücknehmbar.
          </>
        }
      />
      <Typography.Paragraph type="secondary">
        Die Kennung findet der Befehl{' '}
        <Typography.Text code>lifeline-hub archiv personen</Typography.Text> im Archiv. Erwähnungen
        in Freitexten bleiben stehen.
      </Typography.Paragraph>
      <Form.Item
        label="Kennung der Person"
        name="kennung"
        extra={ziel ? `${ZIEL_ART[ziel.art]} ${ziel.kennung}` : 'R-042, EK-17 oder IT-5'}
        rules={[
          {
            validator: (_, wert: string | undefined) =>
              kennungAusEingabe(wert ?? '')
                ? Promise.resolve()
                : Promise.reject(new Error('Kennung wie R-042, EK-17 oder IT-5 angeben')),
          },
        ]}
      >
        <Input autoComplete="off" />
      </Form.Item>
      <Form.Item
        label="Aktenzeichen des Löschersuchens"
        name="aktenzeichen"
        extra="Ohne Namen; bleibt im Einsatztagebuch stehen"
        rules={[
          { required: true, whitespace: true, message: 'Aktenzeichen angeben' },
          { max: 64, message: 'Höchstens 64 Zeichen' },
        ]}
      >
        <Input autoComplete="off" />
      </Form.Item>
      <SpeicherFehler fehler={mutation.error} titel="Löschersuchen nicht erfasst" />
    </ErfassungsModal>
  );
}
