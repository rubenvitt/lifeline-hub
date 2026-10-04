import { Button, Space } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { taktischeDtgVoll } from '../../anzeige/format';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { ladeModulFreigaben } from '../../api/einsaetze';
import { legeLageberichtAn } from '../../api/lageberichte';
import { ladeStab } from '../../api/stab';
import { einsatzKeys } from '../../api/queryKeys';
import { useAuth } from '../../auth/AuthContext';
import DruckKnopf from '../../components/druck/DruckKnopf';
import Druckkopf from '../../components/druck/Druckkopf';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { istKeyFreigegeben } from '../../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../../einsatz/schreibrecht';
import type { Einheit, EinsatzAnzeige, Einsatzabschnitt, Stabsfunktion } from '../../api/types';
import { staerkeText } from '../../anzeige/staerke';
import { monoStil, useRollen } from '../../components/instrument';
import { useViewport } from '../../components/useViewport';
import HaengenderBaum, {
  baumZielStil,
  klappbareSchluessel,
} from '../../components/organigramm/HaengenderBaum';
import {
  einheitDetailPfad,
  einsatzabschnittePfad,
  lageberichtDetailPfad,
} from '../../routing/deeplinks';
import { ZUSTAND_GRUND } from '../../stab/funkplan';
import type { Quelle } from '../../stab/luecken';
import { useStabFreigabe } from '../../stab/useStabFreigabe';
import EinsatzZeichen from '../../zeichen/EinsatzZeichen';
import { fachobjektZeichen } from '../../zeichen/fachobjektZeichen';
import {
  baueFuehrungsorganisation,
  rendereFuehrungsorganisationMarkdown,
  stabZeilen,
  type Fuehrungsorganisation,
  type OrgKnoten,
} from './fuehrungsorganisation';
import './organigrammPrint.css';

/**
 * Organigramm der Führungsorganisation (FwDV 100, LFH-626) — die zweite Ansicht der Seite
 * Einsatzabschnitte. Liest, druckt und übernimmt; bearbeitet wird am Datensatz (Namen sind
 * Deeplinks). Herleitung: `openspec/changes/archive/2026-10-01-lfh-626-fuehrungsorganisation-skizze/design.md`.
 *
 * - **Hängendes Layout ohne Bibliothek** (D3): das Gerüst `components/organigramm/HaengenderBaum`
 *   (Spalten der ersten Ebene, senkrechte Zweige, Klappziele, Druckregeln), geteilt mit der
 *   Fernmeldeskizze des S6 (LFH-625 D4).
 * - **Einsatzleitung ohne erfundene Leitung** (D5): wer die Einsatzleitung führt, ist kein Datum;
 *   die eigene Führungsstelle (LFH-849) trägt nur Funkangaben und steht im Funkplan. Der Stab
 *   steht nur mit Stab-Freigabe daneben — fail-closed über `useStabFreigabe`.
 * - **Keine Zahl an der Wurzel** (D4): die Einsatzstärke hat ihre Heimat im Meldebild (LFH-550).
 */

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

  // ── Kopf: Einsatzleitung, daneben (unter `md` darunter) die Stabsstelle ──
  const kopf = (
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
        {/* Wer die Einsatzleitung führt, ist kein Datum (die Führungsstelle, LFH-849, trägt nur
            Funkangaben). Keine erfundene Leitung, sondern die benannte Lücke. */}
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
  );

  return (
    <HaengenderBaum<OrgKnoten>
      bezeichnung="Organigramm"
      lfh="organigramm"
      kopf={kopf}
      wurzeln={org.wurzeln}
      zugeklappt={zugeklappt}
      onUmschalten={onUmschalten}
      knotenName={(k) => (k.art === 'sammel' ? 'Ohne Abschnitt' : k.name)}
      gruppe={(k) => (k.art === 'sammel' ? 'Ohne Abschnitt' : null)}
      inhalt={(k) =>
        k.art === 'sammel' ? (
          <div style={{ fontWeight: 600, paddingBlock: token.paddingXXS }}>Ohne Abschnitt</div>
        ) : (
          <KnotenInhalt knoten={k} einsatzId={einsatzId} />
        )
      }
    />
  );
}

