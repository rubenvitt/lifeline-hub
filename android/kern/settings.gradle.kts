// Der Kern baut ohne Android-SDK und ohne Android-Plugin; die Versionen kommen aus dem Katalog
// der Hülle.
rootProject.name = "kern"

dependencyResolutionManagement {
    repositories {
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
        mavenCentral()
    }
}
