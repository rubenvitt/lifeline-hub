/**
 * Die drei Paneele des Lage-Dashboards: Gefahrenmatrix · Sichtung · Jüngste ETB-Einträge (im Code
 * „Meldungsstrom“). Rein darstellend
 * — Abfragen, Zustände und Wassermarke hält `LageDashboardPage.tsx`, die Ableitungen liegen in
 * `lageVerdichtung.ts` und `meldungsstrom.ts`.
 *
 * Form aus dem Dashboard-Baukasten (`frontend/AGENTS.md`, LLH-1140): `MatrixPaneel`,
 * `VerteilungsPaneel`, `StromPaneel`. Hier steht nur, was das Lagebild hineinlegt — Wortlaut,
 * Farben aus dem Vertrag, Fuß und Meta.
 */
import type { EtbEintragAnzeige, Sichtungskategorie } from '../../api/types';
import type { AnzeigeKonventionen } from '../../anzeige/format';
import {
  MatrixPaneel,
  StromPaneel,
  VerteilungsPaneel,
  Zeitachseneintrag,
  monoStil,
  useRollen,
} from '../../components/instrument';
import type { LiveVerbindungsStatus } from '../../live/liveVerbindung';
import { etbTyp, sichtung, warnstufeBalkenFarbe } from '../../theme/statusFarben';
import { sichtungsfarben } from '../../theme/tokens';
import { WARNSTUFE_RANG, type GefahrenZeile, type SichtungsZeile } from './lageVerdichtung';
import { warnstufeTon, type Quellzustand } from './lagebild';
import { bannerText, stromQuelle, stromZeit } from './meldungsstrom';
import { modulName } from '../../einsatz/modulRegistry';
import { MIT_ERLAEUTERUNG } from '../gefahren/erlaeuterungen';
import { ErlaeuterungsZeichen } from '../gefahren/ErlaeuterungsMarke';

const LEGENDE = ['niedrig', 'mittel', 'hoch', 'akut'] as const;

export function GefahrenmatrixPaneel({
  zustand,
  zeilen,
  beurteilung,
  gebiete,
  onNeuladen,
  onGefahren,
}: {
  /** `gesperrt`: Modul Gefahren nicht freigegeben — Grund statt Fehler, kein Weg dorthin. */
  zustand: Quellzustand;
  zeilen: GefahrenZeile[];
  /**
   * Nicht beurteilte Gebiete (LLH-1090, `beurteilungHinweis`), `null` wenn alle beurteilt sind.
   * Ersetzt die Zählung unbewerteter Gefahrentypen: eine Zelle ohne Bewertung heißt „keine“.
   */
  beurteilung: string | null;
  gebiete: number;
  onNeuladen: () => void;
  onGefahren: () => void;
}) {
  const { token, rollen } = useRollen();
  const gesperrt = zustand === 'gesperrt';
  const leerText =
    gebiete === 0 ? 'Noch keine Gefahrengebiete angelegt.' : 'Keine Gefahr über Stufe „keine“.';
  return (
    <MatrixPaneel
      titel="Gefahrenmatrix"
      kennung="gefahren"
      zustand={zustand}
      meta={zustand === 'daten' ? `${gebiete} ${gebiete === 1 ? 'Gebiet' : 'Gebiete'}` : undefined}
      sprung={{ label: 'Gefahren', onKlick: onGefahren }}
      fuss={
        (zustand === 'daten' || zustand === 'leer') && !gesperrt && beurteilung ? (
          <span data-lfh="gefahren-beurteilung" style={{ fontSize: 11, color: rollen.achtungText }}>
            {beurteilung}
          </span>
        ) : undefined
      }
      leerText={leerText}
      gesperrtText="Modul Gefahren nicht freigegeben."
      leerAktion={{ label: 'Gefahren bewerten', onKlick: onGefahren }}
      onNeuladen={onNeuladen}
      stufen={LEGENDE}
      zeilen={zeilen.map((z) => ({
        schluessel: z.typ,
        name: z.label,
        // Name wie die Zelle des Palettenauszugs; mit Erläuterung endet er auf
        // „· mit Erläuterung“ (LLH-1365), das Zeichen ist für Hilfstechnik verborgen.
        beschriftung: `${z.label}: ${z.stufe}${z.mitErlaeuterung ? MIT_ERLAEUTERUNG : ''}`,
        zusatz: z.mitErlaeuterung ? (
          <ErlaeuterungsZeichen lfh="gefahrenzeile-erlaeuterung" />
        ) : undefined,
        rang: WARNSTUFE_RANG[z.stufe],
        farbe: warnstufeBalkenFarbe(z.stufe, token),
        stufenwort: z.stufe,
        ton: warnstufeTon(z.stufe),
      }))}
      unterLegende={
        // Das Zeichen der Matrix mit seinem Wort (LLH-1365), nur wenn eine Zeile es trägt.
        zeilen.some((z) => z.mitErlaeuterung) && (
          <div
            aria-hidden="true"
            data-lfh="gefahrenlegende-erlaeuterung"
            style={{ ...monoStil(10), color: rollen.schwach }}
          >
            <ErlaeuterungsZeichen lfh="legende-erlaeuterung" /> mit Erläuterung
          </div>
        )
      }
    />
  );
}

