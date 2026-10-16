import { Button, Collapse, Flex, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { useState } from 'react';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { OrtZeile } from '../anzeige/OrtZeile';
import type {
  Verpflegungsstelle,
  VerpflegungsstelleStatus,
  VerpflegungZeitfenster,
} from '../api/types';
import { MenueAusloeser } from '../components/MenueAusloeser';
import { SeitenLeer } from '../components/SeitenZustand';
import { ZeilenFehler } from '../components/SpeicherHinweis';
import StatusTag from '../components/StatusTag';
import { monoStil, useRollen } from '../components/instrument';
import { useZeilenFehler } from '../components/useZeilenFehler';
import { verpflegungsstelleStatus } from '../theme/statusFarben';
import { laufendeZeitfensterDerStelle } from './stellenKern';
import { Rueckfrage } from './VerpflegungDialoge';
import { STELLE_ART_LABEL, uhrzeitenText, zitat } from './verpflegungText';

const { Text } = Typography;

export interface StellenListeProps {
  einsatzId: number;
  /** Alle nicht stornierten Stellen nach Bezeichnung (Ordnung des Servers). */
  stellen: readonly Verpflegungsstelle[];
  zeitfenster: readonly VerpflegungZeitfenster[];
  jetzt: Dayjs;
  /**
   * Schreibrecht im Einsatz UND `verpflegung-planen` (am Gerät nie). Der Riegel der
   * Zeilenaktionen: ohne ihn gibt es keine, gleich welche Callbacks gesetzt sind.
   */
  darfPlanen: boolean;
  /** Die Ortszeile zur Koordinate (fragt den Server); am Gerät nicht. */
  mitOrt: boolean;
  /** „Stelle anlegen“ im Leerzustand. */
  onAnlegen?: () => void;
  onBearbeiten: (stelle: Verpflegungsstelle) => void;
  /** In Betrieb nehmen bzw. auflösen; lehnt bei Ablehnung ab (`mutateAsync`). */
  onStatus: (stelle: Verpflegungsstelle, status: VerpflegungsstelleStatus) => Promise<unknown>;
  onStornieren: (stelle: Verpflegungsstelle) => Promise<unknown>;
}

type Aktion = 'aktiv' | 'bearbeiten' | 'aufloesen' | 'stornieren';

interface Rueckfragestand {
  art: 'aufloesen' | 'stornieren';
  stelle: Verpflegungsstelle;
  laeuft: boolean;
  fehler: unknown;
}

/** Hängt an der Stelle eine Ausgabe, auch eine zurückgenommene? Dann kein Storno (Server 422). */
function hasAusgabe(stelleId: number, zeitfenster: readonly VerpflegungZeitfenster[]): boolean {
  return zeitfenster.some((zf) => zf.ausgaben.some((a) => a.verpflegungsstelle_id === stelleId));
}

/**
 * Ansicht „Stellen“ der Verpflegung (LLH-1040, design.md D13 Punkt 2; Spec `kraefte-verpflegung`,
 * „Stellen im Modul“).
 *
 * Je Stelle Bezeichnung, Art, Standort, Status als Wort mit Rollenfarbe und das laufende
 * Zeitfenster mit dem Ist der Stelle (`stellenKern.ts`, aus `je_stelle`, der Client rechnet nicht
 * nach). Aufgelöste stehen eingeklappt am Ende.
 *
 * Aktionen nach Status, gezählt nach der Rechteprüfung (`frontend/AGENTS.md`, „Datensatz-Aktionen
 * werden gebündelt“): geplant drei oder vier hinter EINEM `MenueAusloeser`, aktiv zwei Knöpfe,
 * aufgelöst nur „Bearbeiten …“. „Auflösen …“ und „Stornieren …“ fragen rot zurück; die Rückfrage
 * ist EIN `Modal` außerhalb der Zeilen und bleibt bis zum Erfolg offen, ihr Grund steht darin.
 * „In Betrieb nehmen“ ist umkehrbar genug (Auflösen bleibt möglich) und geht ohne Rückfrage; ihr
 * Grund steht an der Zeile (`useZeilenFehler`, LFH-1077), nie als Toast.
 */
export default function StellenListe({
  einsatzId,
  stellen,
  zeitfenster,
  jetzt,
  darfPlanen,
  mitOrt,
  onAnlegen,
  onBearbeiten,
  onStatus,
  onStornieren,
}: StellenListeProps) {
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const zeilen = useZeilenFehler<number>();
  const [rueckfrage, setRueckfrage] = useState<Rueckfragestand | null>(null);

  if (stellen.length === 0) {
    return (
      <SeitenLeer
        titel="Keine Verpflegungsstellen"
        aktion={
          darfPlanen && onAnlegen ? { label: 'Stelle anlegen', onClick: onAnlegen } : undefined
        }
      />
    );
  }

  const offen = stellen.filter((s) => s.status !== 'aufgeloest');
  const aufgeloest = stellen.filter((s) => s.status === 'aufgeloest');

  const inBetriebNehmen = (s: Verpflegungsstelle) => {
    zeilen.beginne(s.id);
    onStatus(s, 'aktiv').catch((e: unknown) =>
      zeilen.melde(s.id, e, 'Inbetriebnahme fehlgeschlagen'),
    );
  };

  const fuehreAus = (s: Verpflegungsstelle, aktion: Aktion) => {
    if (aktion === 'aktiv') inBetriebNehmen(s);
    if (aktion === 'bearbeiten') {
      zeilen.beginne(s.id);
      onBearbeiten(s);
    }
    if (aktion === 'aufloesen' || aktion === 'stornieren') {
      zeilen.beginne(s.id);
      setRueckfrage({ art: aktion, stelle: s, laeuft: false, fehler: null });
    }
  };

  const confirmRueckfrage = () => {
    if (!rueckfrage) return;
    const { art, stelle } = rueckfrage;
    setRueckfrage({ ...rueckfrage, laeuft: true, fehler: null });
    const aufruf = art === 'aufloesen' ? onStatus(stelle, 'aufgeloest') : onStornieren(stelle);
    aufruf.then(
      () => setRueckfrage(null),
      (fehler: unknown) => setRueckfrage((r) => (r ? { ...r, laeuft: false, fehler } : r)),
    );
  };

  const zeile = (s: Verpflegungsstelle) => {
    const kennung = `Stelle ${s.bezeichnung}`;
    const laufend = laufendeZeitfensterDerStelle(s.id, zeitfenster, jetzt);
    const aktionen: { key: Aktion; label: string; gefahr?: true }[] = !darfPlanen
      ? []
      : s.status === 'geplant'
        ? [
            { key: 'aktiv', label: 'In Betrieb nehmen' },
            { key: 'bearbeiten', label: 'Bearbeiten …' },
            { key: 'aufloesen', label: 'Auflösen …', gefahr: true },
            ...(hasAusgabe(s.id, zeitfenster)
              ? []
              : [{ key: 'stornieren' as const, label: 'Stornieren …', gefahr: true as const }]),
          ]
        : s.status === 'aktiv'
          ? [
              { key: 'bearbeiten', label: 'Bearbeiten …' },
              { key: 'aufloesen', label: 'Auflösen …', gefahr: true },
            ]
          : [{ key: 'bearbeiten', label: 'Bearbeiten …' }];
    const grund = zeilen.grund(s.id);
    return (
      <article
        key={s.id}
        data-lfh="verpflegungsstelle"
        data-status={s.status}
        aria-label={kennung}
        style={{
          minWidth: 0,
          marginBottom: token.marginXS,
          paddingBlock: token.paddingSM,
          paddingInline: token.padding,
          background: rollen.paneel,
          border: `1px solid ${rollen.linie}`,
          color: rollen.text,
        }}
      >
        <Flex justify="space-between" align="center" gap={token.marginXS} wrap>
          <Flex align="baseline" gap={token.marginSM} wrap style={{ minWidth: 0 }}>
            <Text strong style={{ fontSize: 15, overflowWrap: 'anywhere' }}>
              {s.bezeichnung}
            </Text>
            <span style={{ color: rollen.text2 }}>{STELLE_ART_LABEL[s.art]}</span>
          </Flex>
          <StatusTag darstellung={verpflegungsstelleStatus[s.status]} />
        </Flex>
        {s.standort && (
          <div style={{ color: rollen.text2, overflowWrap: 'anywhere' }}>{s.standort}</div>
        )}
        {mitOrt && s.lat != null && s.lon != null && (
          <OrtZeile einsatzId={einsatzId} koord={{ lat: s.lat, lon: s.lon }} maxZeilen={1} />
        )}
        <div data-lfh="stelle-laufend" style={{ marginBlockStart: token.marginXXS }}>
          {laufend.length === 0 ? (
            <span style={{ color: rollen.text2 }}>kein laufendes Zeitfenster</span>
          ) : (
            laufend.map(({ zeitfenster: zf, ausgegeben }) => (
              <Flex key={zf.id} gap={token.marginXS} wrap align="baseline">
                <span>{`${zf.bezeichnung} ${uhrzeitenText(zf, konventionen)}`}</span>
                <span style={{ color: rollen.text2 }}>·</span>
                <span style={monoStil(13, 500)}>{`${ausgegeben} EP ausgegeben`}</span>
              </Flex>
            ))
          )}
        </div>
        {grund && <ZeilenFehler fehler={grund.fehler} fallback={grund.fallback} />}
        {aktionen.length > 0 && (
          // `marginSM` = 7 / 11 / 16 px: im Handschuh-Betrieb ≥ 16 px zwischen zwei Zielen.
          <Flex
            justify="flex-end"
            wrap
            gap={token.marginSM}
            data-lfh="stelle-aktionen"
            style={{ marginBlockStart: token.marginXS }}
          >
            {aktionen.length >= 3 ? (
              <MenueAusloeser<Aktion>
                eintraege={aktionen}
                zugaenglicherName={`Aktionen zu ${kennung}`}
                onWahl={(key) => fuehreAus(s, key)}
              />
            ) : (
              aktionen.map((a) => (
                <Button
                  key={a.key}
                  danger={a.gefahr}
                  aria-label={`${a.label} zu ${kennung}`}
                  onClick={() => fuehreAus(s, a.key)}
                >
                  {a.label}
                </Button>
              ))
            )}
          </Flex>
        )}
      </article>
    );
  };

  return (
    <section aria-label="Verpflegungsstellen" data-lfh="verpflegung-stellen">
      {offen.map(zeile)}
      {aufgeloest.length > 0 && (
        <Collapse
          ghost
          items={[
            {
              key: 'aufgeloest',
              label: `aufgelöst (${aufgeloest.length})`,
              children: aufgeloest.map(zeile),
            },
          ]}
        />
      )}
      {rueckfrage && (
        <Rueckfrage
          titel={`Stelle ${zitat(rueckfrage.stelle.bezeichnung)} ${rueckfrage.art === 'aufloesen' ? 'auflösen' : 'stornieren'}?`}
          okText={rueckfrage.art === 'aufloesen' ? 'Auflösen' : 'Stornieren'}
          fehlerTitel={rueckfrage.art === 'aufloesen' ? 'Nicht aufgelöst' : 'Nicht storniert'}
          laeuft={rueckfrage.laeuft}
          fehler={rueckfrage.fehler}
          onBestaetigen={confirmRueckfrage}
          onSchliessen={() => setRueckfrage(null)}
        >
          <Typography.Paragraph>
            {rueckfrage.art === 'aufloesen'
              ? 'Endgültig; neue Ausgaben an der Stelle sind danach nicht mehr möglich.'
              : 'Die Stelle fällt aus der Liste und aus allen Zeitfenstern.'}
          </Typography.Paragraph>
        </Rueckfrage>
      )}
    </section>
  );
}
