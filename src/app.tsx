import React, { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { randomUUID } from 'node:crypto';
import type { ServerConfig } from './types.js';
import { loadServers, saveServers } from './config/store.js';
import {
  deletePassword as keyringDelete,
  getPassword as keyringGet,
  isKeyringAvailable,
  setPassword as keyringSet,
} from './config/secrets.js';
import { connect, disconnect, type Connection } from './db/client.js';
import { ServerList } from './ui/ServerList.js';
import { ServerForm, type ServerFormValues } from './ui/ServerForm.js';
import { ConnectedView } from './ui/ConnectedView.js';
import { Frame } from './ui/Frame.js';
import { PasswordPrompt } from './ui/PasswordPrompt.js';

type Route =
  | { kind: 'list' }
  | { kind: 'add' }
  | { kind: 'edit'; server: ServerConfig; password: string }
  | {
      kind: 'password';
      server: ServerConfig;
      reason: 'no-stored' | 'keyring-unavailable';
    }
  | { kind: 'connecting'; server: ServerConfig }
  | { kind: 'connected'; server: ServerConfig; conn: Connection };

export const App: React.FC = () => {
  const { exit } = useApp();
  const [route, setRoute] = useState<Route>({ kind: 'list' });
  const [servers, setServers] = useState<ServerConfig[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    loadServers()
      .then((s) => {
        setServers(s);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        setError(`Failed to load servers: ${err instanceof Error ? err.message : String(err)}`);
        setLoaded(true);
      });
  }, []);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      void cleanupAndExit();
    }
  });

  async function cleanupAndExit(): Promise<void> {
    if (route.kind === 'connected') {
      try {
        await disconnect(route.conn);
      } catch {
        /* ignore */
      }
    }
    exit();
  }

  async function handleAdd(values: ServerFormValues): Promise<void> {
    const id = randomUUID();
    const newServer: ServerConfig = {
      id,
      name: values.name,
      host: values.host || 'localhost',
      port: values.port,
      database: values.database,
      user: values.user,
    };
    try {
      const next = [...servers, newServer];
      await saveServers(next);
      let warn: string | null = null;
      if (values.password.length > 0) {
        const ok = await keyringSet(id, values.password);
        if (!ok) {
          warn = `Server "${newServer.name}" saved, but the password could not be stored in the keyring.`;
        }
      }
      setServers(next);
      setRoute({ kind: 'list' });
      setError(null);
      setWarning(warn);
    } catch (err) {
      setError(`Failed to add server: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleEditSubmit(values: ServerFormValues): Promise<void> {
    if (route.kind !== 'edit') return;
    const id = route.server.id;
    const updated: ServerConfig = {
      id,
      name: values.name,
      host: values.host || 'localhost',
      port: values.port,
      database: values.database,
      user: values.user,
    };
    try {
      const next = servers.map((s) => (s.id === id ? updated : s));
      await saveServers(next);
      let warn: string | null = null;
      if (values.password.length > 0) {
        const ok = await keyringSet(id, values.password);
        if (!ok) {
          warn = `Server "${updated.name}" updated, but the password could not be stored in the keyring.`;
        }
      } else {
        await keyringDelete(id);
      }
      setServers(next);
      setRoute({ kind: 'list' });
      setError(null);
      setWarning(warn);
    } catch (err) {
      setError(`Failed to update server: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function startEdit(server: ServerConfig): Promise<void> {
    try {
      const password = (await keyringGet(server.id)) ?? '';
      setRoute({ kind: 'edit', server, password });
    } catch (err) {
      setError(`Failed to read keyring: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleDelete(server: ServerConfig): Promise<void> {
    try {
      const next = servers.filter((s) => s.id !== server.id);
      await saveServers(next);
      await keyringDelete(server.id);
      setServers(next);
      setError(null);
    } catch (err) {
      setError(`Failed to delete server: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleConnect(server: ServerConfig): Promise<void> {
    setError(null);
    setWarning(null);
    // 1.3: distinguish "keyring unavailable" from "no stored password".
    // If we can't reach the keyring at all, prompt for the password rather
    // than silently connecting with an empty string.
    const keyringOk = await isKeyringAvailable();
    if (!keyringOk) {
      setRoute({ kind: 'password', server, reason: 'keyring-unavailable' });
      return;
    }
    let stored: string | null = null;
    try {
      stored = await keyringGet(server.id);
    } catch (err) {
      setError(`Failed to read keyring: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (stored === null) {
      setRoute({ kind: 'password', server, reason: 'no-stored' });
      return;
    }
    await actuallyConnect(server, stored);
  }

  async function actuallyConnect(server: ServerConfig, password: string): Promise<void> {
    setRoute({ kind: 'connecting', server });
    try {
      const conn = await connect(server, password);
      setRoute({ kind: 'connected', server, conn });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to connect to ${server.name}: ${msg}`);
      setRoute({ kind: 'list' });
    }
  }

  async function handlePasswordSubmit(password: string, remember: boolean): Promise<void> {
    if (route.kind !== 'password') return;
    const server = route.server;
    if (remember) {
      const ok = await keyringSet(server.id, password);
      if (!ok) {
        setWarning('Could not store password in keyring; using it for this session only.');
      }
    }
    await actuallyConnect(server, password);
  }

  async function handleBackFromConnected(): Promise<void> {
    if (route.kind === 'connected') {
      try {
        await disconnect(route.conn);
      } catch {
        /* ignore */
      }
    }
    setRoute({ kind: 'list' });
  }

  if (!loaded) {
    return (
      <Frame subtitle="loading">
        <Box paddingX={1}>
          <Text>
            <Spinner type="dots" /> Loading…
          </Text>
        </Box>
      </Frame>
    );
  }

  if (route.kind === 'list') {
    const message = error ? error : warning ? warning : null;
    return (
      <Frame subtitle="servers">
        <ServerList
          servers={servers}
          error={message}
          onAdd={() => {
            setError(null);
            setWarning(null);
            setRoute({ kind: 'add' });
          }}
          onEdit={(s) => void startEdit(s)}
          onDelete={(s) => void handleDelete(s)}
          onConnect={(s) => void handleConnect(s)}
          onQuit={() => void cleanupAndExit()}
        />
      </Frame>
    );
  }

  if (route.kind === 'add') {
    return (
      <Frame subtitle="new server">
        <ServerForm
          mode="add"
          onSubmit={(values) => void handleAdd(values)}
          onCancel={() => setRoute({ kind: 'list' })}
        />
      </Frame>
    );
  }

  if (route.kind === 'edit') {
    return (
      <Frame subtitle={`edit · ${route.server.name}`}>
        <ServerForm
          // 2.6: key by server id so re-entering edit for a different server
          // remounts the form with that server's initial values.
          key={route.server.id}
          mode="edit"
          initialValues={{
            name: route.server.name,
            host: route.server.host,
            port: String(route.server.port),
            database: route.server.database,
            user: route.server.user,
            password: route.password,
          }}
          onSubmit={(values) => void handleEditSubmit(values)}
          onCancel={() => setRoute({ kind: 'list' })}
        />
      </Frame>
    );
  }

  if (route.kind === 'password') {
    return (
      <Frame subtitle={`password · ${route.server.name}`}>
        <PasswordPrompt
          server={route.server}
          reason={route.reason}
          onSubmit={(pw, remember) => void handlePasswordSubmit(pw, remember)}
          onCancel={() => setRoute({ kind: 'list' })}
        />
      </Frame>
    );
  }

  if (route.kind === 'connecting') {
    return (
      <Frame subtitle={`connecting · ${route.server.name}`}>
        <Box paddingX={1}>
          <Text>
            <Spinner type="dots" /> Connecting to {route.server.name}…
          </Text>
        </Box>
      </Frame>
    );
  }

  return (
    <Frame subtitle={`${route.server.name} · ${route.server.database}`}>
      <ConnectedView
        conn={route.conn}
        onBack={() => void handleBackFromConnected()}
      />
    </Frame>
  );
};
