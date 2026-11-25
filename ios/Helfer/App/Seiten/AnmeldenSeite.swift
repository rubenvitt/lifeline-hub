import HelferKern
import SwiftUI

/// Bildschirm 2 „Anmelden“ (Spec „Bildschirme“): Server, Anzeigename, Ziel aus der Liste
/// (Einheiten und Fahrzeuge mit Rufname und taktischem Zeichen), „Mich als Person orten“ nur, wenn
/// die Organisation es erlaubt, Einwilligungssatz, „Anmelden und Ortung erlauben“.
struct AnmeldenSeite: View {
    @Bindable var modell: HelferModell

    var body: some View {
        Seite {
            Seitenkopf(untertitel: modell.servername)
            VStack(alignment: .leading, spacing: LifelineAbstand.abstandKomfortabelSm) {
                Augenbraue("Anmelden")
                Text("Wer bist du, und mit wem bist du unterwegs?")
                    .schrift(Stil.titel, relativeTo: .largeTitle)
                    .foregroundStyle(Farbe.text)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Eingabefeld(
                titel: "Anzeigename", text: $modell.anzeigename, beispiel: "Max M., San-Trupp 2",
                kennung: "anzeigename"
            )
            .textContentType(.name)
            zielauswahl
            if modell.zielliste?.personTrackingAllowed == true {
                Toggle(isOn: $modell.personOrten) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Mich als Person orten")
                            .schrift(Stil.text, relativeTo: .body)
                            .foregroundStyle(Farbe.text)
                        Text("Die Einsatzleitung ordnet dich beim Bestätigen einer Kraft zu.")
                            .schrift(Stil.klein, relativeTo: .subheadline)
                            .foregroundStyle(Farbe.gedaempft)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .tint(Farbe.normal)
                .karte()
                .accessibilityIdentifier("person-orten")
            }
            Text(
                "Mit dem Anmelden sendet Lifeline Helfer deine Position an die Einsatzleitung, auch bei gesperrtem Bildschirm, bis du dich abmeldest, pausierst oder der Einsatz endet. Gespeichert wird nur die letzte Position."
            )
            .schrift(Stil.klein, relativeTo: .footnote)
            .foregroundStyle(Farbe.text2)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("einwilligung")
            if let meldung = modell.meldung {
                Hinweis(text: meldung)
            }
            VStack(spacing: LifelineAbstand.abstandKomfortabelSm) {
                Button {
                    Task { await modell.anmelden() }
                } label: {
                    HStack(spacing: LifelineAbstand.abstandKomfortabelSm) {
                        if modell.beschaeftigt { ProgressView().tint(Farbe.aufBedien) }
                        Text("Anmelden und Ortung erlauben")
                    }
                }
                .buttonStyle(Hauptknopfstil())
                .disabled(!modell.kannAnmelden)
                .accessibilityIdentifier("anmelden")
                Button("Abbrechen") {
                    Task { await modell.abmelden() }
                }
                .buttonStyle(Nebenknopfstil(farbe: Farbe.gedaempft))
                .accessibilityIdentifier("abbrechen")
            }
        }
    }

    @ViewBuilder
    private var zielauswahl: some View {
        VStack(alignment: .leading, spacing: LifelineAbstand.abstandKomfortabelXs) {
            Augenbraue("Ziel")
            if let liste = modell.zielliste {
                if liste.targets.isEmpty {
                    Hinweis(
                        text: "Der Einsatz hat noch keine Einheiten oder Fahrzeuge. Bitte die Einsatzleitung fragen.",
                        symbol: "info.circle.fill", farbe: Farbe.bedienText, flaeche: Farbe.bedienFlaeche)
                }
                Zielauswahl(
                    optionen: liste.targets,
                    gewaehlt: modell.gewaehltesZiel
                ) { modell.gewaehltesZiel = $0 }
            } else if modell.zieleLaden {
                HStack(spacing: LifelineAbstand.abstandKomfortabelSm) {
                    ProgressView()
                    Text("Ziele werden geladen …")
                        .schrift(Stil.klein, relativeTo: .subheadline)
                        .foregroundStyle(Farbe.gedaempft)
                }
                .karte()
            } else {
                Button("Ziele erneut laden") { Task { await modell.ladeZiele() } }
                    .buttonStyle(Nebenknopfstil())
            }
        }
    }
}

/// Auswählbare Liste der Ziele, eine Zeile je Einheit oder Fahrzeug.
struct Zielauswahl: View {
    let optionen: [ZielOption]
    let gewaehlt: ZielOption?
    let waehle: (ZielOption) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ForEach(optionen, id: \.kennung) { option in
                Button {
                    waehle(option)
                } label: {
                    Zielzeile(option: option, gewaehlt: option == gewaehlt)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(option == gewaehlt ? .isSelected : [])
                .accessibilityIdentifier("ziel-\(option.kennung)")
                if option != optionen.last {
                    Rectangle().fill(Farbe.linie).frame(height: 1)
                }
            }
        }
        .background(Farbe.flaeche, in: eckig)
        .overlay(eckig.strokeBorder(Farbe.linie, lineWidth: 1))
        .sensoryFeedback(.selection, trigger: gewaehlt)
    }
}

/// Eine Zeile der Zielliste: Symbol der Art, Name, Rufname und taktisches Zeichen.
struct Zielzeile: View {
    let option: ZielOption
    let gewaehlt: Bool

    var body: some View {
        HStack(alignment: .center, spacing: LifelineAbstand.abstandKomfortabelSm) {
            Image(systemName: option.istFahrzeug ? "car.fill" : "person.3.fill")
                .font(.title3)
                .foregroundStyle(gewaehlt ? Farbe.bedien : Farbe.gedaempft)
                .frame(minWidth: 32)
                .accessibilityLabel(option.istFahrzeug ? "Fahrzeug" : "Einheit")
            VStack(alignment: .leading, spacing: 2) {
                Text(option.name)
                    .schrift(Stil.text, relativeTo: .body)
                    .foregroundStyle(Farbe.text)
                    .fixedSize(horizontal: false, vertical: true)
                if let rufname = option.callSign {
                    Text(rufname)
                        .schrift(Stil.klein, relativeTo: .subheadline)
                        .foregroundStyle(Farbe.text2)
                }
                if let zeichen = Self.zeichen(option) {
                    Text(zeichen)
                        .schrift(Stil.augenbraue, relativeTo: .caption)
                        .foregroundStyle(Farbe.gedaempft)
                }
            }
            Spacer(minLength: 0)
            Image(systemName: gewaehlt ? "checkmark.square.fill" : "square")
                .font(.title2)
                .foregroundStyle(gewaehlt ? Farbe.bedien : Farbe.linieStark)
                .accessibilityHidden(true)
        }
        .padding(LifelineAbstand.abstandKomfortabelSm)
        .frame(minHeight: LifelineGroesse.steuerhoeheKomfortabel + 16)
        .background(gewaehlt ? Farbe.bedienFlaeche : Color.clear)
        .overlay(alignment: .leading) {
            if gewaehlt { Rectangle().fill(Farbe.bedien).frame(width: 3) }
        }
        .contentShape(Rectangle())
    }

    /// Taktisches Zeichen als Text: Organisation · Fachaufgabe.
    static func zeichen(_ option: ZielOption) -> String? {
        let teile = [option.signOrganization, option.signFunction].compactMap { $0 }
            .filter { !$0.isEmpty }
        return teile.isEmpty ? nil : teile.joined(separator: " · ")
    }
}