/** Beschreibung je Sichtungskategorie (BBK). Kürzel und Farbe kommen aus dem Vertrag. */
const SICHTUNG_BESCHREIBUNG: Record<Sichtungskategorie, string> = {
  sk1: 'akute vitale Bedrohung',
  sk2: 'schwer verletzt / erkrankt',
  sk3: 'leicht verletzt / erkrankt',
  sk4: 'ohne Überlebenschance',
  tot: 'verstorben',
  unverletzt: 'nicht verletzt',
};

export function SichtungsPaneel({
  zustand,
  zeilen,
  erfasst,
  ohneSichtung,
  versorgung,
  onNeuladen,
  onPersonen,
  onAufnehmen,
}: {
  /** `gesperrt`: Modul Personen nicht freigegeben — Grund statt Fehler, kein Weg dorthin. */
  zustand: Quellzustand;
  zeilen: SichtungsZeile[];
  erfasst: number;
  ohneSichtung: number;
  /** „Unterwegs / offen / abgeschlossen“ aus `versorgungsBilanz` (LLH-1332). */
  versorgung: { unterwegs: number; offen: number; abgeschlossen: number };
  onNeuladen: () => void;
  onPersonen: () => void;
  onAufnehmen: () => void;
}) {
  const { token, rollen } = useRollen();
  return (
    <VerteilungsPaneel
      titel="Sichtung"
      kennung="sichtung"
      zustand={zustand}
      meta={zustand === 'daten' ? `${erfasst} erfasst` : undefined}
      sprung={{ label: modulName('personen'), onKlick: onPersonen }}
      // Fuß: „Ohne Sichtung" und „Unterwegs / offen / abgeschlossen“ (`versorgungsBilanz`, der
      // Versorgungszustand des Servers). „Ohne Sichtung" steht immer, auch mit 0 — sonst
      // schob die live kommende und gehende Zeile das Paneel.
      fuss={
        zustand === 'daten' ? (
          <span style={{ display: 'grid', gap: token.paddingXS }}>
            <span
              data-lfh="ohne-sichtung"
              style={{ display: 'flex', justifyContent: 'space-between', gap: token.paddingSM }}
            >
              <span style={{ fontSize: 11, color: rollen.schwach }}>Ohne Sichtung</span>
              <span style={{ ...monoStil(12), color: rollen.text2 }}>{ohneSichtung}</span>
            </span>
            <span
              data-lfh="transport-bilanz"
              style={{ display: 'flex', justifyContent: 'space-between', gap: token.paddingSM }}
            >
              <span style={{ fontSize: 11, color: rollen.schwach }}>
                Unterwegs / offen / abgeschlossen
              </span>
              <span style={{ ...monoStil(12), color: rollen.text2 }}>
                {versorgung.unterwegs} / {versorgung.offen} / {versorgung.abgeschlossen}
              </span>
            </span>
          </span>
        ) : undefined
      }
      leerText="Noch keine Personen erfasst."
      gesperrtText="Modul Personen nicht freigegeben."
      leerAktion={{ label: 'Person aufnehmen', onKlick: onAufnehmen }}
      onNeuladen={onNeuladen}
      zeilen={zeilen.map((z) => {
        const darstellung = sichtung[z.kategorie];
        const farbe = darstellung.farbe ? sichtungsfarben[darstellung.farbe] : null;
        return {
          schluessel: z.kategorie,
          attribute: { 'data-sichtung': z.kategorie },
          // Kürzel in Textfarbe, die BBK-Farbe im umrandeten Farbfeld davor: Gelb auf Hell und
          // Schwarz auf Dunkel wären als Schrift unlesbar.
          wort: darstellung.label,
          farbfeld: farbe ? { farbe, umrandung: token.colorText } : undefined,
          beschreibung: SICHTUNG_BESCHREIBUNG[z.kategorie],
          wert: z.wert,
          anteil: z.anteil,
          balkenFarbe: farbe ?? rollen.gedaempft,
          // Schwarz auf der dunklen Spur verschwände — die Kontur hält ihn sichtbar.
          balkenKontur: darstellung.farbe === 'schwarz' ? rollen.gedaempft : undefined,
        };
      })}
    />
  );
}

