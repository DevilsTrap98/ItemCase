; Force-closes a running ItemCase instance before install/uninstall so the
; wizard never hits a "file in use" error when updating over an open app.
!macro customInit
  nsExec::Exec 'taskkill /F /IM "${APP_EXECUTABLE_FILENAME}"'
!macroend

!macro customUnInit
  nsExec::Exec 'taskkill /F /IM "${APP_EXECUTABLE_FILENAME}"'
!macroend
