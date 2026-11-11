import { Button, Popconfirm, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { einsatzKeys } from '../../api/queryKeys';
import {
  loadBruchstelle,
  stelleAlleBruchAntraege,
  stelleBruchAntrag,
  verwirfBruch,
} from '../../api/spiegelBruchstelle';
import type { BruchErfassung, EinsatzAnzeige } from '../../api/types';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { zeitKurz } from '../../anzeige/zeitDarstellung';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { monoStil, useRollen } from '../../components/instrument';
import { darfBeantragen, darfNachreichenVerwerfen } from '../schreibrecht';
import { bruchArtWort, bruchFolgenText, bruchOffenText, bruchStellbar } from './spiegelText';

/** Ab so vielen Einträgen rollt die Liste in sich (N4). */
const SICHTBARE_ZEILEN = 8;

/**
 * Nicht übernommene Erfassungen am Spiegel nach einer Notübernahme (LLH-1646, Entwurf N1–N6):
 * eine Zeile je Erfassung, nach Zeit. ETB-Einträge und Meldungen lassen sich als Antrag an den
 * Führer stellen (einzeln oder „Alle stellen“ ab zwei), jede Erfassung lässt sich nach Rückfrage
 * verwerfen. Ohne Freigabe des Moduls steht die Zeile ohne Inhalt und ohne Knöpfe da.
 *
 * Nach Stellen und Verwerfen lädt sie sich und den Kopf (Zähler im Band) neu; die Anträge kommen
 * über das Ereignis der Antragsroute in die Warteschlange.
 */
export default function BruchstelleListe({ einsatz }: { einsatz: EinsatzAnzeige }) {
  const { token } = useRollen();
  const qc = useQueryClient();
  const einsatzId = einsatz.id;
  const liste = useQuery({
    queryKey: einsatzKeys.bruchstelle(einsatzId),
    queryFn: () => loadBruchstelle(einsatzId),
  });
  const neuLaden = () => {
    void qc.invalidateQueries({ queryKey: einsatzKeys.bruchstelle(einsatzId) });
    void qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId), exact: true });
    void qc.invalidateQueries({ queryKey: einsatzKeys.antraege(einsatzId) });
  };
  const alle = useMutation({
    mutationFn: () => stelleAlleBruchAntraege(einsatzId),
    onSettled: neuLaden,
  });
  const stellen = darfBeantragen(einsatz);
  const verwerfen = darfNachreichenVerwerfen(einsatz);
  const eintraege = liste.data;
  const stellbar = eintraege?.filter(bruchStellbar).length ?? 0;
  const offenText = alle.data ? bruchOffenText(alle.data.offen) : null;

  if (liste.isError && eintraege == null) {
    return <Typography.Text type="secondary">Liste nicht geladen</Typography.Text>;
  }
  if (eintraege == null) {
    return <Typography.Text type="secondary">Liste wird geladen</Typography.Text>;
  }
  if (eintraege.length === 0) {
    return <Typography.Text type="secondary">nichts offen</Typography.Text>;
  }
  // Zeilenhöhe: Knopf plus Polsterung; darüber rollt die Liste in sich.
  const zeilenHoehe = token.controlHeight + 2 * token.paddingXXS + 1;
  return (
    <div data-lfh="spiegel-bruchstelle">
      {/* Das Ergebnis von „Alle stellen“ bleibt stehen, auch wenn danach nur noch eine
          Erfassung stellbar ist und der Knopf verschwindet. */}
      {((stellen && stellbar >= 2) || offenText) && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            columnGap: token.marginXS,
            paddingBlockEnd: token.paddingXXS,
          }}
        >
          {stellen && stellbar >= 2 && (
            <Button loading={alle.isPending} onClick={() => alle.mutate()}>
              Alle stellen
            </Button>
          )}
          {offenText && <Typography.Text type="warning">{offenText}</Typography.Text>}
        </div>
      )}
      {alle.error != null && <SpeicherFehler fehler={alle.error} titel="Nicht gestellt" />}
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          maxBlockSize:
            eintraege.length > SICHTBARE_ZEILEN ? SICHTBARE_ZEILEN * zeilenHoehe : undefined,
          overflowY: eintraege.length > SICHTBARE_ZEILEN ? 'auto' : undefined,
        }}
      >
        {eintraege.map((e) => (
          <BruchZeile
            key={e.id}
            einsatzId={einsatzId}
            erfassung={e}
            darfStellen={stellen}
            darfVerwerfen={verwerfen}
            neuLaden={neuLaden}
          />
        ))}
      </ul>
    </div>
  );
}

function BruchZeile({
  einsatzId,
  erfassung: e,
  darfStellen,
  darfVerwerfen,
  neuLaden,
}: {
  einsatzId: number;
  erfassung: BruchErfassung;
  darfStellen: boolean;
  darfVerwerfen: boolean;
  neuLaden: () => void;
}) {
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const stellen = useMutation({
    mutationFn: () => stelleBruchAntrag(einsatzId, e.id),
    onSuccess: neuLaden,
  });
  const verwerfen = useMutation({
    mutationFn: () => verwirfBruch(einsatzId, e.id),
    onSuccess: neuLaden,
  });
  const folgen = bruchFolgenText(e.folgen);
  const zeit = e.zeit ?? e.gesichert_at;
  return (
    <li
      data-lfh="spiegel-bruch"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: token.marginXS,
        paddingBlock: token.paddingXXS,
        borderBlockStart: `1px solid ${rollen.bannerLinie}`,
      }}
    >
      <span style={monoStil(12)}>{zeitKurz(zeit, konventionen)}</span>
      <strong>{bruchArtWort(e)}</strong>
      {!e.verborgen && e.von && (
        <span style={{ color: rollen.text2 }}>
          {e.von}
          {e.kurz && <span aria-hidden="true"> ·</span>}
        </span>
      )}
      {!e.verborgen && e.kurz && <span>{e.kurz}</span>}
      {folgen && <span style={{ color: rollen.text2 }}>{folgen}</span>}
      {!e.verborgen && (darfStellen || darfVerwerfen) && (
        <span style={{ display: 'inline-flex', gap: token.marginXS, marginInlineStart: 'auto' }}>
          {darfStellen && bruchStellbar(e) && (
            <Button loading={stellen.isPending} onClick={() => stellen.mutate()}>
              Als Antrag stellen
            </Button>
          )}
          {darfVerwerfen && (
            <Popconfirm
              title="Nicht nachreichen?"
              okText="Verwerfen"
              cancelText="Abbrechen"
              okButtonProps={{ danger: true }}
              onConfirm={() => verwerfen.mutate()}
            >
              <Button loading={verwerfen.isPending}>Verwerfen</Button>
            </Popconfirm>
          )}
        </span>
      )}
      {stellen.error != null && (
        <div style={{ flexBasis: '100%' }}>
          <SpeicherFehler fehler={stellen.error} titel="Nicht gestellt" />
        </div>
      )}
      {verwerfen.error != null && (
        <div style={{ flexBasis: '100%' }}>
          <SpeicherFehler fehler={verwerfen.error} titel="Nicht verworfen" />
        </div>
      )}
    </li>
  );
}
