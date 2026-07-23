# Product identity and icon

Deskfin uses one stable identity across its runtime and release packages.
Changing these values after public distribution would create a second
application profile and can disrupt upgrades, shortcuts, login sessions, and
operating-system permissions.

| Field              | Value                         |
| ------------------ | ----------------------------- |
| Product name       | Deskfin                       |
| Package name       | `deskfin`                     |
| Application ID     | `io.github.jessielw.deskfin`  |
| Executable name    | `Deskfin`                     |
| macOS category     | Entertainment                 |
| Project repository | `github.com/jessielw/Deskfin` |

The package metadata in `package.json` is the build-time source of truth.
`src/shared/product.ts` mirrors the values used before Electron is ready, and an
automated test prevents the two definitions from drifting. Windows builds also
set the application ID as the user-model ID early so taskbar windows group
consistently.
