## pgaze

A terminal UI for browsing PostgreSQL databases. Manage saved servers, navigate
schemas and tables with arrow keys, view rows, and run ad-hoc SQL.

## Requirements

- Node.js >= 20
- On Linux, the `libsecret` runtime is used to talk to the GNOME / KDE keyring.
  It's installed by default on most desktop distros; if it isn't:

  ```sh
  sudo apt install libsecret-1-0
  ```

  No build-time dev headers are required — `pgaze` uses `@napi-rs/keyring`,
  which ships prebuilt native binaries.

## Install

Clone the repo, then either install globally or link for development.

### Global install (recommended)

```sh
npm install
npm install -g .
```

You can now run `pgaze` from anywhere:

```sh
pgaze
```

### Development link

```sh
npm install
npm run build
npm link        # creates a global `pgaze` symlink pointing at this checkout
```

Then `npm run build` after edits and the linked `pgaze` picks them up.

### Run without installing

```sh
npm install
npm run dev      # via tsx, no build step
```

> Note: the global `pgaze` command runs whichever `node` is first in your
> `PATH`. If you use nvm, make sure your default Node is ≥ 20:
> `nvm alias default 22`.

## Keybindings

### Server list
- `↑` / `↓` — move selection
- `Enter` — connect
- `a` — add a new server
- `e` — edit selected server
- `d` — delete selected server
- `q` — quit

### Add / edit server form
- `↑` / `↓` or `Tab` / `Shift+Tab` — move between fields
- `Enter` — next field, or save on the last field
- `Esc` — cancel

### Connected view
- `Tab` — switch focus (tree ↔ right pane)
- `Ctrl+Q` — toggle right pane (Table ↔ Query)
- `Esc` — back (right pane → tree → server list)

### Tree (left pane)

Each schema contains three lazy-loaded sections:

- **Tables** — ordinary, partitioned, and foreign tables (`pg_class.relkind` r/p/f)
- **Views** — views and materialized views (v/m)
- **Functions** — every routine in `pg_proc` (functions, procedures, aggregates, window functions). Selecting a function pre-fills the SQL editor with a callable template (`SELECT * FROM ...()` or `CALL ...()` for procedures), with the function's argument signature inlined as a comment.

Keys:

- `↑` / `↓` — move
- `Ctrl+↑` / `Ctrl+↓` — jump to prev / next sibling at the same depth
- `→` / `Enter` — expand a node (or activate a leaf)
- `←` — collapse a node
- `PgUp` / `PgDn` — page the viewport
- `/` — search across all schemas, tables, views, and functions; type to filter; `↑`/`↓` to move; `Enter` to open (tables/views go to the data view, functions go to the SQL editor); `Esc` to cancel

### Table view (right pane)
- `↑` / `↓` / `←` / `→` — move the cell cursor
- `Ctrl+↑` / `Ctrl+↓` — jump to first / last visible row
- `Ctrl+←` / `Ctrl+→` — jump to first / last column
- `Enter` — copy the current cell value to the clipboard (OSC 52)
- `s` — toggle sort on the current column (asc → desc → off)
- `n` / `p` — next / previous page

### Query pane (full-page editor)
- Type SQL across multiple lines like a normal text editor.
- `Enter` — insert a newline.
- `↑` / `↓` / `←` / `→` — move the caret. Cursor wraps between lines at the edges.
- `Ctrl+←` / `Ctrl+→` — jump one word.
- `Ctrl+↑` / `Ctrl+↓` — jump to start / end of the document.
- `Backspace` / `Delete` — delete the character before the caret (joins lines at column 0).
- `Ctrl+Enter` — execute the query.
- `Ctrl+R` — also executes (reliable fallback in every terminal).
- After running, the editor is hidden and results take the pane. Press `e` (or `Backspace`) to return to the editor; the SQL is preserved.

#### Variables (`:name`)
Reference parameters in your SQL with `:name`:

```sql
SELECT * FROM users WHERE id = :user_id AND active;
```

When you run a query containing variables, `pgaze` prompts you for each value.
Empty input is sent as `NULL`. Values are passed as `pg` parameters (`$1`, `$2`,
...) so they can't be SQL-injected.

The tokenizer is SQL-aware: `:name` inside string literals (`'...'`), quoted
identifiers (`"..."`), `--` line comments, `/* ... */` block comments, and
dollar-quoted blocks (`$$ ... $$` or `$tag$ ... $tag$`) is **not** treated as a
variable, so plpgsql function bodies stay intact:

```sql
DO $$
DECLARE
  threshold int := :min_count;
BEGIN
  PERFORM pg_notify('chan', 'over ' || threshold);
END
$$;
```

Last-used values for each variable name are remembered for the session.

#### Terminal note for Ctrl+Enter
On startup `pgaze` enables Kitty's keyboard protocol (level 1) and xterm's
`modifyOtherKeys=1` so Ctrl+Enter is reported distinctly from Enter. If your
terminal supports neither, use `Ctrl+R`.

## Storage

- Server metadata: `$XDG_CONFIG_HOME/pgaze/servers.json` (mode 0600).
- Passwords: OS keyring (`pgaze` service). Falls back to prompting on
  connect if the keyring is unavailable.

## License

MIT — see [LICENSE](./LICENSE).
