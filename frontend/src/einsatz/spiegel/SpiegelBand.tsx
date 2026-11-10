import { Button, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ladeEinsatz } from '../../api/einsaetze';
import { einsatzKeys } from '../../api/queryKeys';
import { verwerfeAntrag } from '../../api/spiegelAntraege';
import type { EinsatzAnzeige, EtbTyp, MeldeWeg, SpiegelAntragAnzeige } from '../../api/types';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { zeitKurz } from '../../anzeige/zeitDarstellung';
import { useAuthOptional } from '../../auth/AuthContext';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { monoStil, useRollen } from '../../components/instrument';
import { useMinutenTakt } from '../../components/useMinutenTakt';
import { createAndActivateEntwurf } from '../../etb/entwuerfe/entwurfStore';
import { IconChevronHoch, IconChevronRunter } from '../../icons';
import { useSpiegelAntraege } from './useSpiegelAntraege';
import {
  ANTRAG_ZUSTAND_WORT,
  SPIEGEL_KOPF_ABRUF_MS,
  antragArtWort,
  antragDatenText,
  antragErfassungsort,
  antragZaehler,
  spiegelStand,
  spiegelTitel,
} from './spiegelText';

/**
 * Hinweisband am Spiegel (LLH-1492, design.md D13, Spec `einsatz-spiegel`, „Der Spiegel zeigt
 * seine Herkunft und seinen Stand“): über jeder Einsatzseite, im Rahmen. „Spiegel von <Gegenstelle>“,
 * der Stand des Abgleichs („keine Verbindung seit …“, „Abgleich beendet“) und die Zahl der eigenen
 * Anträge aus dem Kopf; aufgeklappt die Anträge mit Zustand, abgelehnte mit Grund, „Neu erfassen“
 * und „Verwerfen“.
 *
 * FARBE: Grund `bannerGrund`, Kante `bannerLinie` wie ein Hinweis; eine Störung des Abgleichs und
 * abgelehnte Anträge in `achtungText` (zweiter Kanal: das Wort). Ohne Spiegel steht nichts da.
 *
 * Das Band lädt die Anträge (`useSpiegelAntraege`): die Fachseiten lesen sie aus dem Cache, wo sie
 * Vorgemerktes zeigen. Es holt den Kopf alle {@link SPIEGEL_KOPF_ABRUF_MS} neu, weil ein Abgleich
 * ohne neue Zeile kein Live-Ereignis meldet.
 */
export default function SpiegelBand({ einsatz }: { einsatz: EinsatzAnzeige | undefined }) {
  const spiegel = einsatz?.spiegel ?? null;
  const einsatzId = einsatz?.id ?? 0;
  const aktiv = spiegel != null;
  // Ein eigener Beobachter des Kopfs mit Takt, nur am Spiegel (derselbe Key, kein zweiter Cache).
  useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
    enabled: aktiv && spiegel?.beendet === false,
    refetchInterval: SPIEGEL_KOPF_ABRUF_MS,
  });
  const antraege = useSpiegelAntraege(einsatzId, aktiv);
  // Übernahme und Ablehnung kommen mit dem Abgleich und ändern die Zähler im Kopf: dann die Liste
  // neu laden. Den Kopf holt das Band im Takt, auch wenn kein `lagged` kommt.
  const qc = useQueryClient();
  const zaehler = spiegel ? `${spiegel.antraege_ausstehend}/${spiegel.antraege_abgelehnt}` : null;
  const vorigeZaehler = useRef(zaehler);
  useEffect(() => {
    const vorher = vorigeZaehler.current;
    vorigeZaehler.current = zaehler;
    if (vorher == null || zaehler == null || vorher === zaehler) return;
    void qc.invalidateQueries({ queryKey: einsatzKeys.antraege(einsatzId) });
  }, [zaehler, qc, einsatzId]);
  if (!einsatz || !spiegel) return null;
  return (
    <BandInhalt einsatz={einsatz} antraege={antraege.data} antraegeFehler={antraege.isError} />
  );
}

