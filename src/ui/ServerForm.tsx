import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

export type ServerFormValues = {
  name: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
};

export type ServerFormFields = {
  name: string;
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
};

type Props = {
  mode: 'add' | 'edit';
  initialValues?: Partial<ServerFormFields>;
  onSubmit: (values: ServerFormValues) => void;
  onCancel: () => void;
};

const FIELDS = ['name', 'host', 'port', 'database', 'user', 'password'] as const;
type Field = (typeof FIELDS)[number];

const LABELS: Record<Field, string> = {
  name: 'Name',
  host: 'Host',
  port: 'Port',
  database: 'Database',
  user: 'User',
  password: 'Password',
};

export const ServerForm: React.FC<Props> = ({ mode, initialValues, onSubmit, onCancel }) => {
  const [values, setValues] = useState<Record<Field, string>>({
    name: initialValues?.name ?? '',
    host: initialValues?.host ?? 'localhost',
    port: initialValues?.port ?? '5432',
    database: initialValues?.database ?? '',
    user: initialValues?.user ?? '',
    password: initialValues?.password ?? '',
  });
  const [focus, setFocus] = useState<Field>('name');
  const [error, setError] = useState<string | null>(null);

  function step(direction: 1 | -1): void {
    setFocus((f) => {
      const idx = FIELDS.indexOf(f);
      const nextIdx = (idx + direction + FIELDS.length) % FIELDS.length;
      return FIELDS[nextIdx]!;
    });
  }

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.tab) {
      step(key.shift ? -1 : 1);
      return;
    }
    if (key.downArrow) {
      step(1);
      return;
    }
    if (key.upArrow) {
      step(-1);
      return;
    }
  });

  function handleSubmit(): void {
    if (!values.name.trim()) {
      setError('Name is required');
      setFocus('name');
      return;
    }
    if (!values.database.trim()) {
      setError('Database is required');
      setFocus('database');
      return;
    }
    if (!values.user.trim()) {
      setError('User is required');
      setFocus('user');
      return;
    }
    const port = Number(values.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError('Port must be an integer between 1 and 65535');
      setFocus('port');
      return;
    }
    onSubmit({
      name: values.name.trim(),
      host: values.host.trim() || 'localhost',
      port,
      database: values.database.trim(),
      user: values.user.trim(),
      password: values.password,
    });
  }

  function advance(field: Field): void {
    const idx = FIELDS.indexOf(field);
    if (idx === FIELDS.length - 1) {
      handleSubmit();
    } else {
      setFocus(FIELDS[idx + 1]!);
    }
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {mode === 'edit' ? 'Edit server' : 'Add server'}
        </Text>
      </Box>

      {FIELDS.map((field) => {
        const isFocused = focus === field;
        const isPassword = field === 'password';
        return (
          <Box key={field}>
            <Box width={12}>
              <Text color={isFocused ? 'green' : undefined}>
                {isFocused ? '▸ ' : '  '}
                {LABELS[field]}:
              </Text>
            </Box>
            <Box flexGrow={1}>
              {isFocused ? (
                <TextInput
                  value={values[field]}
                  onChange={(v) => setValues((prev) => ({ ...prev, [field]: v }))}
                  onSubmit={() => advance(field)}
                  mask={isPassword ? '*' : undefined}
                  placeholder={field === 'host' ? 'localhost' : ''}
                />
              ) : (
                <Text dimColor>
                  {values[field].length === 0
                    ? field === 'host'
                      ? 'localhost'
                      : '—'
                    : isPassword
                      ? '*'.repeat(values[field].length)
                      : values[field]}
                </Text>
              )}
            </Box>
          </Box>
        );
      })}

      {error && (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          [↑/↓ or Tab] move  [Enter] next/save  [Esc] cancel
        </Text>
      </Box>
    </Box>
  );
};
