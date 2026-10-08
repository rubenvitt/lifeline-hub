import { ConfigProvider } from 'antd';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useOhneVerbindung } from '../offline/verbindung';
import { antdAlgorithmus, antdToken, farbenHell } from '../theme/tokens';
import { baueFernmeldenetz, type Fernmeldenetz } from './fernmeldeskizze';
import FernmeldeskizzeBild from './FernmeldeskizzeBild';
import { ZUSTAND_GRUND } from './funkplan';
import { skizzeAlsPng } from './skizze/skizzeAlsBild';
import { useNetzQuellen } from './useNetzQuellen';
import { useStabFreigabe } from './useStabFreigabe';

/** Die Skizze als Bild mit dem Zeitpunkt, der darin als „Stand“ steht. */
export interface SkizzenBild {
  datei: Blob;
  standAt: string;
}

interface Props {
  einsatzId: number;
  einsatzbezeichnung: string;
  onBild: (bild: SkizzenBild) => void;
  /** Ein Text ist ein Grund aus den Quellen, alles andere ein Fehler beim Zeichnen. */
  onFehler: (fehler: unknown) => void;
}

/**
 * Nimmt die Fernmeldeskizze als Bild auf (LFH-1028), für die Anlage an Lagebericht oder Befehl.
 * Lädt beim Einhängen dieselben Quellen wie der Funkplan (`useNetzQuellen`), zeichnet die Skizze
 * außerhalb des Sichtbereichs in der Druckform und hell wie Papier (eigenes antd-Theme, Grund der
 * Fläche aus `farbenHell`) und meldet das PNG genau einmal. Fehlt die Fläche (Stab gesperrt,
 * Abschnitte nicht geladen), meldet sie den Grund; die übrigen fehlenden Quellen nennt die Skizze
 * selbst wie auf dem Funkplan. Die Seite hängt den Baustein nur für die Dauer einer Aufnahme ein.
 */
export default function SkizzenAufnahme({
  einsatzId,
  einsatzbezeichnung,
  onBild,
  onFehler,
}: Props) {
  const stabFreigabe = useStabFreigabe(einsatzId);
  const ohneVerbindung = useOhneVerbindung();
  const q = useNetzQuellen(einsatzId, stabFreigabe, ohneVerbindung);
  const {
    abschnitte,
    einheiten,
    fahrzeuge,
    besetzung,
    sprechgruppen,
    fuehrungsstelle,
    stellen,
    skizze,
  } = q;
  // Der Zeitpunkt der Aufnahme steht im Schriftfeld und an der Anlage, nicht der letzte Stand der
  // Skizzendaten: das Bild zeigt das ganze Netz zu diesem Zeitpunkt.
  const [standAt] = useState(() => new Date().toISOString());
  const netz = useMemo(
    (): Fernmeldenetz => ({
      ...baueFernmeldenetz({
        einsatzId,
        abschnitte,
        einheiten,
        fahrzeuge,
        besetzung,
        fuehrungsstelle,
        sprechgruppen,
        stellen,
        skizze,
      }),
      stand: standAt,
    }),
    [
      einsatzId,
      abschnitte,
      einheiten,
      fahrzeuge,
      besetzung,
      fuehrungsstelle,
      sprechgruppen,
      stellen,
      skizze,
      standAt,
    ],
  );
  const laedt =
    stabFreigabe.zustand === 'laden' ||
    [
      abschnitte,
      einheiten,
      fahrzeuge,
      besetzung,
      sprechgruppen,
      fuehrungsstelle,
      stellen,
      skizze,
    ].some((x) => x.zustand === 'laden');
  const grund =
    stabFreigabe.zustand === 'gesperrt'
      ? 'Stab nicht freigegeben'
      : stabFreigabe.zustand === 'fehler'
        ? 'Freigaben nicht geladen'
        : !laedt && abschnitte.zustand !== 'daten'
          ? `Abschnitte ${ZUSTAND_GRUND[abschnitte.zustand]}`
          : null;

  const fehlerRef = useRef(onFehler);
  useEffect(() => {
    fehlerRef.current = onFehler;
  });
  useEffect(() => {
    if (grund) fehlerRef.current(grund);
  }, [grund]);

  if (laedt || grund) return null;
  return createPortal(
    <ConfigProvider theme={{ token: antdToken(farbenHell), algorithm: antdAlgorithmus(false) }}>
      <Zeichnung
        netz={netz}
        einsatzbezeichnung={einsatzbezeichnung}
        standAt={standAt}
        onBild={onBild}
        onFehler={onFehler}
      />
    </ConfigProvider>,
    document.body,
  );
}

function Zeichnung({
  netz,
  einsatzbezeichnung,
  standAt,
  onBild,
  onFehler,
}: {
  netz: Fernmeldenetz;
  einsatzbezeichnung: string;
  standAt: string;
  onBild: (bild: SkizzenBild) => void;
  onFehler: (fehler: unknown) => void;
}) {
  const huelle = useRef<HTMLDivElement | null>(null);
  const melden = useRef({ onBild, onFehler });
  useEffect(() => {
    melden.current = { onBild, onFehler };
  });

  // Einmal je Einhängen: das Netz steht, wenn der Baustein zeichnet; ein späteres Live-Update
  // ändert die Aufnahme nicht mehr.
  useEffect(() => {
    let abgebrochen = false;
    void (async () => {
      await document.fonts.ready;
      await new Promise<void>((fertig) => requestAnimationFrame(() => fertig()));
      const svg = huelle.current?.querySelector<SVGSVGElement>('[data-lfh="skizze-flaeche"] svg');
      if (!svg) throw new Error('Skizze nicht gezeichnet');
      const datei = await skizzeAlsPng(svg, farbenHell.flaeche);
      if (!abgebrochen) melden.current.onBild({ datei, standAt });
    })().catch((e: unknown) => {
      if (!abgebrochen) melden.current.onFehler(e);
    });
    return () => {
      abgebrochen = true;
    };
  }, [standAt]);

  return (
    <div
      ref={huelle}
      aria-hidden="true"
      inert
      data-lfh="skizzen-aufnahme"
      style={
        {
          position: 'fixed',
          insetInlineStart: -20000,
          insetBlockStart: 0,
          width: 1600,
          pointerEvents: 'none',
          // Der Grund hinter Zeichen und Text (`skizzenZeichen.tsx`, `GRUND`) folgt sonst dem
          // Modus der Seite; das Bild ist Papier.
          '--lfh-skizze-grund': farbenHell.flaeche,
        } as CSSProperties
      }
    >
      <FernmeldeskizzeBild
        netz={netz}
        aktionen={null}
        einsatzbezeichnung={einsatzbezeichnung}
        druckt
      />
    </div>
  );
}
