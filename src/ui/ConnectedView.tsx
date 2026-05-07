import React, { useState } from 'react';
import { Box, useInput } from 'ink';
import type { Connection } from '../db/client.js';
import { Tree } from './Tree.js';
import { TablePane } from './TablePane.js';
import { QueryPane } from './QueryPane.js';
import { StatusBar } from './StatusBar.js';
import {
  FRAME_INNER_COL_OFFSET,
  FRAME_INNER_ROW_OFFSET,
  useTerminalSize,
} from './Frame.js';

type Pane = 'table' | 'query';
type Focus = 'tree' | 'right';

type Selection = { schema: string; table: string } | null;

type Props = {
  conn: Connection;
  onBack: () => void;
};

export const ConnectedView: React.FC<Props> = ({ conn, onBack }) => {
  const [pane, setPane] = useState<Pane>('table');
  const [focus, setFocus] = useState<Focus>('tree');
  const [selection, setSelection] = useState<Selection>(null);
  const [treeSearching, setTreeSearching] = useState(false);
  const [seedSql, setSeedSql] = useState<string>('');
  const [seedKey, setSeedKey] = useState(0);
  const { cols, rows } = useTerminalSize();

  const totalCols = Math.max(40, cols - FRAME_INNER_COL_OFFSET);
  const totalRows = Math.max(10, rows - FRAME_INNER_ROW_OFFSET);
  const leftWidth = Math.max(20, Math.floor(totalCols * 0.32));

  useInput((input, key) => {
    if (treeSearching && focus === 'tree') return;

    if (key.escape) {
      if (focus === 'right') {
        setFocus('tree');
      } else {
        onBack();
      }
      return;
    }
    if (key.tab) {
      setFocus((f) => (f === 'tree' ? 'right' : 'tree'));
      return;
    }
    if (key.ctrl && input === 'q') {
      setPane((p) => (p === 'table' ? 'query' : 'table'));
      return;
    }
  });

  const innerHeight = Math.max(6, totalRows - 3);

  return (
    <Box flexDirection="column" width={totalCols} height={totalRows} flexGrow={1}>
      <Box flexDirection="row" height={innerHeight}>
        <Box
          width={leftWidth}
          borderStyle="single"
          borderColor={focus === 'tree' ? 'green' : 'gray'}
          flexDirection="column"
        >
          <Tree
            conn={conn}
            focused={focus === 'tree'}
            maxCols={leftWidth - 2}
            maxRows={innerHeight - 2}
            onSearchingChange={setTreeSearching}
            onSelectTable={(schema, table) => {
              setSelection({ schema, table });
              setPane('table');
              setFocus('right');
            }}
            onSelectFunction={(sql) => {
              setSeedSql(sql);
              setSeedKey((k) => k + 1);
              setPane('query');
              setFocus('right');
            }}
          />
        </Box>
        <Box
          flexGrow={1}
          borderStyle="single"
          borderColor={focus === 'right' ? 'green' : 'gray'}
          flexDirection="column"
        >
          {pane === 'table' ? (
            <TablePane
              conn={conn}
              selection={selection}
              focused={focus === 'right'}
              maxCols={totalCols - leftWidth - 4}
              maxRows={innerHeight - 4}
            />
          ) : (
            <QueryPane
              conn={conn}
              focused={focus === 'right'}
              maxCols={totalCols - leftWidth - 4}
              maxRows={innerHeight - 4}
              seedSql={seedSql}
              seedKey={seedKey}
            />
          )}
        </Box>
      </Box>
      <StatusBar
        server={conn.server}
        schema={selection?.schema}
        table={selection?.table}
        pane={pane}
        hint={
          focus === 'tree'
            ? treeSearching
              ? '[Enter] open match · [Esc] cancel search'
              : '[Tab] right · [/] search · [Ctrl+Q] toggle query · [Esc] back'
            : pane === 'table'
              ? '[↑↓←→] cell · [Enter] copy · [s] sort · [n/p] page · [Ctrl+Q] query · [Tab] tree'
              : '[Ctrl+Enter / Ctrl+R] run · [e] back to editor · [Ctrl+Q] tables · [Tab] tree'
        }
      />
    </Box>
  );
};
