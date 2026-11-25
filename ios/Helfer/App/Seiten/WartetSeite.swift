import HelferKern
import SwiftUI
import UIKit

/// Großer, ruhiger Zustand oben auf „Wartet“ und „Angemeldet“: Punkt, Zustandszeile, Erklärung.
struct Zustandsbuehne: View {
    let augenbraue: String
    let zustand: String
    let erklaerung: String
    let farbe: Color
    let flaeche: Color
    var pulsiert = true

    var body: some View {
        VStack(alignment: .leading, spacing: LifelineAbstand.abstandKomfortabelSm) {
            HStack(alignment: .center, spacing: LifelineAbstand.abstandKomfortabelSm) {
                Statuspunkt(farbe: farbe, pulsiert: pulsiert)
                Augenbraue(augenbraue, farbe: farbe)
            }
            Text(zustand)
                .schrift(Stil.zustand, relativeTo: .largeTitle)
                .foregroundStyle(Farbe.text)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("zustand")
            Text(erklaerung)
                .schrift(Stil.text, relativeTo: .body)
                .foregroundStyle(Farbe.text2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(LifelineAbstand.abstandKomfortabelMd)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(flaeche, in: eckig)
        .overlay(alignment: .top) { Rectangle().fill(farbe).frame(height: 3) }
        .accessibilityElement(children: .combine)
    }
}

/// Bildschirm 3 „Wartet“ (Spec „Bildschirme“): Name des Einsatzes, „Die Einsatzleitung bestätigt
/// dich gleich“, Ortung schon an (sichtbar), „Abbrechen“. Das Ziel lässt sich hier noch ändern.
struct WartetSeite: View {
    @Bindable var modell: HelferModell
    @State private var zielWaehlen = false

    var body: some View {
        Seite {
            Seitenkopf(untertitel: modell.servername)
            Zustandsbuehne(
                augenbraue: "Wartet auf Bestätigung",
                zustand: modell.einsatzname,
                erklaerung: "Die Einsatzleitung bestätigt dich gleich. Du kannst das Handy schon einstecken.",
                farbe: Farbe.achtung, flaeche: Farbe.achtungFlaeche)
            VStack(alignment: .leading, spacing: LifelineAbstand.abstandKomfortabelSm) {
                Wertzeile(bezeichnung: "Ziel", wert: modell.zielname, symbol: "scope")
                Wertzeile(bezeichnung: "Name", wert: modell.anzeigename, symbol: "person")
                Wertzeile(
                    bezeichnung: "Ortung", wert: modell.ortungLaeuft ? "an" : "aus",
                    symbol: "location.fill")
            }
            .karte()
            OrtungsHinweise(modell: modell)
            VStack(spacing: LifelineAbstand.abstandKomfortabelSm) {
                if modell.kannZielAendern {
                    Button("Ziel ändern") { zielWaehlen = true }
                        .buttonStyle(Nebenknopfstil())
                        .accessibilityIdentifier("ziel-aendern")
                }
                Button("Abbrechen", role: .destructive) {
                    Task { await modell.abmelden() }
                }
                .buttonStyle(Nebenknopfstil(farbe: Farbe.alarmText))
                .accessibilityIdentifier("abbrechen")
            }
        }
        .sheet(isPresented: $zielWaehlen) {
            NavigationStack {
                Seite {
                    Augenbraue("Ziel ändern")
                    if let liste = modell.zielliste {
                        Zielauswahl(optionen: liste.targets, gewaehlt: modell.gewaehltesZiel) {
                            option in
                            Task {
                                await modell.zielAendern(option)
                                zielWaehlen = false
                            }
                        }
                    } else {
                        ProgressView().task { await modell.ladeZiele() }
                    }
                }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Abbrechen") { zielWaehlen = false }
                    }
                }
            }
            .presentationDetents([.medium, .large])
        }
    }
}

/// Hinweise zur Ortung: nicht erlaubt, oder nach einem Neustart der App noch nicht wieder an.
struct OrtungsHinweise: View {
    @Bindable var modell: HelferModell

    var body: some View {
        if modell.ortungVerweigert {
            VStack(alignment: .leading, spacing: LifelineAbstand.abstandKomfortabelSm) {
                Hinweis(
                    text: "Die Ortung ist nicht erlaubt. Erlaube sie unter Einstellungen → Lifeline Helfer → Standort → „Beim Verwenden der App“.",
                    farbe: Farbe.alarmText, flaeche: Farbe.alarmFlaeche)
                if let einstellungen = URL(string: UIApplication.openSettingsURLString) {
                    Link("Einstellungen öffnen", destination: einstellungen)
                        .buttonStyle(Nebenknopfstil())
                }
            }
        } else if modell.phase.ortet && !modell.ortungLaeuft {
            VStack(alignment: .leading, spacing: LifelineAbstand.abstandKomfortabelSm) {
                Hinweis(text: "Die App wurde neu gestartet. Die Ortung läuft erst wieder, wenn du sie startest.")
                Button {
                    Task { await modell.ortungWiederStarten() }
                } label: {
                    Label("Ortung wieder starten", systemImage: "location.fill")
                }
                .buttonStyle(Hauptknopfstil(rolle: .normal))
                .accessibilityIdentifier("ortung-starten")
            }
        }
    }
}
