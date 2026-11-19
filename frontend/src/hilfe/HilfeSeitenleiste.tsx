import { useEffect, useId, useRef } from 'react';
import type { MouseEvent } from 'react';
import { Drawer, theme } from 'antd';
import { Link, useLocation, useNavigate } from 'react-router';
import Markdown from '../components/Markdown';
import Tastenkuerzel from '../components/Tastenkuerzel';
import { Segmentleiste } from '../components/instrument';
import { useViewport } from '../components/useViewport';
import { istApplePlattform } from '../command-palette/befehle';
import { modulAusPfad } from '../einsatz/modulRegistry';
import { hilfePfad } from '../routing/deeplinks';
import HilfeBild from './HilfeBild';
import { LEISTE_KLASSE, useHilfeSeitenleiste, type HilfeReiter } from './HilfeSeitenleisteProvider';
import { RUECKFALL_KAPITEL, kapitelFuerPfad } from './kontextKapitel';
import { findeKapitel, verlinke } from './kapitel';
import { kuerzelGruppen } from './tastenkuerzel';
import './Hilfe.css';

/** Breite ab `lg` mit Maus (`frontend/AGENTS.md`, UI-Form-Leitlinie, Hilfe-Seitenleiste). */
const LEISTE_BREITE = 480;

/**
 * Die Hilfe-Seitenleiste (LLH-1824): rechts neben der Arbeit das Kapitel zur aktuellen Seite und,
 * mit Tastatur, die Übersicht der Tastenkürzel. Nur lesen; die volle Hilfe bleibt `/hilfe/<kapitel>`.
 * Liegt im Hilfe-Chunk (lazy aus `HilfeSeitenleisteProvider`), weil sie die Kapiteltexte lädt.
 */
export default function HilfeSeitenleiste() {
  const { offen, reiter, setzeReiter, schliesse } = useHilfeSeitenleiste();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { istBeruehrung, abBreite } = useViewport();
  const { token } = theme.useToken();
  const seiteId = useId();
  const kuerzelId = useId();
  const koerper = useRef<HTMLDivElement>(null);

  const slug = kapitelFuerPfad(pathname);
  const kapitel = findeKapitel(slug) ?? findeKapitel(RUECKFALL_KAPITEL)!;
  const mitReitern = !istBeruehrung;
  const gezeigt: HilfeReiter = mitReitern ? reiter : 'seite';
  const breit = abBreite('lg') && !istBeruehrung;
  const imNeuenTab = breit;

  // Neues Kapitel: von oben lesen.
  useEffect(() => {
    const rolle = koerper.current?.closest('.ant-drawer-body');
    if (rolle) rolle.scrollTop = 0;
  }, [kapitel.slug, gezeigt]);

  /** Kapitel-Links im Text öffnen die volle Hilfe und schließen die Leiste. */
  function linkImText(e: MouseEvent<HTMLElement>) {
    if (e.defaultPrevented) return;
    const ziel = (e.target as HTMLElement).closest('a')?.getAttribute('href');
    if (!ziel?.startsWith('/hilfe')) return;
    e.preventDefault();
    schliesse();
    void navigate(ziel, { state: { von: pathname } });
  }

  const kuerzel = kuerzelGruppen(
    istApplePlattform(navigator.userAgent),
    modulAusPfad(pathname)?.key ?? null,
  );

  return (
    <Drawer
      open={offen}
      onClose={schliesse}
      placement="right"
      size={breit ? LEISTE_BREITE : '100%'}
      rootClassName={LEISTE_KLASSE}
      // Neben der Arbeit, nicht modal: ohne Maske bleibt die Seite bedienbar (Entwurf, Anti-Ziele).
      mask={false}
      title={kapitel.titel}
      // Den Fokus gibt der Provider zurück (auch an ein Eingabefeld nach F1).
      focusable={{ focusTriggerAfterClose: false }}
    >
      <div ref={koerper} className="hilfe-seitenleiste">
        {mitReitern && (
          <Segmentleiste<HilfeReiter>
            rolle="tablist"
            beschriftung="Inhalt der Hilfe"
            hasFullWidth
            optionen={[
              { wert: 'seite', label: 'Zu dieser Seite', steuert: seiteId },
              { wert: 'kuerzel', label: 'Tastenkürzel', steuert: kuerzelId },
            ]}
            wert={gezeigt}
            onWechsel={setzeReiter}
            style={{ marginBlockEnd: token.marginMD }}
          />
        )}

        {gezeigt === 'seite' ? (
          <div
            id={seiteId}
            role={mitReitern ? 'tabpanel' : undefined}
            onClick={linkImText}
            className="hilfe-kapitel"
          >
            <Markdown unterEbene={1} bild={HilfeBild}>
              {verlinke(kapitel.text, (s) => hilfePfad({ kapitel: s }))}
            </Markdown>
            <p style={{ display: 'flex', gap: token.marginMD, flexWrap: 'wrap' }}>
              {imNeuenTab ? (
                <a
                  href={hilfePfad({ kapitel: kapitel.slug, von: pathname })}
                  target="_blank"
                  rel="noopener"
                >
                  In der Hilfe öffnen
                </a>
              ) : (
                <Link
                  to={hilfePfad({ kapitel: kapitel.slug })}
                  state={{ von: pathname }}
                  onClick={schliesse}
                >
                  In der Hilfe öffnen
                </Link>
              )}
              <Link to={hilfePfad()} state={{ von: pathname }} onClick={schliesse}>
                Alle Kapitel
              </Link>
            </p>
          </div>
        ) : (
          <div id={kuerzelId} role="tabpanel">
            {kuerzel.map((g) => (
              <section key={g.titel} style={{ marginBlockEnd: token.marginLG }}>
                <h3 style={{ fontSize: token.fontSizeLG, marginBlock: token.marginXS }}>
                  {g.titel}
                </h3>
                <dl
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'max-content 1fr',
                    columnGap: token.marginMD,
                    rowGap: token.marginXS,
                    margin: 0,
                  }}
                >
                  {g.eintraege.map((e) => (
                    <div key={e.wirkung} style={{ display: 'contents' }}>
                      <dt style={{ display: 'flex', gap: token.marginXXS, flexWrap: 'wrap' }}>
                        {e.tasten.map((t) => (
                          <Tastenkuerzel key={t}>{t}</Tastenkuerzel>
                        ))}
                      </dt>
                      <dd style={{ margin: 0 }}>{e.wirkung}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        )}
      </div>
    </Drawer>
  );
}
