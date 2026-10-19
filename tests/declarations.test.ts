import { readFileSync } from 'node:fs';
import { format } from 'prettier';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { transformDeclarations } from '../src/declarations.ts';

// Fixed replacement identity matching the independently authored expected declaration fixture.
const coreName = '@example/synchronous-core';

const rejectionCases: { name: string; source: string }[] = JSON.parse(
  readFileSync(new URL('./fixtures/declarations.rejected.json', import.meta.url), 'utf8'),
);

describe('declaration AST transformation', () => {
  it('changes only the reviewed contracts in an independent declaration fixture', async () => {
    const source = readFileSync(
      new URL('./fixtures/contracts.input.d.ts', import.meta.url),
      'utf8',
    );
    const expected = readFileSync(
      new URL('./fixtures/contracts.expected.d.ts', import.meta.url),
      'utf8',
    );
    const options = { parser: 'typescript', singleQuote: true, printWidth: 100 };
    const expectedFile = ts.createSourceFile(
      'expected.d.ts',
      expected,
      ts.ScriptTarget.Latest,
      true,
    );
    const expectedPrinted = ts.createPrinter().printFile(expectedFile);
    const output = transformDeclarations(source, coreName);

    expect(await format(output, options)).toBe(await format(expectedPrinted, options));
    expect(transformDeclarations(output, coreName)).toBe(output);
  });

  it('rewrites declaration imports, re-exports, and import type queries', () => {
    const output = transformDeclarations(
      [
        'import type {Platform} from "@floating-ui/core";',
        'export type {Middleware} from "@floating-ui/core";',
        'export type State = import("@floating-ui/core").MiddlewareState;',
      ].join('\n'),
      coreName,
    );
    expect(output).not.toContain('@floating-ui/core');
    expect(output.match(/@example\/synchronous-core/g)).toHaveLength(3);
  });

  it.each(rejectionCases)(
    'stops for review instead of stripping unrelated types: $name',
    ({ source }) => {
      expect(() => transformDeclarations(source, coreName)).toThrow(/Unreviewed|Unknown/);
    },
  );
});
