import { Button, Input, Menu } from 'antd';
import type { MouseEvent } from 'react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import Markdown from '../components/Markdown';
import { Select } from '../components/Select';
import { SeitenLeer } from '../components/SeitenZustand';
import DruckKnopf from '../components/druck/DruckKnopf';
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

/**
 * Hilfe (LFH-1096, Spec `anwenderdoku`, `docs/anwender/AGENTS.md`).
 *
 * Zeigt die Kapitel aus `docs/anwender/kapitel/`. Ohne Kapitel in der Adresse liegt oben die
 * Übersicht nach Bereichen (Karten mit Kurztext), darunter stehen die Kapitel der Lesergruppe
 * hintereinander: das ist zugleich die Einweisungsmappe zum Drucken. Die Suche filtert Navigation,
 * Übersicht und Mappe gemeinsam; Kapitel enden mit Zurück/Weiter.
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
  const gruppe = parseHilfeGruppe(params);
  const [suche, setSuche] = useState('');
  const begriff = suche.trim().toLowerCase();
  const liste = kapitelDerGruppe(gruppe).filter(
    (k) => !begriff || `${k.titel} ${kurztext(k.text)}`.toLowerCase().includes(begriff),
  );
  const einzeln = findeKapitel(slug);
  const gezeigt: Kapitel[] = slug === undefined ? liste : einzeln ? [einzeln] : [];
  const bereiche = BEREICHE.map((name) => ({
    name,
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

  /** Kapitel-Links im Text wechseln in der Seite, statt sie neu zu laden. */
  function linkImText(e: MouseEvent<HTMLElement>) {
    if (e.defaultPrevented) return;
    const a = (e.target as HTMLElement).closest('a');
    const ziel = a?.getAttribute('href');
    if (!ziel?.startsWith('/hilfe')) return;
    e.preventDefault();
    void navigate(ziel);
  }

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
          <Select<Gruppe>
            aria-label="Lesergruppe"
            className="hilfe-navi__gruppe"
            showSearch={false}
            value={gruppe}
            options={GRUPPEN.map((g) => ({ value: g.key, label: g.name }))}
            onChange={(g) => void navigate(hilfePfad({ gruppe: g }))}
          />
          <Input
            type="search"
            allowClear
            placeholder="Kapitel suchen"
            aria-label="Kapitel suchen"
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
          />
          <Menu
            mode="inline"
            selectedKeys={[slug ?? '']}
            items={[
              { key: '', label: 'Alle Kapitel' },
              ...bereiche.map((b) => ({
                type: 'group' as const,
                key: `bereich-${b.name}`,
                label: b.name,
                children: b.kapitel.map((k) => ({ key: k.slug, label: k.titel })),
              })),
            ]}
            onClick={({ key }) => void navigate(hilfePfad({ kapitel: key || undefined, gruppe }))}
          />
        </nav>

        <main className="hilfe-inhalt" data-lfh="druckwurzel" onClick={linkImText}>
          <div className="druckkopf--nur-druck hilfe-druckkopf">
            Lifeline Hub · Anwenderdokumentation · {einzeln ? einzeln.titel : gruppenName(gruppe)} ·
            Version {__APP_VERSION__}
          </div>
          {slug === undefined && liste.length > 0 && (
            <section className="hilfe-uebersicht" aria-label="Kapitel nach Bereichen">
              {bereiche.map((b) => (
                <div key={b.name} className="hilfe-bereich">
                  <h3 className="hilfe-bereich__titel">{b.name}</h3>
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
      </div>
    </div>
  );
}
