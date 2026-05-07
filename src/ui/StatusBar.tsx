import React from 'react';
import { Box, Text } from 'ink';
import type { ServerConfig } from '../types.js';

type Props = {
  server: ServerConfig;
  schema?: string | undefined;
  table?: string | undefined;
  pane: 'table' | 'query';
  hint?: string | undefined;
};

export const StatusBar: React.FC<Props> = ({ server, schema, table, pane, hint }) => {
  const target =
    schema && table ? `${schema}.${table}` : schema ? schema : '—';
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} flexDirection="row">
      <Text>
        <Text bold color="cyan">{server.name}</Text>
        <Text dimColor> · </Text>
        <Text>{server.database}</Text>
        <Text dimColor> · </Text>
        <Text>{target}</Text>
        <Text dimColor> · </Text>
        <Text color={pane === 'query' ? 'magenta' : 'yellow'}>
          {pane === 'query' ? 'query' : 'table'}
        </Text>
        {hint && (
          <>
            <Text dimColor> · </Text>
            <Text dimColor>{hint}</Text>
          </>
        )}
      </Text>
    </Box>
  );
};
