import { Alert, Checkbox, Modal, Space, Typography } from 'antd';
import { useState, type CSSProperties } from 'react';
import { fehlerText } from '../../api/client';
import { legeNachforderungAn } from '../../api/nachforderungen';
import type {
  AdressatKategorie,
  NachforderungPrioritaet,
  NeueNachforderung,
} from '../../api/types';
import { MengenFeld } from '../../components/MengenFeld';
import { Select } from '../../components/Select';
import { useRollen } from '../../components/instrument';
import {
  ADRESSAT_OPTIONEN,
  PRIORITAET_OPTIONEN,
} from '../../nachforderungen/NachforderungFormular';
import type { Posten } from './posten';

interface Zeile extends Posten {
  an: boolean;
  /** Angelegt in einem früheren Lauf dieses Dialogs; nicht mehr wählbar. */
  angelegt: boolean;
  fehler?: string;
}

export interface Lauf {
  angelegt: string[];
  gescheitert: { art: string; fehler: string }[];
}

/**
 * Legt je gewähltem Posten eine Nachforderung mit Bezug zur Stelle an (LLH-1520, design.md D6),
 * nacheinander über den bestehenden Schreibweg. Ein gescheiterter Posten hält die übrigen nicht
 * auf. Rein bis auf den Aufruf, für den Test exportiert.
 */
export async function legePostenAn(
  einsatzId: number,
  stelleId: number,
  posten: readonly Pick<Posten, 'art' | 'anzahl' | 'bezeichnung'>[],
  gemeinsam: { adressat_kategorie: AdressatKategorie; prioritaet: NachforderungPrioritaet },
  anlegen: (einsatzId: number, body: NeueNachforderung) => Promise<unknown> = legeNachforderungAn,
): Promise<Lauf> {
  const lauf: Lauf = { angelegt: [], gescheitert: [] };
  for (const p of posten) {
    try {
      await anlegen(einsatzId, {
        art: p.art,
        anzahl: p.anzahl,
        bezeichnung: p.bezeichnung,
        betreuungsstelle_id: stelleId,
        ...gemeinsam,
      });
      lauf.angelegt.push(p.art);
    } catch (e) {
      lauf.gescheitert.push({ art: p.art, fehler: fehlerText(e, 'nicht angelegt') });
    }
  }
  return lauf;
}

/**
 * Dialog „Nachforderungen anlegen“ aus dem Ergebnis des Rechners: Posten mit Anzahl, Adressat
 * und Priorität gemeinsam. Nach einem Lauf mit Fehlern bleibt er offen; angelegte Posten stehen
 * als angelegt, gescheiterte bleiben angehakt mit Grund.
 */
