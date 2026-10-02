import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import HaengenderBaum, { baumZielStil } from '../components/organigramm/HaengenderBaum';
import { monoStil, useRollen } from '../components/instrument';
import { IconWarndreieck } from '../icons';
import { einheitDetailPfad, einsatzabschnittePfad } from '../routing/deeplinks';
import EinsatzZeichen from '../zeichen/EinsatzZeichen';
import { fachobjektZeichen } from '../zeichen/fachobjektZeichen';
import type { Fernmeldeskizze, SkizzenKnoten } from './fernmeldeskizze';
import type { Kante } from './luecken';

/**
 * Die Fernmeldeskizze des S6 (LFH-625) — die zweite Darstellung des Funkplans. Reine Darstellung
 * über dem geteilten Gerüst `HaengenderBaum`; Klappzustand und Modell kommen von der Seite.
 * Herleitung: `openspec/changes/archive/2026-10-01-lfh-625-fernmeldeskizze/design.md` (D5).
 *
 * - **Wurzel ohne erfundene Gegenstelle** (LFH-849): „Gegenstelle nicht erfasst“, keine
 *   Stabsstelle — der Stab trägt keine Funkdaten.
 * - **Knoten**: Name als Link (bearbeitet wird am Datensatz), darunter Rufname, TMO/DMO und
 *   Kommunikationsmittel. Leitung, Stärke und Erreichbarkeit stehen hier nie (Spec
 *   „Knoteninhalt“); die Erreichbarkeit ist personenbezogen und bleibt in der Tabelle.
 * - **Kante** als erste Zeile des unteren Knotens: im hängenden Layout zeichnet die Linie der
 *   Elternliste die Verbindung, der Knoten ist ihr Ende. Ohne gemeinsamen Kanal als Wort mit
 *   Zeichen, nicht nur als Farbe (WCAG 1.4.1).
 */

const ZEICHEN_PX = 22;

/**
 * Eine Sprechgruppe mit ihrer Betriebsart: „TMO 311“ aus „311“. Trägt die Bezeichnung die
 * Betriebsart schon („DMO 505“), bleibt sie, wie sie ist — die Tabelle trennt nach Spalten, die
 * Skizze nach Wort, und „DMO DMO 505“ läse sich wie ein Fehler.
 */
function mitBetriebsart(art: 'TMO' | 'DMO', bezeichnung: string): string {
  return bezeichnung.trim().toUpperCase().startsWith(art) ? bezeichnung : `${art} ${bezeichnung}`;
}

function sprechgruppenLabels(tmo: readonly string[], dmo: readonly string[]): string[] {
  return [...tmo.map((b) => mitBetriebsart('TMO', b)), ...dmo.map((b) => mitBetriebsart('DMO', b))];
}

interface Props {
  einsatzId: number;
  skizze: Fernmeldeskizze;
  zugeklappt: ReadonlySet<string>;
  onUmschalten: (key: string) => void;
}

export default function FernmeldeskizzeBild({
  einsatzId,
  skizze,
  zugeklappt,
  onUmschalten,
}: Props) {
  const { token, rollen } = useRollen();
  const kopf = (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div
        role="group"
        aria-label="Einsatzleitung"
        data-lfh="org-einsatzleitung"
        style={{
          border: `2px solid ${rollen.linieStark}`,
          background: rollen.paneel,
          padding: `${token.paddingXS}px ${token.paddingSM}px`,
          minWidth: 0,
        }}
      >
        <div style={{ fontWeight: 600 }}>Einsatzleitung</div>
        {/* LFH-849: Rufname und Sprechgruppen der eigenen Führungsstelle sind kein Datum. Keine
            erfundene Gegenstelle, sondern die benannte Lücke; die Kanten darunter urteilen nicht. */}
        <div style={{ color: rollen.gedaempft }}>Gegenstelle nicht erfasst</div>
      </div>
    </div>
  );

  return (
    <HaengenderBaum<SkizzenKnoten>
      bezeichnung="Fernmeldeskizze"
      lfh="skizze"
      kopf={kopf}
      wurzeln={skizze.wurzeln}
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

function KantenZeile({ kante }: { kante: Kante }) {
  const { token, rollen } = useRollen();
  if (kante.art === 'ohne-urteil') return null;
  if (kante.art === 'keine') {
    return (
      <div
        data-lfh="skizze-kante"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: token.marginXXS,
          color: rollen.achtungText,
        }}
      >
        <span aria-hidden="true" style={{ display: 'inline-flex' }}>
          <IconWarndreieck />
        </span>
        <span>keine gemeinsame Sprechgruppe</span>
      </div>
    );
  }
  return (
    <div
      data-lfh="skizze-kante"
      style={{ ...monoStil(12), color: rollen.gedaempft, overflowWrap: 'anywhere' }}
    >
      {`⇄ ${sprechgruppenLabels(kante.tmo, kante.dmo).join(' · ')}`}
    </div>
  );
}

function KnotenInhalt({
  knoten,
  einsatzId,
}: {
  knoten: Exclude<SkizzenKnoten, { art: 'sammel' }>;
  einsatzId: number;
}) {
  const { token, rollen } = useRollen();
  const ziel =
    knoten.art === 'abschnitt'
      ? einsatzabschnittePfad(einsatzId, { abschnitt: knoten.id })
      : einheitDetailPfad(einsatzId, knoten.id);
  const meta: CSSProperties = { ...monoStil(12), overflowWrap: 'anywhere' };
  const ohneSprechgruppe = knoten.tmo.length === 0 && knoten.dmo.length === 0;
  // Dieselbe Prüfung wie in `EinsatzZeichen` (rendert dort `null`): hier entscheidet sie, ob der
  // Platz überhaupt entsteht.
  const darstellbar = fachobjektZeichen(knoten.tz) != null;
  return (
    <>
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
        <KantenZeile kante={knoten.kante} />
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
          {/* Schlüssel mit Stelle: zwei Sprechgruppen können dieselbe Bezeichnung tragen
              (einsatzlokal und Stammdaten). */}
          {sprechgruppenLabels(knoten.tmo, knoten.dmo).map((l, i) => (
            <span key={`${i}-${l}`} style={{ ...meta, color: rollen.text }}>
              {l}
            </span>
          ))}
          {ohneSprechgruppe && (
            // Als Wort, nicht nur als Farbe (WCAG 1.4.1).
            <span style={{ color: rollen.achtungText }}>keine Sprechgruppe</span>
          )}
          {knoten.kommunikationsmittel && <span>{knoten.kommunikationsmittel}</span>}
        </div>
      </div>
    </>
  );
}
