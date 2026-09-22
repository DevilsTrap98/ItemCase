# ItemCase – TODO

## Später

- [ ] Automatischen Desktop-Updater einführen
  - `electron-updater` mit dem bestehenden Windows-NSIS-Installer integrieren.
  - Öffentliche HTTPS-Updatequelle festlegen; keine privaten Zugriffstoken an Clients ausliefern.
  - Update-Dialog umsetzen: verfügbar, herunterladen, Fortschritt, neu starten oder später.
  - Releases semantisch versionieren und `latest.yml`, Installer sowie Blockmap gemeinsam veröffentlichen.
  - Windows-Code-Signing-Zertifikat beschaffen und Update-Signaturen prüfen.
  - Erste updaterfähige Version einmalig manuell verteilen; Folgeversionen automatisch ausrollen.
  - Update-, Abbruch-, Offline- und Rollback-Szenarien vor Veröffentlichung testen.
