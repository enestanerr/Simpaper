; Simpaper: file types, file-type icons and the Default apps registration (docs/adr/0010-file-associations.md).
;
; electron-builder includes this file (nsis.include defaults to build/installer.nsh) in the installer AND in the
; uninstaller build, and makensis runs with -WX and -INPUTCHARSET UTF8: no Var or Function that one of the two builds
; would leave unused, and APP_EXECUTABLE_FILENAME / APP_ID only inside macro bodies (they are defined later).
;
; Root key: SHELL_CONTEXT, i.e. HKCU for the default "only for me" install and HKLM when an administrator chooses
; "all users". Windows protects the user's default-app choice (UserChoice), so it is never read or written here:
; Simpaper becomes the default only where no registered app owns a type yet, everywhere else the user chooses it
; (Windows asks when such a file is opened next, or Settings > Apps > Default apps > Simpaper).
;
; The table below must match src/shared/fileAssociations.ts and the type names FORMAT_LABELS in
; src/main/app/strings.ts; tests/unit/main/fileAssociations.test.ts checks it. ProgIDs are never renamed: the
; users' default-app choices point at them.

!include LogicLib.nsh

; Value name under Software\RegisteredApplications = Capabilities\ApplicationName = BRAND.registeredAppName.
!define SP_REGAPP "Simpaper"
; Registry locations below the root key. Only scripts/installer/check-associations.mjs overrides them (with a scratch
; key, so the check never touches the real associations); electron-builder never defines them.
!ifndef SP_CLASSES
  !define SP_CLASSES "Software\Classes"
!endif
!ifndef SP_REGISTERED_APPS
  !define SP_REGISTERED_APPS "Software\RegisteredApplications"
!endif
!ifndef SP_APP_KEY
  !define SP_APP_KEY "Software\Simpaper"
