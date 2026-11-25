import { useMemo, useState } from 'react';
import { Button, Descriptions, Space, Typography } from 'antd';
import type { FreiesZeichenUpdate, ZoneTyp } from '../../api/types';
import { useRollen } from '../../components/instrument';
import { fremdebeneFarbe } from '../../theme/statusFarben';
import type { Fremdebene } from '../../api/fremdebenen';
import { alsText, pick } from './fachebeneTitel';
import KartenDetailCard from './KartenDetailCard';
import { FREMDE_DATEN } from './lageplan';
import { UEBERNAHME_GRUND_TEXT, zerlege, type UebernahmeTeil } from './fremdebeneUebernahme';
import FremdebeneUebernehmenDialog from './FremdebeneUebernehmenDialog';
import ZeichenWahlDialog from './ZeichenWahlDialog';

/** Was „Übernehmen“ meldet (LLH-2129); der Aufrufer legt an und liefert, ob es ganz gelang. */
export interface UebernahmeWahl {
  teile: UebernahmeTeil[];
  zonenTyp?: ZoneTyp;
  spec?: FreiesZeichenUpdate;
}

/**
 * Ein Objekt einer Fremdebene (LLH-2099, Entwurf „Zeichnen“): nur zum Lesen, mit Name,
 * Beschreibung, Ebene und dem Kennwort „Fremde Daten“ — die Angaben stammen nicht aus dem Einsatz
 * und sind nicht geprüft. Der Server liefert nur `name` und `description` als Text.
 *
 * Mit Schreibrecht übernimmt „Übernehmen …“ das Objekt als eigene Zeichnung (LLH-2129): Fläche
 * oder Linie über die Artwahl als Zone, Punkte über den Zeichen-Dialog als freies Zeichen.
 */
export default function FremdebeneDetail({
  ebene,
  properties,
  geometrie,
  darfSchreiben = false,
  uebernahmeLaeuft = false,
  onUebernehmen,
  onSchliessen,
}: {
  ebene: Fremdebene;
  properties: Record<string, unknown>;
  /** Volle Geometrie des Objekts aus den Daten der Ebene (nicht die gekachelte der Karte). */
  geometrie?: unknown;
  darfSchreiben?: boolean;
  uebernahmeLaeuft?: boolean;
  onUebernehmen?: (wahl: UebernahmeWahl) => Promise<boolean>;
  onSchliessen: () => void;
}) {
  const { token } = useRollen();
  const [dialogOffen, setDialogOffen] = useState(false);
  const zerlegt = useMemo(() => zerlege(geometrie), [geometrie]);
  const teile = 'teile' in zerlegt ? zerlegt.teile : null;
  const art = teile?.[0].art;
  const melde = async (wahl: UebernahmeWahl) => {
    if (!onUebernehmen) return;
    if (await onUebernehmen(wahl)) setDialogOffen(false);
  };
  const name = pick(properties, 'name');
  const beschreibung = alsText(properties.description);
  return (
    <KartenDetailCard
      titel={name ?? ebene.name}
      akzentFarbe={fremdebeneFarbe(ebene.color, token)}
      kachel="FD"
      unterzeile={FREMDE_DATEN}
      onSchliessen={onSchliessen}
    >
      <Descriptions
        size="small"
        column={1}
        items={[
          ...(beschreibung
            ? [{ key: 'beschreibung', label: 'Beschreibung', children: beschreibung }]
            : []),
          { key: 'ebene', label: 'Ebene', children: ebene.name },
          {
            key: 'herkunft',
            label: 'Herkunft',
            children:
              ebene.source === 'url' && ebene.url_host
                ? `${FREMDE_DATEN} von ${ebene.url_host}`
                : `${FREMDE_DATEN} aus einer Datei`,
          },
        ]}
      />
      {darfSchreiben && onUebernehmen && (
        <Space orientation="vertical" size={4}>
          <Button disabled={!teile} onClick={() => setDialogOffen(true)}>
            Übernehmen …
          </Button>
          {'grund' in zerlegt && (
            <Typography.Text type="secondary">
              {UEBERNAHME_GRUND_TEXT[zerlegt.grund]}
            </Typography.Text>
          )}
        </Space>
      )}
      {teile && art && art !== 'punkt' && (
        <FremdebeneUebernehmenDialog
          offen={dialogOffen}
          art={art}
          anzahl={teile.length}
          laeuft={uebernahmeLaeuft}
          onBestaetigen={(zonenTyp) => void melde({ teile, zonenTyp })}
          onAbbrechen={() => setDialogOffen(false)}
        />
      )}
      {teile && art === 'punkt' && (
        <ZeichenWahlDialog
          offen={dialogOffen}
          quelle="maus"
          onPlatzieren={(spec) => void melde({ teile, spec })}
          onAbbrechen={() => setDialogOffen(false)}
        />
      )}
    </KartenDetailCard>
  );
}
