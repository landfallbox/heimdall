; -- heimdall.iss --
;
; Heimdall Windows installer (Inno Setup 6, "modern dynamic" style).
; Replaces the old electron-builder NSIS installer.
;
; Build:  ISCC.exe /DAppVersion=<x.y.z> heimdall.iss
;   (AppVersion defaults to 0.16.1 when not passed, so a plain
;    `ISCC heimdall.iss` also works for local builds.)
;
; Behavior parity with the old build\installer.nsh:
;   * per-user install (no elevation), x64 only
;   * a "data directory" page lets the user move config/logs off the C drive;
;     the choice is persisted to a pointer file the app reads at startup
;   * moving the data directory copies the existing user data (config, logs,
;     usage) into the new folder, so nothing has to be reconfigured
;   * silent installs never touch the pointer (so upgrades keep the choice)
;   * uninstall asks whether to also delete user data
;   * first-run migration removes the old NSIS install's registry entries and
;     runs its uninstaller if it is still present

#ifndef AppVersion
  #define AppVersion "0.16.1"
#endif

[Setup]
AppName=Heimdall
AppVersion={#AppVersion}
AppId=DE9625C4-291A-4F4F-BCD6-229A655A370E
AppVerName=Heimdall {#AppVersion}
AppPublisher=Heimdall
DefaultDirName={localappdata}\Programs\Heimdall
DefaultGroupName=Heimdall
DisableProgramGroupPage=yes
; per-user install, no admin required
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; modern look that follows the system light/dark theme
WizardStyle=modern dynamic
WizardBackColor=#f3f3f3
WizardBackColorDynamicDark=#202020
SetupIconFile=icon.ico
UninstallDisplayName=Heimdall
UninstallDisplayIcon={app}\Heimdall.exe
; ask to close a running Heimdall before installing over it
CloseApplications=yes
OutputDir=..\release
OutputBaseFilename=heimdall-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
ShowLanguageDialog=no
VersionInfoVersion={#AppVersion}.0
VersionInfoCompany=Heimdall
VersionInfoDescription=Heimdall Setup

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional tasks:"

[Files]
; the unpacked Electron app produced by `electron-builder --win dir`
Source: "..\release\win-unpacked\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\Heimdall"; Filename: "{app}\Heimdall.exe"; Comment: "Launch Heimdall"
Name: "{autodesktop}\Heimdall"; Filename: "{app}\Heimdall.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Heimdall.exe"; Description: "Launch Heimdall"; Flags: nowait postinstall skipifsilent

[Code]
const
  DataPointerSection = 'Heimdall';
  DataPointerKey = 'DataDirectory';
  // Runtime artifacts, not user data. Kept in sync with MIGRATION_SKIP_ENTRIES
  // in gui/electron/data-location.ts.
  DataMigrationSkipList =
    'data-location.ini;router.pid;Cache;Code Cache;GPUCache;DawnGraphiteCache;' +
    'DawnWebGPUCache;Crashpad;Crash Reports;blob_storage;Local Storage;Session ' +
    'Storage;IndexedDB;Network;Partitions;DIPS;DIPS-wal;SharedStorage;' +
    'SharedStorage-wal;Shared Dictionary;Preferences;lockfile;Local State;' +
    '.updaterId';
  // Old electron-builder NSIS install identifiers (UUIDv5 of "local.heimdall").
  OldNsGuid = '5f1af358-1741-5d1a-99a6-6c4880522cb8';
  // Uninstall key Inno Setup 6 writes for this AppId. Its presence means an
  // Inno install already exists, so the built-in UsePreviousAppDir already
  // handles the install path and the NSIS migration below must not run.
  InnoUninstallSubKey =
    'Software\Microsoft\Windows\CurrentVersion\Uninstall\DE9625C4-291A-4F4F-BCD6-229A655A370E_is1';
  // Win32 constants for reparse-point detection (see IsReparsePoint below).
  // Not exposed by Inno's built-in functions.
  WinInvalidFileAttributes = $FFFFFFFF;
  WinFileAttributeReparsePoint = $400;

var
  DataDirPage: TWizardPage;
  DataDirFolderIcon: TBitmapImage;
  DataDirLine1: TNewStaticText;
  DataDirLine2: TNewStaticText;
  DataDirEdit: TNewPathEdit;
  DataDirBrowseButton: TNewButton;
  // What the data-directory field was prefilled with, so a pointer file is
  // only written when the user actually picks a non-default location.
  InitialDataDir: String;

function DefaultDataDir: String;
begin
  Result := ExpandConstant('{userappdata}\Heimdall');
end;

function DataPointerFile: String;
begin
  Result := ExpandConstant('{userappdata}\Heimdall\data-location.ini');
end;

// ---------------------------------------------------------------------------
// Win32 declaration for reparse-point detection.
//
// ExpandFileName only performs *syntactic* normalization (absolute path,
// relative-to-absolute, ".." segment folding); it does NOT resolve
// junctions or reparse points. A junction whose target lies inside the
// data directory would therefore pass the containment check while the
// actual write lands inside the data directory, causing a self-nesting
// copy. The usual resolution (GetFinalPathNameByHandleW) cannot be used
// from Inno's Pascal Script: its String output parameter is unsupported
// by the external-call mechanism, so reparse-point data directories are
// rejected instead of resolved (see IsReparsePoint below).
// ---------------------------------------------------------------------------
function WinGetFileAttributesW(const lpFileName: String): Cardinal;
  external 'GetFileAttributesW@kernel32.dll stdcall';

// True when APath exists and is a junction or symlink (directory reparse
// point), or when any of its ancestors is one: a plain folder under a
// junction still physically resolves through it. GetFileAttributesW reads
// the reparse-point attribute without following the path, so no handle is
// needed.
function IsReparsePoint(APath: String): Boolean;
var
  CurrentPath, ParentPath: String;
  Attr: Cardinal;
begin
  Result := False;
  CurrentPath := ExpandFileName(Trim(APath));
  while CurrentPath <> '' do
  begin
    Attr := WinGetFileAttributesW(CurrentPath);
    if (Attr <> WinInvalidFileAttributes) and
       ((Attr and WinFileAttributeReparsePoint) <> 0) then
    begin
      Result := True;
      Exit;
    end;
    ParentPath := ExtractFileDir(CurrentPath);
    // ExtractFileDir returns the path itself at a drive root, so the
    // comparison guards against walking forever.
    if CompareText(ParentPath, CurrentPath) = 0 then
      Break;
    CurrentPath := ParentPath;
  end;
end;

// Mirrors the data-directory rules from the old installer.nsh:
//   empty  -> True (means "use default", pointer is not written)
//   UNC    -> True
//   drive  -> True only when it is an absolute path (X:\...) and not a drive root
//   relative -> False
function IsValidDataDir(const Path: String): Boolean;
var
  L: String;
begin
  L := Trim(Path);
  if L = '' then
  begin
    Result := True;
    Exit;
  end;
  if Length(L) < 2 then
  begin
    Result := False;
    Exit;
  end;
  if Copy(L, 1, 2) = '\\' then
  begin
    Result := True; // UNC path
    Exit;
  end;
  if Copy(L, 2, 1) = ':' then
  begin
    // drive-letter path: must be absolute (X:\) and not a bare drive root (X:\)
    if Copy(L, 3, 1) <> '\' then
    begin
      Result := False; // drive-relative, e.g. D:relative
      Exit;
    end;
    if Length(L) = 3 then
    begin
      Result := False; // drive root, e.g. C:\
      Exit;
    end;
    Result := True;
    Exit;
  end;
  Result := False; // relative path
end;

procedure DataDirBrowseOnClick(Sender: TObject);
var
  Dir: String;
begin
  Dir := DataDirEdit.Text;
  if BrowseForFolder('Select Heimdall data directory', Dir, True) then
    DataDirEdit.Text := Dir;
end;

// True when AChild is the same as, or located inside, AParent. Paths are
// normalized (.. segments, environment variables) and compared
// case-insensitively without trailing separators. Reparse points are not
// resolved here; they are rejected at input (see IsReparsePoint).
function IsPathWithin(AParent, AChild: String): Boolean;
var
  Parent, Child: String;
begin
  Parent := LowerCase(ExpandFileName(Trim(AParent)));
  Child := LowerCase(ExpandFileName(Trim(AChild)));
  while (Length(Parent) > 1) and (Copy(Parent, Length(Parent), 1) = '\') do
    Delete(Parent, Length(Parent), 1);
  while (Length(Child) > 1) and (Copy(Child, Length(Child), 1) = '\') do
    Delete(Child, Length(Child), 1);
  if Parent = Child then
  begin
    Result := True;
    Exit;
  end;
  Result := Pos(Parent + '\', Child) = 1;
end;

function DataDirNextButtonClick(Sender: TWizardPage): Boolean;
var
  DataDir, EffectiveDir: String;
  SameDir: Boolean;
begin
  Result := True;
  DataDir := Trim(DataDirEdit.Text);
  if DataDir = '' then
    Exit; // empty -> use default, proceed
  if not IsValidDataDir(DataDir) then
  begin
    MsgBox('That is not a valid folder path. Heimdall will use the default data directory:' + #13#10 +
      DefaultDataDir, mbError, MB_OK);
    // fall back to the default location and continue (matches the old installer)
    DataDirEdit.Text := '';
    Exit;
  end;
  // A junction or symlink cannot be resolved here (ExpandFileName is
  // syntactic only), so it could pass the containment checks below while
  // physically pointing inside the current data directory; reject it.
  if IsReparsePoint(DataDir) then
  begin
    MsgBox('The data directory must be a real folder, not a junction or symlink.' + #13#10 +
      'Choose a different folder to continue.', mbError, MB_OK);
    // Keep the user on this page with the known-good directory restored.
    DataDirEdit.Text := InitialDataDir;
    Result := False;
  end;
  // The in-app data location change refuses directories that contain each
  // other; the installer must too, or the data copy would nest itself.
  EffectiveDir := DataDir;
  if CompareText(DataDir, DefaultDataDir) = 0 then
    EffectiveDir := DefaultDataDir;
  if InitialDataDir = '' then
    Exit;
  // Normalized equality: the same directory (case, trailing separator, or
  // .. segments aside) is not a containment conflict.
  SameDir := IsPathWithin(InitialDataDir, EffectiveDir) and IsPathWithin(EffectiveDir, InitialDataDir);
  if not SameDir and
      (IsPathWithin(InitialDataDir, EffectiveDir) or IsPathWithin(EffectiveDir, InitialDataDir)) then
  begin
    MsgBox('The new data directory must not be inside the current one or contain it.' + #13#10 +
      'Current data directory:' + #13#10 + InitialDataDir, mbError, MB_OK);
    // Keep the user on this page with the known-good directory restored.
    DataDirEdit.Text := InitialDataDir;
    Result := False;
  end;
end;

// One-time NSIS -> Inno migration. When an Inno install does not exist yet but
// an old electron-builder NSIS install does, carry its install path over so the
// wizard pre-fills the directory the user already chose instead of the default.
// The old NSIS key is only removed in PrepareToInstall (after the wizard), so it
// is still readable here. Guarded by the absence of the Inno uninstall key, so
// an Inno -> Inno upgrade is left to the built-in UsePreviousAppDir.
procedure PrefillInstallDirFromOldNsInstall;
var
  OldDir: String;
begin
  if RegKeyExists(HKCU, InnoUninstallSubKey) then
    Exit; // an Inno install exists: built-in behavior already handles the path
  if RegQueryStringValue(HKCU, 'Software\' + OldNsGuid, 'InstallLocation', OldDir) then
  begin
    OldDir := Trim(OldDir);
    if (OldDir <> '') and (Length(OldDir) >= 3) and (Copy(OldDir, 2, 1) = ':') then
      WizardForm.DirEdit.Text := OldDir;
  end;
end;

procedure InitializeWizard;
var
  PrevDataDir: String;
  IconWidth: Integer;
begin
  PrefillInstallDirFromOldNsInstall;

  DataDirPage := CreateCustomPage(wpSelectDir, 'Choose the data directory', '');

  // Mirror the built-in Select Destination Location page so the two pages
  // line up: a folder icon in the top-left, two text lines, then the path
  // edit spanning the row with the Browse button pinned to the right edge.
  IconWidth := ScaleX(24);

  DataDirFolderIcon := TBitmapImage.Create(DataDirPage);
  DataDirFolderIcon.Width := IconWidth;
  DataDirFolderIcon.Height := ScaleY(24);
  InitializeBitmapImageFromStockIcon(DataDirFolderIcon, SIID_FOLDER, clNone, []);
  DataDirFolderIcon.Left := 0;
  DataDirFolderIcon.Top := 0;
  DataDirFolderIcon.Parent := DataDirPage.Surface;

  DataDirLine1 := TNewStaticText.Create(DataDirPage);
  DataDirLine1.Caption := 'Heimdall stores its config, logs, and local app state in the following folder.';
  DataDirLine1.Left := IconWidth + ScaleX(12);
  DataDirLine1.Top := ScaleY(4);
  DataDirLine1.Width := DataDirPage.SurfaceWidth - DataDirLine1.Left;
  DataDirLine1.Parent := DataDirPage.Surface;

  DataDirLine2 := TNewStaticText.Create(DataDirPage);
  DataDirLine2.Caption := 'To continue, click Next. If you would like to use a different folder, click Browse.';
  DataDirLine2.Left := 0;
  DataDirLine2.Top := ScaleY(36);
  DataDirLine2.Width := DataDirPage.SurfaceWidth;
  DataDirLine2.Parent := DataDirPage.Surface;

  DataDirBrowseButton := TNewButton.Create(DataDirPage);
  DataDirBrowseButton.Caption := 'Browse...';
  DataDirBrowseButton.Width := WizardForm.CalculateButtonWidth(['Browse...']);
  DataDirBrowseButton.Left := DataDirPage.SurfaceWidth - DataDirBrowseButton.Width;
  DataDirBrowseButton.Top := ScaleY(67);
  DataDirBrowseButton.Height := ScaleY(23);
  DataDirBrowseButton.OnClick := @DataDirBrowseOnClick;
  DataDirBrowseButton.Parent := DataDirPage.Surface;

  DataDirEdit := TNewPathEdit.Create(DataDirPage);
  DataDirEdit.Left := 0;
  DataDirEdit.Top := ScaleY(68);
  DataDirEdit.Width := DataDirBrowseButton.Left - DataDirEdit.Left - ScaleX(8);
  DataDirEdit.Parent := DataDirPage.Surface;

  // Prefill the previously chosen data directory on an upgrade, or the default
  // location otherwise.
  PrevDataDir := GetIniString(DataPointerSection, DataPointerKey, '', DataPointerFile);
  if PrevDataDir <> '' then
    DataDirEdit.Text := PrevDataDir
  else
    DataDirEdit.Text := DefaultDataDir;
  InitialDataDir := DataDirEdit.Text;

  DataDirPage.OnNextButtonClick := @DataDirNextButtonClick;
end;

function IsDataMigrationSkipEntry(AName: String): Boolean;
begin
  // Transient config-store files are never migrated.
  if Pos('.config-', AName) = 1 then
  begin
    Result := True;
    Exit;
  end;
  // Exact-match lookup in the ';'-delimited skip list.
  Result := Pos(';' + AName + ';', ';' + DataMigrationSkipList + ';') > 0;
end;

// Recursively copies everything from ASrcDir into ADestDir, creating
// directories as needed. Existing files in ADestDir are never overwritten, so
// a target that already holds data stays intact; existing directories are
// still traversed so files missing from them are filled in. Returns False
// when a directory could not be created or a file could not be copied.
function CopyDataTree(ASrcDir, ADestDir: String): Boolean;
var
  FindRec: TFindRec;
  SrcPath, DestPath: String;
begin
  if not ForceDirectories(ADestDir) then
  begin
    Result := False;
    Exit;
  end;
  if not FindFirst(ASrcDir + '\*', FindRec) then
  begin
    // The directory exists (ForceDirectories succeeded), so a failed
    // enumeration means it could not be read, not that it is empty.
    Result := False;
    Exit;
  end;
  Result := True;
  repeat
    if (FindRec.Name = '.') or (FindRec.Name = '..') then
      Continue;
    SrcPath := ASrcDir + '\' + FindRec.Name;
    DestPath := ADestDir + '\' + FindRec.Name;
    if FindRec.Attributes and FILE_ATTRIBUTE_DIRECTORY <> 0 then
    begin
      // A directory junction inside the source tree could point back at an
      // ancestor of itself, making the recursive copy self-nesting; never
      // descend into one.
      if FindRec.Attributes and WinFileAttributeReparsePoint <> 0 then
        Continue;
      if not CopyDataTree(SrcPath, DestPath) then
      begin
        Result := False;
        Break;
      end;
    end
    else if not FileExists(DestPath) then
    begin
      if not CopyFile(SrcPath, DestPath, False) then
      begin
        Result := False;
        Break;
      end;
    end;
  until not FindNext(FindRec);
  FindClose(FindRec);
end;

// Copies the user data (config, logs, usage) from the previously effective
// data directory into the new one, so a directory change does not lose the
// existing configuration. Mirrors the in-app changeDataDir migration: only
// top-level runtime artifacts are skipped, nested files are copied as-is.
// Returns False when the copy could not be completed.
function MigrateDataFiles(FromDir, ToDir: String): Boolean;
var
  FindRec: TFindRec;
  SrcPath, DestPath: String;
begin
  Result := False;
  if (FromDir = '') or (ToDir = '') then
    Exit;
  // Normalized equality: the same directory (case, trailing separator, or
  // .. segments aside) means there is nothing to migrate.
  if IsPathWithin(FromDir, ToDir) and IsPathWithin(ToDir, FromDir) then
  begin
    Result := True;
    Exit;
  end;
  // A destination inside the source would make the copy enumerate its own
  // output; a source inside the destination mirrors the in-app rule that the
  // two directories may not contain each other.
  if IsPathWithin(FromDir, ToDir) or IsPathWithin(ToDir, FromDir) then
    Exit;
  // Reparse points cannot be resolved here, so a junction as source or
  // destination could physically nest the copy; refuse to migrate and let
  // the caller keep the data where it is.
  if IsReparsePoint(FromDir) or IsReparsePoint(ToDir) then
    Exit;
  if not DirExists(FromDir) then
  begin
    Result := True; // nothing to migrate
    Exit;
  end;
  if not ForceDirectories(ToDir) then
    Exit;
  if not FindFirst(FromDir + '\*', FindRec) then
  begin
    // DirExists just succeeded, so a failed enumeration means the source
    // could not be read, not that it is empty.
    Result := False;
    Exit;
  end;
  Result := True;
  repeat
    if (FindRec.Name = '.') or (FindRec.Name = '..') then
      Continue;
    // Only top-level runtime artifacts are excluded, mirroring
    // MIGRATION_SKIP_ENTRIES in gui/electron/data-location.ts.
    if IsDataMigrationSkipEntry(FindRec.Name) then
      Continue;
    SrcPath := FromDir + '\' + FindRec.Name;
    DestPath := ToDir + '\' + FindRec.Name;
    if FindRec.Attributes and FILE_ATTRIBUTE_DIRECTORY <> 0 then
    begin
      // A directory junction inside the source tree could point back at an
      // ancestor of itself, making the recursive copy self-nesting; never
      // descend into one.
      if FindRec.Attributes and WinFileAttributeReparsePoint <> 0 then
        Continue;
      if not CopyDataTree(SrcPath, DestPath) then
      begin
        Result := False;
        Break;
      end;
    end
    else if not FileExists(DestPath) then
    begin
      if not CopyFile(SrcPath, DestPath, False) then
      begin
        Result := False;
        Break;
      end;
    end;
  until not FindNext(FindRec);
  FindClose(FindRec);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  DataDir, NewEffectiveDir: String;
begin
  if CurStep = ssPostInstall then
  begin
    // Silent installs (e.g. the in-app updater) must not rewrite the pointer,
    // otherwise a fresh silent install would overwrite an existing choice.
    if WizardSilent then
      Exit;
    DataDir := Trim(DataDirEdit.Text);
    // The field is prefilled with the default (or the previous custom) path.
    // An unchanged field keeps the pointer exactly as it was.
    if DataDir = InitialDataDir then
      Exit;
    // An empty or default path means "use the default location".
    NewEffectiveDir := DefaultDataDir;
    if (DataDir <> '') and (CompareText(DataDir, DefaultDataDir) <> 0) then
      NewEffectiveDir := DataDir;
    // Carry the existing user data over to the new location before the
    // pointer is rewritten, so the app does not start with an empty config.
    // The pointer only moves once the copy has fully succeeded; a failed
    // migration leaves Heimdall reading from its original location.
    if not MigrateDataFiles(InitialDataDir, NewEffectiveDir) then
    begin
      MsgBox('Copying the existing Heimdall data to the new data directory failed.' + #13#10 +
        'The data directory was not changed; your data remains in its original location.' + #13#10 +
        'Copy the files manually and start Heimdall again.', mbError, MB_OK);
      Exit;
    end;
    if NewEffectiveDir = DefaultDataDir then
      // A stale custom pointer must be deleted, or the app would keep using
      // the old directory the user just cleared.
      DeleteIniEntry(DataPointerSection, DataPointerKey, DataPointerFile)
    else
    begin
      CreateDir(DataDir);
      CreateDir(DefaultDataDir);
      SetIniString(DataPointerSection, DataPointerKey, DataDir, DataPointerFile);
    end;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
  DefaultDir: String;
begin
  if CurUninstallStep = usUninstall then
  begin
    // Silent uninstall: keep the data, ask nothing (matches the old IfSilent).
    if UninstallSilent then
      Exit;

    DefaultDir := DefaultDataDir;
    DataDir := GetIniString(DataPointerSection, DataPointerKey, '', DataPointerFile);
    if DataDir = '' then
      DataDir := DefaultDir;

    if MsgBox('Do you also want to delete Heimdall user data?' + #13#10 + #13#10 +
      'This removes config.json, logs, and local app state from:' + #13#10 +
      DataDir + #13#10 + DefaultDir, mbConfirmation, MB_YESNO) <> IDYES then
      Exit;

    // Only delete the chosen directory when it is a sane absolute path that is
    // not a drive root; a corrupt/relative pointer must not trigger a wipe.
    if (DataDir <> '') and IsValidDataDir(DataDir) then
      DelTree(DataDir, True, True, True);

    // The default directory is always removed when the user confirms.
    DelTree(DefaultDir, True, True, True);
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  OldInstallDir: String;
  OldUninstallExe: String;
begin
  Result := '';
  NeedsRestart := False;

  // Drop the old NSIS Add/Remove Programs entry and its install-info key.
  RegDeleteKeyIncludingSubkeys(HKCU, 'Software\' + OldNsGuid);
  RegDeleteKeyIncludingSubkeys(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\' + OldNsGuid);

  // If the old (lowercase) install is still present, run its uninstaller
  // silently so leftover files are removed before the new ones are copied.
  // On a case-insensitive filesystem this is the same folder the new install
  // uses, and PrepareToInstall runs before any files are copied.
  OldInstallDir := ExpandConstant('{localappdata}\Programs\heimdall');
  OldUninstallExe := OldInstallDir + '\Uninstall Heimdall.exe';
  if FileExists(OldUninstallExe) then
  begin
    // _?= (must be last, unquoted) keeps NSIS from re-spawning a temporary
    // copy: without it, ewWaitUntilTerminated would wait only for the
    // launcher while the temp copy keeps deleting OldInstallDir in the
    // background — the same folder the new install copies files into.
    if Exec(OldUninstallExe, '/S _?=' + OldInstallDir, OldInstallDir, SW_HIDE,
         ewWaitUntilTerminated, ResultCode) and (ResultCode = 0) then
      // The in-place uninstaller cannot delete its own exe; remove the
      // orphan so it does not linger in the new installation directory.
      DeleteFile(OldUninstallExe)
    else
      // A failed old-uninstaller can leave a mix of old and new files behind.
      MsgBox('The previous Heimdall version could not be fully uninstalled (code ' +
        IntToStr(ResultCode) + '). Some old files may remain.' + #13#10 + #13#10 +
        'The new version will still be installed.', mbInformation, MB_OK);
  end;
end;
