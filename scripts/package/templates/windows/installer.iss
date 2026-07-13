; Naviyra Panel — Windows installer (Inno Setup 6)
; Build: iscc scripts/package/templates/windows/installer.iss

#define AppName "Naviyra Panel"
#define AppVersion "0.1.0"
#define AppPublisher "Naviyra"
#define AppURL "https://naviyra.com"
#define ReleaseDir "bundle"

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
DefaultDirName={autopf}\Naviyra Panel
DefaultGroupName={#AppName}
OutputDir=.
OutputBaseFilename=NaviyraPanel-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"

[Files]
Source: "{#ReleaseDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\bin\naviyra-panel.cmd"; WorkingDir: "{app}\app"
Name: "{group}\Stop {#AppName}"; Filename: "{app}\bin\naviyra-panel.cmd"; Parameters: "stop"; WorkingDir: "{app}\app"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\bin\naviyra-panel.cmd"; Tasks: desktopicon; WorkingDir: "{app}\app"

[Run]
Filename: "{app}\bin\naviyra-panel.cmd"; Description: "Launch {#AppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\app\data"