!endif
!define SP_CAPS "${SP_APP_KEY}\Capabilities"
; resources/fileicons/*.ico, shipped by electron-builder.yml (extraResources).
!define SP_ICONS "resources\fileicons"

; One line per extension: OP ProgID extension icon claim "English type name" "Turkish type name".
; claim 1: offered as the default where no registered app owns the type yet.
; claim 0: only in "Open with" and on Simpaper's Default apps page (AllowSilentDefaultTakeOver: never competes).
!macro SP_FILE_TYPES OP
  !insertmacro ${OP} Simpaper.docx  docx document     1 "Word Document" "Word Belgesi"
  !insertmacro ${OP} Simpaper.docm  docm document     1 "Word Macro-Enabled Document" "Makro İçerebilen Word Belgesi"
  !insertmacro ${OP} Simpaper.dotx  dotx document     1 "Word Template" "Word Şablonu"
  !insertmacro ${OP} Simpaper.dotm  dotm document     1 "Word Macro-Enabled Template" "Makro İçerebilen Word Şablonu"
  !insertmacro ${OP} Simpaper.doc   doc  document     1 "Word 97-2003 Document" "Word 97-2003 Belgesi"
  !insertmacro ${OP} Simpaper.rtf   rtf  document     1 "Rich Text Format" "Zengin Metin Biçimi"
  !insertmacro ${OP} Simpaper.txt   txt  document     0 "Plain Text" "Düz Metin"
  !insertmacro ${OP} Simpaper.odt   odt  document     1 "OpenDocument Text" "OpenDocument Metni"
  !insertmacro ${OP} Simpaper.xlsx  xlsx spreadsheet  1 "Excel Workbook" "Excel Çalışma Kitabı"
  !insertmacro ${OP} Simpaper.xlsm  xlsm spreadsheet  1 "Excel Macro-Enabled Workbook" "Makro İçerebilen Excel Çalışma Kitabı"
  !insertmacro ${OP} Simpaper.xltx  xltx spreadsheet  1 "Excel Template" "Excel Şablonu"
  !insertmacro ${OP} Simpaper.xltm  xltm spreadsheet  1 "Excel Macro-Enabled Template" "Makro İçerebilen Excel Şablonu"
  !insertmacro ${OP} Simpaper.xlsb  xlsb spreadsheet  1 "Excel Binary Workbook" "Excel İkili Çalışma Kitabı"
  !insertmacro ${OP} Simpaper.xls   xls  spreadsheet  1 "Excel 97-2003 Workbook" "Excel 97-2003 Çalışma Kitabı"
  !insertmacro ${OP} Simpaper.csv   csv  spreadsheet  0 "CSV (delimited text)" "CSV (ayırıcılı metin)"
  !insertmacro ${OP} Simpaper.tsv   tsv  spreadsheet  0 "Tab-separated text" "Sekmeyle ayrılmış metin"
  !insertmacro ${OP} Simpaper.tsv   tab  spreadsheet  0 "Tab-separated text" "Sekmeyle ayrılmış metin"
  !insertmacro ${OP} Simpaper.ods   ods  spreadsheet  1 "OpenDocument Spreadsheet" "OpenDocument Hesap Tablosu"
  !insertmacro ${OP} Simpaper.pptx  pptx presentation 1 "PowerPoint Presentation" "PowerPoint Sunusu"
  !insertmacro ${OP} Simpaper.pptm  pptm presentation 1 "PowerPoint Macro-Enabled Presentation" "Makro İçerebilen PowerPoint Sunusu"
  !insertmacro ${OP} Simpaper.ppsx  ppsx presentation 1 "PowerPoint Show" "PowerPoint Gösterisi"
  !insertmacro ${OP} Simpaper.ppsm  ppsm presentation 1 "PowerPoint Macro-Enabled Show" "Makro İçerebilen PowerPoint Gösterisi"
  !insertmacro ${OP} Simpaper.potx  potx presentation 1 "PowerPoint Template" "PowerPoint Şablonu"
  !insertmacro ${OP} Simpaper.potm  potm presentation 1 "PowerPoint Macro-Enabled Template" "Makro İçerebilen PowerPoint Şablonu"
  !insertmacro ${OP} Simpaper.ppt   ppt  presentation 1 "PowerPoint 97-2003 Presentation" "PowerPoint 97-2003 Sunusu"
  !insertmacro ${OP} Simpaper.pps   pps  presentation 1 "PowerPoint 97-2003 Show" "PowerPoint 97-2003 Gösterisi"
  !insertmacro ${OP} Simpaper.odp   odp  presentation 1 "OpenDocument Presentation" "OpenDocument Sunusu"
  !insertmacro ${OP} Simpaper.pdf   pdf  pdf          1 "PDF Document" "PDF Belgesi"
!macroend

; Install: the ProgID (type name in the installer's language, icon, open command), the "Open with" entry, the
; Default apps capability and, for claim 1, the extension's default where no registered app owns it yet.
; Uses $R0-$R2 (saved by customInstall).
!macro SP_REGISTER PROGID EXT ICON CLAIM EN TR
  ${If} $LANGUAGE == 1055
    WriteRegStr SHELL_CONTEXT "${SP_CLASSES}\${PROGID}" "" "${TR}"
  ${Else}
    WriteRegStr SHELL_CONTEXT "${SP_CLASSES}\${PROGID}" "" "${EN}"
  ${EndIf}
  WriteRegStr SHELL_CONTEXT "${SP_CLASSES}\${PROGID}" "AppUserModelID" "${APP_ID}"
  WriteRegStr SHELL_CONTEXT "${SP_CLASSES}\${PROGID}\DefaultIcon" "" '"$INSTDIR\${SP_ICONS}\${ICON}.ico",0'
  WriteRegStr SHELL_CONTEXT "${SP_CLASSES}\${PROGID}\shell" "" "open"
  WriteRegStr SHELL_CONTEXT "${SP_CLASSES}\${PROGID}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegNone SHELL_CONTEXT "${SP_CLASSES}\.${EXT}\OpenWithProgids" "${PROGID}"
  WriteRegStr SHELL_CONTEXT "${SP_CAPS}\FileAssociations" ".${EXT}" "${PROGID}"
  !if ${CLAIM} == 1
    ; A default that names an existing ProgID belongs to an installed app (Office, LibreOffice …) and stays; an empty
    ; or dangling one is taken. Both the merged view (HKCR: current user over machine) and the value this install
    ; would overwrite (HKLM for "all users") must allow it.
    StrCpy $R1 "1"
    ReadRegStr $R0 HKCR ".${EXT}" ""
    ${If} $R0 != ""
    ${AndIf} $R0 != "${PROGID}"
      ClearErrors
      EnumRegKey $R2 HKCR "$R0" 0
      ${IfNot} ${Errors}
        StrCpy $R1 "0"
      ${EndIf}
    ${EndIf}
    ReadRegStr $R0 SHELL_CONTEXT "${SP_CLASSES}\.${EXT}" ""
    ${If} $R0 != ""
    ${AndIf} $R0 != "${PROGID}"
      ClearErrors
      EnumRegKey $R2 HKCR "$R0" 0
      ${IfNot} ${Errors}
        StrCpy $R1 "0"
      ${EndIf}
    ${EndIf}
    ${If} $R1 == "1"
      WriteRegStr SHELL_CONTEXT "${SP_CLASSES}\.${EXT}" "" "${PROGID}"
    ${EndIf}
  !else
    WriteRegNone SHELL_CONTEXT "${SP_CLASSES}\${PROGID}" "AllowSilentDefaultTakeOver"
  !endif
!macroend

; Uninstall below ROOT: our "Open with" entry, our ProgID and the extension's default only while it still names our
; ProgID. Extension keys stay (other apps' values may live there). Uses $R0 (saved by the caller).
!macro SP_UNREGISTER_TYPE ROOT PROGID EXT
  DeleteRegValue ${ROOT} "${SP_CLASSES}\.${EXT}\OpenWithProgids" "${PROGID}"
  ReadRegStr $R0 ${ROOT} "${SP_CLASSES}\.${EXT}" ""
  ${If} $R0 == "${PROGID}"
    DeleteRegValue ${ROOT} "${SP_CLASSES}\.${EXT}" ""
  ${EndIf}
  DeleteRegKey ${ROOT} "${SP_CLASSES}\${PROGID}"
!macroend
!macro SP_UNREGISTER PROGID EXT ICON CLAIM EN TR
  !insertmacro SP_UNREGISTER_TYPE SHELL_CONTEXT ${PROGID} ${EXT}
!macroend
!macro SP_UNREGISTER_CURRENT_USER PROGID EXT ICON CLAIM EN TR
  !insertmacro SP_UNREGISTER_TYPE HKCU ${PROGID} ${EXT}
!macroend

; Everything the installer registers below ROOT; OP is the matching per-type macro.
!macro SP_UNREGISTER_ALL ROOT OP
  !insertmacro SP_FILE_TYPES ${OP}
  ; Created by Windows when a user picks Simpaper.exe with "Choose another app" > "Look for another app".
  DeleteRegKey ${ROOT} "${SP_CLASSES}\Applications\${APP_EXECUTABLE_FILENAME}"
  DeleteRegValue ${ROOT} "${SP_REGISTERED_APPS}" "${SP_REGAPP}"
  DeleteRegKey ${ROOT} "${SP_APP_KEY}"
!macroend

; SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST | SHCNF_FLUSH): Explorer picks up the new icons and handlers now.
!macro SP_NOTIFY_SHELL
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
!macroend

!macro customInstall
  Push $R0
  Push $R1
  Push $R2
  ; From "only for me" to "all users": electron-builder has just removed this user's per-user copy (installSection.nsh
  ; runs uninstallOldVersion HKEY_CURRENT_USER, which keeps the registration because it is an update). Its entries
  ; would win over the machine-wide ones in HKCR and start the deleted program, so they go first.
  ${If} $installMode == "all"
    !insertmacro SP_UNREGISTER_ALL HKCU SP_UNREGISTER_CURRENT_USER
  ${EndIf}
  !insertmacro SP_FILE_TYPES SP_REGISTER
  WriteRegStr SHELL_CONTEXT "${SP_CAPS}" "ApplicationName" "${SP_REGAPP}"
  ${If} $LANGUAGE == 1055
    WriteRegStr SHELL_CONTEXT "${SP_CAPS}" "ApplicationDescription" "Belgeler, hesap tabloları, sunular ve PDF için ofis paketi"
  ${Else}
    WriteRegStr SHELL_CONTEXT "${SP_CAPS}" "ApplicationDescription" "Office suite for documents, spreadsheets, presentations and PDF"
  ${EndIf}
  WriteRegStr SHELL_CONTEXT "${SP_CAPS}" "ApplicationIcon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr SHELL_CONTEXT "${SP_REGISTERED_APPS}" "${SP_REGAPP}" "${SP_CAPS}"
  !insertmacro SP_NOTIFY_SHELL
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

!macro customUnInstall
  ; An update runs the previous uninstaller with --updated before the new files are installed: keep the
  ; registration, so the users' default-app choices that name Simpaper's ProgIDs stay valid.
  ${IfNot} ${isUpdated}
    Push $R0
    !insertmacro SP_UNREGISTER_ALL SHELL_CONTEXT SP_UNREGISTER
    !insertmacro SP_NOTIFY_SHELL
    Pop $R0
  ${EndIf}
!macroend

; Finish page: an unchecked box that opens Settings > Apps > Default apps on Simpaper's page (Windows 11 21H2/22H2
; with the April 2023 update, 23H2 and later; Windows 10 opens the list of default apps). Only the installer build
; has the finish page. MUI2 draws this box one line high (195 x 10 dialog units): keep the labels short.
!ifndef BUILD_UNINSTALLER
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "$(spChooseDefaultApps)"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION spOpenDefaultApps
!endif

; customHeader runs after the languages (LANG_*) and multiUser.nsh ($installMode) are defined.
!macro customHeader
  !ifndef BUILD_UNINSTALLER
    LangString spChooseDefaultApps ${LANG_ENGLISH} "Make Simpaper the default in Windows Settings"
    LangString spChooseDefaultApps ${LANG_TURKISH} "Simpaper'ı Windows Ayarları'nda varsayılan yap"
    Function spOpenDefaultApps
      ${If} $installMode == "all"
        ${StdUtils.ExecShellAsUser} $0 "ms-settings:defaultapps?registeredAppMachine=${SP_REGAPP}" "open" ""
      ${Else}
        ${StdUtils.ExecShellAsUser} $0 "ms-settings:defaultapps?registeredAppUser=${SP_REGAPP}" "open" ""
      ${EndIf}
    FunctionEnd
  !endif
!macroend
