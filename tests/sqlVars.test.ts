import { describe, expect, it } from 'vitest';
import { extractVariables, substituteVariables } from '../src/db/sqlVars.js';

describe('extractVariables', () => {
  it('finds simple :var', () => {
    expect(extractVariables('SELECT * FROM t WHERE id = :id')).toEqual(['id']);
  });

  it('returns each variable once, in order', () => {
    expect(
      extractVariables('SELECT :a, :b, :a, :c, :b'),
    ).toEqual(['a', 'b', 'c']);
  });

  it('ignores ::cast', () => {
    expect(extractVariables('SELECT id::int FROM t')).toEqual([]);
  });

  it('ignores :var inside single-quoted strings', () => {
    expect(extractVariables(`SELECT 'hello :name' FROM t`)).toEqual([]);
  });

  it('ignores :var inside double-quoted identifiers', () => {
    expect(extractVariables(`SELECT "weird :col" FROM t`)).toEqual([]);
  });

  it('ignores :var inside line comments', () => {
    expect(
      extractVariables('-- :secret\nSELECT :real FROM t'),
    ).toEqual(['real']);
  });

  it('ignores :var inside block comments', () => {
    expect(
      extractVariables('/* :secret /* nested :inner */ */ SELECT :real'),
    ).toEqual(['real']);
  });

  it('ignores :var inside dollar-quoted body ($$...$$)', () => {
    expect(
      extractVariables(`DO $$ DECLARE x int := :inner; BEGIN END $$ SELECT :real`),
    ).toEqual(['real']);
  });

  it('ignores :var inside tagged dollar quote ($tag$...$tag$)', () => {
    expect(
      extractVariables(`SELECT $body$ :a $body$, :b`),
    ).toEqual(['b']);
  });

  it("handles doubled-quote escapes inside strings", () => {
    expect(
      extractVariables(`SELECT 'it''s :inside', :outside`),
    ).toEqual(['outside']);
  });
});

describe('substituteVariables', () => {
  it('rewrites :var to $N and orders values', () => {
    const { sql, values } = substituteVariables(
      'SELECT * FROM t WHERE a = :x AND b = :y AND c = :x',
      { x: 1, y: 'two' },
    );
    expect(sql).toBe('SELECT * FROM t WHERE a = $1 AND b = $2 AND c = $1');
    expect(values).toEqual([1, 'two']);
  });

  it('passes null for missing values', () => {
    const { sql, values } = substituteVariables('SELECT :a, :b', { a: 'x' });
    expect(sql).toBe('SELECT $1, $2');
    expect(values).toEqual(['x', null]);
  });

  it('does not rewrite inside dollar-quoted plpgsql', () => {
    const { sql, values } = substituteVariables(
      `DO $$ BEGIN PERFORM pg_notify('c', ':kept'); END $$ SELECT :real`,
      { real: 7, kept: 'NO' },
    );
    expect(sql).toBe(
      `DO $$ BEGIN PERFORM pg_notify('c', ':kept'); END $$ SELECT $1`,
    );
    expect(values).toEqual([7]);
  });

  it('preserves ::cast unchanged', () => {
    const { sql, values } = substituteVariables(
      `SELECT :id::int`,
      { id: '42' },
    );
    expect(sql).toBe('SELECT $1::int');
    expect(values).toEqual(['42']);
  });
});
