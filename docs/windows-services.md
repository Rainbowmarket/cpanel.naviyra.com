# Native Windows service controls

Admin → Services discovers hosting services registered with Windows Service Control Manager.
It displays their real running/stopped state and startup mode.
Start, stop and restart execute live operations. Run the agent/launcher
as Administrator to change services. Reading the service inventory does not change the machine.

## Supported services

| Panel entry | Default Windows service names |
| --- | --- |
| Apache | Apache2.4, Apache24, Apache2.2 |
| MySQL | MySQL, MySQL80, MySQL84 and other MySQL version names |
| MariaDB | MariaDB and versioned MariaDB names |
| PostgreSQL | postgresql, postgresql-x64-17 and other versioned names |
| FTP | FileZilla Server, filezilla-server |
| Nginx | NaviyraNginx, nginx (requires a service wrapper) |
| PHP FastCGI | NaviyraPHP (requires a service wrapper) |
| Panel / agent | NaviyraPanel / NaviyraAgent, or naviyra-panel / naviyra-agent |

Install software with its official installer and select its Windows-service option.
For an existing XAMPP installation, register Apache and MySQL as services using the
XAMPP control panel running as Administrator. A running console application is not a
registered service and is not claimed as installed by this screen.

For Apache's native registration, run `httpd.exe -k install -n "Apache2.4"` from its
installed bin directory in an elevated terminal. Test its configuration before starting it.
See [Apache's Windows instructions](https://httpd.apache.org/docs/2.4/platform/windows.html).

Nginx for Windows is a console application, not a native Windows service. A separately
configured service wrapper is required for these controls. Do not register node.exe,
php-cgi.exe or nginx.exe directly with `sc create`: they do not implement the Windows
service protocol. See [Nginx's Windows documentation](https://nginx.org/en/docs/windows.html).

## Custom names and multiple installations

Set the exact registered service name in the host's `.env`, then restart the launcher:

```env
WINDOWS_SERVICE_APACHE=Apache2.4
WINDOWS_SERVICE_MYSQL=MySQL84
WINDOWS_SERVICE_POSTGRESQL=postgresql-x64-17
```

The pattern is `WINDOWS_SERVICE_<PANEL_ID>` with uppercase letters and underscores
instead of hyphens; PHP uses `WINDOWS_SERVICE_PHP_FPM`.
These overrides are privileged host configuration, not user-submitted service names.
When several database instances match, the panel refuses to choose one automatically.
Each entry manages one configured instance.

Panel and agent services must be controlled outside the panel to avoid interrupting
their own response. Services directly hosting the current agent are also protected. Disabled services
must first be enabled in Windows Services. Restart waits for the stopped and running
states and does not force dependent services to stop.

## Scope

This adds native service lifecycle management, not full Windows hosting-stack parity.
It does not download software, register wrappers, open firewall ports, or change startup
types. Linux-only Postfix, Dovecot, BIND and systemd timers are marked unavailable;
Linux installation buttons are not offered on Windows. Website/vhost provisioning,
FTP account creation, mail delivery and backup scheduling retain their existing platform
limitations. Starting Apache alone does not provision panel-managed websites in Apache.

The agent stays private; expose website ports only through your chosen gateway.
Operations take effect immediately when requested; Administrator permissions are required.
