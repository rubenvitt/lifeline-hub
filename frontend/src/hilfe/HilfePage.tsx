import { Button, Input } from 'antd';
import type { InputRef } from 'antd';
import type { MouseEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import Markdown from '../components/Markdown';
import { Select } from '../components/Select';
import { SeitenLeer } from '../components/SeitenZustand';
import DruckKnopf from '../components/druck/DruckKnopf';
import { useViewport } from '../components/useViewport';
import { Bildmarke } from '../marke/Bildmarke';
import {
  GERAET_START_PFAD,
  einsaetzePfad,
  hilfePfad,
  parseHilfeGruppe,
} from '../routing/deeplinks';
import { BEREICHE, bereichVon, kurztext } from './bereiche';
import { GRUPPEN, gruppenName, type Gruppe } from './gruppen';
import HilfeBild from './HilfeBild';
import { KAPITEL, findeKapitel, kapitelDerGruppe, verlinke, type Kapitel } from './kapitel';
import './Hilfe.css';

/** Klein, ohne Umlaute und ß: „gerat“ findet „Gerät“. */
function falte(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ß/g, 'ss');
}

interface Gliederungspunkt {
  text: string;
  ebene: 2 | 3;
}

/**
 * Hilfe (LFH-1096, Spec `anwenderdoku`, `docs/anwender/AGENTS.md`).
 *
 * Aufbau wie die Doku der Website (`website/src/pages/doku/`): links die Kapitel nach Bereichen
 * (einklappbar, Suche im Volltext, Lesergruppe), in der Mitte der Text, ab 1240 px rechts das
 * Inhaltsverzeichnis des Kapitels mit dem Abschnitt, in dem man gerade liest. Unter `lg` liegt die
 * Kapitelliste eingeklappt über dem Text.
 *
 * Ohne Kapitel in der Adresse zeigt die Seite die Übersicht nach Bereichen (Karten mit Kurztext)
 * und darunter alle Kapitel der Lesergruppe am Stück: das ist zugleich die Einweisungsmappe zum
 * Drucken (nur die Druckwurzel geht aufs Papier, die Übersicht nicht).
 *
 * Offen ohne Anmeldung (das Kapitel „Anmelden“ braucht man davor) und ohne Netz (die Texte stecken
 * im Chunk dieser Seite, den der Service Worker vorhält). Bilder lädt die Seite erst beim Ansehen
 * und hält sie danach im Laufzeit-Cache (`HilfeBild`, `bilder.ts`, LFH-1128). Der Rückweg folgt
 * der Sitzung: Person, Gerät oder Anmeldung.
 */
