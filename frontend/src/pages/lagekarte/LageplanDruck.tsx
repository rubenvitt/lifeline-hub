import Druckkopf from '../../components/druck/Druckkopf';
import {
  lageplanFlaeche,
  massstabLeiste,
  massstabZahl,
  massstabZahlText,
  nordpfeilDrehung,
  veraltetHinweis,
  type LegendenZone,
} from './lageplan';
import type { LageplanBlatt } from './useLageplan';
import './lageplanDruck.css';

/** Farbfeld einer Zone: Füllung, Rand und Strichelung wie auf der Karte. */
function ZonenFeld({ zone }: { zone: LegendenZone }) {
  return (
    <svg width="4mm" height="4mm" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect
        x="1.5"
        y="1.5"
        width="13"
        height="13"
        fill={zone.fuellung}
        fillOpacity={Math.max(0.15, Math.min(1, zone.fuellDeckung))}
        stroke={zone.linie}
        strokeWidth="2"
        strokeDasharray={zone.gestrichelt ? '3 2' : undefined}
      />
    </svg>
  );
}

/** Nordpfeil, um die Peilung der Karte gedreht. */
function Nordpfeil({ peilung }: { peilung: number }) {
  return (
    <svg
      data-lfh="lageplan-nordpfeil"
      width="10mm"
      height="10mm"
      viewBox="0 0 40 40"
      role="img"
      aria-label="Norden"
    >
      <circle cx="20" cy="20" r="18" fill="white" stroke="currentColor" strokeWidth="1.5" />
      <g transform={`rotate(${nordpfeilDrehung(peilung)} 20 20)`}>
        <path d="M20 4 L26 24 L20 20 L14 24 Z" fill="currentColor" />
        <text x="20" y="33" textAnchor="middle" fontSize="9" fontWeight="700" fill="currentColor">
          N
        </text>
      </g>
    </svg>
  );
}

/**
 * Das Druckblatt des Lageplans (LLH-1051, Spec `lagekarte-druck`): A4 quer (`lageplanDruck.css`),
 * Druckkopf, der Ausschnitt in fester Breite in mm, Maßstab samt Verhältnis und Nordpfeil, Hinweis
 * auf veraltete Fachebenen und die Legende dessen, was gezeichnet ist.
 *
 * Hängt nur, solange ein Blatt da ist (`useLageplan`, vom Knopf bis `afterprint`), am Bildschirm
 * nie sichtbar.
 */
export default function LageplanDruck({ blatt }: { blatt: LageplanBlatt }) {
  const { aufnahme, legende } = blatt;
  const { breiteMm, hoeheMm } = lageplanFlaeche(aufnahme.cssBreite, aufnahme.cssHoehe);
  const massstab = massstabLeiste(aufnahme.meterJePx, aufnahme.cssBreite);
  const zahl = massstabZahl(aufnahme.meterJePx, aufnahme.cssBreite, breiteMm);
  const hinweis = veraltetHinweis(legende);
  const zeilen = [
    ...legende.ebenen.map((z) => ({ ...z, zone: null })),
    ...legende.zonen.map((z) => ({ schluessel: z.schluessel, text: z.text, zone: z })),
    ...legende.fachebenen.map((z) => ({ ...z, zone: null })),
    ...legende.bilder.map((z) => ({ ...z, text: `Bild: ${z.text}`, zone: null })),
  ];
  return (
    <div data-lfh="druckwurzel" className="lageplan-druck">
      <div className="lageplan-blatt">
        <Druckkopf
          dokumentart="Lageplan"
          einsatz={blatt.einsatz}
          zeilen={blatt.zeilen}
          sichtbarkeit="druck"
        />
        <figure className="lageplan-figur">
          <img
            data-lfh="lageplan-bild"
            src={blatt.bildUrl}
            alt="Ausschnitt der Lagekarte"
            style={{ width: `${breiteMm}mm`, height: `${hoeheMm}mm` }}
          />
          <figcaption className="lageplan-unterzeile" style={{ width: `${breiteMm}mm` }}>
            {massstab && (
              <span data-lfh="lageplan-massstab" className="lageplan-massstab">
                <svg
                  width={`${massstab.anteil * breiteMm}mm`}
                  height="2.5mm"
                  viewBox="0 0 100 10"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                  focusable="false"
                >
                  <rect x="0" y="0" width="50" height="10" fill="currentColor" />
                  <rect
                    x="0.5"
                    y="0.5"
                    width="99"
                    height="9"
                    fill="none"
                    stroke="currentColor"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                <span>{massstab.text}</span>
              </span>
            )}
            {zahl != null && (
              <span data-lfh="lageplan-verhaeltnis">Maßstab ca. {massstabZahlText(zahl)}</span>
            )}
            <Nordpfeil peilung={aufnahme.peilung} />
          </figcaption>
        </figure>
        {hinweis && (
          <p data-lfh="lageplan-veraltet" className="lageplan-veraltet">
            {hinweis}
          </p>
        )}
        {zeilen.length > 0 && (
          <section data-lfh="lageplan-legende" className="lageplan-legende">
            <h2>Legende</h2>
            <ul>
              {zeilen.map((z) => (
                <li key={z.schluessel}>
                  {z.zone && <ZonenFeld zone={z.zone} />}
                  <span>{z.text}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
