import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { AnhangVerweis } from '../components/DownloadAnker';
import { useRollen } from '../components/instrument';
import { vermerkeTitel, type Vermerk } from './vermerke';

/**
 * Darstellung der Vermerke (`etb/vermerke.ts`): als Spalte mit „+n“ in der Spaltenzeile, als
 * umbrechende Liste unter dem Text der Handschirm-Zeile und in der aufgeklappten Spaltenzeile.
 *
 * Verweise führen per Link (das ↗ ist Zierde, `aria-hidden`), Dateien laden über
 * `AnhangVerweis` (am Spiegel „wird geholt“, LLH-1492), ein Nachtrag ist Text in der
 * Achtungsrolle. Jedes Bedienziel hat die Bedienhöhe, ragt aber in die Polsterung der Zeile: die
 * Zeile bleibt einzeilig (Muster `Zeitachseneintrag`, Zeilenmenü).
 */
function VermerkInhalt({ v, ueberstand }: { v: Vermerk; ueberstand: number }) {
  const { token } = useRollen();
  const ziel = {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: token.controlHeight,
    marginBlock: -ueberstand,
    minWidth: 0,
  } as const;
  if (v.datei) {
    return (
      <AnhangVerweis
        href={v.datei.href}
        download={v.datei.dateiname}
        aria-label={v.datei.name}
        style={ziel}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.text}</span>
      </AnhangVerweis>
    );
  }
  if (v.pfad) {
    return (
      <Link to={v.pfad} style={ziel}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.text}</span>
        <span aria-hidden="true">&nbsp;↗</span>
      </Link>
    );
  }
  return <span>{v.text}</span>;
}

function vermerkKlasse(v: Vermerk, extra: string): string {
  return ['etb-vermerk', v.ton === 'achtung' ? 'etb-vermerk--achtung' : '', extra]
    .filter(Boolean)
    .join(' ');
}

/** Breite des „+n“ samt Abstand, die beim Messen frei bleibt (12 px Text, drei Zeichen). */
const PLUS_RESERVE = 34;
const LUECKE = 6;

/**
 * Wie viele Vermerke passen in die Spalte? Rein, über die gemessenen Breiten. Unbekannte Breite
 * (0, etwa ohne Layout) zeigt alle. Passt schon der erste nicht, steht er gekürzt da (Auslassung):
 * eine Spalte zeigt immer mindestens einen Vermerk.
 */
export function passendeVermerke(breiten: readonly number[], platz: number): number {
  if (platz <= 0 || breiten.length === 0) return breiten.length;
  let summe = 0;
  for (let i = 0; i < breiten.length; i += 1) {
    const mitDiesem = summe + (i > 0 ? LUECKE : 0) + breiten[i];
    const reserve = i < breiten.length - 1 ? PLUS_RESERVE : 0;
    if (mitDiesem + reserve > platz) return Math.max(1, i);
    summe = mitDiesem;
  }
  return breiten.length;
}

/**
 * Die Spalte Vermerk einer Spaltenzeile (Spec, „Vermerke in eigener Spalte“): eine Zeile; was
 * nicht passt, steht hinter „+n“, das die Vermerke unter dem Text aufklappt. Alle Vermerke nennt
 * der Titel der Spalte und das Zeilenmenü. `vor` steht vorn (Sendezustand einer gepufferten
 * Zeile), `nach` fest am Ende (das „mehr“ eines langen Eintrags) — beide fallen nie hinter „+n“.
 */