export default function HilfePage() {
  const { kapitel: slug } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { benutzer, geraet } = useAuth();
  const { abBreite } = useViewport();
  const breit = abBreite('lg');
  const gruppe = parseHilfeGruppe(params);
  const [suche, setSuche] = useState('');
  const suchfeld = useRef<InputRef>(null);
  const woerter = falte(suche).split(/\s+/).filter(Boolean);
  const liste = kapitelDerGruppe(gruppe).filter((k) => {
    if (woerter.length === 0) return true;
    const text = falte(`${k.titel} ${k.text}`);
    return woerter.every((w) => text.includes(w));
  });
  const einzeln = findeKapitel(slug);
  const gezeigt: Kapitel[] = slug === undefined ? liste : einzeln ? [einzeln] : [];
  const bereichAktuell = einzeln ? bereichVon(einzeln.reihenfolge) : undefined;
  const bereiche = BEREICHE.map((name, i) => ({
    name,
    nummer: String(i).padStart(2, '0'),
    kapitel: liste.filter((k) => bereichVon(k.reihenfolge) === name),
  })).filter((b) => b.kapitel.length > 0);
  const stelle = einzeln ? KAPITEL.indexOf(einzeln) : -1;
  const zurueck = stelle > 0 ? KAPITEL[stelle - 1] : undefined;
  const weiter = stelle >= 0 ? KAPITEL[stelle + 1] : undefined;

  const rueckweg = geraet
    ? { pfad: GERAET_START_PFAD, label: 'Zum Gerät' }
    : benutzer
      ? { pfad: einsaetzePfad(), label: 'Zur App' }
      : { pfad: '/login', label: 'Zur Anmeldung' };

  // „/“ springt in die Suche, wie in der Doku der Website.
  useEffect(() => {
    function taste(e: KeyboardEvent) {
      const ziel = e.target as HTMLElement;
      if (e.key !== '/' || ziel.isContentEditable) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(ziel.tagName)) return;
      e.preventDefault();
      suchfeld.current?.focus();
    }
    window.addEventListener('keydown', taste);
    return () => window.removeEventListener('keydown', taste);
  }, []);

  // Gliederung des gezeigten Kapitels aus dem gerenderten Text: `##` rendert `Markdown` bei
  // `unterEbene={1}` als `h3.md-h2`, `###` als `h4.md-h3`.
  const kapitelText = useRef<HTMLDivElement>(null);
  const [gliederung, setGliederung] = useState<Gliederungspunkt[]>([]);
  const [aktiv, setAktiv] = useState(-1);
  useEffect(() => {
    const wurzel = kapitelText.current;
    if (!einzeln || !wurzel) {
      setGliederung([]);
      return;
    }
    const knoten = [...wurzel.querySelectorAll<HTMLElement>('.md-h2, .md-h3')];
    setGliederung(
      knoten.map((h) => ({
        text: h.textContent ?? '',
        ebene: h.classList.contains('md-h2') ? 2 : 3,
      })),
    );
    let geplant = 0;
    function markiere() {
      geplant = 0;
      let index = -1;
      knoten.forEach((h, i) => {
        if (h.getBoundingClientRect().top < 140) index = i;
      });
      setAktiv(index);
    }
    function beimRollen() {
      if (!geplant) geplant = requestAnimationFrame(markiere);
    }
    markiere();
    window.addEventListener('scroll', beimRollen, { passive: true });
    return () => {
      window.removeEventListener('scroll', beimRollen);
      if (geplant) cancelAnimationFrame(geplant);
    };
  }, [einzeln]);

  // Neues Kapitel: oben anfangen.
  useEffect(() => {
    if (slug !== undefined) window.scrollTo({ top: 0 });
  }, [slug]);

  function springeZu(index: number) {
    const knoten = kapitelText.current?.querySelectorAll<HTMLElement>('.md-h2, .md-h3')[index];
    knoten?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Kapitel-Links im Text wechseln in der Seite, statt sie neu zu laden. */
  function linkImText(e: MouseEvent<HTMLElement>) {
    if (e.defaultPrevented) return;
    const a = (e.target as HTMLElement).closest('a');
    const ziel = a?.getAttribute('href');
    if (!ziel?.startsWith('/hilfe')) return;
    e.preventDefault();
    void navigate(ziel);
  }

  const kapitelListe = (
    <>
      <Link
        className="hilfe-navi__start"
        to={hilfePfad({ gruppe })}
        aria-current={slug === undefined ? 'page' : undefined}
      >
        Alle Kapitel
      </Link>
      {bereiche.map((b) => (
        <details
          key={b.name}
          className="hilfe-navi__bereich"
          open={slug === undefined || woerter.length > 0 || b.name === bereichAktuell}
        >
          <summary>
            <span>{b.name}</span>
            <span className="hilfe-navi__zahl">{b.kapitel.length}</span>
          </summary>
          <ul className="hilfe-navi__liste">
            {b.kapitel.map((k) => (
              <li key={k.slug}>
                <Link
                  to={hilfePfad({ kapitel: k.slug, gruppe })}
                  aria-current={k.slug === slug ? 'page' : undefined}
                >
                  {k.titel}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ))}
      {liste.length === 0 && <p className="hilfe-navi__leer">Kein Treffer.</p>}
    </>
  );

  const inhaltsverzeichnis = (
    <ol className="hilfe-toc">
      {gliederung.map((g, i) => (
        <li key={`${i}-${g.text}`} className={`hilfe-toc__punkt hilfe-toc__punkt--${g.ebene}`}>
          <button
            type="button"
            aria-current={i === aktiv ? 'location' : undefined}
            onClick={() => springeZu(i)}
          >
            {g.text}
          </button>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="hilfe-seite">
      <header className="hilfe-kopf">
        <div className="hilfe-kopf__marke">
          <Bildmarke hoehe={18} linienFarbe="var(--lfh-text)" quadratFarbe="var(--lfh-marke)" />
          <span className="hilfe-kopf__name">lifeline-hub</span>
          <h1 className="hilfe-kopf__titel">Hilfe</h1>
        </div>
        <div className="hilfe-kopf__aktionen">
          <DruckKnopf ohneOrganisation gesperrt={gezeigt.length === 0} />
          <Button onClick={() => void navigate(rueckweg.pfad)}>{rueckweg.label}</Button>
        </div>
      </header>

      <div className="hilfe-rumpf">
        <nav className="hilfe-navi" aria-label="Kapitel">
          <div className="hilfe-navi__werkzeuge">
            <Input
              ref={suchfeld}
              type="search"
              allowClear
              placeholder="Kapitel durchsuchen"
              aria-label="Kapitel durchsuchen"
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
            />
            <Select<Gruppe>
              aria-label="Lesergruppe"
              className="hilfe-navi__gruppe"
              showSearch={false}
              value={gruppe}
              options={GRUPPEN.map((g) => ({ value: g.key, label: g.name }))}
              onChange={(g) => void navigate(hilfePfad({ gruppe: g }))}
            />
          </div>
          {breit ? (
            <div className="hilfe-navi__kapitel">{kapitelListe}</div>
          ) : (
            <details className="hilfe-navi__klappe" open={slug === undefined}>
              <summary>
                <span>Kapitel</span>
                <span className="hilfe-navi__ort">{bereichAktuell ?? gruppenName(gruppe)}</span>
              </summary>
              <div className="hilfe-navi__kapitel">{kapitelListe}</div>
            </details>
          )}
        </nav>

        <main className="hilfe-inhalt" onClick={linkImText}>
          {slug === undefined && liste.length > 0 && (
            <section className="hilfe-uebersicht" aria-label="Kapitel nach Bereichen">
              {bereiche.map((b) => (
                <div key={b.name} className="hilfe-bereich">
                  <h2 className="hilfe-bereich__titel">
                    <span className="hilfe-bereich__nummer">{b.nummer}</span>
                    {b.name}
                  </h2>
                  <ul className="hilfe-karten">
                    {b.kapitel.map((k) => (
                      <li key={k.slug}>
                        <Link className="hilfe-karte" to={hilfePfad({ kapitel: k.slug, gruppe })}>
                          <span className="hilfe-karte__titel">{k.titel}</span>
                          <span className="hilfe-karte__kurz">{kurztext(k.text)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <h2 className="hilfe-mappe__titel">
                Alle Kapitel am Stück
                <span className="hilfe-mappe__zahl">{liste.length}</span>
              </h2>
            </section>
          )}
          {slug === undefined && liste.length === 0 && (
            <div className="hilfe-leer">
              <p>Kein Kapitel passt zur Suche.</p>
              <Button onClick={() => setSuche('')}>Suche lösen</Button>
            </div>
          )}
          {slug !== undefined && gezeigt.length === 0 && (
            <SeitenLeer
              titel="Kapitel nicht gefunden"
              aktion={{ label: 'Alle Kapitel', pfad: hilfePfad({ gruppe }) }}
            />
          )}

          {einzeln && gliederung.length > 1 && !abBreite('xl') && (
            <details className="hilfe-inhaltsklappe">
              <summary>Auf dieser Seite</summary>
              {inhaltsverzeichnis}
            </details>
          )}

          <div className="hilfe-druckwurzel" data-lfh="druckwurzel" ref={kapitelText}>
            <div className="druckkopf--nur-druck hilfe-druckkopf">
              Lifeline Hub · Anwenderdokumentation · {einzeln ? einzeln.titel : gruppenName(gruppe)}{' '}
              · Version {__APP_VERSION__}
            </div>
            {gezeigt.map((k) => (
              <article key={k.slug} className="hilfe-kapitel" data-lfh="druck-kapitel">
                <p className="hilfe-kapitel__bereich">{bereichVon(k.reihenfolge)}</p>
                <Markdown
                  unterEbene={1}
                  titel={<h2 className="hilfe-kapitel__titel">{k.titel}</h2>}
                  bild={HilfeBild}
                >
                  {verlinke(k.text, (s) => hilfePfad({ kapitel: s, gruppe }))}
                </Markdown>
              </article>
            ))}
          </div>

          {einzeln && (zurueck || weiter) && (
            <nav className="hilfe-blaettern" aria-label="Kapitel blättern">
              {zurueck ? (
                <Link
                  className="hilfe-blaettern__link hilfe-blaettern__link--zurueck"
                  to={hilfePfad({ kapitel: zurueck.slug, gruppe })}
                >
                  <span className="hilfe-blaettern__richtung">← Zurück</span>
                  <span>{zurueck.titel}</span>
                </Link>
              ) : (
                <span />
              )}
              {weiter && (
                <Link
                  className="hilfe-blaettern__link hilfe-blaettern__link--weiter"
                  to={hilfePfad({ kapitel: weiter.slug, gruppe })}
                >
                  <span className="hilfe-blaettern__richtung">Weiter →</span>
                  <span>{weiter.titel}</span>
                </Link>
              )}
            </nav>
          )}
        </main>

        {einzeln && gliederung.length > 1 && abBreite('xl') && (
          <aside className="hilfe-rand" aria-label="Auf dieser Seite">
            <p className="hilfe-rand__titel">Auf dieser Seite</p>
            {inhaltsverzeichnis}
          </aside>
        )}
      </div>
    </div>
  );
}
