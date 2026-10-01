import { Button, Space } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ladeStab } from '../../api/stab';
import { einsatzKeys } from '../../api/queryKeys';
import type { Einheit, EinsatzAnzeige, Einsatzabschnitt, Stabsfunktion } from '../../api/types';
import { staerkeText } from '../../anzeige/staerke';
import { monoStil, useRollen } from '../../components/instrument';
import { useViewport } from '../../components/useViewport';
import { IkoneChevronRechts, IkoneChevronRunter } from '../../ikonen';
import { einheitDetailPfad, einsatzabschnittePfad } from '../../routing/deeplinks';
import { besetzungDarstellung } from '../../stab/besetzung';
import { ZUSTAND_GRUND } from '../../stab/funkplan';
import type { Quelle } from '../../stab/luecken';
import { SACHGEBIETE } from '../../stab/sachgebiete';
import { useStabFreigabe } from '../../stab/useStabFreigabe';
import EinsatzZeichen from '../../zeichen/EinsatzZeichen';
import {
  baueFuehrungsorganisation,
  klappbareSchluessel,
  type Fuehrungsorganisation,
  type OrgKnoten,
} from './fuehrungsorganisation';

/**
 * Organigramm der Führungsorganisation (FwDV 100, LFH-626) — die zweite Ansicht der Seite
 * Einsatzabschnitte. Liest, druckt und übernimmt; bearbeitet wird am Datensatz (Namen sind
 * Deeplinks). Herleitung: `openspec/changes/lfh-626-fuehrungsorganisation-skizze/design.md`.
 *
 * - **Hängendes Layout ohne Bibliothek** (D3): die erste Ebene unter der Einsatzleitung bricht in
 *   Spalten um (`auto-fill`), tiefere Ebenen hängen senkrecht. So bleibt es in jeder Breite ohne
 *   waagerechtes Scrollen. Jede Spalte trägt ihre eigene Oberkante; ein durchgehender Querbalken
 *   löge beim Umbruch in die zweite Zeile.
 * - **Einsatzleitung ohne erfundene Leitung** (D5): die eigene Führungsstelle ist kein Datum
 *   (LFH-849). Der Stab steht nur mit Stab-Freigabe daneben — fail-closed über `useStabFreigabe`.
 * - **Keine Zahl an der Wurzel** (D4): die Einsatzstärke hat ihre Heimat im Meldebild (LFH-550).
 */

/** Mindestbreite einer Spalte der ersten Ebene; gemessen vor dem Bau (design.md D3, Nachtrag). */
export const SPALTE_MIN_PX = 300;
/** Ab dieser Tiefe rückt nichts mehr weiter ein, die Linie bleibt (D3). */
const EINRUECKEN_BIS_TIEFE = 4;
const ZEICHEN_PX = 22;

export type StabsstelleZustand =
  | { zustand: 'aus' }
  | { zustand: 'fehler' }
  | { zustand: 'daten'; besetzung: readonly Stabsfunktion[] };

interface BildProps {
  einsatzId: number;
  org: Fuehrungsorganisation;
  stab: StabsstelleZustand;
  zugeklappt: ReadonlySet<string>;
  onUmschalten: (key: string) => void;
}

