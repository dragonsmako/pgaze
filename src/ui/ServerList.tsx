import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ServerConfig } from '../types.js';

type Props = {
  servers: ServerConfig[];
  error: string | null;
  onAdd: () => void;
  onEdit: (server: ServerConfig) => void;
  onDelete: (server: ServerConfig) => void;
  onConnect: (server: ServerConfig) => void;
  onQuit: () => void;
};

export const ServerList: React.FC<Props> = ({
  servers,
  error,
  onAdd,
  onEdit,
  onDelete,
  onConnect,
  onQuit,
}) => {
  const [index, setIndex] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const safeIndex = servers.length === 0 ? 0 : Math.min(index, servers.length - 1);

  useInput((input, key) => {
    if (confirmDelete) {
      if (input === 'y' || input === 'Y') {
        const target = servers[safeIndex];
        if (target) onDelete(target);
        setConfirmDelete(false);
        return;
      }
      if (input === 'n' || input === 'N' || key.escape) {
        setConfirmDelete(false);
        return;
      }
      return;
    }

    if (key.upArrow) {
      setIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setIndex((i) => Math.min(servers.length - 1, i + 1));
      return;
    }
    if (key.return) {
      const target = servers[safeIndex];
      if (target) onConnect(target);
      return;
    }
    if (input === 'a') {
      onAdd();
      return;
    }
    if (input === 'e' && servers.length > 0) {
      const target = servers[safeIndex];
      if (target) onEdit(target);
      return;
    }
    if (input === 'd' && servers.length > 0) {
      setConfirmDelete(true);
      return;
    }
    if (input === 'q') {
      onQuit();
      return;
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          pgadmin-tui · servers
        </Text>
      </Box>

      {error && (
        <Box marginBottom={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      {servers.length === 0 ? (
        <Box marginBottom={1}>
          <Text dimColor>No servers yet — press [a] to add one.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginBottom={1}>
          {servers.map((server, i) => {
            const selected = i === safeIndex;
            return (
              <Box key={server.id}>
                <Text color={selected ? 'green' : undefined}>
                  {selected ? '▸ ' : '  '}
                  <Text bold={selected}>{server.name}</Text>
                  <Text dimColor>
                    {'  '}
                    {server.user}@{server.host}:{server.port}/{server.database}
                  </Text>
                </Text>
              </Box>
            );
          })}
        </Box>
      )}

      {confirmDelete ? (
        <Text color="yellow">
          Delete &quot;{servers[safeIndex]?.name}&quot;? [y/N]
        </Text>
      ) : (
        <Text dimColor>
          [↑/↓] move  [Enter] connect  [a] add  [e] edit  [d] delete  [q] quit
        </Text>
      )}
    </Box>
  );
};