function BandInhalt({
  einsatz,
  antraege,
  antraegeFehler,
}: {
  einsatz: EinsatzAnzeige;
  antraege: readonly SpiegelAntragAnzeige[] | undefined;
  antraegeFehler: boolean;
}) {
  const spiegel = einsatz.spiegel!;
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const jetzt = useMinutenTakt();
  const [offen, setOffen] = useState(false);
  const listeId = useId();
  const stand = spiegelStand(spiegel, einsatz.status === 'aktiv', jetzt, (w) =>
    zeitKurz(w, konventionen),
  );
  const zaehler = antragZaehler(spiegel);
  const hatAntraege = (antraege?.length ?? 0) > 0 || zaehler.length > 0;
  return (
    <div
      role="status"
      data-lfh="spiegel-band"
      style={{
        background: rollen.bannerGrund,
        borderBlockEnd: `1px solid ${rollen.bannerLinie}`,
        borderInlineStart: `3px solid ${rollen.bannerLinie}`,
        paddingBlock: token.paddingXXS,
        paddingInline: 'var(--lfh-seiten-polsterung)',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: token.marginXS,
          rowGap: token.paddingXXS,
          minHeight: token.controlHeight,
        }}
      >
        <strong data-lfh="spiegel-band-titel">{spiegelTitel(spiegel)}</strong>
        <span
          data-lfh="spiegel-band-stand"
          style={{ color: stand.gestoert ? rollen.achtungText : rollen.text2 }}
        >
          <span aria-hidden="true">· </span>
          {stand.text}
        </span>
        {zaehler.map((z) => (
          <span
            key={z}
            data-lfh="spiegel-band-zaehler"
            style={{ color: z.endsWith('abgelehnt') ? rollen.achtungText : rollen.text2 }}
          >
            <span aria-hidden="true">· </span>
            <span style={monoStil(12)}>{z.split(' ')[0]}</span>
            {z.slice(z.indexOf(' '))}
          </span>
        ))}
        {hatAntraege && (
          <Button
            type="link"
            aria-expanded={offen}
            aria-controls={listeId}
            icon={offen ? <IconChevronHoch /> : <IconChevronRunter />}
            iconPlacement="end"
            onClick={() => setOffen((o) => !o)}
            style={{ marginInlineStart: 'auto', paddingInline: 0 }}
          >
            Anträge
          </Button>
        )}
      </div>
      {offen && (
        <div id={listeId} data-lfh="spiegel-antraege" style={{ paddingBlockEnd: token.paddingXS }}>
          {antraegeFehler && antraege == null ? (
            <Typography.Text type="secondary">Anträge nicht geladen</Typography.Text>
          ) : antraege == null ? (
            <Typography.Text type="secondary">Anträge werden geladen</Typography.Text>
          ) : antraege.length === 0 ? (
            <Typography.Text type="secondary">keine offenen Anträge</Typography.Text>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {antraege.map((a) => (
                <AntragZeile key={a.id} einsatzId={einsatz.id} antrag={a} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Ein ETB-Antrag als Entwurf der Erfassung: Wortlaut, Typ, Von/An, Meldeweg (LLH-1492). */
function createEtbEntwurf(benutzerId: number, einsatzId: number, daten: unknown): Promise<void> {
  const d = (daten ?? {}) as Record<string, unknown>;
  const text = (feld: string) => (typeof d[feld] === 'string' ? (d[feld] as string) : undefined);
  return createAndActivateEntwurf(benutzerId, einsatzId, {
    inhalt: text('inhalt') ?? '',
    typ: (text('typ') ?? 'meldung') as EtbTyp,
    von: text('von'),
    an: text('an'),
    meldeweg: text('meldeweg') as MeldeWeg | undefined,
    veranlassung: text('veranlassung'),
  });
}

function AntragZeile({
  einsatzId,
  antrag: a,
}: {
  einsatzId: number;
  antrag: SpiegelAntragAnzeige;
}) {
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const benutzerId = useAuthOptional()?.benutzer?.id;
  const abgelehnt = a.zustand === 'abgelehnt';
  const verwerfen = useMutation({
    mutationFn: () => verwerfeAntrag(einsatzId, a.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.antraege(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId), exact: true });
    },
  });
  const ort = antragErfassungsort(einsatzId, a);
  const neuErfassen = async () => {
    // Nur das ETB nimmt die Daten als Entwurf auf; die übrigen Orte zeigen sie hier.
    if (a.art === 'etb' && benutzerId != null) {
      await createEtbEntwurf(benutzerId, einsatzId, a.daten).catch(() => {});
    }
    if (ort) navigate(ort);
  };
  const daten = antragDatenText(a);
  return (
    <li
      data-lfh="spiegel-antrag"
      data-zustand={a.zustand}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: token.marginXS,
        paddingBlock: token.paddingXXS,
        borderBlockStart: `1px solid ${rollen.bannerLinie}`,
      }}
    >
      <span style={monoStil(12)}>{zeitKurz(a.erfasst_at, konventionen)}</span>
      <strong>{antragArtWort(a.art)}</strong>
      {daten && <span>{daten}</span>}
      <span style={{ color: abgelehnt ? rollen.achtungText : rollen.text2 }}>
        · {ANTRAG_ZUSTAND_WORT[a.zustand] ?? a.zustand}
        {abgelehnt && a.grund ? `: ${a.grund}` : ''}
      </span>
      {abgelehnt && (
        <span style={{ display: 'inline-flex', gap: token.marginXS, marginInlineStart: 'auto' }}>
          {ort && <Button onClick={() => void neuErfassen()}>Neu erfassen</Button>}
          <Button loading={verwerfen.isPending} onClick={() => verwerfen.mutate()}>
            Verwerfen
          </Button>
        </span>
      )}
      {verwerfen.error != null && (
        <div style={{ flexBasis: '100%' }}>
          <SpeicherFehler fehler={verwerfen.error} titel="Nicht verworfen" />
        </div>
      )}
    </li>
  );
}
