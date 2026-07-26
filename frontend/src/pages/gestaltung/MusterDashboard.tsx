/**
 * LFH-352 · Sandbox — die gemeinsame Struktur der drei Gestaltungsvarianten.
 *
 * Bewusst EINE Komponente für alle drei Richtungen: die Varianten unterscheiden
 * sich in Schriftpaarung, Flächenwirkung und Formensprache, nicht im Aufbau. So
 * ist der Vergleich ehrlich (gleiche Daten, gleiche Struktur), und das Ergebnis
 * ist bereits token-förmig — genau die Übergabe, die A2 (LFH-328) braucht.
 *
 * Keine antd-Komponenten: sie bringen ihre eigene Formensprache mit und würden
 * genau das verdecken, worüber hier entschieden wird.
 *
 * Wegwerf-Gerüst — verschwindet mit der Sandbox nach der Richtungsentscheidung.
 */
import type { Datenzustand, Dringlichkeit, Lagebild } from './lagebild';

interface Props {
  lagebild: Lagebild;
  zustand: Datenzustand;
  dtg: string;
}

function Plakette({ stufe, children }: { stufe: Dringlichkeit; children: React.ReactNode }) {
  return <span className={`gs-plakette gs-plakette--${stufe}`}>{children}</span>;
}

function Kachel(props: {
  titel: string;
  mehr?: string;
  zustand: Datenzustand;
  leerText: string;
  leerAktion: string;
  kinder: React.ReactNode;
  spanne?: boolean;
}) {
  const { titel, mehr = 'Öffnen', zustand, leerText, leerAktion, kinder, spanne } = props;
  return (
    <section className={`gs-kachel${spanne ? ' gs-kachel--breit' : ''}`}>
      <header className="gs-kachel__kopf">
        <span className="gs-marke__strich" aria-hidden="true" />
        <h2 className="gs-kachel__titel">{titel}</h2>
        <span className="gs-kachel__mehr">{mehr}</span>
      </header>
      <div className="gs-kachel__leib">
        {zustand === 'laden' && (
          <div className="gs-skelett" aria-busy="true" aria-label="wird geladen">
            <span className="gs-skelett__balken gs-skelett__balken--gross" />
            <span className="gs-skelett__balken" />
            <span className="gs-skelett__balken gs-skelett__balken--kurz" />
          </div>
        )}
        {/* Fehler und Leer sind bewusst UNTERSCHIEDLICH gestaltet — der Sweep-Befund
            lautet „Fehler sieht aus wie leer"; wer daraus eine Lage funkt, funkt falsch. */}
        {zustand === 'fehler' && (
          <div className="gs-fehler" role="alert">
            <span className="gs-fehler__zeichen" aria-hidden="true">
              !
            </span>
            <div>
              <b className="gs-fehler__titel">Daten nicht abrufbar</b>
              <p className="gs-fehler__text">
                Stand unbekannt — nicht als Lage melden. Letzter Abruf fehlgeschlagen.
              </p>
              <button type="button" className="gs-knopf">
                Erneut abrufen
              </button>
            </div>
          </div>
        )}
        {zustand === 'leer' && (
          <div className="gs-leer">
            <p className="gs-leer__text">{leerText}</p>
            <button type="button" className="gs-knopf">
              {leerAktion}
            </button>
          </div>
        )}
        {zustand === 'daten' && kinder}
      </div>
    </section>
  );
}

