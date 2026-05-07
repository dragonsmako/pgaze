# pgadmin-tui

A terminal UI for browsing PostgreSQL databases. Manage saved servers, navigate
schemas and tables with arrow keys, view rows, and run ad-hoc SQL.

## Requirements

- Node.js >= 20
- On Linux, `libsecret` development headers (needed by `keytar` to use the OS keyring):

  ```sh
  sudo apt install libsecret-1-dev
  ```

## Install

```sh
npm install
```

## Run (dev)

```sh
npm run dev
```

## Build

```sh
npm run build
npm start
```

## Keybindings

### Server list
- `↑`/`↓` — move selection
- `Enter` — connect
- `a` — add a new server
- `e` — edit selected server
- `d` — delete selected server
- `q` — quit

### Connected view
- `↑`/`↓` — move within focused pane
- `→` / `Enter` — expand tree node
- `←` — collapse tree node
- `Tab` — switch focus (tree ↔ right pane)
- `q` — toggle right pane (Table ↔ Query)
- `n` / `p` — next / previous page (table view)
- `Ctrl+Enter` — run query (query pane)
- `Esc` — back

## Storage

- Server metadata: `$XDG_CONFIG_HOME/pgadmin-tui/servers.json` (mode 0600).
- Passwords: OS keyring (`pgadmin-tui` service). Falls back to prompting on
  connect if the keyring is unavailable.
