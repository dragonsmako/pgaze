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
  const { cols, rows } = useTerminalSize();

  const totalCols = Math.max(40, cols - FRAME_INNER_COL_OFFSET);
  const totalRows = Math.max(10, rows - FRAME_INNER_ROW_OFFSET);
  const leftWidth = Math.max(20, Math.floor(totalCols * 0.32));

  useInput((input, key) => {
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
    if (input === 'q' && focus === 'tree') {
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
            onSelectTable={(schema, table) => {
              setSelection({ schema, table });
              setPane('table');
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
            ? '[Tab] focus right · [q] toggle query · [Esc] back to list'
            : pane === 'table'
              ? '[n/p] page · [Tab] back to tree · [Esc] tree'
              : '[Tab] back to tree · [Esc] tree'
        }
      />
    </Box>
  );
};
