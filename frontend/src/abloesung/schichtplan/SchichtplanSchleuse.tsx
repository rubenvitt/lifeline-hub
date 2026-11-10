import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Sammelbanner } from '../../components/instrument';
import { useZuflussSchleuse, useZuflussSteuerung } from '../../components/useZuflussSchleuse';
import type { RasterZeile } from './raster';
import { schleusenKurz, schleusenText, schleuseZeilen } from './zeilenSchleuse';

/**
 * Die Zeilenschleuse des Schichtplans (LLH-1604, Spec `kraefte-schichtplan`, „Zeilen ohne
 * Sprung“), EINE Hülle um Raster bzw. Handy-Liste für den Einsatz (`SchichtplanAnsicht`) und die
 * Vorplanung (`PlanungSchichtplan`). Wann sie hält, entscheidet die gemeinsame Schleuse
 * (`components/useZuflussSchleuse.ts`, wie `Datensicht` und `ListeDetail`): Fokus in der Hülle,
 * ein Maus- oder Stiftzeiger über ihr oder `halten` (laufender Zug, gezogene Person, offener
 * Dialog). Was sie zeigt, rechnet `zeilenSchleuse.ts`: gezeigte Folge und Gruppe, frischer Titel,
 * entfallene Posten als leere Zeile.
 *
 * Blöcke gehen nicht durch die Schleuse: sie stehen in ihrer Zeile an ihrer Uhrzeit und springen
 * nicht.
 *
 * Das Banner liegt als Überlagerung mit Nullhöhe über dem Inhalt (Muster `ErfassungsAnhaenge`) und
 * klebt unter dem Rahmen (LFH-952); es verschiebt selbst keine Zeile. Nach „anzeigen“ geht der
 * Fokus auf den obersten Block, statt mit dem Knopf auf `<body>` zu fallen. Die Hülle selbst ist
 * NICHT fokussierbar: ein Klick auf eine leere Spur hielte die Schleuse sonst über den Fokus
 * geschlossen, bis jemand woanders hinklickt.
 *
 * NACHLAUF VON `halten`: Ein Dialog liegt im Portal; solange er offen ist, haben Fokus und Zeiger
 * die Hülle verlassen. Schließt er, wird er sofort abgebaut, der Fokus fällt auf `<body>`, und der
 * Zeiger ruht womöglich über dem Raster, ohne dass ein Ereignis es meldet. Deshalb hält die Schleuse
 * nach dem Wegfall von `halten` weiter bis zur nächsten Zeigerbewegung, zum nächsten Druck oder zur
 * nächsten Taste. Bewegt sich der Zeiger dabei über der Hülle, übernimmt deren Zeigerbedingung
 * (React meldet die Bewegung vor dem Dokument).
 *
 * SOLANGE DIE QUELLEN LADEN (`bereit`), friert nichts ein: im Einsatz steht die Pause sofort da,
 * Einheiten, UHS und Abschnitte kommen nach; eingefroren wäre sonst ein Raster aus der Pause, und
 * alle Einheiten warteten hinter dem Banner.
 */

interface SchichtplanSchleuseProps {
  /** Die frischen Zeilen, wie sie ohne Schleuse stünden. */
  zeilen: readonly RasterZeile[];
  /** Hält ohne Fokus und Zeiger: ein Zug läuft, eine Person wird gezogen, ein Dialog ist offen. */
  halten?: boolean;
  /** Alle Quellen der Zeilen sind da; vorher friert die Schleuse nicht ein. Vorgabe `true`. */
  bereit?: boolean;
  /** Handschirm: Banner in der Kurzform (`Sammelbanner`, LFH-694). */
  schmal?: boolean;
  children: (zeilen: readonly RasterZeile[]) => ReactNode;
}

const schluesselVon = (z: RasterZeile) => z.schluessel;
const gruppeVon = (z: RasterZeile) => z.gruppe ?? '';

export default function SchichtplanSchleuse({
  zeilen,
  halten = false,
  bereit = true,
  schmal = false,
  children,
}: SchichtplanSchleuseProps) {
  const wurzel = useRef<HTMLDivElement>(null);

  // Nachlauf im Render nachgesetzt, nicht im Effekt: die Schleuse sähe sonst in genau einem
  // Bildaufbau `halten` ohne Nachlauf und öffnete.
  const [haltenVorher, setHaltenVorher] = useState(halten);
  const [nachlauf, setNachlauf] = useState(false);
  if (halten !== haltenVorher) {
    setHaltenVorher(halten);
    setNachlauf(!halten);
  }
  useEffect(() => {
    if (!nachlauf) return;
    const ende = () => setNachlauf(false);
    const arten = ['pointermove', 'pointerdown', 'keydown'] as const;
    for (const art of arten) document.addEventListener(art, ende);
    return () => {
      for (const art of arten) document.removeEventListener(art, ende);
    };
  }, [nachlauf]);

  const steuerung = useZuflussSteuerung<RasterZeile>();
  const bereich = useZuflussSchleuse(steuerung, {
    zeilen,
    schluessel: schluesselVon,
    aktiv: bereit,
    gruppeVon,
    // Das Gerippe sind die gezeigten Zeilen: aus ihm kommen Gruppe und Titel einer entfallenen.
    mitGerippe: true,
    wurzel,
    halten: halten || nachlauf,
  });
  const gezeigt = steuerung.stand.art === 'gefroren' ? steuerung.stand.gerippe : null;
  const { sichtbar, wartend } = useMemo(() => {
    if (!gezeigt) return { sichtbar: zeilen, wartend: null };
    const geschleust = schleuseZeilen(gezeigt, zeilen);
    return { sichtbar: geschleust.zeilen, wartend: geschleust.wartend };
  }, [gezeigt, zeilen]);
  const text = wartend ? schleusenText(wartend) : null;

  const fokusNachFreigabe = useRef(false);
  const anzeigen = () => {
    fokusNachFreigabe.current = true;
    steuerung.nachBenutzeraktion();
  };
  useEffect(() => {
    if (!fokusNachFreigabe.current || text != null) return;
    fokusNachFreigabe.current = false;
    // `preventScroll`: das klebende Banner steht gerade dann, wenn der Kopf weggerollt ist.
    wurzel.current
      ?.querySelector<HTMLElement>(
        '[data-lfh="schichtplan-block"], [data-lfh="schichtplan-listen-block"]',
      )
      ?.focus({ preventScroll: true });
  }, [text]);

  return (
    <div
      ref={wurzel}
      data-lfh="schichtplan-schleuse"
      // `minWidth: 0`: als Gitterzelle neben der Seitenleiste darf die Hülle schmaler werden als das
      // Raster breit ist; das Raster rollt selbst waagerecht.
      style={{ position: 'relative', outline: 'none', minWidth: 0 }}
      {...bereich}
    >
      <div style={{ position: 'sticky', top: 'var(--lfh-rahmen-oben, 0px)', height: 0, zIndex: 5 }}>
        {text != null && wartend && (
          <Sammelbanner
            aktion={{ label: 'anzeigen', onKlick: anzeigen }}
            kurz={schmal ? schleusenKurz(wartend) : undefined}
            style={{ position: 'absolute', insetInline: 0, top: 0 }}
          >
            {text}
          </Sammelbanner>
        )}
      </div>
      {children(sichtbar)}
    </div>
  );
}
