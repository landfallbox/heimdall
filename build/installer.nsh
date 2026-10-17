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

  ; 安装位置消毒逻辑改用 StrLen + StrCpy 手动做末尾组件判定（见 lmrCombinedLeave），
  ; 不再引入 StrContains.nsh：electron-builder 的 NSIS 不含 StrLib.nsh，无法用
  ; ${EndsWith}；而 StrContains 的子串匹配会误接受 C:\HeimdallBackup 这类目录。

  ; === 安装期位置选择（安装位置 + 数据目录合并页）===
  ; 用一个自定义页同时让用户指定 Heimdall 的安装位置和数据目录
  ; （config / 日志 / 用量统计等）。安装位置直接写入 $INSTDIR；数据目录选择结果
  ; 写进指针文件，应用启动时读取并据此重定向 Electron 的 userData，从而把数据
  ; 从 C 盘迁到用户指定的目录。
  ; 该页替代了模板默认的“选择安装位置”页（通过移除 allowToChangeInstallationDirectory
  ; 关闭），并把原本独立的数据目录页合并进来，减少安装步骤。

  Var DataDirDialog
  Var DataDirText
  Var DataDirEdit
  Var InstDirEdit

  ; 跳过“为所有用户 / 仅为我”安装模式页：本应用固定为 per-user 安装
  ; （perMachine: false），该页只会多一步无意义的选择。customInstallMode 在安装
  ; 模式页的 Pre 回调里被模板调用，置 $isForceCurrentInstall=1 后模板会强制
  ; per-user 并 Abort 跳过该页（静默安装时同样生效，行为保持一致）。
  !macro customInstallMode
    StrCpy $isForceCurrentInstall "1"
  !macroend

  !macro customPageAfterChangeDir
    !insertmacro MUI_PAGE_INIT

    PageEx custom
      PageCallbacks lmrCombinedPre lmrCombinedLeave
      Caption " "
    PageExEnd

    Function lmrCombinedPre
      ${IfNot} ${Silent}
        nsDialogs::Create 1018
        Pop $DataDirDialog
        ${If} $DataDirDialog == error
          Abort
        ${EndIf}

        ${NSD_CreateLabel} 0u 0u 434u 16u "Choose where Heimdall is installed and where it stores its data:"
        Pop $0

        ${NSD_CreateLabel} 0u 24u 90u 12u "Install location:"
        Pop $0

        ${NSD_CreateText} 95u 22u 285u 14u ""
        Pop $InstDirEdit
        ; 预填当前安装位置（升级时为上次安装目录，全新安装时为 per-user 默认目录）。
        ${NSD_SetText} $InstDirEdit "$INSTDIR"

        ${NSD_CreateButton} 384u 22u 30u 14u "..."
        Pop $0
        ${NSD_OnClick} $0 lmrInstDirBrowse
        Pop $0

        ${NSD_CreateLabel} 0u 48u 90u 12u "Data directory:"
        Pop $0

        ${NSD_CreateText} 95u 46u 285u 14u ""
        Pop $DataDirEdit

        ${NSD_CreateButton} 384u 46u 30u 14u "..."
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

    Function lmrCombinedLeave
      ${IfNot} ${Silent}
        ; --- 安装位置：空值保留默认；相对路径拒绝；绝对路径（含盘根）接受 ---
        ${NSD_GetText} $InstDirEdit $0
        ${If} $0 != ""
          ; 取前 2 个字符判断 UNC（NSIS 中 "\\" 是字面 2 个反斜杠，
          ; 取 1 个字符永远不等于 "\\"，会漏判 \\server\share 路径）
          StrCpy $1 "$0" 2 0
          StrCpy $2 "$0" 1 1
          ${If} $2 == ":"
            ; 盘符路径必须形如 X:\...（排除 D:relative 这类盘符相对路径）
            StrCpy $3 "$0" 1 2
            ${If} $3 == "\"
              StrCpy $INSTDIR "$0"
            ${Else}
              MessageBox MB_ICONSTOP "That is not a valid folder path. Heimdall will use the default install location."
            ${EndIf}
          ${ElseIf} $1 == "\\"
            StrCpy $INSTDIR "$0"
          ${Else}
            MessageBox MB_ICONSTOP "That is not a valid folder path. Heimdall will use the default install location."
          ${EndIf}
          ; 消毒（等价于模板 instFilesPre）：$INSTDIR 必须落在 ${APP_FILENAME}
          ; 子目录内。用户选了盘根或未含 Heimdall 的目录时自动补上子目录，
          ; 防止把文件直接铺到 D:\ 或用户主目录等位置。
          ; 末尾组件判定：仅当 $INSTDIR 的最后一个路径组件恰好是
          ; ${APP_FILENAME}（或为空）时才不追加，避免子串匹配误接受
          ; C:\HeimdallBackup 这类目录。StrCpy 用法参照模板
          ; installUtil.nsh 的 GetFileParent：`StrCpy $d $s 1 -K` 取从末尾
          ; 第 K 个字符起的 1 字符；`StrCpy $d $s N` 取前 N 字符。
          StrCpy $R1 "$INSTDIR" 1 -1
          ${If} $R1 == "\"
            StrLen $R2 "$INSTDIR"
            IntOp $R2 $R2 - 1
            StrCpy $INSTDIR "$INSTDIR" $R2
          ${EndIf}
          StrLen $R1 "${APP_FILENAME}"
          StrCpy $R3 ""
          StrLen $R4 "$INSTDIR"
          ${If} $R4 >= $R1
            StrCpy $R3 "$INSTDIR" $R1 -$R1
            ${If} $R3 == "${APP_FILENAME}"
              ${If} $R4 > $R1
                ; 末尾组件前必须还有路径分隔符（\）或盘符（:，即盘根直下），
                ; 否则说明是 XHeimdall 这类更长组件的尾部，仍需追加
                IntOp $R5 $R1 + 1
                StrCpy $R4 "$INSTDIR" 1 -$R5
                ${If} $R4 != "\"
                  ${If} $R4 != ":"
                    StrCpy $R3 ""
                  ${EndIf}
                ${EndIf}
              ${EndIf}
            ${EndIf}
          ${EndIf}
          ${If} $R3 != "${APP_FILENAME}"
            StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
          ${EndIf}
        ${EndIf}

        ; --- 数据目录：空值跳过（静默升级不写指针）；相对路径和盘根在此拦下 ---
        ${NSD_GetText} $DataDirEdit $DataDirText
        ; 轻量校验：应用启动时会执行完整规则，但相对路径和盘根永远无效，
        ; 在这里就拦下，避免写进一个应用不得不修复的指针。
        ${If} $DataDirText != ""
          ; 取前 2 个字符判断 UNC（NSIS 中 "\\" 是字面 2 个反斜杠，
          ; 取 1 个字符永远不等于 "\\"，会漏判 \\server\share 路径）
          StrCpy $1 "$DataDirText" 2 0
          StrCpy $2 "$DataDirText" 1 1
          ${If} $2 == ":"
            StrCpy $3 "$DataDirText" 1 2
            StrCpy $4 "$DataDirText" 1 3
            ; 盘符相对路径（D:relative）不是绝对路径，按无效处理
            ${If} $3 != "\"
              MessageBox MB_ICONSTOP "That is not a valid folder path. Heimdall will use the default data directory:$\r$\n$APPDATA\Heimdall"
              StrCpy $DataDirText ""
            ${ElseIf} $4 == ""
              MessageBox MB_ICONSTOP "Choose a folder instead of a drive root. Heimdall will use the default data directory:$\r$\n$APPDATA\Heimdall"
              StrCpy $DataDirText ""
            ${EndIf}
          ${ElseIf} $1 != "\\"
            MessageBox MB_ICONSTOP "That is not a valid folder path. Heimdall will use the default data directory:$\r$\n$APPDATA\Heimdall"
            StrCpy $DataDirText ""
          ${EndIf}
        ${EndIf}
      ${EndIf}
    FunctionEnd

    Function lmrInstDirBrowse
      Pop $0
      ${NSD_GetText} $InstDirEdit $0
      nsDialogs::SelectFolderDialog "Select Heimdall install location" $0
      Pop $0
      ${If} $0 != error
        ${NSD_SetText} $InstDirEdit "$0"
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
  ; StrCpy 的起始偏移从 0 计数：第 0 位是盘符/UNC 反斜杠，第 1 位是冒号。
  ; 取前 2 个字符判断 UNC（NSIS 中 "\\" 是字面 2 个反斜杠，
  ; 取 1 个字符永远不等于 "\\"，会漏判 \\server\share 路径）
  StrCpy $1 "$0" 2 0
  StrCpy $2 "$0" 1 1
  ${If} $2 == ":"
    StrCpy $3 "$0" 1 2
    StrCpy $4 "$0" 1 3
    ; 盘符相对路径不是绝对路径，按无效处理
    ${If} $3 != "\"
      StrCpy $0 ""
    ${ElseIf} $4 == ""
      StrCpy $0 ""
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