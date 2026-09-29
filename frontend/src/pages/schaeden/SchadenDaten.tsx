import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Space, Tag, Typography } from 'antd';
import StatusTag from '../../components/StatusTag';
import { Datenfeld, Datenraster } from '../../components/instrument';
import KoordinatenAnzeige from '../../anzeige/KoordinatenAnzeige';
import { lagekartePfad } from '../../routing/deeplinks';
import type { Schaden } from '../../api/types';
import { ABSCHLUSS_LABEL, AUSMASS_META, TYP_LABEL, geschaedigtAnzeige } from './schadenHelfer';

/** Die Felder, die die Detailseite im Bearbeiten-Modus an Ort und Stelle als Eingabe zeigt. */
type SchadenEingabeFeld = 'typ' | 'ausmass' | 'ort' | 'beschreibung' | 'geschaedigt';

/**
 * Die Schadensdaten als Datenraster — ein Bauteil für Detailseite und Palettenvorschau.
 *
 * Im Bearbeiten-Modus übergibt die Seite je Feld ihren `Form.Item noStyle`-Knoten über `eingabe`;
 * das Raster bleibt dasselbe. Regeln (Pflichtfeld Ort) hängen am `Form.Item` der Seite. Ohne
 * `eingabe` ist es reine Anzeige.
 */
export default function SchadenDaten({
  schaden: s,
  einsatzId,
  eingabe,
  verortenLink = false,
  ortZeile = true,
  spalten = 3,
}: {
  schaden: Schaden;
  einsatzId: number;
  /** Eingabeknoten je Feld (nur im Bearbeiten-Modus der Seite). */
  eingabe?: Partial<Record<SchadenEingabeFeld, ReactNode>>;
  /** „Auf Karte verorten" bei unverortetem Schaden — nur mit Schreibrecht sinnvoll. */
  verortenLink?: boolean;
  /**
   * Ort-Zeile (Ortsname, Peilung) unter der Koordinate. Sie ist ein eigener Serverabruf; die
   * Palettenvorschau lässt sie deshalb weg.
   */
  ortZeile?: boolean;
  spalten?: number;
}) {
  return (
    <Datenraster spalten={spalten} beschriftung="Schadensdaten">
      <Datenfeld label="Typ">{eingabe?.typ ?? <Tag>{TYP_LABEL[s.typ]}</Tag>}</Datenfeld>
      <Datenfeld label="Ausmaß">
        {eingabe?.ausmass ?? <StatusTag darstellung={AUSMASS_META[s.ausmass]} />}
      </Datenfeld>
      <Datenfeld label="Ort">{eingabe?.ort ?? s.ort}</Datenfeld>
      <Datenfeld label="Beschreibung" breit>
        {eingabe?.beschreibung ?? (s.beschreibung || '—')}
      </Datenfeld>
      {/* Verortung sichtbar machen: eine unverortete Lage, die niemand als unverortet sieht, ist
          so gut wie nicht erfasst. Keine Koordinateneingabe hier (`SchadenEingabe` kennt kein
          lat/lon, LFH-453), der Weg ist der Auftrag an die Karte. */}
      <Datenfeld label="Verortung">
        {s.lat != null && s.lon != null ? (
          <KoordinatenAnzeige
            lat={s.lat}
            lon={s.lon}
            einsatzId={ortZeile ? einsatzId : undefined}
          />
        ) : (
          <Space wrap>
            <Typography.Text type="secondary">nicht verortet</Typography.Text>
            {verortenLink && (
              <Link to={lagekartePfad(einsatzId, { platzieren: { typ: 'schaden', id: s.id } })}>
                Auf Karte verorten
              </Link>
            )}
          </Space>
        )}
      </Datenfeld>
      <Datenfeld label="Geschädigt" breit>
        {eingabe?.geschaedigt ?? geschaedigtAnzeige(s, einsatzId)}
      </Datenfeld>
      {s.status !== 'offen' && <Datenfeld label="Übergeben an">{s.uebergeben_an || '—'}</Datenfeld>}
      {s.status === 'abgeschlossen' && (
        <Datenfeld label="Abschlussgrund">
          {s.abschluss_grund ? ABSCHLUSS_LABEL[s.abschluss_grund] : '—'}
        </Datenfeld>
      )}
    </Datenraster>
  );
}
