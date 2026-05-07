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
  keypressBus,
  looksLikeCtrlEnterFragment,
  recentlySawCtrlEnter,
} from '../lib/keypress.js';

type Props = {
  conn: Connection;
  focused: boolean;
  maxCols: number;
  maxRows: number;
  seedSql?: string;
  seedKey?: number;
};

type Mode = 'editor' | 'variables' | 'running' | 'results';

type EditorState = {
  lines: string[];
  cursorRow: number;
  cursorCol: number;
};

const initialEditor: EditorState = { lines: [''], cursorRow: 0, cursorCol: 0 };

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

const moveLeft = (s: EditorState): EditorState => {
  if (s.cursorCol > 0) return { ...s, cursorCol: s.cursorCol - 1 };
  if (s.cursorRow > 0) {
    const newRow = s.cursorRow - 1;
    return { ...s, cursorRow: newRow, cursorCol: (s.lines[newRow] ?? '').length };
  }
  return s;
};

const moveRight = (s: EditorState): EditorState => {
  const line = s.lines[s.cursorRow] ?? '';
  if (s.cursorCol < line.length) return { ...s, cursorCol: s.cursorCol + 1 };
  if (s.cursorRow < s.lines.length - 1) {
    return { ...s, cursorRow: s.cursorRow + 1, cursorCol: 0 };
  }
  return s;
};

const moveUp = (s: EditorState): EditorState => {
  if (s.cursorRow === 0) return { ...s, cursorCol: 0 };
  const newRow = s.cursorRow - 1;
  const len = (s.lines[newRow] ?? '').length;
  return { ...s, cursorRow: newRow, cursorCol: clamp(s.cursorCol, 0, len) };
};

const moveDown = (s: EditorState): EditorState => {
  if (s.cursorRow >= s.lines.length - 1) {
    const len = (s.lines[s.cursorRow] ?? '').length;
    return { ...s, cursorCol: len };
  }
  const newRow = s.cursorRow + 1;
  const len = (s.lines[newRow] ?? '').length;
  return { ...s, cursorRow: newRow, cursorCol: clamp(s.cursorCol, 0, len) };
};

const moveWordLeft = (s: EditorState): EditorState => {
  const line = s.lines[s.cursorRow] ?? '';
  let col = s.cursorCol;
  while (col > 0 && /\s/.test(line[col - 1] ?? '')) col--;
  while (col > 0 && !/\s/.test(line[col - 1] ?? '')) col--;
  if (col === s.cursorCol && s.cursorRow > 0) {
    const prev = s.lines[s.cursorRow - 1] ?? '';
    return { ...s, cursorRow: s.cursorRow - 1, cursorCol: prev.length };
  }
  return { ...s, cursorCol: col };
};

const moveWordRight = (s: EditorState): EditorState => {
  const line = s.lines[s.cursorRow] ?? '';
  let col = s.cursorCol;
  while (col < line.length && !/\s/.test(line[col] ?? '')) col++;
  while (col < line.length && /\s/.test(line[col] ?? '')) col++;
  if (col === s.cursorCol && s.cursorRow < s.lines.length - 1) {
    return { ...s, cursorRow: s.cursorRow + 1, cursorCol: 0 };
  }
  return { ...s, cursorCol: col };
};

const moveDocStart = (s: EditorState): EditorState => ({ ...s, cursorRow: 0, cursorCol: 0 });
const moveDocEnd = (s: EditorState): EditorState => {
  const lr = s.lines.length - 1;
  const len = (s.lines[lr] ?? '').length;
  return { ...s, cursorRow: lr, cursorCol: len };
};

const insertNewline = (s: EditorState): EditorState => {
  const line = s.lines[s.cursorRow] ?? '';
  const before = line.slice(0, s.cursorCol);
  const after = line.slice(s.cursorCol);
  const lines = [...s.lines];
  lines[s.cursorRow] = before;
  lines.splice(s.cursorRow + 1, 0, after);
  return { lines, cursorRow: s.cursorRow + 1, cursorCol: 0 };
};

const backspace = (s: EditorState): EditorState => {
  if (s.cursorCol > 0) {
    const line = s.lines[s.cursorRow] ?? '';
    const newLine = line.slice(0, s.cursorCol - 1) + line.slice(s.cursorCol);
    const lines = [...s.lines];
    lines[s.cursorRow] = newLine;
    return { ...s, lines, cursorCol: s.cursorCol - 1 };
  }
  if (s.cursorRow > 0) {
    const prev = s.lines[s.cursorRow - 1] ?? '';
    const cur = s.lines[s.cursorRow] ?? '';
    const lines = [...s.lines];
    lines.splice(s.cursorRow, 1);
    lines[s.cursorRow - 1] = prev + cur;
    return { lines, cursorRow: s.cursorRow - 1, cursorCol: prev.length };
  }
  return s;
};