/**
 * Wortlaut je Verbindungszustand — `Record` über die volle Union. `idle` ist „noch nicht offen",
 * nicht „live".
 */
const VERBINDUNG: Record<LiveVerbindungsStatus, string> = {
  idle: 'Verbindung wird aufgebaut',
  open: 'live',
  connecting: 'Verbindung wird aufgebaut',
  lost: 'Verbindung unterbrochen',
};

/**
 * Breite des Verbindungsworts: die des längsten, in `ch` (das Meta ist Mono, jedes Zeichen gleich
 * breit). Ob der Paneelkopf umbricht, hängt sonst am Zustand: auf 390 px passte „live“ neben den
 * Titel, „Verbindung wird aufgebaut“ nicht, und der Kopf schrumpfte beim Verbinden von 53 auf
 * 38 px (LFH-629). Mit fester Breite bricht er in jedem Zustand gleich.
 */
const VERBINDUNG_BREITE = `${Math.max(...Object.values(VERBINDUNG).map((w) => w.length))}ch`;

/**
 * Das Paneel zeigt ETB-Einträge aller Typen, keine Meldungen; daher nicht „Meldungsstrom“
 * (LLH-1046). Kurz, damit der Kopf neben Verbindungswort und „ETB“ im Dreierraster nicht umbricht.
 */
const STROM_TITEL = 'Jüngste ETB-Einträge';

export function MeldungsstromPaneel({
  zustand,
  sichtbar,
  neu,
  neuMindestens,
  liveStatus,
  konv,
  onAnzeigen,
  onNeuladen,
  onEtb,
  onErfassen,
}: {
  /** `gesperrt`: Modul ETB nicht freigegeben — Grund statt Fehler, kein Weg dorthin (LFH-669). */
  zustand: Quellzustand;
  sichtbar: EtbEintragAnzeige[];
  neu: number;
  neuMindestens: boolean;
  liveStatus: LiveVerbindungsStatus;
  konv: AnzeigeKonventionen;
  onAnzeigen: () => void;
  onNeuladen: () => void;
  onEtb: () => void;
  onErfassen: () => void;
}) {
  const { rollen } = useRollen();
  // „live" nur bei offener Leitung — bei totem Stream liefert der Cache weiter alte Daten.
  const metaFarbe =
    liveStatus === 'open'
      ? rollen.bedien
      : liveStatus === 'lost'
        ? rollen.alarmText
        : rollen.schwach;
  return (
    <StromPaneel
      titel={STROM_TITEL}
      zustand={zustand}
      meta={
        <span
          data-lfh="strom-live"
          style={{
            color: metaFarbe,
            display: 'inline-block',
            minWidth: VERBINDUNG_BREITE,
            textAlign: 'end',
          }}
        >
          {VERBINDUNG[liveStatus]}
        </span>
      }
      sprung={{ label: 'ETB', onKlick: onEtb }}
      leerText="Noch keine Einträge im Einsatztagebuch."
      gesperrtText="Modul ETB nicht freigegeben."
      leerAktion={{ label: 'Eintrag erfassen', onKlick: onErfassen }}
      onNeuladen={onNeuladen}
      listeName="Jüngste Einträge"
      neu={neu}
      bannerText={bannerText(neu, neuMindestens)}
      onAnzeigen={onAnzeigen}
    >
      {sichtbar.map((e) => (
        <Zeitachseneintrag
          key={e.id}
          als="li"
          data-lfd-nr={e.lfd_nr}
          zeit={stromZeit(e, konv)}
          nr={`Nr. ${e.lfd_nr}`}
          typ={e.typ}
          typwort={etbTyp[e.typ].label}
          meta={stromQuelle(e)}
        >
          <span
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              fontSize: 12,
              lineHeight: 1.4,
            }}
            title={e.inhalt}
          >
            {e.inhalt}
          </span>
        </Zeitachseneintrag>
      ))}
    </StromPaneel>
  );
}
