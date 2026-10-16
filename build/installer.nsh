; 数据目录指针：NSIS 与应用约定的唯一入口。指针始终固定在默认 userData 目录，
; 里面记录真正的数据目录；electron-builder 会在安装包与卸载程序中各包含一次本文件，
; 因此宏定义需要防重复。
!ifndef HEIMDALL_DATA_LOCATION_DEFINED
  !define HEIMDALL_DEFAULT_DATA_DIR "$APPDATA\Heimdall"
  !define HEIMDALL_DATA_POINTER "${HEIMDALL_DEFAULT_DATA_DIR}\data-location.ini"
  !define HEIMDALL_DATA_POINTER_SECTION "Heimdall"
  !define HEIMDALL_DATA_POINTER_KEY "DataDirectory"
!endif

!ifndef BUILD_UNINSTALLER

  ; === 安装期数据目录选择 ===
  ; 在“选择安装位置”页之后插入一个自定义页，让用户指定 Heimdall 的数据目录
  ; （config / 日志 / 用量统计等）。选择结果写进指针文件，应用启动时读取并据此
  ; 重定向 Electron 的 userData，从而把数据从 C 盘迁到用户指定的目录。

  Var DataDirDialog
  Var DataDirText
  Var DataDirEdit

  !macro customPageAfterChangeDir
    !insertmacro MUI_PAGE_INIT

    PageEx custom
      PageCallbacks lmrDataDirPre lmrDataDirLeave
      Caption " "
    PageExEnd

    Function lmrDataDirPre
      ${IfNot} ${Silent}
        nsDialogs::Create 1018
        Pop $DataDirDialog
        ${If} $DataDirDialog == error
          Abort
        ${EndIf}

        ${NSD_CreateLabel} 0u 0u 280u 16u "Choose where Heimdall stores its data (config, logs, usage):"
        Pop $0

        ${NSD_CreateText} 0u 18u 240u 12u ""
        Pop $DataDirEdit

        ${NSD_CreateButton} 248u 18u 30u 12u "..."
        Pop $0
        ${NSD_OnClick} $0 lmrDataDirBrowse
        Pop $0

        ; 升级安装时预填上次选择的数据目录，避免误重置回默认位置。
        ReadINIStr $0 "${HEIMDALL_DATA_POINTER}" "${HEIMDALL_DATA_POINTER_SECTION}" "${HEIMDALL_DATA_POINTER_KEY}"
        ${If} $0 != ""
          ${NSD_SetText} $DataDirEdit "$0"
        ${EndIf}

        nsDialogs::Show
      ${EndIf}
    FunctionEnd

    Function lmrDataDirLeave
      ${IfNot} ${Silent}
        ${NSD_GetText} $DataDirEdit $DataDirText
        ; 轻量校验：应用启动时会执行完整规则，但相对路径和盘根永远无效，
        ; 在这里就拦下，避免写进一个应用不得不修复的指针。
        ${If} $DataDirText != ""
          ; StrCpy 的起始偏移从 1 计数：第 1 位是盘符/UNC 反斜杠，第 2 位是冒号。
          StrCpy $1 "$DataDirText" 1 1
          StrCpy $2 "$DataDirText" 1 2
          ${If} $2 == ":"
            StrCpy $3 "$DataDirText" 1 3
            StrCpy $4 "$DataDirText" 1 4
            ${If} $3 == "\"
              ${If} $4 == ""
                MessageBox MB_ICONSTOP "Choose a folder instead of a drive root. Heimdall will use the default data directory:$\r$\n$APPDATA\Heimdall"
                StrCpy $DataDirText ""
              ${EndIf}
            ${EndIf}
          ${ElseIf} $1 != "\\"
            MessageBox MB_ICONSTOP "That is not a valid folder path. Heimdall will use the default data directory:$\r$\n$APPDATA\Heimdall"
            StrCpy $DataDirText ""
          ${EndIf}
        ${EndIf}
      ${EndIf}
    FunctionEnd

    Function lmrDataDirBrowse
      Pop $0
      ${NSD_GetText} $DataDirEdit $0
      nsDialogs::SelectFolderDialog "Select Heimdall data directory" $0
      Pop $0
      ${If} $0 != error
        ${NSD_SetText} $DataDirEdit "$0"
      ${EndIf}
    FunctionEnd
  !macroend

  ; 安装段执行：只有用户真正选了目录才写指针。空值一律跳过写入 —— 静默安装
  ; （electron-updater 用 /S 装新版本）不会走自定义页，$DataDirText 恒为空，
  ; 此时若照写不误就会清掉已有指针，让更新后的应用回到默认目录、丢掉用户数据。
  ; 应用启动时会校验该目录是否可用，不可用则临时回落默认目录并提示。
  !macro customInstall
    ${If} $DataDirText != ""
      CreateDirectory "$DataDirText"
      CreateDirectory "${HEIMDALL_DEFAULT_DATA_DIR}"
      WriteINIStr "${HEIMDALL_DATA_POINTER}" "${HEIMDALL_DATA_POINTER_SECTION}" "${HEIMDALL_DATA_POINTER_KEY}" "$DataDirText"
    ${EndIf}
  !macroend

!endif

!macro customUnInstall
  IfSilent lmrKeepUserData

  ReadINIStr $0 "${HEIMDALL_DATA_POINTER}" "${HEIMDALL_DATA_POINTER_SECTION}" "${HEIMDALL_DATA_POINTER_KEY}"
  ${If} $0 == ""
    StrCpy $0 "${HEIMDALL_DEFAULT_DATA_DIR}"
  ${EndIf}

  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Do you also want to delete Heimdall user data?$\r$\n$\r$\nThis removes config.json, logs, and local app state from:$\r$\n$0$\r$\n${HEIMDALL_DEFAULT_DATA_DIR}" \
    IDNO lmrKeepUserData

  ; 指针可能由旧版安装器写入或被手工改坏（相对路径、盘根）。RMDir /r 这类值
  ; 会误删无关内容，因此仅当它是绝对路径且不是盘根时才执行删除。
  ; StrCpy 的起始偏移从 1 计数：第 1 位是盘符/UNC 反斜杠，第 2 位是冒号。
  StrCpy $1 "$0" 1 1
  StrCpy $2 "$0" 1 2
  ${If} $2 == ":"
    StrCpy $3 "$0" 1 3
    StrCpy $4 "$0" 1 4
    ${If} $3 == "\"
      ${If} $4 == ""
        StrCpy $0 ""
      ${EndIf}
    ${EndIf}
  ${ElseIf} $1 != "\\"
    StrCpy $0 ""
  ${EndIf}
  ${If} $0 != ""
    RMDir /r "$0"
  ${EndIf}
  RMDir /r "${HEIMDALL_DEFAULT_DATA_DIR}"

lmrKeepUserData:
!macroend