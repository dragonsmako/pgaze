import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { ServerConfig } from '../types.js';

type Props = {
  server: ServerConfig;
  reason: 'no-stored' | 'keyring-unavailable';
  onSubmit: (password: string, remember: boolean) => void;
  onCancel: () => void;
};

export const PasswordPrompt: React.FC<Props> = ({ server, reason, onSubmit, onCancel }) => {
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(reason === 'no-stored');
  const [focusOnRemember, setFocusOnRemember] = useState(false);

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.tab) {
      setFocusOnRemember((v) => !v);
      return;
    }
    if (focusOnRemember && (_input === ' ' || _input === 'y' || _input === 'n')) {
      setRemember((v) => (_input === ' ' ? !v : _input === 'y'));
      return;
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Password required for {server.name}
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text dimColor>
          {reason === 'keyring-unavailable'
            ? 'OS keyring is unavailable — enter the password manually for this session.'
            : 'No stored password — enter it now.'}
        </Text>
      </Box>
      <Box>
        <Box width={12}>
          <Text color={!focusOnRemember ? 'green' : undefined}>
            {!focusOnRemember ? '▸ ' : '  '}Password:
          </Text>
        </Box>
        <Box flexGrow={1}>
          {!focusOnRemember ? (
            <TextInput
              value={password}
              onChange={setPassword}
              onSubmit={() => onSubmit(password, remember)}
              mask="*"
              placeholder=""
            />
          ) : (
            <Text dimColor>{'*'.repeat(password.length) || '—'}</Text>
          )}
        </Box>
      </Box>
      <Box marginTop={1}>
        <Box width={12}>
          <Text color={focusOnRemember ? 'green' : undefined}>
            {focusOnRemember ? '▸ ' : '  '}Remember:
          </Text>
        </Box>
        <Box>
          <Text>
            [{remember ? 'x' : ' '}] save to keyring{' '}
            <Text dimColor>(space to toggle)</Text>
          </Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          [Tab] toggle field · [Enter] connect · [Esc] cancel
        </Text>
      </Box>
    </Box>
  );
};
