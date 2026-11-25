import { useState } from 'react';
import { Button } from 'antd';
import { Stapel, Textstufe, monoStil } from '../components/instrument';
import { helferAppLink } from '../routing/deeplinks';
import { codeGruppiert } from '../pages/einstellungen/geraeteKern';
import { GeraeteKarte } from './GeraeteKarte';

/**
 * Weiche der Helfer-App im Browser (`/helfer#<CODE>`, Spec
 * `docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`, „Oberfläche“): die Kamera
 * öffnet den QR der Einladung hier, wenn die App „Lifeline Helfer“ ihn nicht selbst annimmt.
 *
 * Die Seite bietet „In Lifeline Helfer öffnen“ (`lifeline-helfer://anmelden?server=…#CODE`) und
 * die Download-Wege an. Sie löst den Code nicht ein, fragt den Server nichts und ortet nicht:
 * angemeldet wird nur in der App. Der Code bleibt im Fragment (der Browser schickt es nie an den
 * Server), damit derselbe Link nach der Installation noch einmal trägt.
 */

function codeAusFragment(): string {
  const roh = window.location.hash.replace(/^#/, '').trim();
  try {
    return decodeURIComponent(roh);
  } catch {
    return roh;
  }
}

export default function HelferWeichePage() {
  // Einmal beim ersten Rendern lesen.
  const [code] = useState(codeAusFragment);

  return (
    <GeraeteKarte untertitel="Lifeline Helfer">
      <Stapel abstand="md">
        {code ? (
          <>
            <Textstufe als="p">
              {'Einladung zum Einsatz mit dem Code '}
              <span data-lfh="helfer-code" style={monoStil('monoGross')}>
                {codeGruppiert(code)}
              </span>
            </Textstufe>
            <Button
              type="primary"
              size="large"
              block
              href={helferAppLink(window.location.origin, code)}
            >
              In Lifeline Helfer öffnen
            </Button>
          </>
        ) : (
          <Textstufe als="p">
            Diese Seite öffnet eine Einladung der Einsatzleitung. Bitte den QR-Code erneut scannen.
          </Textstufe>
        )}
        <Stapel abstand="xs" aria-label="App laden">
          <Textstufe stufe="kartentitel" als="h2">
            Noch keine App?
          </Textstufe>
          <Textstufe ton="gedaempft">iPhone: über TestFlight</Textstufe>
          <Textstufe ton="gedaempft">Android: APK von der Einsatzleitung</Textstufe>
          <Textstufe ton="gedaempft">Danach den QR-Code noch einmal scannen.</Textstufe>
        </Stapel>
      </Stapel>
    </GeraeteKarte>
  );
}
