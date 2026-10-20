/**
 * „Als Anlage an …“ der Lagekarte (LLH-1051, Spec `lagekarte-druck`): der aktuelle Ausschnitt als
 * Lageplan-Bild an einen offenen Entwurf (Lagebericht oder Befehl) oder an einen neuen Lagevortrag.
 *
 * Gewählt wird per Radio, „Anfügen“ nimmt die Karte erst dann auf: das Bild zeigt, was beim Anfügen
 * zu sehen war. Abgelegt wird über den bestehenden Anlagen-Weg (`legeDokumentAnlageAb`, Art
 * `lageplan`); ein neuer Lagevortrag entsteht über die API und öffnet sich danach. Ein bestehender
 * Entwurf bleibt zu, der Erfolg geht an den Toast.
 *
 * Eine Ablehnung steht im Dialog, der offen bleibt (LFH-1077). Während des Ablegens gibt es kein
 * Zurück: Schließen hielte den Upload nicht auf.
 */
import { useEffect, useMemo, useState } from 'react';
import { App, Button, Empty, Modal, Radio, Space, Spin, theme } from 'antd';
import dayjs from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { listeBefehle } from '../../api/befehle';
import { legeDokumentAnlageAb, type AnlagenDokument } from '../../api/dokumentAnlagen';
import { legeLageberichtAn, listeLageberichte } from '../../api/lageberichte';
import { einsatzKeys } from '../../api/queryKeys';
import type { EinsatzStatus } from '../../api/types';
import { useZeitEingabe } from '../../anzeige/ZeitpunktEingabe';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { einsatzRechteGrund } from '../../components/nurAnsicht';
import { lageberichtDetailPfad } from '../../routing/deeplinks';
import { KARTENBILD_FEHLT, type LageplanAnlage } from './useLageplan';

/** Wortlaut des Nebenwegs. */
export const ALS_ANLAGE = 'Als Anlage an …';

/** Titel der Anlage im Dokument. */
export const LAGEPLAN_TITEL = 'Lageplan';

type Freigabe = 'frei' | 'gesperrt' | 'offen';

/**
 * Warum „Als Anlage an …“ gerade nicht geht; `null` = es geht. Der Grund steht im Label
 * (LFH-1079), nie nur als Tooltip.
 */
export function anlageSperrGrund({
  einsatz,
  darfSchreiben,
  ohneVerbindung,
  lageberichte,
  befehle,
}: {
  einsatz: { status: EinsatzStatus };
  darfSchreiben: boolean;
  ohneVerbindung: boolean;
  lageberichte: Freigabe;
  befehle: Freigabe;
}): string | null {
  if (!darfSchreiben) return einsatzRechteGrund(einsatz.status);
  if (ohneVerbindung) return 'ohne Verbindung';
  if (lageberichte === 'frei' || befehle === 'frei') return null;
  if (lageberichte === 'gesperrt' && befehle === 'gesperrt')
    return 'Lageberichte und Befehle gesperrt';
  return 'Freigaben nicht geladen';
}

/** Ein Ziel der Anlage: ein offener Entwurf oder ein neuer Lagevortrag. */
type Ziel =
  | { art: 'neu'; schluessel: 'neu' }
  | { art: 'entwurf'; schluessel: string; dokument: AnlagenDokument; id: number; titel: string };

const NEU: Ziel = { art: 'neu', schluessel: 'neu' };

class KeinKartenbild extends Error {}

interface Props {
  offen: boolean;
  einsatzId: number;
  /** Modulfreigaben: welche Entwürfe der Dialog anbietet. */
  lageberichteFrei: boolean;
  befehleFrei: boolean;
  erstelleAnlage: () => Promise<LageplanAnlage | null>;
  onSchliessen: () => void;
}