export default function NachforderungenDialog({
  einsatzId,
  stelleId,
  stelleName,
  posten,
  onFertig,
  onSchliessen,
}: {
  einsatzId: number;
  stelleId: number;
  stelleName: string;
  posten: readonly Posten[];
  /** Nach einem Lauf, in dem etwas angelegt wurde (für Invalidierung und Rückmeldung). */
  onFertig: (lauf: Lauf, offenGeblieben: boolean) => void;
  onSchliessen: () => void;
}) {
  const { token } = useRollen();
  const [zeilen, setZeilen] = useState<Zeile[]>(() =>
    posten.map((p) => ({ ...p, an: p.vorgewaehlt, angelegt: false })),
  );
  const [adressat, setAdressat] = useState<AdressatKategorie>('leitstelle');
  const [prioritaet, setPrioritaet] = useState<NachforderungPrioritaet>('normal');
  const [laeuft, setLaeuft] = useState(false);

  const gewaehlt = zeilen.filter((z) => z.an && !z.angelegt && z.anzahl > 0);
  const n = gewaehlt.length;
  const knopf = n === 1 ? '1 Nachforderung anlegen' : `${n} Nachforderungen anlegen`;
  const gescheitert = zeilen.filter((z) => z.fehler);

  async function anlegen() {
    setLaeuft(true);
    const lauf = await legePostenAn(einsatzId, stelleId, gewaehlt, {
      adressat_kategorie: adressat,
      prioritaet,
    });
    setLaeuft(false);
    const fehlerJe = new Map(lauf.gescheitert.map((g) => [g.art, g.fehler]));
    const angelegt = new Set(lauf.angelegt);
    setZeilen((alt) =>
      alt.map((z) =>
        angelegt.has(z.art)
          ? { ...z, an: false, angelegt: true, fehler: undefined }
          : fehlerJe.has(z.art)
            ? { ...z, fehler: fehlerJe.get(z.art) }
            : z,
      ),
    );
    const offen = lauf.gescheitert.length > 0;
    if (lauf.angelegt.length > 0) onFertig(lauf, offen);
    if (!offen) onSchliessen();
  }

  const zeile: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 120px',
    gap: token.marginSM,
    alignItems: 'center',
    paddingBlock: token.paddingXS,
    borderBlockEnd: `1px solid ${token.colorBorderSecondary}`,
  };

  return (
    <Modal
      open
      title={`Nachforderungen für ${stelleName}`}
      okText={knopf}
      cancelText="Schließen"
      okButtonProps={{ disabled: n === 0 }}
      confirmLoading={laeuft}
      onOk={() => void anlegen()}
      onCancel={laeuft ? undefined : onSchliessen}
      closable={!laeuft}
      mask={{ closable: !laeuft }}
      destroyOnHidden
    >
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <div role="group" aria-label="Posten">
          {zeilen.map((z) => (
            <div key={z.schluessel} style={zeile}>
              <Checkbox
                checked={z.an}
                disabled={z.angelegt || laeuft}
                onChange={(ev) =>
                  setZeilen((alt) =>
                    alt.map((x) =>
                      x.schluessel === z.schluessel ? { ...x, an: ev.target.checked } : x,
                    ),
                  )
                }
              >
                <span style={{ display: 'grid' }}>
                  <span>{z.art}</span>
                  {z.bezeichnung && (
                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                      {z.bezeichnung}
                    </Typography.Text>
                  )}
                  {z.angelegt && (
                    <Typography.Text type="success" style={{ fontSize: token.fontSizeSM }}>
                      angelegt
                    </Typography.Text>
                  )}
                  {z.fehler && (
                    <Typography.Text type="danger" style={{ fontSize: token.fontSizeSM }}>
                      {z.fehler}
                    </Typography.Text>
                  )}
                </span>
              </Checkbox>
              <MengenFeld
                beschriftung={`Anzahl ${z.art}`}
                min={1}
                max={1_000_000}
                value={z.anzahl}
                disabled={z.angelegt || laeuft}
                onChange={(v) =>
                  setZeilen((alt) =>
                    alt.map((x) => (x.schluessel === z.schluessel ? { ...x, anzahl: v ?? 0 } : x)),
                  )
                }
                style={{ width: '100%' }}
              />
            </div>
          ))}
        </div>
        <div
          style={{
            display: 'grid',
            gap: token.marginSM,
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
          }}
        >
          <label style={{ display: 'grid', gap: 4 }}>
            <Typography.Text type="secondary">Adressat</Typography.Text>
            <Select<AdressatKategorie>
              aria-label="Adressat"
              options={ADRESSAT_OPTIONEN}
              value={adressat}
              onChange={setAdressat}
              disabled={laeuft}
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <Typography.Text type="secondary">Priorität</Typography.Text>
            <Select<NachforderungPrioritaet>
              aria-label="Priorität"
              options={PRIORITAET_OPTIONEN}
              value={prioritaet}
              onChange={setPrioritaet}
              disabled={laeuft}
            />
          </label>
        </div>
        {gescheitert.length > 0 && (
          <Alert
            type="error"
            showIcon
            title={
              gescheitert.length === 1
                ? '1 Posten nicht angelegt'
                : `${gescheitert.length} Posten nicht angelegt`
            }
            description={gescheitert.map((z) => z.art).join(', ')}
          />
        )}
      </Space>
    </Modal>
  );
}