export function EtbVermerkSpalte({
  vermerke,
  vor,
  nach,
  aufgeklappt,
  onAufklappen,
}: {
  vermerke: readonly Vermerk[];
  vor?: ReactNode;
  nach?: ReactNode;
  /** Stehen die Vermerke unter dem Text (nach „+n“)? Dann trägt die Spalte nur den Rückweg. */
  aufgeklappt: boolean;
  onAufklappen: (auf: boolean) => void;
}) {
  const { token } = useRollen();
  const ueberstand = Math.max(0, (token.controlHeight - 20) / 2);
  const liste = useRef<HTMLDivElement>(null);
  const [anzahl, setAnzahl] = useState(vermerke.length);
  const schluessel = vermerke.map((v) => v.schluessel).join('|');
  useLayoutEffect(() => {
    const el = liste.current;
    if (!el || aufgeklappt) return;
    const messen = () => {
      const kinder = [...el.querySelectorAll<HTMLElement>(':scope > [data-vermerk]')];
      const spalte = el.parentElement;
      // Platz der Liste: die Spalte ohne „vor“ und „nach“. Das „+n“ zählt nicht mit, es hält
      // `passendeVermerke` frei — sonst zählte es doppelt, sobald es steht.
      const neben = spalte
        ? [...spalte.children]
            .filter((k) => k !== el && !k.classList.contains('etb-vermerk-mehr'))
            .reduce((s, k) => s + (k as HTMLElement).offsetWidth + LUECKE, 0)
        : 0;
      const n = passendeVermerke(
        kinder.map((k) => k.scrollWidth),
        spalte?.clientWidth ? Math.max(1, spalte.clientWidth - neben) : 0,
      );
      setAnzahl((vorher) => (vorher === n ? vorher : n));
    };
    messen();
    const beobachter = new ResizeObserver(messen);
    if (el.parentElement) beobachter.observe(el.parentElement);
    return () => beobachter.disconnect();
  }, [schluessel, aufgeklappt]);

  const verborgen = aufgeklappt ? 0 : vermerke.length - Math.min(anzahl, vermerke.length);
  const titel = vermerkeTitel(vermerke);
  return (
    <div className="etb-vermerk-spalte" data-lfh="etb-vermerk" title={titel || undefined}>
      {vor}
      {!aufgeklappt && vermerke.length > 0 && (
        <div ref={liste} className="etb-vermerk-liste">
          {vermerke.map((v, i) => {
            const zuViel = i >= vermerke.length - verborgen;
            return (
              <span
                key={v.schluessel}
                data-vermerk={v.schluessel}
                aria-hidden={zuViel || undefined}
                className={vermerkKlasse(
                  v,
                  zuViel ? 'etb-vermerk--verborgen' : i === 0 ? 'etb-vermerk--erster' : '',
                )}
              >
                {i > 0 && <span aria-hidden="true">·&nbsp;</span>}
                <VermerkInhalt v={v} ueberstand={ueberstand} />
              </span>
            );
          })}
        </div>
      )}
      {(verborgen > 0 || aufgeklappt) && (
        <button
          type="button"
          className="etb-vermerk-mehr"
          aria-expanded={aufgeklappt}
          aria-label={
            aufgeklappt
              ? 'Vermerke zuklappen'
              : verborgen === 1
                ? '1 weiterer Vermerk zeigen'
                : `${verborgen} weitere Vermerke zeigen`
          }
          onClick={() => onAufklappen(!aufgeklappt)}
          style={{ minHeight: token.controlHeight, marginBlock: -ueberstand }}
        >
          {aufgeklappt ? 'zuklappen' : `+${verborgen}`}
        </button>
      )}
      {nach}
    </div>
  );
}

/**
 * Alle Vermerke umbrechend: unter dem Text der Handschirm-Zeile und aufgeklappt unter der
 * Spaltenzeile. `nach` hängt die vollständigen Anhang- und Dokumentblöcke an (Vorschaubild,
 * Original, LFH-747/LFH-759), die nur hier Platz haben.
 */
export function EtbVermerkListe({
  vermerke,
  ohneDateien = false,
  nach,
}: {
  vermerke: readonly Vermerk[];
  /** Dateien weglassen, weil `nach` sie vollständig zeigt. */
  ohneDateien?: boolean;
  nach?: ReactNode;
}) {
  const { token } = useRollen();
  const sichtbar = ohneDateien ? vermerke.filter((v) => !v.datei) : vermerke;
  if (sichtbar.length === 0 && nach == null) return null;
  return (
    <div
      data-lfh="etb-vermerke"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: token.marginSM,
        fontSize: 12,
        lineHeight: '18px',
        color: 'var(--lfh-gedaempft)',
      }}
    >
      {sichtbar.map((v) => (
        <span key={v.schluessel} data-vermerk={v.schluessel} className={vermerkKlasse(v, '')}>
          <VermerkInhalt v={v} ueberstand={0} />
        </span>
      ))}
      {nach}
    </div>
  );
}