export default function LageplanAnlageDialog({
  offen,
  einsatzId,
  lageberichteFrei,
  befehleFrei,
  erstelleAnlage,
  onSchliessen,
}: Props) {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { formatiere } = useZeitEingabe();
  const [wahl, setWahl] = useState<string | null>(null);

  const berichte = useQuery({
    queryKey: einsatzKeys.lageberichte(einsatzId),
    queryFn: () => listeLageberichte(einsatzId),
    enabled: offen && lageberichteFrei,
  });
  const befehle = useQuery({
    queryKey: einsatzKeys.befehle(einsatzId),
    queryFn: () => listeBefehle(einsatzId),
    enabled: offen && befehleFrei,
  });

  const ziele = useMemo<Ziel[]>(() => {
    const entwuerfe: Ziel[] = [
      ...(lageberichteFrei ? (berichte.data ?? []) : [])
        .filter((b) => b.status === 'entwurf')
        .map((b) => ({
          art: 'entwurf' as const,
          schluessel: `lageberichte-${b.id}`,
          dokument: 'lageberichte' as const,
          id: b.id,
          titel: `Lagebericht · ${b.titel}`,
        })),
      ...(befehleFrei ? (befehle.data ?? []) : [])
        .filter((b) => b.status === 'entwurf')
        .map((b) => ({
          art: 'entwurf' as const,
          schluessel: `befehle-${b.id}`,
          dokument: 'befehle' as const,
          id: b.id,
          titel: `Befehl · ${b.titel}`,
        })),
    ];
    return lageberichteFrei ? [...entwuerfe, NEU] : entwuerfe;
  }, [lageberichteFrei, befehleFrei, berichte.data, befehle.data]);

  const ablegen = useMutation({
    mutationFn: async (ziel: Ziel) => {
      const anlage = await erstelleAnlage();
      if (!anlage) throw new KeinKartenbild(KARTENBILD_FEHLT);
      let dokument: AnlagenDokument;
      let id: number;
      let titel: string;
      if (ziel.art === 'neu') {
        const neu = await legeLageberichtAn(einsatzId, {
          vorlage: 'lagebericht',
          titel: `Lageüberblick ${formatiere(dayjs(), 'HHmm')}`,
        });
        dokument = 'lageberichte';
        id = neu.id;
        titel = neu.titel;
        // Schlägt das Anfügen danach fehl, steht der neue Entwurf schon in der Liste des Dialogs.
        void qc.invalidateQueries({ queryKey: einsatzKeys.lageberichte(einsatzId) });
      } else {
        ({ dokument, id, titel } = ziel);
      }
      await legeDokumentAnlageAb(dokument, einsatzId, id, {
        art: 'lageplan',
        titel: LAGEPLAN_TITEL,
        standAt: anlage.standAt,
        datei: anlage.datei,
        dateiname: 'lageplan.png',
      });
      return { neu: ziel.art === 'neu', dokument, id, titel };
    },
    onSuccess: ({ neu, dokument, id, titel }) => {
      void qc.invalidateQueries({
        queryKey:
          dokument === 'lageberichte'
            ? einsatzKeys.lageberichtAnlagen(einsatzId, id)
            : einsatzKeys.befehlAnlagen(einsatzId, id),
      });
      setWahl(null);
      onSchliessen();
      if (neu) {
        message.success(`Lageplan an neuen Lagevortrag „${titel}“ angefügt`);
        void navigate(lageberichtDetailPfad(einsatzId, id));
      } else {
        message.success(`Lageplan an „${titel}“ angefügt`);
      }
    },
    // Kein `onError`: der Grund steht im Dialog (LFH-1077).
  });

  const { reset } = ablegen;
  // Öffnen räumt den Grund des letzten Versuchs.
  useEffect(() => {
    if (offen) reset();
  }, [offen, reset]);

  // Ein einziges Ziel ist gewählt; sonst wählt die Person selbst.
  const gewaehlt =
    ziele.find((z) => z.schluessel === wahl) ?? (ziele.length === 1 ? ziele[0] : null);
  const laeuft = ablegen.isPending;
  const laedt = (lageberichteFrei && berichte.isLoading) || (befehleFrei && befehle.isLoading);
  const listenFehler = berichte.error ?? befehle.error;

  const abbrechen = () => {
    if (laeuft) return;
    setWahl(null);
    onSchliessen();
  };

  return (
    <Modal
      open={offen}
      title="Lageplan als Anlage"
      onCancel={abbrechen}
      destroyOnHidden
      closable={!laeuft}
      mask={{ closable: !laeuft }}
      keyboard={!laeuft}
      footer={
        <Space>
          <Button onClick={abbrechen} disabled={laeuft}>
            Abbrechen
          </Button>
          <Button
            type="primary"
            loading={laeuft}
            disabled={!gewaehlt}
            onClick={() => {
              if (gewaehlt) ablegen.mutate(gewaehlt);
            }}
          >
            Anfügen
          </Button>
        </Space>
      }
    >
      {laedt ? (
        <Spin />
      ) : ziele.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Kein offener Entwurf" />
      ) : (
        <Radio.Group
          value={gewaehlt?.schluessel ?? null}
          onChange={(e) => setWahl(e.target.value as string)}
          disabled={laeuft}
          aria-label="Ziel der Anlage"
        >
          <Space orientation="vertical">
            {ziele.map((z) => (
              <Radio key={z.schluessel} value={z.schluessel}>
                {z.art === 'neu' ? 'Neuer Lagevortrag' : z.titel}
              </Radio>
            ))}
          </Space>
        </Radio.Group>
      )}
      {listenFehler != null && (
        <div style={{ marginTop: token.marginSM }}>
          <SpeicherFehler
            fehler={listenFehler}
            titel="Entwürfe nicht geladen"
            fallback="Abruf fehlgeschlagen"
          />
        </div>
      )}
      {ablegen.error != null && (
        <div style={{ marginTop: token.marginSM }}>
          <SpeicherFehler
            fehler={ablegen.error}
            titel="Lageplan nicht angefügt"
            fallback={
              ablegen.error instanceof KeinKartenbild ? KARTENBILD_FEHLT : 'Anfügen fehlgeschlagen'
            }
          />
        </div>
      )}
    </Modal>
  );
}
