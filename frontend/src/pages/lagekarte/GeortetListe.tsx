import { Augenbraue, Textstufe, useRollen } from '../../components/instrument';
import { ebenenZeileStil } from './leistenTeile';
import type { KarteMarker } from './marker';
import { geortetEintraege } from './geortet';

/**
 * Liste „Geortet“ über der Objektliste (Helfer-App, Spec „Oberfläche → Lagekarte“): die Ziele mit
 * automatischer Position, Name, Quelle und Alter; ein Tipp springt zum Marker wie in der
 * Objektliste. Eine veraltete Position (ab 5 min) trägt das Wort, die Karte zeichnet den Marker
 * blass. Ohne geortetes Ziel steht nichts da.
 */
export default function GeortetListe({
  verortet,
  onMarkerWaehlen,
}: {
  verortet: readonly KarteMarker[];
  onMarkerWaehlen: (schluessel: string) => void;
}) {
  const { token, rollen } = useRollen();
  const eintraege = geortetEintraege(verortet);
  if (eintraege.length === 0) return null;
  return (
    <section
      data-lfh="geortet"
      aria-labelledby="lfh-geortet-kopf"
      style={{ borderBlockEnd: `1px solid ${rollen.linie}` }}
    >
      <Augenbraue
        als="h3"
        id="lfh-geortet-kopf"
        style={{ paddingInline: token.padding, paddingBlockStart: token.paddingSM }}
      >
        Geortet
      </Augenbraue>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {eintraege.map((e) => (
          <li key={e.schluessel}>
            <button
              type="button"
              data-lfh="geortet-eintrag"
              onClick={() => onMarkerWaehlen(e.schluessel)}
              style={{
                ...ebenenZeileStil(token),
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 0,
                background: 'transparent',
                color: rollen.text,
              }}
            >
              <Textstufe>{e.label}</Textstufe>
              <Textstufe stufe="meta" ton="gedaempft">
                {e.veraltet ? `${e.quelle} · veraltet` : e.quelle}
              </Textstufe>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
