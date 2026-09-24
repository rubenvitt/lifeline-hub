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
export type SchadenEingabeFeld = 'typ' | 'ausmass' | 'ort' | 'beschreibung' | 'geschaedigt';

/**
 * Die Schadensdaten als Datenraster — EIN Bauteil für die Detailseite und die Vorschau der
 * Sprungpalette (LFH-664). Zwei Kopien wären zwei Stellen, an denen ein Feld fehlen kann.
 *
 * BEARBEITEN AN ORT UND STELLE: die Seite übergibt im Bearbeiten-Modus je Feld ihren
 * `Form.Item noStyle`-Knoten über `eingabe`; das Raster bleibt dasselbe, statt gegen ein
 * separates Formular getauscht zu werden. Regeln (Pflichtfeld Ort) hängen am `Form.Item` der
 * Seite — dieses Bauteil weiß nichts von einem Formular. Die Vorschau übergibt nichts und
 * bekommt damit die reine Anzeige.
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
   * Palettenvorschau lässt sie weg, weil sie ohne zusätzlichen Abruf auskommen muss
   * (Spec „Die Vorschau liest den Stand der Trefferliste").
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
      {/**
       * VERORTUNG (LFH-340 · C5, Befund M39). Bis dahin sagte die Seite kein Wort darüber,
       * ob dieser Schaden auf der Karte steht — obwohl `lat`/`lon` seit jeher am Datensatz
       * hängen und die Karte sie setzen kann. Eine Lage, die man nicht verorten kann, weil
       * niemand sieht, dass sie unverortet ist, ist so gut wie nicht erfasst.
       *
       * Die Koordinate wird hier NICHT eingegeben: `SchadenEingabe` kennt kein lat/lon
       * (nur `SchadenPatch` tut es), und ein Eingabefeld wäre eine Backend-Erweiterung.
       * Der Weg ist deshalb der Auftrag an die Karte — sie hat die Mechanik bereits.
       */}
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
