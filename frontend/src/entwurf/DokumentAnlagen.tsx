import { Alert, App, Button, Flex, Popconfirm, Space, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import {
  dokumentAnlageDateiPfad,
  entferneDokumentAnlage,
  legeDokumentAnlageAb,
  listeDokumentAnlagen,
  type AnlagenDokument,
} from '../api/dokumentAnlagen';
import { einsatzKeys } from '../api/queryKeys';
import type { DokumentAnlage } from '../api/types';
import { AnhangVorschauGruppe } from '../components/AnhangVorschau';
import DownloadAnker from '../components/DownloadAnker';
import { Paneel, PaneelZeile, useRollen } from '../components/instrument';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { IconMuelleimer } from '../icons';
import { useOhneVerbindung } from '../offline/verbindung';
import SkizzenAufnahme, { type SkizzenBild } from '../stab/SkizzenAufnahme';
import { useStabFreigabe } from '../stab/useStabFreigabe';
import './dokumentAnlagen.css';

/** Höchstzahl je Dokument, wie `MAX_ANLAGEN` im Server (`vorlagendokument/anlage.rs`). */
export const MAX_ANLAGEN = 10;

const anlagenKey = (dokument: AnlagenDokument, einsatzId: number, dokumentId: number) =>
  dokument === 'lageberichte'
    ? einsatzKeys.lageberichtAnlagen(einsatzId, dokumentId)
    : einsatzKeys.befehlAnlagen(einsatzId, dokumentId);

const anlageName = (a: Pick<DokumentAnlage, 'nummer' | 'titel'>) =>
  `Anlage ${a.nummer}: ${a.titel}`;

interface Props {
  dokument: AnlagenDokument;
  einsatzId: number;
  dokumentId: number;
  einsatzbezeichnung: string;
  /** Entwurf und Schreibrecht: Anlagen anfügen und entfernen. */
  schreibt: boolean;
  /** Klasse der Seite für Bedienung, die nicht aufs Papier gehört. */
  ohneDruckKlasse: string;
}

/**
 * Bild-Anlagen an Lagebericht und Befehl (LFH-1028): am Schirm das Paneel „Anlagen“, auf Papier
 * je Anlage ein eigenes Blatt (A4 quer, `dokumentAnlagen.css`) hinter dem Text. Die Druckfassung
 * hängt immer im DOM, damit das Bild zum Druck schon geladen ist; am Schirm blendet CSS sie aus.
 *
 * Anfügen und Entfernen gibt es nur im Entwurf; die Freigabe friert die Anlagen ein. Die
 * Fernmeldeskizze anfügen kann nur, wer den Stab sieht, und nur mit Verbindung (die Skizze ist
 * nicht offline). Ohne Anlage und ohne diese Möglichkeit steht nichts.
 */
export default function DokumentAnlagen({
  dokument,
  einsatzId,
  dokumentId,
  einsatzbezeichnung,
  schreibt,
  ohneDruckKlasse,
}: Props) {
  const { message } = App.useApp();
  const { token } = useRollen();
  const qc = useQueryClient();
  const key = anlagenKey(dokument, einsatzId, dokumentId);
  const query = useQuery({
    queryKey: key,
    queryFn: () => listeDokumentAnlagen(dokument, einsatzId, dokumentId),
  });
  const stabFreigabe = useStabFreigabe(einsatzId);
  const ohneVerbindung = useOhneVerbindung();
  const [nimmtAuf, setNimmtAuf] = useState(false);
  /**
   * Grund, warum sich die Skizze im Browser nicht zeichnen ließ (lokal, kein Serveraufruf). Ein
   * Programmfehler beim Zeichnen steht als „Skizze nicht gezeichnet“, nicht mit seinem Wortlaut.
   */
  const [skizzenFehler, setSkizzenFehler] = useState<string | null>(null);

  const ablegen = useMutation({
    mutationFn: (bild: SkizzenBild) =>
      legeDokumentAnlageAb(dokument, einsatzId, dokumentId, {
        art: 'fernmeldeskizze',
        titel: 'Fernmeldeskizze',
        standAt: bild.standAt,
        datei: bild.datei,
        dateiname: 'fernmeldeskizze.png',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key });
      message.success('Fernmeldeskizze angefügt');
    },
    // Kein `onError`: der Grund steht beim Knopf (`anfuegenFehler`, LFH-1077).
  });
  const entfernen = useMutation({
    mutationFn: (anlageId: number) =>
      entferneDokumentAnlage(dokument, einsatzId, dokumentId, anlageId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key });
      message.success('Anlage entfernt');
    },
  });

  const anlagen = query.data ?? [];
  const darfAnfuegen = schreibt && stabFreigabe.zustand === 'frei' && !ohneVerbindung;
  const laeuft = nimmtAuf || ablegen.isPending;

  /** Ein neuer Versuch räumt den Grund des vorigen, gleich ob er beim Zeichnen oder beim Server lag. */
  const starteAufnahme = () => {
    setSkizzenFehler(null);
    ablegen.reset();
    setNimmtAuf(true);
  };

  /**
   * Ein Anfügen, ein Grund (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“): der Server
   * lehnte ab oder die Skizze ließ sich nicht zeichnen. Er steht beim Knopf — im Paneel oder, ohne
   * Anlage, in der Zeile mit dem Knopf — bis zum nächsten Versuch; auch dann, wenn der Knopf
   * inzwischen fehlt (offline, Freigabe weg).
   */
  const anfuegenFehlt = ablegen.error != null || skizzenFehler != null;
  const anfuegenFehler =
    ablegen.error != null ? (
      <SpeicherFehler fehler={ablegen.error} titel="Fernmeldeskizze nicht angefügt" />
    ) : skizzenFehler != null ? (
      <Alert
        type="error"
        showIcon
        title="Fernmeldeskizze nicht angefügt"
        description={skizzenFehler}
      />
    ) : null;

  const anfuegen = darfAnfuegen ? (
    <Button
      onClick={starteAufnahme}
      loading={laeuft}
      disabled={anlagen.length >= MAX_ANLAGEN}
      data-lfh="anlage-skizze-anfuegen"
    >
      Fernmeldeskizze anfügen
    </Button>
  ) : null;

  const aufnahme = nimmtAuf ? (
    <SkizzenAufnahme
      einsatzId={einsatzId}
      einsatzbezeichnung={einsatzbezeichnung}
      onBild={(bild) => {
        setNimmtAuf(false);
        ablegen.mutate(bild);
      }}
      onFehler={(e) => {
        setNimmtAuf(false);
        setSkizzenFehler(typeof e === 'string' ? e : 'Skizze nicht gezeichnet');
      }}
    />
  ) : null;

  if (anlagen.length === 0) {
    if (!anfuegen && !anfuegenFehlt) return null;
    return (
      <Flex
        vertical
        className={ohneDruckKlasse}
        gap={token.marginXS}
        style={{ marginBlock: token.marginSM }}
      >
        {(anfuegen || aufnahme) && (
          <Flex gap={token.marginXS}>
            {anfuegen}
            {aufnahme}
          </Flex>
        )}
        {anfuegenFehler}
      </Flex>
    );
  }

  const fehlerId = entfernen.isError ? entfernen.variables : undefined;
  const fehlerAnlage = anlagen.find((a) => a.id === fehlerId);
  const pfad = (a: DokumentAnlage) =>
    dokumentAnlageDateiPfad(dokument, einsatzId, dokumentId, a.id);

  return (
    <>
      <div className={ohneDruckKlasse} style={{ marginBlockStart: token.marginMD }}>
        <Paneel
          titel="Anlagen"
          meta={`${anlagen.length} ${anlagen.length === 1 ? 'Anlage' : 'Anlagen'}`}
          aktion={anfuegen ?? undefined}
        >
          <SpeicherFehler
            fehler={entfernen.error}
            titel={fehlerAnlage ? `${anlageName(fehlerAnlage)} nicht entfernt` : 'Nicht entfernt'}
          />
          {anfuegenFehler}
          <AnhangVorschauGruppe>
            {anlagen.map((a) => (
              <div key={a.id} data-lfh="dokument-anlage-zeile" data-anlage-id={a.id}>
                <PaneelZeile>
                  <Space
                    size="middle"
                    align="center"
                    style={{ width: '100%', justifyContent: 'space-between' }}
                  >
                    <DownloadAnker
                      href={pfad(a)}
                      dateiname={a.dateiname}
                      text={anlageName(a)}
                      mime={a.mime}
                      vorschauKennung={anlageName(a)}
                      zusatz={
                        <>
                          Stand <ZeitAnzeige wert={a.stand_at} />
                        </>
                      }
                      zugaenglicherName={`${anlageName(a)} herunterladen`}
                    />
                    {schreibt && (
                      <Popconfirm
                        title="Anlage entfernen?"
                        okText="Entfernen"
                        cancelText="Abbrechen"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => entfernen.mutate(a.id)}
                      >
                        <Button
                          type="text"
                          danger
                          loading={entfernen.isPending && entfernen.variables === a.id}
                          aria-label={`${anlageName(a)} entfernen`}
                          icon={
                            <span aria-hidden="true">
                              <IconMuelleimer />
                            </span>
                          }
                        />
                      </Popconfirm>
                    )}
                  </Space>
                </PaneelZeile>
              </div>
            ))}
          </AnhangVorschauGruppe>
        </Paneel>
        {aufnahme}
      </div>
      <div className="dokument-anlagen-druck">
        {anlagen.map((a) => (
          <section key={a.id} data-lfh="druck-anlage" className="dokument-anlage-blatt">
            <div data-lfh="titelblock">
              <Typography.Title level={2}>
                {anlageName(a)}, Stand <ZeitAnzeige wert={a.stand_at} />
              </Typography.Title>
              <img src={pfad(a)} alt={anlageName(a)} />
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
