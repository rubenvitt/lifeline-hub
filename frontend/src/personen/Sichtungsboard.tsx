import { Collapse, Typography } from 'antd';
import { useMemo, useRef, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { registrierAnzeige } from '../api/einsatzPerson';
import type { Person } from '../api/types';
import { formatVor } from '../anzeige/abstand';
import { monoStil, useRollen } from '../components/instrument';
import StatusTag from '../components/StatusTag';
import { useMinutenTakt } from '../components/useMinutenTakt';
import {
  useZuflussSchleuse,
  useZuflussSteuerung,
  type ZuflussSteuerung,
} from '../components/useZuflussSchleuse';
import { useViewport } from '../components/useViewport';
import { gehalteneFolge } from '../pages/uhs/dringlichkeit';
import { personDetailPfad } from '../routing/deeplinks';
import { kontamination as KONTAMINATION, sichtung } from '../theme/statusFarben';
import { sichtungsflaechen } from '../theme/tokens';
import { SICHTUNGSBILD_REIHE, type SichtungsbildSchluessel } from './personenBilanz';
import { rasterSchluessel } from './personenFilter';
import { nameText, seitWert, SkTag, verbleibText, type PersonenBedienung } from './personenSpalten';
import PrioritaetMarke from './PrioritaetMarke';
import ZeilenSichtung from './ZeilenSichtung';

/**
 * Sichtungsboard (LLH-1332, Change `y4l621ih-patientenverbleib-uebergabe`, design.md D9, Spec
 * `sichtungsboard`): die Ansicht „Sichtungsraster“ der Betroffenenseite als Überblick nach EINER
 * Achse, kein Umschalten derselben Liste zwischen Tabelle und Karten (`frontend/AGENTS.md`, „Kein
 * Nutzerschalter Tabelle ↔ Karte“).
 *
 * - Eine Spalte je Kategorie in der festen Folge des Sichtungsbilds, ALLE immer: eine stehende Folge
 *   springt bei Live-Updates nicht. Der Kopf zeigt die BBK-Fläche (`sichtungsflaechen`, Kontrast
 *   gerechnet) mit Wort und Zahl; „unverletzt“ und „ohne Sichtung“ ohne Farbe.
 * - Innerhalb der Spalte die am längsten zurückliegende Sichtung oben (`seitWert`, wie das alte
 *   Raster).
 * - Die Karte führt zur Detailseite (Link über Kennung und Name); die Sichtungsmarke daneben ist
 *   der Auslöser der Nachsichtung (`ZeilenSichtung`, derselbe Schreibweg wie die Zeile), ohne
 *   Schreibrecht nur Anzeige. Kein Klickziel im Klickziel.
 * - Die Zuflussschleuse hält Menge, Spalte (`gruppeVon`) und Folge, solange Zeiger oder Fokus im
 *   Board sind oder eine Nachsichtung offen ist (`halten`); Neue warten hinten in ihrer Spalte.
 * - Ab `lg` nebeneinander mit eigenem Bildlauf je Spalte; darunter untereinander und einklappbar,
 *   leere eingeklappt. Die Seite rollt nie seitlich.
 */

const personSchluessel = (p: Person) => p.id;

function wort(k: SichtungsbildSchluessel): string {
  return k === 'ohne' ? 'ohne Sichtung' : sichtung[k].label;
}

interface SichtungsboardProps {
  einsatzId: number;
  /** Die Menge der Zeilen-Ansicht (Statusfilter, Lücken, Abgeschlossene). */
  personen: readonly Person[];
  uhsName: (id: number) => string | undefined;
  /** Bedienung wie in der Liste; ohne sie ist die Sichtung reine Anzeige. */
  bedienung?: PersonenBedienung;
  /** Ein Popover, Menü oder Dialog der Seite ist offen: das Board hält still. */
  halten?: boolean;
  /** Steht über den Spalten, wenn die Menge leer ist (derselbe Satz wie in den Zeilen). */
  leerText?: string;
}

export default function Sichtungsboard({
  einsatzId,
  personen,
  uhsName,
  bedienung,
  halten = false,
  leerText,
}: SichtungsboardProps) {
  const { token } = useRollen();
  const nebeneinander = useViewport().abBreite('lg');
  const wurzel = useRef<HTMLDivElement | null>(null);
  const sortiert = useMemo(
    () =>
      [...personen].sort(
        (a, b) => seitWert(a).localeCompare(seitWert(b)) || a.registrier_nr - b.registrier_nr,
      ),
    [personen],
  );
  const zufluss: ZuflussSteuerung<Person> = useZuflussSteuerung<Person>();
  const bereich = useZuflussSchleuse(zufluss, {
    zeilen: sortiert,
    schluessel: personSchluessel,
    aktiv: true,
    gruppeVon: rasterSchluessel,
    mitGerippe: false,
    wurzel,
    halten,
  });
  const stand = zufluss.stand;
  const gezeigt =
    stand.art === 'gefroren' ? gehalteneFolge(stand.folge, sortiert, personSchluessel) : sortiert;
  const spalteVon = (p: Person): string =>
    (stand.art === 'gefroren' ? stand.gruppeVon.get(p.id) : undefined) ?? rasterSchluessel(p);
  const je = new Map<string, Person[]>(SICHTUNGSBILD_REIHE.map((k) => [k, []]));
  for (const p of gezeigt) je.get(spalteVon(p))?.push(p);

  const karten = (k: SichtungsbildSchluessel) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS }}>
      {je.get(k)!.map((p) => (
        <BoardKarte
          key={p.id}
          p={p}
          einsatzId={einsatzId}
          uhsName={uhsName}
          bedienung={bedienung}
        />
      ))}
    </div>
  );

  return (
    <>
      {personen.length === 0 && leerText && (
        <Typography.Paragraph type="secondary">{leerText}</Typography.Paragraph>
      )}
      <div
        ref={wurzel}
        {...bereich}
        data-testid="sichtungsboard"
        aria-label="Betroffene nach Sichtungskategorie"
        role="region"
        style={
          nebeneinander
            ? {
                display: 'grid',
                // Leere Spalten schmal, damit die belegten Platz für Namen haben; nie breiter als die
                // Seite.
                gridTemplateColumns: SICHTUNGSBILD_REIHE.map((k) =>
                  je.get(k)!.length > 0 ? 'minmax(0, 1fr)' : 'minmax(0, 0.45fr)',
                ).join(' '),
                gap: token.marginXS,
                alignItems: 'start',
              }
            : { display: 'flex', flexDirection: 'column', gap: token.marginXS }
        }
      >
        {nebeneinander ? (
          SICHTUNGSBILD_REIHE.map((k) => (
            <section
              key={k}
              data-testid="board-spalte"
              data-sichtung={k}
              aria-label={`${wort(k)}, ${je.get(k)!.length}`}
              style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: token.marginXS }}
            >
              <SpaltenKopf k={k} zahl={je.get(k)!.length} />
              <div style={{ maxHeight: '70vh', overflowY: 'auto', minWidth: 0 }}>{karten(k)}</div>
            </section>
          ))
        ) : (
          <Collapse
            defaultActiveKey={SICHTUNGSBILD_REIHE.filter((k) => je.get(k)!.length > 0)}
            items={SICHTUNGSBILD_REIHE.map((k) => ({
              key: k,
              label: <SpaltenKopf k={k} zahl={je.get(k)!.length} inline />,
              children: (
                <section data-testid="board-spalte" data-sichtung={k} aria-label={wort(k)}>
                  {karten(k)}
                </section>
              ),
            }))}
          />
        )}
      </div>
    </>
  );
}

