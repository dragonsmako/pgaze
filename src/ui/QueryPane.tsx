import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import type { Connection } from '../db/client.js';
import { runQuery } from '../db/introspect.js';
import { extractVariables, substituteVariables } from '../db/sqlVars.js';
import type { QueryResult } from '../types.js';
import { DataGrid } from './DataGrid.js';
import {
  MultilineEditor,
  type MultilineEditorState,
  emptyEditorState,
  editorStateFromText,
  editorStateText,
} from './MultilineEditor.js';
import { keypressBus } from '../lib/keypress.js';
import { stripAnsi } from '../lib/textUtil.js';
import { IMPLICIT_AD_HOC_LIMIT } from '../config/uiConstants.js';

type Props = {
  conn: Connection;
  focused: boolean;
  maxCols: number;
  maxRows: number;
  seedSql?: string;
  seedKey?: number;
};

type Mode = 'editor' | 'variables' | 'running' | 'results';

function severityColor(severity: string): string | undefined {
  const s = severity.toUpperCase();
  if (s === 'WARNING') return 'yellow';
  if (s === 'NOTICE') return 'cyan';
  if (s === 'INFO') return 'green';
  if (s.startsWith('DEBUG') || s === 'LOG') return 'gray';
  if (s === 'ERROR' || s === 'FATAL' || s === 'PANIC') return 'red';
  return undefined;
}

// Detect a bare top-level SELECT without LIMIT or multiple statements,
// using the SQL-aware tokenizer for accuracy. We only auto-LIMIT in this
// safe case; everything else passes through untouched.
function shouldAutoLimit(sql: string): boolean {
  const trimmed = sql.trim().replace(/;\s*$/, '');
  if (!/^\s*select\b/i.test(trimmed)) return false;
  if (/\blimit\s+\d/i.test(trimmed)) return false;
  // Reject multiple top-level statements (use the existing tokenizer to
  // count semicolons outside strings/comments/dollar-quotes).
  const semis = countTopLevelSemicolons(trimmed);
  if (semis > 0) return false;
  return true;
}

function countTopLevelSemicolons(sql: string): number {
  // Lightweight reuse of the same state machine as sqlVars.tokenize:
  // we don't need full tokens, just to skip over strings/comments/dollar
  // quotes when looking for `;`.
  let i = 0;
  let semis = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < sql.length) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth++; i += 2; }
        else if (sql[i] === '*' && sql[i + 1] === '/') { depth--; i += 2; }
        else i++;
      }
      continue;
    }
    if (ch === '$') {
      const m = sql.slice(i).match(/^\$([a-zA-Z_][a-zA-Z0-9_]*)?\$/);
      if (m) {
        const tag = m[0];
        i += tag.length;
        const close = sql.indexOf(tag, i);
        if (close === -1) { i = sql.length; }
        else { i = close + tag.length; }
        continue;
      }
    }
    if (ch === ';') semis++;
    i++;
  }
  return semis;
}

