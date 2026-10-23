import { useEffect, useRef } from 'react';
import {
  ladeBenachrichtigung,
  ladeOffeneBenachrichtigungen,
  quittiereBenachrichtigung,
} from '../api/benachrichtigungen';
import { ApiError } from '../api/client';
import type { BenachrichtigungAnzeige, BenachrichtigungEreignis } from '../api/types';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import type { AnzeigeKonventionen } from '../anzeige/format';
import { zeitKurz } from '../anzeige/zeitDarstellung';
import {
  BENACHRICHTIGUNG_WINDOW_EVENT,
  NACHREICHEN_WINDOW_EVENT,
} from '../live/benachrichtigungListener';
import { spieleAlarmTon } from './alarmTon';
import {
  BENACHRICHTIGUNG_ARTEN,
  ersatzPfad,
  istOrgArt,
  sammelGruppeVon,
  toastSchluessel,
  zielVon,
} from './benachrichtigungKatalog';
import { gezeigt, inArbeit, quittiert } from './benachrichtigungGedaechtnis';
import { ladeMeldungInhalt, type MeldungInhalt } from './meldungInhalt';
import type { AlarmToastEintrag, AlarmToasts } from './useAlarmToasts';
import {
  eingangTon,
  merkeEingangTon,
  type EingangEintrag,
  type Eingangshinweis,
} from './useEingangshinweis';
import { schliessePushMeldungen } from './webPush';

/**
 * Quittiert auf dem Server; der Server meldet es allen Verbindungen des Nutzers (Spec
 * „Quittieren gilt für alle Verbindungen“). Scheitert der Aufruf, darf das Nachreichen sie
 * wieder zeigen: verloren ist dann nur ein Klick, nicht die Benachrichtigung.
 */
export function quittiereNachNutzer(id: number): void {
  if (quittiert.has(id)) return;
  quittiert.add(id);
  void schliessePushMeldungen(id);
  quittiereBenachrichtigung(id).catch(() => quittiert.delete(id));
}

type Bezug = Pick<BenachrichtigungEreignis, 'art' | 'einsatz_id'>;

/** Gehört die Benachrichtigung in diese Zentrale? Org-Arten überall, sonst nur im Einsatz. */
function passt(e: Bezug, einsatzId: number | null): boolean {
  return istOrgArt(e.art) || (einsatzId != null && e.einsatz_id === einsatzId);
}

/**
 * Ersatz, wenn der Text nicht zu holen war (Netz, Server): Name der Art und Sprung ins Modul. Ein
 * Alarm darf an einem langsamen Server nicht hängen bleiben.
 */
function ersatzAnzeige(e: BenachrichtigungEreignis): BenachrichtigungAnzeige {
  return {
    id: e.benachrichtigung_id,
    einsatz_id: e.einsatz_id,
    art: e.art,
    stufe: e.stufe,
    bezug_typ: e.bezug_typ,
    bezug_id: e.bezug_id,
    erstellt_at: '',
    titel: BENACHRICHTIGUNG_ARTEN[e.art]?.name ?? 'Benachrichtigung',
    pfad: ersatzPfad(e),
  };
}

/**
 * Der Toast einer Benachrichtigung. `inhalt` (LLH-1052, `meldungInhalt.ts`) ersetzt Titel und
 * Detailzeile des Servers durch Absender und Wortlautanfang der Meldung; was fehlt, bleibt beim
 * Server.
 */
function eintragVon(
  a: BenachrichtigungAnzeige,
  opts: { uhrzeit: string | null; desktop: boolean; inhalt?: MeldungInhalt | null },
): AlarmToastEintrag {
  const schluessel = toastSchluessel({ ...a, benachrichtigung_id: a.id });
  const anfang = opts.inhalt?.anfang ?? null;
  const beschreibung = [anfang ?? a.detail, opts.uhrzeit].filter(Boolean).join(' · ') || undefined;
  return {
    schluessel,
    art: a.stufe === 'alarm' ? 'warning' : 'info',
    titel: opts.inhalt?.titel ?? a.titel,
    beschreibung,
    beschreibungVoll: anfang ? (opts.inhalt?.wortlaut ?? undefined) : undefined,
    pfad: a.pfad,
    ziel: zielVon(a),
    gruppe: sammelGruppeVon(a.art),
    name: BENACHRICHTIGUNG_ARTEN[a.art]?.name ?? a.titel,
    stufe: a.stufe,
    benachrichtigungId: a.id,
    // `tag` `<einsatz>-<schlüssel>`: dieselbe Benachrichtigung ersetzt ihre OS-Meldung.
    desktop: opts.desktop ? { tag: `${a.einsatz_id}-${schluessel}` } : undefined,
  };
}