function Stabsstelle({ stab, stil }: { stab: StabsstelleZustand; stil: CSSProperties }) {
  const { token, rollen } = useRollen();
  let inhalt: ReactNode;
  if (stab.zustand === 'fehler') {
    inhalt = <div style={{ color: rollen.gedaempft }}>Besetzung nicht geladen</div>;
  } else if (stab.zustand === 'daten') {
    // S-Folge aus der einen Liste; unbesetzte Sachgebiete erscheinen nicht.
    const zeilen = stabZeilen(stab.besetzung);
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
  // Dieselbe Prüfung wie in `EinsatzZeichen` (rendert dort `null`): hier entscheidet sie, ob der
  // Platz überhaupt entsteht.
  const darstellbar = fachobjektZeichen(knoten.tz) != null;
  return (
    <>
      {/* Zierde: die Bezeichnung daneben trägt die Bedeutung. Ist kein Zeichen darstellbar,
          entfällt der Platz ganz (Spec „Taktische Zeichen als Zierde“). */}
      {darstellbar && (
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
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <Link
          to={ziel}
          style={{
            ...baumZielStil(token),
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
  /** Ältester Stand der Quellen (`gemeinsamerDatenstand`) für den Druckkopf; ms seit Epoche. */
  datenstand?: number;
}

/**
 * Das Organigramm mit Klappzustand, Stabsstelle und Werkzeugzeile. Gemerkt werden die
 * ZUGEklappten Schlüssel: es startet offen, und was live hinzukommt, steht offen da (Muster
 * `FunkplanPage`).
 */
export default function Organigramm({ einsatz, abschnitte, einheiten, datenstand }: Props) {
  const { token, rollen } = useRollen();
  const { benutzer } = useAuth();
  const navigate = useNavigate();
  const { konventionen } = useAnzeigeKonventionen();
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

  // Dieselbe Abfrage wie `useStabFreigabe` (gemeinsamer Cache): die Übernahme legt einen
  // Lagebericht an, also braucht es Schreibrecht UND das freigegebene Modul Lageberichte.
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatz.id),
    queryFn: () => ladeModulFreigaben(einsatz.id),
  });
  const darfUebernehmen =
    darfImEinsatzSchreiben(einsatz, benutzer) &&
    istKeyFreigegeben('lageberichte', freigabenQuery.data);
  // Solange eine Quelle lädt, stünde „lädt“ im unveränderlichen Bericht.
  const quellenLaden = einheiten.zustand === 'laden' || (stabFrei && stabQuery.isPending);

  const uebernehmen = useMutation({
    mutationFn: async () => {
      // Der Stand der Daten, nicht des Klicks: eine Liste aus dem Zwischenspeicher trägt ihr
      // Alter in den unveränderlichen Bericht (Review LFH-626).
      const stand = taktischeDtgVoll(
        new Date(datenstand || Date.now()).toISOString(),
        konventionen,
      );
      // EIN Aufruf mit Startinhalt (Spec `dokument-uebernahme`): der Bericht entsteht mit Text
      // oder gar nicht.
      const lb = await legeLageberichtAn(einsatz.id, {
        vorlage: 'freitext',
        titel: `Führungsorganisation ${stand}`,
        abschnitte: [
          {
            schluessel: 'text',
            text: rendereFuehrungsorganisationMarkdown(org, {
              stand,
              stab:
                stab.zustand === 'daten'
                  ? stab.besetzung
                  : stab.zustand === 'fehler'
                    ? 'fehler'
                    : null,
              einheitenZustand: einheiten.zustand,
            }),
          },
        ],
      });
      return lb.id;
    },
    onSuccess: (lbId) => navigate(lageberichtDetailPfad(einsatz.id, lbId)),
  });

  const umschalten = (key: string) =>
    setZugeklappt((alt) => {
      const neu = new Set(alt);
      if (neu.has(key)) neu.delete(key);
      else neu.add(key);
      return neu;
    });

  return (
    // Druckwurzel (LFH-22): Mechanik in `druck/druck.css`, Eigenheiten in `organigrammPrint.css`.
    // Nur diese Ansicht trägt eine; die Gliederung hat keine — eine Wurzel je Seite.
    <div className="organigramm-print-root" data-lfh="druckwurzel">
      <Druckkopf
        dokumentart="Führungsorganisation"
        einsatz={einsatz}
        sichtbarkeit="druck"
        zeilen={[
          {
            etikett: 'Stand',
            wert: taktischeDtgVoll(new Date(datenstand || Date.now()).toISOString(), konventionen),
          },
        ]}
      />
      <Space
        wrap
        className="organigramm-no-print"
        style={{ marginBlockEnd: token.margin }}
        data-lfh="org-werkzeuge"
      >
        <Button disabled={klappbar.length === 0} onClick={() => setZugeklappt(new Set())}>
          Alle aufklappen
        </Button>
        <Button disabled={klappbar.length === 0} onClick={() => setZugeklappt(new Set(klappbar))}>
          Alle zuklappen
        </Button>
        {darfUebernehmen && (
          <Button
            loading={uebernehmen.isPending}
            disabled={quellenLaden}
            title={quellenLaden ? 'Erst wenn alle Angaben geladen sind' : undefined}
            onClick={() => uebernehmen.mutate()}
          >
            In Lagebericht übernehmen
          </Button>
        )}
        {/* Erst nach committetem Aufklappen drucken — `useDrucken` löst den Dialog nach dem
            Commit aus. */}
        <DruckKnopf vorbereiten={() => setZugeklappt(new Set())} />
      </Space>
      {uebernehmen.error != null && (
        <div className="organigramm-no-print" style={{ marginBlockEnd: token.margin }}>
          <SpeicherFehler
            fehler={uebernehmen.error}
            titel="Nicht in den Lagebericht übernommen"
            fallback="Übernahme fehlgeschlagen"
          />
        </div>
      )}
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
    </div>
  );
}