export const QueryPane: React.FC<Props> = ({
  conn,
  focused,
  maxCols,
  maxRows,
  seedSql,
  seedKey,
}) => {
  const [editor, setEditor] = useState<MultilineEditorState>(emptyEditorState);
  const [mode, setMode] = useState<Mode>('editor');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSql, setLastSql] = useState('');
  const [autoLimited, setAutoLimited] = useState(false);

  // variable prompt state
  const [varNames, setVarNames] = useState<string[]>([]);
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  const [varCache, setVarCache] = useState<Record<string, string>>({});
  const [varFocus, setVarFocus] = useState<number>(0);

  // ────── seed SQL when the tree picks a function template ──────
  useEffect(() => {
    if (seedKey === undefined || seedKey === 0) return;
    if (seedSql === undefined) return;
    setEditor(editorStateFromText(seedSql));
    setMode('editor');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  // ────── execution flow ──────

  // We keep refs for cancellation + stable closures used by the keypressBus.
  const cancelRef = useRef<{ cancelled: boolean } | null>(null);

  function startExecute(): void {
    if (mode !== 'editor') return;
    const sql = editorStateText(editor).trim();
    if (sql.length === 0) return;
    const vars = extractVariables(sql);
    if (vars.length === 0) {
      runWithVars(sql, {});
      return;
    }
    const initial: Record<string, string> = {};
    for (const v of vars) initial[v] = varCache[v] ?? '';
    setVarNames(vars);
    setVarValues(initial);
    setVarFocus(0);
    setMode('variables');
  }

  function runWithVars(sql: string, raw: Record<string, string>): void {
    const valuesForSubst: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      valuesForSubst[k] = v.length === 0 ? null : v;
    }
    const { sql: out, values } = substituteVariables(sql, valuesForSubst);
    // 2.4: implicit LIMIT for a bare SELECT to avoid OOM.
    let finalSql = out;
    let limited = false;
    if (values.length === 0 && shouldAutoLimit(out)) {
      finalSql = `${out.replace(/;\s*$/, '')} LIMIT ${IMPLICIT_AD_HOC_LIMIT}`;
      limited = true;
    }
    // 2.7: warn on multi-statement + variables before pg rejects it.
    if (values.length > 0 && countTopLevelSemicolons(out.replace(/;\s*$/, '')) > 0) {
      setError(
        'Queries that use :variables can only contain one statement. Remove the inner `;` and try again.',
      );
      setLastSql(sql);
      setResult(null);
      setAutoLimited(false);
      setMode('results');
      return;
    }
    setLastSql(sql);
    setAutoLimited(limited);
    setMode('running');
    setError(null);
    setResult(null);
    const token = { cancelled: false };
    cancelRef.current = token;
    runQuery(conn, finalSql, values)
      .then((res) => {
        if (token.cancelled) return;
        setResult(res);
        setMode('results');
      })
      .catch((err: unknown) => {
        if (token.cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setMode('results');
      });
  }

  function confirmVarsAndRun(): void {
    setVarCache((prev) => ({ ...prev, ...varValues }));
    const sql = editorStateText(editor).trim();
    runWithVars(sql, varValues);
  }

  // Cancel any in-flight query when this component unmounts (or pane changes).
  useEffect(() => {
    return () => {
      if (cancelRef.current) cancelRef.current.cancelled = true;
    };
  }, []);

  // 2.1: single keypressBus subscription with a ref-based dispatcher.
  const dispatchRef = useRef<() => void>(() => {});
  dispatchRef.current = () => {
    if (!focused) return;
    if (mode === 'editor') startExecute();
    else if (mode === 'variables') confirmVarsAndRun();
  };
  useEffect(() => {
    const handler = (): void => dispatchRef.current();
    keypressBus.on('ctrl-enter', handler);
    return () => {
      keypressBus.off('ctrl-enter', handler);
    };
  }, []);

  // ────── input handling for non-editor modes ──────
  useInput(
    (input, key) => {
      if (mode === 'editor') {
        // Ctrl+R fallback for terminals that don't distinguish Ctrl+Enter.
        if (key.ctrl && input === 'r') {
          startExecute();
          return;
        }
        // The MultilineEditor owns all other keys when focused.
        return;
      }

      if (mode === 'variables') {
        if (key.escape) {
          setMode('editor');
          return;
        }
        if (key.upArrow) {
          setVarFocus((i) => Math.max(0, i - 1));
          return;
        }
        if (key.downArrow) {
          setVarFocus((i) => Math.min(varNames.length, i + 1));
          return;
        }
        if (key.tab) {
          setVarFocus((i) => {
            const total = varNames.length + 1;
            const dir = key.shift ? -1 : 1;
            return (i + dir + total) % total;
          });
          return;
        }
        if (key.return && varFocus === varNames.length) {
          confirmVarsAndRun();
          return;
        }
        if ((key.ctrl && key.return) || (key.ctrl && input === 'r')) {
          confirmVarsAndRun();
          return;
        }
        return;
      }

      if (mode === 'results') {
        if (input === 'e' || key.backspace) {
          setMode('editor');
          return;
        }
      }
    },
    { isActive: focused },
  );

  // ────── render ──────

  if (mode === 'running') {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text>
          <Spinner type="dots" /> Running…
        </Text>
        <Box marginTop={1}>
          <Text dimColor wrap="truncate">{lastSql}</Text>
        </Box>
      </Box>
    );
  }

  if (mode === 'variables') {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="magenta">Variables</Text>
          <Text dimColor>  fill in :name placeholders, then Run</Text>
        </Box>
        {varNames.map((name, i) => {
          const isFocused = varFocus === i && focused;
          return (
            <Box key={name}>
              <Box width={Math.min(20, Math.max(8, name.length + 4))}>
                <Text color={isFocused ? 'green' : undefined}>
                  {isFocused ? '▸ ' : '  '}:{name}
                </Text>
              </Box>
              <Box flexGrow={1}>
                {isFocused ? (
                  <TextInput
                    value={varValues[name] ?? ''}
                    onChange={(v) =>
                      setVarValues((prev) => ({ ...prev, [name]: v }))
                    }
                    onSubmit={() => {
                      if (i < varNames.length - 1) setVarFocus(i + 1);
                      else setVarFocus(varNames.length);
                    }}
                    placeholder="(empty = NULL)"
                  />
                ) : (
                  <Text dimColor>
                    {varValues[name]?.length
                      ? varValues[name]
                      : <Text dimColor>NULL</Text>}
                  </Text>
                )}
              </Box>
            </Box>
          );
        })}
        <Box marginTop={1}>
          <Text
            color={varFocus === varNames.length ? 'black' : 'green'}
            backgroundColor={varFocus === varNames.length ? 'green' : undefined}
            bold={varFocus === varNames.length}
          >
            {varFocus === varNames.length ? ' ▶ Run query ' : ' [ Run query ] '}
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            [↑↓/Tab] move · [Enter] next/run · [Ctrl+Enter / Ctrl+R] run · [Esc] cancel
          </Text>
        </Box>
      </Box>
    );
  }

  if (mode === 'results') {
    const sqlPreview = lastSql.replace(/\s+/g, ' ').trim();
    const notices = result?.notices ?? [];
    const hasGrid = !!result && !error && result.columns.length > 0;
    const summary = (() => {
      if (error) return '(error)';
      if (!result) return '';
      if (result.columns.length > 0) {
        return `${result.rows.length} row${result.rows.length === 1 ? '' : 's'} · ${result.columns.length} col(s)`;
      }
      const cmd = result.command ?? 'OK';
      return `${cmd}${result.rowCount ? ` · ${result.rowCount} row(s) affected` : ''}`;
    })();
    return (
      <Box flexDirection="column">
        <Box paddingX={1} flexDirection="row" justifyContent="space-between">
          <Text>
            <Text bold color="magenta">Results</Text>
            <Text dimColor>{'  '}{summary}</Text>
          </Text>
          {focused && <Text dimColor>[e] edit · [Ctrl+Q] tables</Text>}
        </Box>
        <Box paddingX={1}>
          <Text dimColor wrap="truncate">› {sqlPreview}</Text>
        </Box>

        {autoLimited && (
          <Box paddingX={1} marginTop={1}>
            <Text color="yellow">
              ⚠ Auto-applied LIMIT {IMPLICIT_AD_HOC_LIMIT}. Add an explicit LIMIT to query for more rows.
            </Text>
          </Box>
        )}

        {error && (
          <Box paddingX={1} marginTop={1}>
            <Text color="red">{stripAnsi(error)}</Text>
          </Box>
        )}

        {notices.length > 0 && (
          <Box flexDirection="column" paddingX={1} marginTop={1}>
            <Text dimColor>messages:</Text>
            {notices.map((n, i) => (
              <Text key={i} color={severityColor(n.severity)} wrap="truncate">
                {stripAnsi(n.severity)}: {stripAnsi(n.message)}
              </Text>
            ))}
          </Box>
        )}

        {hasGrid && (
          <Box marginTop={1} flexDirection="column">
            <DataGrid
              columns={result!.columns}
              rows={result!.rows}
              maxCols={maxCols}
              maxRows={Math.max(2, maxRows - 6 - Math.min(notices.length, 4))}
            />
          </Box>
        )}

        {!hasGrid && !error && result && notices.length === 0 && (
          <Box paddingX={1} marginTop={1}>
            <Text dimColor>
              {result.command ?? 'OK'}
              {result.rowCount ? ` — ${result.rowCount} row(s) affected` : ''}
              {' (no rows returned)'}
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  // editor mode
  return (
    <Box flexDirection="column">
      <Box paddingX={1} flexDirection="row" justifyContent="space-between">
        <Text>
          <Text bold color="magenta">SQL editor</Text>
          <Text dimColor>
            {'  '}line {editor.cursorRow + 1}/{editor.lines.length} · col {editor.cursorCol + 1}
          </Text>
        </Text>
        {focused && (
          <Text dimColor>
            [Ctrl+Enter / Ctrl+R] run · :var = parameter · [Esc] tree
          </Text>
        )}
      </Box>
      <MultilineEditor
        state={editor}
        onChange={setEditor}
        focused={focused}
        maxCols={maxCols}
        maxRows={Math.max(3, maxRows - 1)}
      />
    </Box>
  );
};