/** Reine Darstellung — der Klappzustand und die Stabsstelle kommen von außen. */
export function OrganigrammBild({ einsatzId, org, stab, zugeklappt, onUmschalten }: BildProps) {
  const { token, rollen } = useRollen();
  const { abBreite } = useViewport();
  const breit = abBreite('md');
  const linie = `1px solid ${rollen.linieStark}`;

  const kasten: CSSProperties = {
    border: linie,
    background: rollen.paneel,
    padding: `${token.paddingXS}px ${token.paddingSM}px`,
    minWidth: 0,
  };

  return (
    <section aria-label="Organigramm" data-lfh="organigramm">
      {/* ── Kopf: Einsatzleitung, daneben (unter `md` darunter) die Stabsstelle ── */}
      <div
        style={{
          display: 'flex',
          flexDirection: breit ? 'row' : 'column',
          alignItems: breit ? 'center' : 'stretch',
          justifyContent: 'center',
        }}
      >
        <div
          role="group"
          aria-label="Einsatzleitung"
          data-lfh="org-einsatzleitung"
          style={{ ...kasten, borderWidth: 2 }}
        >
          <div style={{ fontWeight: 600 }}>Einsatzleitung</div>
          {/* LFH-849: der Einsatz kennt die eigene Führungsstelle nicht. Keine erfundene Leitung,
              sondern die benannte Lücke. */}
          <div style={{ color: rollen.gedaempft }}>Leitung nicht erfasst</div>
        </div>
        {stab.zustand !== 'aus' && (
          <>
            {/* Stabslinie: der Stab ist beigeordnet, nicht unterstellt (FwDV 100). */}
            <span
              aria-hidden
              style={
                breit
                  ? { flex: `0 0 ${token.marginLG}px`, borderBlockStart: linie }
                  : {
                      alignSelf: 'center',
                      blockSize: token.marginSM,
                      borderInlineStart: linie,
                    }
              }
            />
            <Stabsstelle stab={stab} stil={kasten} />
          </>
        )}
      </div>

      {/* ── Erste Ebene: Spalten mit eigener Oberkante ── */}
      {org.wurzeln.length > 0 && (
        <ul
          data-lfh="org-ebene1"
          style={{
            listStyle: 'none',
            margin: `${token.marginLG}px 0 0`,
            padding: 0,
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${SPALTE_MIN_PX}px), 1fr))`,
            gap: token.margin,
          }}
        >
          {org.wurzeln.map((k) => (
            <li
              key={k.key}
              data-lfh="org-spalte"
              style={{
                borderBlockStart: `2px solid ${rollen.linieStark}`,
                paddingTop: token.paddingXS,
                minWidth: 0,
              }}
            >
              <Zweig
                knoten={k}
                tiefe={0}
                einsatzId={einsatzId}
                zugeklappt={zugeklappt}
                onUmschalten={onUmschalten}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Stabsstelle({ stab, stil }: { stab: StabsstelleZustand; stil: CSSProperties }) {
  const { token, rollen } = useRollen();
  let inhalt: ReactNode;
  if (stab.zustand === 'fehler') {
    inhalt = <div style={{ color: rollen.gedaempft }}>Besetzung nicht geladen</div>;
  } else if (stab.zustand === 'daten') {
    // S-Folge aus der einen Liste; unbesetzte Sachgebiete erscheinen nicht.
    const zeilen = SACHGEBIETE.flatMap((s) => {
      const zeile = stab.besetzung.find((b) => b.sachgebiet === s.sachgebiet);
      return zeile ? [{ kuerzel: s.kuerzel, text: besetzungDarstellung(zeile).label }] : [];
    });
    inhalt =
      zeilen.length === 0 ? (
        <div style={{ color: rollen.gedaempft }}>Kein Sachgebiet besetzt</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {zeilen.map((z) => (
            <li key={z.kuerzel} style={{ display: 'flex', gap: token.marginXS }}>
              <span style={monoStil(12, 500)}>{z.kuerzel}</span>
              <span style={{ overflowWrap: 'anywhere' }}>{z.text}</span>
            </li>
          ))}
        </ul>
      );
  }
  return (
    <div role="group" aria-label="Stab" data-lfh="org-stab" style={stil}>
      <div style={{ fontWeight: 600 }}>Stab</div>
      {inhalt}
    </div>
  );
}

interface ZweigProps {
  knoten: OrgKnoten;
  tiefe: number;
  einsatzId: number;
  zugeklappt: ReadonlySet<string>;
  onUmschalten: (key: string) => void;
}

/** Ein Knoten mit seinen Kindern, senkrecht darunter. */
function Zweig({ knoten, tiefe, einsatzId, zugeklappt, onUmschalten }: ZweigProps) {
  const { token, rollen } = useRollen();
  const offen = !zugeklappt.has(knoten.key);
  const kinderId = `org-kinder-${knoten.key}`;
  const hatKinder = knoten.kinder.length > 0;
  const bezeichnung = knoten.art === 'sammel' ? 'Ohne Abschnitt' : knoten.name;

  const kopf = (
    <div
      data-lfh="org-knoten"
      style={{ display: 'flex', alignItems: 'flex-start', gap: token.marginXS, minWidth: 0 }}
    >
      {hatKinder ? (
        <Button
          type="text"
          data-lfh="org-klappen"
          aria-label={`Unterstellte von ${bezeichnung}`}
          aria-expanded={offen}
          aria-controls={kinderId}
          icon={offen ? <IkoneChevronRunter /> : <IkoneChevronRechts />}
          onClick={() => onUmschalten(knoten.key)}
        />
      ) : (
        // Platzhalter in Knopfbreite, damit Zeichen und Namen einer Ebene fluchten.
        <span aria-hidden style={{ flex: `0 0 ${token.controlHeightSM}px` }} />
      )}
      {knoten.art === 'sammel' ? (
        <div style={{ fontWeight: 600, paddingBlock: token.paddingXXS }}>Ohne Abschnitt</div>
      ) : (
        <KnotenInhalt knoten={knoten} einsatzId={einsatzId} />
      )}
    </div>
  );

  const kinder = hatKinder && offen && (
    <ul
      id={kinderId}
      style={{
        listStyle: 'none',
        margin: 0,
        // Einrückung gedeckelt: tiefe Gliederungen wachsen nach unten, nicht in die Breite.
        marginInlineStart: tiefe < EINRUECKEN_BIS_TIEFE ? token.controlHeightSM / 2 : 0,
        paddingInlineStart: tiefe < EINRUECKEN_BIS_TIEFE ? token.paddingSM : token.paddingXXS,
        borderInlineStart: `1px solid ${rollen.linieStark}`,
      }}
    >
      {knoten.kinder.map((k) => (
        <li key={k.key} style={{ minWidth: 0 }}>
          <Zweig
            knoten={k}
            tiefe={tiefe + 1}
            einsatzId={einsatzId}
            zugeklappt={zugeklappt}
            onUmschalten={onUmschalten}
          />
        </li>
      ))}
    </ul>
  );

  return knoten.art === 'sammel' ? (
    <div role="group" aria-label="Ohne Abschnitt">
      {kopf}
      {kinder}
    </div>
  ) : (
    <>
      {kopf}
      {kinder}
    </>
  );
}

function KnotenInhalt({
  knoten,
  einsatzId,
}: {
  knoten: Exclude<OrgKnoten, { art: 'sammel' }>;
  einsatzId: number;
}) {
  const { token, rollen } = useRollen();
  const ziel =
    knoten.art === 'abschnitt'
      ? einsatzabschnittePfad(einsatzId, { abschnitt: knoten.id })
      : einheitDetailPfad(einsatzId, knoten.id);
  const meta: CSSProperties = { ...monoStil(12), overflowWrap: 'anywhere' };
  return (
    <>
      {/* Zierde: die Bezeichnung daneben trägt die Bedeutung. */}
      <span
        aria-hidden="true"
        data-lfh="org-zeichen"
        style={{
          display: 'inline-flex',
          flex: `0 0 ${ZEICHEN_PX}px`,
          inlineSize: ZEICHEN_PX,
          blockSize: ZEICHEN_PX,
          marginBlockStart: token.paddingXXS,
        }}
      >
        <EinsatzZeichen tz={knoten.tz} size={ZEICHEN_PX} />
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <Link
          to={ziel}
          style={{
            color: rollen.bedienText,
            fontWeight: knoten.art === 'abschnitt' ? 600 : 400,
            overflowWrap: 'anywhere',
          }}
        >
          {knoten.name}
        </Link>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            columnGap: token.marginXS,
            color: rollen.gedaempft,
          }}
        >
          <span style={meta}>{knoten.rufname ?? 'kein Rufname'}</span>
          {knoten.leitung != null ? (
            <span style={{ overflowWrap: 'anywhere' }}>{knoten.leitung}</span>
          ) : (
            // Als Wort, nicht nur als Farbe (WCAG 1.4.1).
            <span style={{ color: rollen.achtungText }}>Leitung nicht besetzt</span>
          )}
          <span style={{ ...meta, color: rollen.text }}>{staerkeText(knoten.staerke)}</span>
        </div>
      </div>
    </>
  );
}

interface Props {
  einsatz: EinsatzAnzeige;
  abschnitte: readonly Einsatzabschnitt[];
  einheiten: Quelle<Einheit>;
}

/**
 * Das Organigramm mit Klappzustand, Stabsstelle und Werkzeugzeile. Gemerkt werden die
 * ZUGEklappten Schlüssel: es startet offen, und was live hinzukommt, steht offen da (Muster
 * `FunkplanPage`).
 */
export default function Organigramm({ einsatz, abschnitte, einheiten }: Props) {
  const { token, rollen } = useRollen();
  const org = useMemo(
    () =>
      baueFuehrungsorganisation(abschnitte, einheiten.zustand === 'daten' ? einheiten.daten : null),
    [abschnitte, einheiten],
  );
  const [zugeklappt, setZugeklappt] = useState<ReadonlySet<string>>(new Set());
  const klappbar = useMemo(() => klappbareSchluessel(org.wurzeln), [org]);

  const stabFreigabe = useStabFreigabe(einsatz.id);
  const stabFrei = stabFreigabe.zustand === 'frei';
  const stabQuery = useQuery({
    queryKey: einsatzKeys.stab(einsatz.id),
    queryFn: () => ladeStab(einsatz.id),
    enabled: stabFrei,
  });
  // Fail-closed: ohne ermittelte Freigabe und solange nichts da ist, steht keine Stabsstelle da.
  const stab: StabsstelleZustand = !stabFrei
    ? { zustand: 'aus' }
    : stabQuery.data
      ? { zustand: 'daten', besetzung: stabQuery.data.besetzung }
      : stabQuery.isError
        ? { zustand: 'fehler' }
        : { zustand: 'aus' };

  const umschalten = (key: string) =>
    setZugeklappt((alt) => {
      const neu = new Set(alt);
      if (neu.has(key)) neu.delete(key);
      else neu.add(key);
      return neu;
    });

  return (
    <>
      <Space wrap style={{ marginBlockEnd: token.margin }} data-lfh="org-werkzeuge">
        <Button disabled={klappbar.length === 0} onClick={() => setZugeklappt(new Set())}>
          Alle aufklappen
        </Button>
        <Button disabled={klappbar.length === 0} onClick={() => setZugeklappt(new Set(klappbar))}>
          Alle zuklappen
        </Button>
      </Space>
      {einheiten.zustand !== 'daten' && (
        <div style={{ color: rollen.gedaempft, marginBlockEnd: token.marginSM }}>
          {`Einheiten: ${ZUSTAND_GRUND[einheiten.zustand]}`}
        </div>
      )}
      <OrganigrammBild
        einsatzId={einsatz.id}
        org={org}
        stab={stab}
        zugeklappt={zugeklappt}
        onUmschalten={umschalten}
      />
    </>
  );
}