/**
 * Gehört die Benachrichtigung in den Eingangshinweis? Jeder Eingang des Einsatzes (Stufe
 * `hinweis`, LLH-1143 D7; bis dahin nur die Art `meldung`, LLH-1062). Org-Arten betreffen keinen
 * offenen Einsatz und bleiben Toasts.
 */
function istEingang(e: Pick<BenachrichtigungEreignis, 'art' | 'stufe'>): boolean {
  return e.stufe === 'hinweis' && !istOrgArt(e.art);
}

/**
 * Der Eintrag im Eingangshinweis: bei einer Meldung Absender und Wortlaut aus der Meldung, sonst
 * Titel und Detailzeile des Servers.
 */
function eingangVon(
  a: BenachrichtigungAnzeige,
  opts: { uhrzeit: string | null; inhalt: MeldungInhalt | null },
): EingangEintrag {
  const inhalt = opts.inhalt;
  const meldung = a.art === 'meldung';
  return {
    benachrichtigungId: a.id,
    einsatzId: a.einsatz_id,
    bezug: a.bezug_typ,
    bezugId: a.bezug_id,
    ziel: zielVon(a),
    titel: inhalt?.titel ?? a.titel,
    zeile: meldung ? (inhalt?.absender ?? a.detail ?? a.titel) : a.titel,
    anfang: inhalt?.anfang ?? (meldung ? undefined : (a.detail ?? undefined)),
    wortlaut: inhalt?.wortlaut ?? undefined,
    uhrzeit: opts.uhrzeit ?? undefined,
    pfad: a.pfad,
    // Ohne gelesenen Status kein „Sichten“: lieber ein Knopf zu wenig als einer ins Leere.
    neu: inhalt?.status === 'neu',
  };
}

/**
 * Benachrichtigungen in einer Zentrale (design.md D5). Hört auf das Live-Ereignis (über
 * `live/benachrichtigungListener.ts`), holt den Text (`GET /api/benachrichtigungen/{id}`), zeigt
 * den Toast im gemeinsamen Budget und spielt den Ton der Stufe; das Quittier-Ereignis nimmt ihn
 * weg. Eine fremde oder aufgeräumte Benachrichtigung (4xx) bleibt still.
 *
 * Nachreichen beim Mount (Öffnen eines Einsatzes, Org-Layout) und auf Bitte des Stroms (`lagged`,
 * Neuaufbau): die offene Liste, älteste zuerst, damit die jüngste einzeln stehen bleibt; mit
 * Uhrzeit, und für alles zusammen höchstens EIN dezenter Ton. Eine OS-Meldung nur für Alarme.
 *
 * `einsatzId` `null` ist die Org-Zentrale: nur Org-Arten.
 *
 * Eingänge des Einsatzes (Stufe `hinweis`) gehen ins Eingangsband (`eingang`, LLH-1062,
 * LLH-1143 D7), nicht ins Toast-Budget; ihr Ton ist gedrosselt. Die Toasts tragen Alarme und
 * Org-Arten. Ohne `eingang` (Org-Zentrale) gibt es keine Einsatz-Eingänge. Die Stufe `still`
 * steht nur im Verlauf.
 */
