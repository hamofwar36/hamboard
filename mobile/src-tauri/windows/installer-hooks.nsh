!include LogicLib.nsh

Var HamboardStartupEnabled
Var HamboardStartupChoiceCaptured

; Capture the current startup preference before installation begins.
; Tauri updater/passive/silent installs preserve the existing choice and never prompt.
!macro NSIS_HOOK_PREINSTALL
  StrCpy $HamboardStartupChoiceCaptured 0

  ${GetOptions} $CMDLINE "/UPDATE" $0
  ${IfNot} ${Errors}
    Goto hamboard_startup_pre_done
  ${EndIf}

  ${GetOptions} $CMDLINE "/P" $0
  ${IfNot} ${Errors}
    Goto hamboard_startup_pre_done
  ${EndIf}

  IfSilent hamboard_startup_pre_done 0

  ; Fresh installs default to Yes. Manual reinstalls mirror the existing Run entry
  ; so the confirmation dialog defaults to the user's current preference.
  StrCpy $HamboardStartupChoiceCaptured 1
  StrCpy $HamboardStartupEnabled 1
  IfFileExists "$INSTDIR\${MAINBINARYNAME}.exe" 0 hamboard_startup_pre_done
    StrCpy $HamboardStartupEnabled 0
    ReadRegStr $1 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
    ${If} $1 != ""
      StrCpy $HamboardStartupEnabled 1
      Goto hamboard_startup_pre_done
    ${EndIf}
    ReadRegStr $1 HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
    ${If} $1 != ""
      StrCpy $HamboardStartupEnabled 1
    ${EndIf}

  hamboard_startup_pre_done:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Ask only after installation work has completed, immediately before Tauri's finish page.
  ${If} $HamboardStartupChoiceCaptured = 1
    ${If} $HamboardStartupEnabled = 1
      MessageBox MB_ICONQUESTION|MB_YESNO|MB_DEFBUTTON1 "컴퓨터 시작 시 햄보드를 자동으로 실행할까요?" IDYES hamboard_startup_enable IDNO hamboard_startup_disable
    ${Else}
      MessageBox MB_ICONQUESTION|MB_YESNO|MB_DEFBUTTON2 "컴퓨터 시작 시 햄보드를 자동으로 실행할까요?" IDYES hamboard_startup_enable IDNO hamboard_startup_disable
    ${EndIf}

    hamboard_startup_enable:
      ; Recreate both values so malformed Run commands and stale Windows approval state are repaired.
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${PRODUCTNAME}"
      WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}" '"$INSTDIR\${MAINBINARYNAME}.exe"'
      WriteRegBin HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${PRODUCTNAME}" 020000000000000000000000
      Goto hamboard_startup_done

    hamboard_startup_disable:
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${PRODUCTNAME}"

    hamboard_startup_done:
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Remove startup registration before uninstall so reinstalling cannot inherit stale state.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${PRODUCTNAME}"
!macroend
