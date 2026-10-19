import { isDeepStrictEqual } from 'node:util';
import ts from 'typescript';
import { isCoreModuleSpecifier, parse, printTransform } from './ast.ts';

// See ../TYPESCRIPT_AST.md for AST terminology and TypeScript API details.

/**
 * Review checkpoint describing asynchronous syntax in an upstream implementation.
 */
export interface AsyncInventory {
  /**
   * Sorted lexical labels for async functions; duplicate labels remain significant.
   */
  functions: string[];

  /**
   * Occurrence counts keyed by containing function and the calls whose results are awaited.
   */
  awaits: Record<string, number>;
}

/**
 * Builds a dotted lexical label for review, without attempting symbol or call-graph resolution.
 */
function functionName(node: ts.Node): string {
  const parts: string[] = [];

  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isVariableDeclaration(current) ||
      ts.isPropertyAssignment(current)
    ) {
      if (current.name) {
        parts.unshift(current.name.getText());
      }
    }
  }

  return parts.join('.') || '<anonymous>';
}

/**
 * Returns a property name only when it is written literally in the source.
 */
function propertyName(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text;
  }

  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
}

/**
 * Collects the result-producing callees in the supported await operand grammar.
 * Calls, parentheses, and conditional branches are supported, including lowered optional calls.
 * Throws for other operands whose semantics have not been reviewed for await removal.
 */
function awaitedCalls(expression: ts.Expression): string[] {
  if (ts.isParenthesizedExpression(expression)) {
    return awaitedCalls(expression.expression);
  }

  if (ts.isCallExpression(expression)) {
    // Only the result-producing call is awaited, not calls in its arguments.
    return [expression.expression.getText().replace(/\s+/g, '')];
  }

  if (ts.isConditionalExpression(expression)) {
    return [...awaitedCalls(expression.whenTrue), ...awaitedCalls(expression.whenFalse)];
  }

  if (
    ts.isVoidExpression(expression) &&
    ts.isNumericLiteral(expression.expression) &&
    expression.expression.text === '0'
  ) {
    // Upstream lowers optional calls to "method == null ? void 0 : method()".
    return [];
  }

  // Await performs GetValue. Simply deleting it from an awaited property used
  // as a callee can accidentally bind "this", or extend an optional chain.
  // Keep the supported grammar narrow instead of adding a runtime adapter.
  throw new Error('Unreviewed await operand: ' + expression.getText());
}

/**
 * Inventories removable async/await syntax and rejects known unsupported async mechanisms.
 * This is a conservative syntax check, not proof that arbitrary callees return synchronously.
 * The build separately compares its result with the committed, reviewed inventory.
 *
 * @throws Error - If syntax is invalid or an asynchronous construct needs manual review.
 */
export function inspectImplementation(code: string, filename = 'input.js'): AsyncInventory {
  const file = parse(code, filename);
  const inventory: AsyncInventory = { functions: [], awaits: {} };

  function visit(node: ts.Node): void {
    const isAsyncLoop = ts.isForOfStatement(node) && node.awaitModifier;
    const isGenerator = ts.isFunctionLike(node) && 'asteriskToken' in node && node.asteriskToken;

    if (isAsyncLoop || isGenerator || ts.isYieldExpression(node)) {
      throw new Error('Unsupported generator or async iteration in ' + filename);
    }

    // For simplicity, these name checks intentionally reject even unrelated synchronous methods
    // named then, catch, or finally. Floating UI has none of that, so this simple check should suffice.
    const isAsyncIdentifier =
      ts.isIdentifier(node) &&
      ['Promise', 'PromiseLike', '__awaiter', '__async', 'regeneratorRuntime'].includes(node.text);
    const isPromiseAccess = propertyName(node) === 'Promise';
    const isAsyncCall =
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        ['then', 'catch', 'finally'].includes(propertyName(node.expression) ?? ''));

    if (isAsyncIdentifier || isPromiseAccess || isAsyncCall) {
      throw new Error(
        'Unsupported asynchronous mechanism in ' + filename + ': ' + node.getText().slice(0, 100),
      );
    }

    if (
      ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
    ) {
      inventory.functions.push(functionName(node));
    }

    if (ts.isAwaitExpression(node)) {
      const calls = awaitedCalls(node.expression);

      if (!calls.length) {
        throw new Error('Unreviewed await operand: ' + node.getText());
      }

      // A local result variable is not part of the containing function's name.
      let owner: ts.Node | undefined = node.parent;

      while (owner && !ts.isFunctionLike(owner)) {
        owner = owner.parent;
      }

      const signature = functionName(owner ?? node) + ': ' + calls.sort().join(', ');
      inventory.awaits[signature] = (inventory.awaits[signature] ?? 0) + 1;
    }

    ts.forEachChild(node, visit);
  }

  visit(file);
  inventory.functions.sort();
  inventory.awaits = Object.fromEntries(Object.entries(inventory.awaits).sort());

  return inventory;
}

/**
 * Requires an observed inventory or dependency map to match its reviewed checkpoint.
 * Object property order is irrelevant; array order and duplicate entries remain significant.
 *
 * @param actual - Observed structure from the current upstream inputs.
 * @param expected - Previously reviewed structure.
 * @param label - Description included with the observed value when comparison fails.
 */
export function assertInventory(
  actual: unknown,
  expected: unknown,
  label = 'Upstream async inventory',
): void {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(
      label + ' changed; review before transforming.\nObserved: ' + JSON.stringify(actual, null, 2),
    );
  }
}

/**
 * Removes reviewed forms of async/await and redirects upstream core module references.
 * Callers must supply synchronous platform methods and middleware; no runtime guards are added.
 * The build must approve the input inventory separately before accepting a new upstream release.
 *
 * @param code - Canonical upstream ESM implementation.
 * @param coreName - Replacement core package imported by the generated DOM package.
 * @param filename
 * @throws Error - If an input or output construct falls outside the supported transformation.
 */
export function transformImplementation(
  code: string,
  coreName: string,
  filename = 'input.js',
): string {
  inspectImplementation(code, filename);

  const result = printTransform(parse(code, filename), (context) => {
    const visit: ts.Visitor = (node) => {
      if (node.kind === ts.SyntaxKind.AsyncKeyword) {
        return undefined;
      }

      if (ts.isAwaitExpression(node)) {
        return ts.visitNode(node.expression, visit);
      }

      if (isCoreModuleSpecifier(node)) {
        return context.factory.createStringLiteral(coreName);
      }

      return ts.visitEachChild(node, visit, context);
    };

    return (file) => ts.visitNode(file, visit) as ts.SourceFile;
  });

  const remaining = inspectImplementation(result, filename);

  if (remaining.functions.length || Object.keys(remaining.awaits).length) {
    throw new Error('Transformation left asynchronous syntax in ' + filename);
  }

  return result;
}
