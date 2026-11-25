// Kern der Android-Helfer-App (ADR-0098): eigener Build ohne Android-SDK und ohne Android-Plugin,
// Versionen aus dem Katalog der Hülle.
rootProject.name = "helferkern"

// Die Helfer-App braucht `ServerAdresse` des Lifeline-Kerns; wie die App bindet dieser Build ihn
// per Abhängigkeitsersetzung (`dev.rubeen.lifeline:kern`) ein.
includeBuild("../kern")

// Maven Central über Googles öffentlichen Spiegel, Maven Central selbst dahinter für das, was dem
// Spiegel fehlt. Maven Central drosselt nach Volumen je IP-Adresse, und die geteilten Adressen der
// GitHub-Runner trifft das: am 23.11.2026 bekamen drei Läufe der Android-Prüfung auf zwei PRs
// „429 Too Many Requests“ für `nativeruntime-dist-compat-1.0.20.jar` (Robolectric, 165 MB), mit
// `Retry-After` von einer Stunde bis einem Tag. Gradle wiederholt 429 nur Sekunden lang, das hilft
// dagegen nicht; der Spiegel lieferte dieselbe Datei zur selben Zeit. Gleicher Eintrag in
// `../settings.gradle.kts`.

dependencyResolutionManagement {
    repositories {
        maven("https://maven-central.storage-download.googleapis.com/maven2/") { name = "MavenCentralSpiegel" }
        mavenCentral()
    }
    versionCatalogs {
        create("libs") {
            from(files("../gradle/libs.versions.toml"))
        }
    }
}

pluginManagement {
    repositories {
        gradlePluginPortal()
        maven("https://maven-central.storage-download.googleapis.com/maven2/") { name = "MavenCentralSpiegel" }
        mavenCentral()
    }
}