export default function MusterDashboard({ lagebild: l, zustand, dtg }: Props) {
  const zeigeDaten = zustand === 'daten';

  return (
    <div className="gs-flaeche">
      {/* ── Signatur-Element: Instrumentenband ────────────────────────────────
          Die Größen, die im Einsatz nie fehlen dürfen — immer sichtbar, immer
          an derselben Stelle (nimmt LFH-294 auf). */}
      <header className="gs-band">
        <div className="gs-marke">
          <span className="gs-marke__strich" aria-hidden="true" />
          <span className="gs-marke__name">LIFELINE HUB</span>
        </div>
        <div className="gs-band__wert">
          <span className="gs-etikett">Einsatz</span>
          <b className="gs-band__einsatz">{zeigeDaten ? l.bezeichnung : '—'}</b>
        </div>
        <div className="gs-band__wert">
          <span className="gs-etikett">DTG</span>
          <b className="gs-zahl">{dtg}</b>
        </div>
        <div className="gs-band__wert">
          <span className="gs-etikett">Gesamtstärke</span>
          <b className="gs-zahl">{zeigeDaten ? l.staerke : '—/—/—//—'}</b>
        </div>
        <div className="gs-band__verbindung">
          <span
            className={`gs-puls gs-puls--${zustand === 'fehler' ? 'alarm' : 'normal'}`}
            aria-hidden="true"
          />
          <span className="gs-etikett">
            {zustand === 'fehler' ? 'Verbindung gestört' : 'Live verbunden'}
          </span>
        </div>
      </header>

      {/* ── Kennzahlenleiste: Wortlaut statt nackter Zähler ──────────────────── */}
      <div className="gs-kennzahlen">
        {l.kennzahlen.map((k) => (
          <button
            type="button"
            key={k.etikett}
            className={`gs-kz${k.stufe && k.stufe !== 'normal' ? ` gs-kz--${k.stufe}` : ''}`}
          >
            <span className="gs-etikett">{k.etikett}</span>
            {zustand === 'laden' ? (
              <b className="gs-zahl gs-zahl--gross gs-zahl--wartet">····</b>
            ) : zustand === 'fehler' ? (
              <b className="gs-zahl gs-zahl--gross gs-zahl--unbekannt" title="Stand unbekannt">
                ?
              </b>
            ) : (
              <b className="gs-zahl gs-zahl--gross">{k.wert}</b>
            )}
            <span className="gs-zusatz">
              {zustand === 'fehler'
                ? 'Stand unbekannt'
                : zustand === 'laden'
                  ? 'wird abgerufen'
                  : k.zusatz}
            </span>
          </button>
        ))}
      </div>

      {/* ── Kachelraster ──────────────────────────────────────────────────────── */}
      <div className="gs-raster">
        <Kachel
          titel="Betroffene"
          mehr="Personenliste"
          zustand={zustand}
          leerText="Noch keine Personen erfasst."
          leerAktion="Person aufnehmen"
          kinder={
            <>
              <div className="gs-sichtung">
                {l.sichtung.map((s) => (
                  <div
                    key={s.etikett}
                    className={`gs-sichtung__feld gs-sichtung__feld--${s.stufe}`}
                  >
                    <span className="gs-etikett">{s.etikett}</span>
                    <b className="gs-zahl gs-zahl--mittel">{s.wert}</b>
                  </div>
                ))}
              </div>
              <p className="gs-fussnote">
                {l.betroffeneGesamt} erfasst
                {l.vermisst > 0 && (
                  <>
                    {' · '}
                    <Plakette stufe="alarm">{l.vermisst} vermisst</Plakette>
                  </>
                )}
              </p>
            </>
          }
        />

        <Kachel
          titel="Kräfte"
          mehr="Meldebild"
          zustand={zustand}
          leerText="Noch keine Kräfte disponiert."
          leerAktion="Einheit alarmieren"
          kinder={
            <>
              <b className="gs-zahl gs-staerke">{l.staerke}</b>
              <p className="gs-fussnote">Führer / Unterführer / Mannschaft // Gesamt</p>
              <dl className="gs-werte">
                <div>
                  <dt className="gs-etikett">Einheiten</dt>
                  <dd className="gs-zahl">{l.einheiten}</dd>
                </div>
                <div>
                  <dt className="gs-etikett">Abschnitte</dt>
                  <dd className="gs-zahl">{l.abschnitte}</dd>
                </div>
                <div>
                  <dt className="gs-etikett">Fahrzeuge gebunden</dt>
                  <dd className="gs-zahl">
                    {l.fahrzeugeGebunden}/{l.fahrzeugeGesamt}
                  </dd>
                </div>
              </dl>
            </>
          }
        />

        <Kachel
          titel="Infrastruktur"
          mehr="Übersicht"
          zustand={zustand}
          leerText="Noch keine Einrichtungen oder Schäden erfasst."
          leerAktion="UHS anlegen"
          kinder={
            <dl className="gs-werte gs-werte--liste">
              <div>
                <dt className="gs-etikett">UHS aktiv</dt>
                <dd className="gs-zahl">
                  {l.uhsAktiv}/{l.uhsGesamt}
                </dd>
              </div>
              <div>
                <dt className="gs-etikett">Schäden offen</dt>
                <dd className="gs-zahl">
                  {l.schaedenOffen}/{l.schaedenGesamt}
                </dd>
              </div>
              <div>
                <dt className="gs-etikett">Tiere aktiv</dt>
                <dd className="gs-zahl">{l.tiereAktiv}</dd>
              </div>
              <div>
                <dt className="gs-etikett">Lagezonen</dt>
                <dd className="gs-zahl">{l.zonen}</dd>
              </div>
            </dl>
          }
        />

        <Kachel
          titel="Aktueller Lagebericht"
          mehr="Berichte"
          zustand={l.bericht === null && zustand === 'daten' ? 'leer' : zustand}
          leerText="Noch kein Lagebericht erstellt."
          leerAktion="Lagebericht schreiben"
          kinder={
            l.bericht && (
              <>
                <b className="gs-berichtstitel">{l.bericht.titel}</b>
                <p className="gs-fussnote">
                  <Plakette stufe={l.bericht.status === 'freigegeben' ? 'normal' : 'achtung'}>
                    {l.bericht.status}
                  </Plakette>
                  {' · Stand '}
                  <span className="gs-zahl">{l.bericht.stand}</span>
                </p>
                <p className="gs-fussnote">von {l.bericht.von}</p>
              </>
            )
          }
        />

        <Kachel
          titel="Aufträge / Befehle"
          mehr="Auftragsliste"
          zustand={zustand}
          leerText="Keine Aufträge erteilt."
          leerAktion="Auftrag erteilen"
          kinder={
            <>
              <b className="gs-zahl gs-zahl--gross">{l.auftraegeOffen}</b>
              <p className="gs-fussnote">offen oder in Arbeit</p>
              {l.auftraegeUeberfaellig > 0 && (
                <p className="gs-fussnote">
                  <Plakette stufe="alarm">{l.auftraegeUeberfaellig} überfällig</Plakette>
                </p>
              )}
            </>
          }
        />

        <Kachel
          titel="Meldungen (eingehend)"
          mehr="Meldebuch"
          zustand={zustand}
          leerText="Keine Meldungen eingegangen."
          leerAktion="Meldung erfassen"
          spanne
          kinder={
            <>
              <div className="gs-zaehlzeile">
                <span>
                  <b className="gs-zahl gs-zahl--mittel">{l.meldungenOffen}</b>{' '}
                  <span className="gs-etikett">offen</span>
                </span>
                <span>
                  <b className="gs-zahl gs-zahl--mittel">{l.meldungenNeu}</b>{' '}
                  <span className="gs-etikett">neu</span>
                </span>
                {l.meldungenUeberfaellig > 0 && (
                  <Plakette stufe="alarm">{l.meldungenUeberfaellig} überfällig</Plakette>
                )}
              </div>
              <ul className="gs-zeilen">
                {l.ereignisse.length === 0 && (
                  <li className="gs-fussnote">Keine Meldungen im aktuellen Fenster.</li>
                )}
                {l.ereignisse.map((e, i) => (
                  <li className="gs-zeile" key={`${e.zeit}-${i}`}>
                    <span className={`gs-marker gs-marker--${e.stufe}`} aria-hidden="true" />
                    <time className="gs-zahl">{e.zeit}</time>
                    <span className="gs-zeile__text">{e.text}</span>
                    <span className="gs-zeile__von">{e.von}</span>
                  </li>
                ))}
              </ul>
            </>
          }
        />
      </div>
    </div>
  );
}