function insertText(s: EditorState, text: string): EditorState {
  const parts = text.split(/\r\n|\r|\n/);
  let cur = s;
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) cur = insertNewline(cur);
    const piece = parts[i] ?? '';
    if (piece.length > 0) {
      const line = cur.lines[cur.cursorRow] ?? '';
      const newLine = line.slice(0, cur.cursorCol) + piece + line.slice(cur.cursorCol);
      const lines = [...cur.lines];
      lines[cur.cursorRow] = newLine;
      cur = { ...cur, lines, cursorCol: cur.cursorCol + piece.length };
    }
  }
  return cur;
}

function severityColor(severity: string): string | undefined {
  const s = severity.toUpperCase();
  if (s === 'WARNING') return 'yellow';
  if (s === 'NOTICE') return 'cyan';
  if (s === 'INFO') return 'green';
  if (s.startsWith('DEBUG') || s === 'LOG') return 'gray';
  if (s === 'ERROR' || s === 'FATAL' || s === 'PANIC') return 'red';
  return undefined;
}

function isPrintable(s: string): boolean {
  if (s.length === 0) return false;
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code >= 32 && code !== 127) return true;
  }
  return false;
}

export const QueryPane: React.FC<Props> = ({ conn, focused, maxCols, maxRows, seedSql, seedKey }) => {
  const [editor, setEditor] = useState<EditorState>(initialEditor);
  const [scroll, setScroll] = useState(0);
  const [mode, setMode] = useState<Mode>('editor');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSql, setLastSql] = useState('');

  // variable prompt state
  const [varNames, setVarNames] = useState<string[]>([]);
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  const [varCache, setVarCache] = useState<Record<string, string>>({});
  const [varFocus, setVarFocus] = useState<number>(0);

  const headerRows = 1;
  const footerRows = 1;
  const viewport = Math.max(3, maxRows - headerRows - footerRows);

  useEffect(() => {
    setScroll((prev) => {
      const cr = editor.cursorRow;
      let next = prev;
      if (cr < next) next = cr;
      else if (cr >= next + viewport) next = cr - viewport + 1;
      const max = Math.max(0, editor.lines.length - viewport);
      if (next > max) next = max;
      if (next < 0) next = 0;
      return next;
    });
  }, [editor.cursorRow, editor.lines.length, viewport]);

  // Seed editor when ConnectedView pushes a function template (keyed so each push re-applies).
  useEffect(() => {
    if (seedKey === undefined || seedSql === undefined) return;
    if (seedKey === 0) return; // initial mount with no actual seed yet
    const lines = seedSql.length === 0 ? [''] : seedSql.split('\n');
    setEditor({ lines, cursorRow: 0, cursorCol: 0 });
    setMode('editor');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  // ────── execution flow ──────

  function startExecute(): void {
    if (mode !== 'editor') return;
    const sql = editor.lines.join('\n').trim();
    if (sql.length === 0) return;
    const vars = extractVariables(sql);
    if (vars.length === 0) {
      runWithVars(sql, {});
      return;
    }
    // prompt for values
    const initial: Record<string, string> = {};
    for (const v of vars) {
      initial[v] = varCache[v] ?? '';
    }
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
    setLastSql(sql);
    setMode('running');
    setError(null);
    setResult(null);
    runQuery(conn, out, values)
      .then((res) => {
        setResult(res);
        setMode('results');
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setMode('results');
      });
  }

  function confirmVarsAndRun(): void {
    setVarCache((prev) => ({ ...prev, ...varValues }));
    const sql = editor.lines.join('\n').trim();
    runWithVars(sql, varValues);
  }

  // Listen for the disambiguated Ctrl+Enter from the terminal protocols.
  const startExecuteRef = useRef(startExecute);
  startExecuteRef.current = startExecute;
  useEffect(() => {
    const handler = (): void => {
      if (focused && mode === 'editor') startExecuteRef.current();
    };
    keypressBus.on('ctrl-enter', handler);
    return () => {
      keypressBus.off('ctrl-enter', handler);
    };
  }, [focused, mode]);

  // ────── input handling ──────

  useInput(
    (input, key) => {
      if (mode === 'editor') {
        // ctrl+R always works as a reliable fallback
        if ((key.ctrl && key.return) || (key.ctrl && input === 'r')) {
          startExecute();
          return;
        }
        // movement
        if (key.ctrl && key.upArrow) return setEditor(moveDocStart);
        if (key.ctrl && key.downArrow) return setEditor(moveDocEnd);
        if (key.ctrl && key.leftArrow) return setEditor(moveWordLeft);
        if (key.ctrl && key.rightArrow) return setEditor(moveWordRight);
        if (key.upArrow) return setEditor(moveUp);
        if (key.downArrow) return setEditor(moveDown);
        if (key.leftArrow) return setEditor(moveLeft);
        if (key.rightArrow) return setEditor(moveRight);
        if (key.return) {
          // suppress newline if a Ctrl+Enter escape just fired
          if (recentlySawCtrlEnter()) return;
          setEditor(insertNewline);
          return;
        }
        if (key.backspace || key.delete) return setEditor(backspace);
        if (input && !key.ctrl && !key.meta && !key.escape && !key.tab) {
          if (looksLikeCtrlEnterFragment(input)) return;
          if (isPrintable(input)) {
            setEditor((s) => insertText(s, input));
          }
          return;
        }
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
            const total = varNames.length + 1; // fields + Run button
            const dir = key.shift ? -1 : 1;
            return (i + dir + total) % total;
          });
          return;
        }
        // Enter on Run button: runs
        if (key.return && varFocus === varNames.length) {
          confirmVarsAndRun();
          return;
        }
        // Ctrl+R / Ctrl+Enter run too
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
        return;
      }
    },
    { isActive: focused },
  );

  // also handle Ctrl+Enter in variables mode via the terminal protocol bus
  useEffect(() => {
    if (mode !== 'variables') return;
    const handler = (): void => {
      if (focused) confirmVarsAndRun();
    };
    keypressBus.on('ctrl-enter', handler);
    return () => {
      keypressBus.off('ctrl-enter', handler);
    };
    // confirmVarsAndRun closes over varValues which is fine for a one-shot listener
  }, [mode, focused, varValues]);

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

        {error && (
          <Box paddingX={1} marginTop={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}

        {notices.length > 0 && (
          <Box flexDirection="column" paddingX={1} marginTop={1}>
            <Text dimColor>messages:</Text>
            {notices.map((n, i) => (
              <Text key={i} color={severityColor(n.severity)} wrap="truncate">
                {n.severity}: {n.message}
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

  // editor
  const visibleStart = scroll;
  const visibleEnd = Math.min(editor.lines.length, scroll + viewport);
  const totalLines = editor.lines.length;
  const lineNumWidth = String(totalLines).length;

  return (
    <Box flexDirection="column">
      <Box paddingX={1} flexDirection="row" justifyContent="space-between">
        <Text>
          <Text bold color="magenta">SQL editor</Text>
          <Text dimColor>
            {'  '}line {editor.cursorRow + 1}/{totalLines} · col {editor.cursorCol + 1}
          </Text>
        </Text>
        {focused && (
          <Text dimColor>
            [Ctrl+Enter / Ctrl+R] run · :var = parameter · [Esc] tree
          </Text>
        )}
      </Box>
      <Box flexDirection="column" paddingX={1}>
        {Array.from({ length: visibleEnd - visibleStart }, (_, i) => {
          const realRow = visibleStart + i;
          const line = editor.lines[realRow] ?? '';
          const isCursorRow = realRow === editor.cursorRow && focused;
          return (
            <EditorLine
              key={realRow}
              line={line}
              row={realRow}
              lineNumWidth={lineNumWidth}
              cursorCol={isCursorRow ? editor.cursorCol : null}
              maxCols={maxCols}
            />
          );
        })}
        {Array.from(
          { length: Math.max(0, viewport - (visibleEnd - visibleStart)) },
          (_, i) => (
            <Text key={`blank-${i}`} dimColor>
              {' '.repeat(lineNumWidth) + ' ~'}
            </Text>
          ),
        )}
      </Box>
    </Box>
  );
};

const EditorLine: React.FC<{
  line: string;
  row: number;
  lineNumWidth: number;
  cursorCol: number | null;
  maxCols: number;
}> = ({ line, row, lineNumWidth, cursorCol, maxCols }) => {
  const num = String(row + 1).padStart(lineNumWidth, ' ');
  const gutter = `${num} │ `;
  const contentBudget = Math.max(1, maxCols - gutter.length);

  if (cursorCol === null) {
    const shown = line.length > contentBudget ? line.slice(0, contentBudget - 1) + '…' : line;
    return (
      <Text wrap="truncate">
        <Text dimColor>{gutter}</Text>
        {shown.length === 0 ? ' ' : shown}
      </Text>
    );
  }

  let scrollX = 0;
  if (cursorCol >= contentBudget) scrollX = cursorCol - contentBudget + 1;
  const visibleLine = line.slice(scrollX, scrollX + contentBudget);
  const visibleCursor = cursorCol - scrollX;

  const before = visibleLine.slice(0, visibleCursor);
  const cursorChar = visibleLine[visibleCursor] ?? ' ';
  const after = visibleLine.slice(visibleCursor + 1);

  return (
    <Text wrap="truncate">
      <Text color="cyan">{gutter}</Text>
      <Text>{before}</Text>
      <Text inverse>{cursorChar}</Text>
      <Text>{after}</Text>
    </Text>
  );
};
