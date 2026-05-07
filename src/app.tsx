import React, { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { v4 as uuid } from 'uuid';
import type { ServerConfig } from './types.js';
import { loadServers, saveServers } from './config/store.js';
import {
  deletePassword as keyringDelete,
  getPassword as keyringGet,
  setPassword as keyringSet,
} from './config/secrets.js';
import { connect, disconnect, type Connection } from './db/client.js';
import { ServerList } from './ui/ServerList.js';
import { ServerForm, type ServerFormValues } from './ui/ServerForm.js';
import { ConnectedView } from './ui/ConnectedView.js';
import { Frame } from './ui/Frame.js';

type Route =
  | { kind: 'list' }
  | { kind: 'add' }
  | { kind: 'edit'; server: ServerConfig; password: string }
  | { kind: 'connecting'; server: ServerConfig }
  | { kind: 'connected'; server: ServerConfig; conn: Connection };

export const App: React.FC = () => {
  const { exit } = useApp();
  const [route, setRoute] = useState<Route>({ kind: 'list' });
  const [servers, setServers] = useState<ServerConfig[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadServers().then((s) => {
      setServers(s);
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
    const id = uuid();
    const newServer: ServerConfig = {
      id,
      name: values.name,
      host: values.host || 'localhost',
      port: values.port,
      database: values.database,
      user: values.user,
    };
    const next = [...servers, newServer];
    await saveServers(next);
    if (values.password.length > 0) {
      await keyringSet(id, values.password);
    }
    setServers(next);
    setRoute({ kind: 'list' });
    setError(null);
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
    const next = servers.map((s) => (s.id === id ? updated : s));
    await saveServers(next);
    if (values.password.length > 0) {
      await keyringSet(id, values.password);
    } else {
      await keyringDelete(id);
    }
    setServers(next);
    setRoute({ kind: 'list' });
    setError(null);
  }

  async function startEdit(server: ServerConfig): Promise<void> {
    const password = (await keyringGet(server.id)) ?? '';
    setRoute({ kind: 'edit', server, password });
  }

  async function handleDelete(server: ServerConfig): Promise<void> {
    const next = servers.filter((s) => s.id !== server.id);
    await saveServers(next);
    await keyringDelete(server.id);
    setServers(next);
  }

  async function handleConnect(server: ServerConfig): Promise<void> {
    setError(null);
    setRoute({ kind: 'connecting', server });
    try {
      const password = (await keyringGet(server.id)) ?? '';
      const conn = await connect(server, password);
      setRoute({ kind: 'connected', server, conn });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to connect to ${server.name}: ${msg}`);
      setRoute({ kind: 'list' });
    }
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
    return (
      <Frame subtitle="servers">
        <ServerList
          servers={servers}
          error={error}
          onAdd={() => setRoute({ kind: 'add' })}
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
