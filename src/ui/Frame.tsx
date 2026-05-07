import React from 'react';
import { Box, Text, useStdout } from 'ink';

type Props = {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
};

export const FRAME_BORDER_COLS = 2;
export const FRAME_BORDER_ROWS = 2;
export const FRAME_HEADER_ROWS = 1;
export const FRAME_INNER_COL_OFFSET = FRAME_BORDER_COLS;
export const FRAME_INNER_ROW_OFFSET = FRAME_BORDER_ROWS + FRAME_HEADER_ROWS;

export function useTerminalSize(): { cols: number; rows: number } {
  const { stdout } = useStdout();
  return {
    cols: stdout?.columns ?? 120,
    rows: stdout?.rows ?? 30,
  };
}

export const Frame: React.FC<Props> = ({ title = 'pgaze', subtitle, children }) => {
  const { cols, rows } = useTerminalSize();
  return (
    <Box
      width={cols}
      height={rows}
      borderStyle="round"
      borderColor="cyan"
      flexDirection="column"
    >
      <Box paddingX={1} flexDirection="row" justifyContent="space-between">
        <Text bold color="cyan">
          ◆ {title}
        </Text>
        {subtitle ? <Text dimColor>{subtitle}</Text> : <Text> </Text>}
      </Box>
      <Box flexGrow={1} flexDirection="column">
        {children}
      </Box>
    </Box>
  );
};
