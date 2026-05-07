type Token =
  | { kind: 'text'; value: string }
  | { kind: 'var'; name: string };

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*/;

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let buffer = '';
  let i = 0;

  function flushText(): void {
    if (buffer.length > 0) {
      tokens.push({ kind: 'text', value: buffer });
      buffer = '';
    }
  }

  while (i < sql.length) {
    const ch = sql[i];

    // single-quoted string literal: '...''...'
    if (ch === "'") {
      buffer += ch;
      i++;
      while (i < sql.length) {
        const c = sql[i] as string;
        buffer += c;
        i++;
        if (c === "'") {
          if (sql[i] === "'") {
            buffer += "'";
            i++;
            continue;
          }
          break;
        }
      }
      continue;
    }

    // double-quoted identifier: "...""..."
    if (ch === '"') {
      buffer += ch;
      i++;
      while (i < sql.length) {
        const c = sql[i] as string;
        buffer += c;
        i++;
        if (c === '"') {
          if (sql[i] === '"') {
            buffer += '"';
            i++;
            continue;
          }
          break;
        }
      }
      continue;
    }

    // line comment -- ...
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') {
        buffer += sql[i];
        i++;
      }
      continue;
    }

    // block comment /* ... */ (Postgres allows nesting)
    if (ch === '/' && sql[i + 1] === '*') {
      let depth = 1;
      buffer += '/*';
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++;
          buffer += '/*';
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--;
          buffer += '*/';
          i += 2;
        } else {
          buffer += sql[i];
          i++;
        }
      }
      continue;
    }

    // dollar-quoted: $tag$ ... $tag$  (or  $$ ... $$)
    if (ch === '$') {
      const m = sql.slice(i).match(/^\$([a-zA-Z_][a-zA-Z0-9_]*)?\$/);
      if (m) {
        const tag = m[0];
        buffer += tag;
        i += tag.length;
        const close = sql.indexOf(tag, i);
        if (close === -1) {
          buffer += sql.slice(i);
          i = sql.length;
        } else {
          buffer += sql.slice(i, close + tag.length);
          i = close + tag.length;
        }
        continue;
      }
    }

    // type cast :: — skip both colons so :: doesn't become a variable
    if (ch === ':' && sql[i + 1] === ':') {
      buffer += '::';
      i += 2;
      continue;
    }

    // :variable
    if (ch === ':') {
      const rest = sql.slice(i + 1);
      const m = rest.match(IDENT);
      if (m) {
        flushText();
        tokens.push({ kind: 'var', name: m[0] });
        i += 1 + m[0].length;
        continue;
      }
    }

    buffer += ch;
    i++;
  }

  flushText();
  return tokens;
}

export function extractVariables(sql: string): string[] {
  const tokens = tokenize(sql);
  const seen: string[] = [];
  for (const t of tokens) {
    if (t.kind === 'var' && !seen.includes(t.name)) {
      seen.push(t.name);
    }
  }
  return seen;
}

export function substituteVariables(
  sql: string,
  values: Record<string, unknown>,
): { sql: string; values: unknown[] } {
  const tokens = tokenize(sql);
  const order: string[] = [];
  let out = '';
  for (const t of tokens) {
    if (t.kind === 'text') {
      out += t.value;
    } else {
      let idx = order.indexOf(t.name);
      if (idx === -1) {
        order.push(t.name);
        idx = order.length - 1;
      }
      out += `$${idx + 1}`;
    }
  }
  const valArr = order.map((n) =>
    Object.prototype.hasOwnProperty.call(values, n) ? values[n] : null,
  );
  return { sql: out, values: valArr };
}