/** Kopf einer Spalte: BBK-Fläche mit Wort und Zahl (zweiter Kanal). */
function SpaltenKopf({
  k,
  zahl,
  inline = false,
}: {
  k: SichtungsbildSchluessel;
  zahl: number;
  inline?: boolean;
}) {
  const { token, rollen } = useRollen();
  const farbe = k === 'ohne' ? null : sichtung[k].farbe;
  const flaeche = farbe ? sichtungsflaechen[farbe] : null;
  const stil: CSSProperties = {
    margin: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: token.marginXS,
    paddingInline: token.paddingXS,
    paddingBlock: token.paddingXXS,
    background: flaeche?.flaeche ?? rollen.flaeche3,
    color: flaeche?.schrift ?? rollen.text,
    border: `1px solid ${token.colorText}`,
    fontSize: token.fontSize,
    fontWeight: 600,
    width: inline ? '100%' : undefined,
  };
  return (
    <h2 style={stil}>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{wort(k)}</span>
      <span data-testid="board-zahl" style={monoStil(14, 500)}>
        {zahl}
      </span>
    </h2>
  );
}

/** Eine Person als Karte. */
function BoardKarte({
  p,
  einsatzId,
  uhsName,
  bedienung,
}: {
  p: Person;
  einsatzId: number;
  uhsName: (id: number) => string | undefined;
  bedienung?: PersonenBedienung;
}) {
  const { token, rollen } = useRollen();
  const jetzt = useMinutenTakt();
  const kennung = registrierAnzeige(p.registrier_nr);
  const name = nameText(p);
  const aufenthalt =
    verbleibText(p, uhsName) ?? (p.antreff_ort ? `Fundort ${p.antreff_ort}` : null);
  const sichtungBedienbar =
    bedienung?.rueckmeldung != null &&
    (bedienung.darfSichten ?? bedienung.darfSchreiben) &&
    !p.storniert_at &&
    p.status !== 'vermisst';
  const zeit = p.aktuelle_sichtung_at
    ? `gesichtet ${formatVor(p.aktuelle_sichtung_at, jetzt)}`
    : `erfasst ${formatVor(p.erfasst_at, jetzt)}`;
  return (
    <article
      data-testid="board-karte"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: token.marginXXS,
        padding: token.paddingXS,
        background: rollen.paneel,
        border: `1px solid ${rollen.linie}`,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: token.marginXS, minWidth: 0 }}>
        {sichtungBedienbar ? (
          <ZeilenSichtung
            p={p}
            einsatzId={einsatzId}
            rueckmeldung={bedienung!.rueckmeldung!}
            vorgemerkt={bedienung?.vorgemerkt?.get(p.id)?.has('sichtung') ?? false}
          />
        ) : (
          <SkTag p={p} />
        )}
        {/* Das Bedienziel der Karte: Kennung und Name führen zur Detailseite. */}
        <Link
          to={personDetailPfad(einsatzId, p.id)}
          style={{
            flex: '1 1 auto',
            minWidth: 0,
            minHeight: token.controlHeight,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            color: rollen.text,
          }}
        >
          <span style={{ display: 'flex', gap: token.marginXS, flexWrap: 'wrap' }}>
            <span style={monoStil(token.fontSize, 500)}>{kennung}</span>
            {p.pat_nummer && (
              <span style={{ ...monoStil(token.fontSizeSM), color: rollen.text2 }}>
                PAT {p.pat_nummer}
              </span>
            )}
          </span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name ?? 'unbekannt'}
          </span>
        </Link>
      </div>
      <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
        {zeit}
        {aufenthalt && ` · ${aufenthalt}`}
      </Typography.Text>
      {(p.transport_prioritaet || p.kontamination) && (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: token.marginXXS }}>
          <PrioritaetMarke prioritaet={p.transport_prioritaet} />
          {p.kontamination && <StatusTag darstellung={KONTAMINATION} />}
        </span>
      )}
    </article>
  );
}