export function useBenachrichtigungen(
  einsatzId: number | null,
  toasts: AlarmToasts,
  eingang?: Eingangshinweis,
): void {
  // Über eine Ref: laden Zone oder Darstellung nach, soll das nicht noch einmal nachreichen.
  const konvRef = useRef<AnzeigeKonventionen>({});
  konvRef.current = useAnzeigeKonventionen().konventionen;

  useEffect(() => {
    let aktiv = true;

    const uhrzeitVon = (a: BenachrichtigungAnzeige): string | null => {
      // Rolle „kurz“ (LLH-1061): nachgereicht kann auch eine von gestern sein.
      return zeitKurz(a.erstellt_at, konvRef.current) || null;
    };

    const unbekannt = (id: number) =>
      !quittiert.has(id) && !inArbeit.has(id) && !toasts.zeigt(id) && !eingang?.zeigt(id);

    const beiEreignis = async (ev: Event) => {
      const e = (ev as CustomEvent<BenachrichtigungEreignis>).detail;
      if (!e) return;
      // Die Push-Meldung (LLH-1223) steht unabhängig davon, welche Zentrale sie zeigen würde.
      if (e.quittiert) void schliessePushMeldungen(e.benachrichtigung_id);
      if (!passt(e, einsatzId)) return;
      // Stufe still (LLH-1143, design.md D2): steht nur im Verlauf, kein Toast, kein Ton.
      if (e.stufe === 'still') return;
      const id = e.benachrichtigung_id;
      if (e.quittiert) {
        quittiert.add(id);
        toasts.entferneBenachrichtigung(id);
        eingang?.entferneBenachrichtigung(id);
        // „Alle gelesen“ (LLH-1143 D4): ein Ereignis für alle Eingänge bis dahin, nie für Alarme.
        if (e.gelesen_bis != null) eingang?.entferneBis(e.gelesen_bis);
        return;
      }
      if (!unbekannt(id)) return;
      inArbeit.add(id);
      // Der Inhalt der Meldung (LLH-1052) kommt parallel und mit eigener Frist; er wirft nie.
      const inhaltZusage = ladeMeldungInhalt(e);
      let anzeige: BenachrichtigungAnzeige;
      let inhalt: MeldungInhalt | null;
      try {
        try {
          anzeige = await ladeBenachrichtigung(id);
        } catch (fehler) {
          if (fehler instanceof ApiError && fehler.status < 500) return;
          anzeige = ersatzAnzeige(e);
        }
        inhalt = await inhaltZusage;
      } finally {
        inArbeit.delete(id);
      }
      if (!aktiv || quittiert.has(id) || anzeige.quittiert_at) return;
      if (eingang && istEingang(anzeige)) {
        if (
          eingang.melde(eingangVon(anzeige, { uhrzeit: null, inhalt }), {
            ton: true,
            desktop: true,
          }) === 'neu'
        ) {
          gezeigt.add(id);
        }
        return;
      }
      const ergebnis = toasts.melde(eintragVon(anzeige, { uhrzeit: null, desktop: true, inhalt }));
      if (ergebnis === 'inaktiv') return;
      gezeigt.add(id);
      if (ergebnis === 'neu') spieleAlarmTon(e.stufe === 'alarm' ? 'alarm' : 'dezent');
    };

    // Ein Abruf zur Zeit; eine Bitte währenddessen holt danach noch einmal.
    let laeuft = false;
    let nochmal = false;
    const nachreichen = async () => {
      if (laeuft) {
        nochmal = true;
        return;
      }
      laeuft = true;
      try {
        do {
          nochmal = false;
          let liste: BenachrichtigungAnzeige[];
          try {
            liste = await ladeOffeneBenachrichtigungen();
          } catch {
            return;
          }
          if (!aktiv) return;
          // Der Server liefert jüngste zuerst.
          const offen = [...liste]
            .reverse()
            .filter((a) => !a.quittiert_at && passt(a, einsatzId) && unbekannt(a.id));
          // Die Inhalte (LLH-1052) zusammen holen, je mit Frist: ein Abruf je offenem Alarm.
          const inhalte = await Promise.all(offen.map((a) => ladeMeldungInhalt(a)));
          if (!aktiv) return;
          let ton = false;
          let eingangNeu = false;
          for (const [i, a] of offen.entries()) {
            // Während der Inhalte kann sie live gekommen oder quittiert worden sein.
            if (!unbekannt(a.id)) continue;
            const wiederholt = gezeigt.has(a.id);
            if (eingang && istEingang(a)) {
              const e = eingangVon(a, { uhrzeit: uhrzeitVon(a), inhalt: inhalte[i] });
              if (eingang.melde(e, { ton: false, desktop: false }) !== 'neu') continue;
              if (!wiederholt) eingangNeu = true;
              gezeigt.add(a.id);
              continue;
            }
            const ergebnis = toasts.melde(
              eintragVon(a, {
                uhrzeit: uhrzeitVon(a),
                desktop: !wiederholt && a.stufe === 'alarm',
                inhalt: inhalte[i],
              }),
            );
            if (ergebnis === 'inaktiv') return;
            gezeigt.add(a.id);
            if (ergebnis === 'neu' && !wiederholt) ton = true;
          }
          // Für alles zusammen höchstens EIN dezenter Ton; der Eingang zählt ihn in seine Drossel.
          if (ton) {
            spieleAlarmTon('dezent');
            merkeEingangTon();
          } else if (eingangNeu) {
            eingangTon();
          }
        } while (nochmal && aktiv);
      } finally {
        laeuft = false;
      }
    };

    const beiNachreichen = () => void nachreichen();
    window.addEventListener(BENACHRICHTIGUNG_WINDOW_EVENT, beiEreignis);
    window.addEventListener(NACHREICHEN_WINDOW_EVENT, beiNachreichen);
    void nachreichen();
    return () => {
      aktiv = false;
      window.removeEventListener(BENACHRICHTIGUNG_WINDOW_EVENT, beiEreignis);
      window.removeEventListener(NACHREICHEN_WINDOW_EVENT, beiNachreichen);
    };
  }, [einsatzId, toasts, eingang]);
}
