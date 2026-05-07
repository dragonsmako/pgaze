import React, { useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { useScrollViewport } from '../lib/useScrollViewport.js';
import { truncate } from '../lib/textUtil.js';
import { looksLikeCtrlEnterFragment, recentlySawCtrlEnter } from '../lib/keypress.js';

export type MultilineEditorState = {
  lines: string[];
  cursorRow: number;
  cursorCol: number;
};

export const emptyEditorState: MultilineEditorState = {
  lines: [''],
  cursorRow: 0,
  cursorCol: 0,
};

export function editorStateFromText(text: string): MultilineEditorState {
  const lines = text.length === 0 ? [''] : text.split(/\r\n|\r|\n/);
  return { lines, cursorRow: 0, cursorCol: 0 };
}

export function editorStateText(s: MultilineEditorState): string {
  return s.lines.join('\n');
}

// ────── pure mutators ──────

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

const moveLeft = (s: MultilineEditorState): MultilineEditorState => {
  if (s.cursorCol > 0) return { ...s, cursorCol: s.cursorCol - 1 };
  if (s.cursorRow > 0) {
    const r = s.cursorRow - 1;
    return { ...s, cursorRow: r, cursorCol: (s.lines[r] ?? '').length };
  }
  return s;
};

const moveRight = (s: MultilineEditorState): MultilineEditorState => {
  const line = s.lines[s.cursorRow] ?? '';
  if (s.cursorCol < line.length) return { ...s, cursorCol: s.cursorCol + 1 };
  if (s.cursorRow < s.lines.length - 1) return { ...s, cursorRow: s.cursorRow + 1, cursorCol: 0 };
  return s;
};

const moveUp = (s: MultilineEditorState): MultilineEditorState => {
  if (s.cursorRow === 0) return { ...s, cursorCol: 0 };
  const r = s.cursorRow - 1;
  return { ...s, cursorRow: r, cursorCol: clamp(s.cursorCol, 0, (s.lines[r] ?? '').length) };
};

const moveDown = (s: MultilineEditorState): MultilineEditorState => {
  if (s.cursorRow >= s.lines.length - 1) {
    return { ...s, cursorCol: (s.lines[s.cursorRow] ?? '').length };
  }
  const r = s.cursorRow + 1;
  return { ...s, cursorRow: r, cursorCol: clamp(s.cursorCol, 0, (s.lines[r] ?? '').length) };
};

const moveWordLeft = (s: MultilineEditorState): MultilineEditorState => {
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

const moveWordRight = (s: MultilineEditorState): MultilineEditorState => {
  const line = s.lines[s.cursorRow] ?? '';
  let col = s.cursorCol;
  while (col < line.length && !/\s/.test(line[col] ?? '')) col++;
  while (col < line.length && /\s/.test(line[col] ?? '')) col++;
  if (col === s.cursorCol && s.cursorRow < s.lines.length - 1) {
    return { ...s, cursorRow: s.cursorRow + 1, cursorCol: 0 };
  }
  return { ...s, cursorCol: col };
};

const moveDocStart = (s: MultilineEditorState): MultilineEditorState =>
  ({ ...s, cursorRow: 0, cursorCol: 0 });

const moveDocEnd = (s: MultilineEditorState): MultilineEditorState => {
  const r = s.lines.length - 1;
  return { ...s, cursorRow: r, cursorCol: (s.lines[r] ?? '').length };
};

const insertNewline = (s: MultilineEditorState): MultilineEditorState => {
  const line = s.lines[s.cursorRow] ?? '';
  const before = line.slice(0, s.cursorCol);
  const after = line.slice(s.cursorCol);
  const lines = [...s.lines];
  lines[s.cursorRow] = before;
  lines.splice(s.cursorRow + 1, 0, after);
  return { lines, cursorRow: s.cursorRow + 1, cursorCol: 0 };
};

const backspace = (s: MultilineEditorState): MultilineEditorState => {
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

function insertText(s: MultilineEditorState, text: string): MultilineEditorState {
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

function isPrintable(s: string): boolean {
  if (s.length === 0) return false;
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code >= 32 && code !== 127) return true;
  }
  return false;
}

// ────── component ──────

type Props = {
  state: MultilineEditorState;
  onChange: (next: MultilineEditorState) => void;
  focused: boolean;
  maxCols: number;
  maxRows: number;
};

export const MultilineEditor: React.FC<Props> = ({
  state,
  onChange,
  focused,
  maxCols,
  maxRows,
}) => {
  const totalLines = state.lines.length;
  const lineNumWidth = String(totalLines).length;

  const { safeScroll } = useScrollViewport({
    cursor: state.cursorRow,
    total: totalLines,
    viewport: maxRows,
  });

  const apply = useCallback(
    (fn: (s: MultilineEditorState) => MultilineEditorState) => onChange(fn(state)),
    [state, onChange],
  );

  useInput(
    (input, key) => {
      // Movement
      if (key.ctrl && key.upArrow) return apply(moveDocStart);
      if (key.ctrl && key.downArrow) return apply(moveDocEnd);
      if (key.ctrl && key.leftArrow) return apply(moveWordLeft);
      if (key.ctrl && key.rightArrow) return apply(moveWordRight);
      if (key.upArrow) return apply(moveUp);
      if (key.downArrow) return apply(moveDown);
      if (key.leftArrow) return apply(moveLeft);
      if (key.rightArrow) return apply(moveRight);

      if (key.return) {
        // Suppress newline if Ctrl+Enter just fired through the protocol bus.
        if (recentlySawCtrlEnter()) return;
        return apply(insertNewline);
      }
      if (key.backspace || key.delete) return apply(backspace);

      if (input && !key.ctrl && !key.meta && !key.escape && !key.tab) {
        if (looksLikeCtrlEnterFragment(input)) return;
        if (isPrintable(input)) apply((s) => insertText(s, input));
      }
    },
    { isActive: focused },
  );

  const visibleStart = safeScroll;
  const visibleEnd = Math.min(totalLines, safeScroll + maxRows);
  const blanks = Math.max(0, maxRows - (visibleEnd - visibleStart));

  return (
    <Box flexDirection="column" paddingX={1}>
      {Array.from({ length: visibleEnd - visibleStart }, (_, i) => {
        const realRow = visibleStart + i;
        const line = state.lines[realRow] ?? '';
        const isCursorRow = realRow === state.cursorRow && focused;
        return (
          <EditorLine
            key={realRow}
            line={line}
            row={realRow}
            lineNumWidth={lineNumWidth}
            cursorCol={isCursorRow ? state.cursorCol : null}
            maxCols={maxCols}
          />
        );
      })}
      {Array.from({ length: blanks }, (_, i) => (
        <Text key={`blank-${i}`} dimColor>
          {' '.repeat(lineNumWidth) + ' ~'}
        </Text>
      ))}
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
    const shown = truncate(line, contentBudget);
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

