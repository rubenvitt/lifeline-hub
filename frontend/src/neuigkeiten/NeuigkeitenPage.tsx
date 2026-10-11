import { useEffect, useState } from 'react';
import { Button, Tag, Typography } from 'antd';
import { EINTRAEGE } from 'virtual:neuigkeiten';
import type { ChangelogEintrag, Kanal } from '../../scripts/changelog-zerlegen.mjs';
import Markdown from '../components/Markdown';
import { Paneel, Segmentleiste } from '../components/instrument';
import { useVersionsstand, useMarkiereGelesen } from './useVersionsstand';
import {
  nachKanal,
  seitLetzterVersion,
  vorschau,
  VORSCHAU_GRENZE,
  type KanalFilter,
} from './neuigkeiten';

const KANAL_TITEL: Record<Kanal, string> = { alpha: 'Alpha', beta: 'Beta', stabil: 'Stabil' };

const FILTER_OPTIONEN: { wert: KanalFilter; label: string }[] = [
  { wert: 'alle', label: 'Alle' },
  { wert: 'alpha', label: 'Alpha' },
  { wert: 'beta', label: 'Beta' },
  { wert: 'stabil', label: 'Stabil' },
];

/** `2026-10-11` → `11.10.2026`. Ohne Datum (ältere Einträge) bleibt die Zeile leer. */
function datumAnzeige(datum: string | null): string {
  return datum ? datum.split('-').reverse().join('.') : '';
}

/**
 * Die Neuigkeiten der Anwendung (Spec `neuigkeiten`): oben die Änderungen seit der zuletzt
 * gelaufenen Version, darunter das Archiv je Kanal. Öffnen markiert die laufende Version als
 * gelesen.
 */
export default function NeuigkeitenPage() {
  const { data: stand } = useVersionsstand();
  const { mutate: markiereGelesen } = useMarkiereGelesen();
  const [filter, setFilter] = useState<KanalFilter>('alle');

  useEffect(() => {
    markiereGelesen();
  }, [markiereGelesen]);

  const seitLetzter = stand
    ? seitLetzterVersion(EINTRAEGE, stand.laufend, stand.zuletzt_gestartet)
    : [];
  const archiv = nachKanal(EINTRAEGE, filter);

  return (
    <div style={{ display: 'grid', gap: 24, maxWidth: 900 }}>
      <Typography.Title level={1} style={{ margin: 0 }}>
        Neuigkeiten
      </Typography.Title>

      {seitLetzter.length > 0 && (
        <Paneel titel="Seit deiner letzten Version" koerperPolster>
          <Eintragsliste eintraege={seitLetzter} />
        </Paneel>
      )}

      <Paneel titel="Archiv" koerperPolster>
        <div style={{ marginBottom: 16 }}>
          <Segmentleiste
            optionen={FILTER_OPTIONEN}
            wert={filter}
            onWechsel={setFilter}
            beschriftung="Einträge nach Kanal filtern"
          />
        </div>
        {archiv.length === 0 ? (
          <Typography.Text type="secondary">
            {filter === 'beta'
              ? 'Noch keine Beta-Versionen. Dieser Kanal füllt sich mit dem ersten Beta-Release.'
              : 'Keine Einträge in diesem Kanal.'}
          </Typography.Text>
        ) : (
          <Eintragsliste eintraege={archiv} />
        )}
      </Paneel>
    </div>
  );
}

function Eintragsliste({ eintraege }: { eintraege: ChangelogEintrag[] }) {
  return (
    <div style={{ display: 'grid', gap: 32 }}>
      {/* Die Position schlüsselt: die CHANGELOG führt historisch eine Version doppelt (alpha.55). */}
      {eintraege.map((e, i) => (
        <EintragAnzeige key={`${i}-${e.version}`} eintrag={e} />
      ))}
    </div>
  );
}

function EintragAnzeige({ eintrag }: { eintrag: ChangelogEintrag }) {
  const [vollstaendig, setVollstaendig] = useState(false);
  const lang = eintrag.kanal === 'stabil' && eintrag.text.length > VORSCHAU_GRENZE;
  const { text, gekuerzt } =
    lang && !vollstaendig
      ? vorschau(eintrag.text, VORSCHAU_GRENZE)
      : { text: eintrag.text, gekuerzt: false };

  return (
    <article data-lfh="neuigkeit" data-version={eintrag.version}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
        <Typography.Title level={2} style={{ margin: 0, fontSize: 18 }}>
          <span style={{ fontFamily: 'monospace' }}>{eintrag.version}</span>
        </Typography.Title>
        <Tag>{KANAL_TITEL[eintrag.kanal]}</Tag>
        {eintrag.datum && (
          <Typography.Text type="secondary">{datumAnzeige(eintrag.datum)}</Typography.Text>
        )}
      </div>
      <div style={{ marginTop: 8 }}>
        <Markdown unterEbene={3}>{text}</Markdown>
      </div>
      {lang && (
        <Button type="link" style={{ paddingInline: 0 }} onClick={() => setVollstaendig((v) => !v)}>
          {gekuerzt ? 'Vollständig anzeigen' : 'Weniger anzeigen'}
        </Button>
      )}
    </article>
  );
}
