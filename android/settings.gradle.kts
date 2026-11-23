// Android-Hülle (LLH-1989). Der Kern ist ein eigenständiger Build ohne Android-SDK
// (`android/kern`, eigene Repositories); die App (`:app`) braucht das SDK und bindet den Kern per
// Abhängigkeitsersetzung ein (`dev.rubeen.lifeline:kern`).
pluginManagement {
    repositories {
        google()
        // Spiegel vor Maven Central: Kopf von `kern/settings.gradle.kts`.
        maven("https://maven-central.storage-download.googleapis.com/maven2/") { name = "MavenCentralSpiegel" }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode = RepositoriesMode.FAIL_ON_PROJECT_REPOS
    repositories {
        google()
        maven("https://maven-central.storage-download.googleapis.com/maven2/") { name = "MavenCentralSpiegel" }
        mavenCentral()
    }
}

rootProject.name = "lifeline-android"

includeBuild("kern")
include(":app")
