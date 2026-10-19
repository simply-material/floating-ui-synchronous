import ts from 'typescript';
import { isCoreModuleSpecifier, parse, printTransform } from './ast.ts';

// See ../TYPESCRIPT_AST.md for AST terminology and TypeScript API details.

// Only these function and member contracts may have their immediate returns rewritten.
const functionContracts = new Set(['ComputePosition', 'computePosition', 'detectOverflow']);
const memberContracts = new Map<string, readonly string[]>([
  ['Middleware', ['fn']],
  ['SizeOptions', ['apply']],
  [
    'Platform',
    [
      'getElementRects',
      'getClippingRect',
      'getDimensions',
      'convertOffsetParentRelativeRectToViewportRelativeRect',
      'getOffsetParent',
      'isElement',
      'getDocumentElement',
      'getClientRects',
      'isRTL',
      'getScale',
    ],
  ],
]);

// Async-related type names must not be shadowed or remain in generated declarations.
const asyncTypeNames = new Set(['Promise', 'PromiseLike', 'Promisable']);

/**
 * Returns a single-name type reference matching {@link name}, or undefined.
 */
function matchSingleNameTypeReference(
  type: ts.TypeNode | undefined,
  name: string,
): ts.TypeReferenceNode | undefined {
  if (!type || !ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName)) {
    return undefined;
  }

  return type.typeName.text === name ? type : undefined;
}

/**
 * Returns the sole argument of a matching single-name type reference, or undefined.
 */
function getSingleTypeArgument(type: ts.TypeNode, name: string): ts.TypeNode | undefined {
  const reference = matchSingleNameTypeReference(type, name);

  if (reference?.typeArguments?.length === 1) {
    return reference.typeArguments[0];
  }
}

/**
 * Returns the identifier name introduced by a supported declaration or import.
 */
function getDeclaredOrImportedTypeName(node: ts.Node): string | undefined {
  if (
    ts.isTypeAliasDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeParameterDeclaration(node) ||
    ts.isImportSpecifier(node) ||
    ts.isImportClause(node) ||
    ts.isNamespaceImport(node) ||
    ts.isImportEqualsDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isModuleDeclaration(node)
  ) {
    const name = node.name;
    return name && ts.isIdentifier(name) ? name.text : undefined;
  }
}

/**
 * Requires an alias without an export modifier, with one parameter, no constraint/default,
 * and body `T | Promise<T>`, in that order.
 *
 * This is meant to validate the use of `Promisable` in Floating UI's core dependency based
 * on our expectations. If any of our expectations are violated, an error will be thrown,
 * meaning that the upstream code should be reviewed and this validator updated accordingly.
 */
function validatePromisableDefinition(alias: ts.TypeAliasDeclaration, filename: string): void {
  const exported = alias.modifiers?.some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  );

  if (exported) {
    throw new Error('Unreviewed public Promisable alias in ' + filename);
  }

  if (alias.typeParameters?.length !== 1) {
    throw new Error('Unknown Promisable definition: expected one type parameter in ' + filename);
  }

  const parameter = alias.typeParameters[0];

  if (parameter.constraint || parameter.default) {
    throw new Error(
      'Unknown Promisable definition: parameter constraints and defaults require review in ' +
        filename,
    );
  }

  if (!ts.isUnionTypeNode(alias.type) || alias.type.types.length !== 2) {
    throw new Error('Unknown Promisable definition: expected T | Promise<T> in ' + filename);
  }

  // Both branches must refer to the alias's own parameter.
  const [value, promise] = alias.type.types;
  const valueParameter = matchSingleNameTypeReference(value, parameter.name.text);

  if (!valueParameter || valueParameter.typeArguments?.length) {
    throw new Error(
      'Unknown Promisable definition: first branch must be its parameter in ' + filename,
    );
  }

  const promiseArgument = getSingleTypeArgument(promise, 'Promise');
  const promisedParameter = matchSingleNameTypeReference(promiseArgument, parameter.name.text);

  if (!promisedParameter || promisedParameter.typeArguments?.length) {
    throw new Error(
      'Unknown Promisable definition: second branch must be Promise of its parameter in ' +
        filename,
    );
  }
}

/**
 * Returns the validated private `Promisable<T> = T | Promise<T>` alias, or undefined if absent.
 *
 * Throws for public, nested, or duplicate aliases, and declarations/imports named Promise
 * or PromiseLike, so those names cannot silently change what our transformation means.
 *
 * This is meant to validate the use of `Promisable` in Floating UI's core dependency based
 * on our expectations. If any of our expectations are violated, an error will be thrown,
 * meaning that the upstream code should be reviewed and this validator updated accordingly.
 */
function findAndValidatePromisableAlias(file: ts.SourceFile): ts.TypeAliasDeclaration | undefined {
  let alias: ts.TypeAliasDeclaration | undefined;

  function visit(node: ts.Node): void {
    const name = getDeclaredOrImportedTypeName(node);

    if (name && asyncTypeNames.has(name)) {
      // A local `type Promise<T> = { data: T }` would invalidate our interpretation of
      // Promise<T>. The reviewed Promisable alias is the only binding we allow here.
      if (name !== 'Promisable' || !ts.isTypeAliasDeclaration(node)) {
        throw new Error('Unreviewed asynchronous type binding: ' + name);
      }

      // Only the file-level helper may be removed.
      if (node.parent !== file) {
        throw new Error('Unreviewed nested Promisable alias in ' + file.fileName);
      }

      if (alias) {
        throw new Error('Unreviewed duplicate Promisable alias in ' + file.fileName);
      }

      validatePromisableDefinition(node, file.fileName);
      alias = node;
    }

    // Separate exports can expose an otherwise private alias.
    if (ts.isExportSpecifier(node)) {
      const localName = (node.propertyName ?? node.name).text;
      const exportedName = node.name.text;

      if (asyncTypeNames.has(localName) || asyncTypeNames.has(exportedName)) {
        throw new Error('Unreviewed asynchronous type export: ' + node.getText(file));
      }
    }

    if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression)) {
      if (asyncTypeNames.has(node.expression.text)) {
        throw new Error('Unreviewed asynchronous type export: ' + node.getText(file));
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(file);
  return alias;
}

/**
 * Selects immediate return nodes from top-level declarations covered by the contract lists.
 *
 * In `fn(callback: () => Promise<void>): Promise<Result>`, only `Promise<Result>` is selected.
 * Asynchronous code in parameters, constraints, and types inside returned data/callbacks are not considered
 * because we do not currently expect that in the Floating UI dependencies we transform.
 * If our expectation becomes invalid (e.g., if Floating UI makes a change), then our final validation
 * will throw an any error on any remaining asynchronous behavior, meaning we'd need to then handle those cases.
 */
function collectReturnTypesToTransform(file: ts.SourceFile): Set<ts.TypeNode> {
  const returnTypes = new Set<ts.TypeNode>();

  /**
   * Adds immediate function return nodes, looking through parentheses and union branches.
   * Also looks inside one BivariantCallback wrapper when enabled for `size.apply`.
   * Note that BivariantCallback is a helper defined by Floating UI.
   *
   * @param type
   * @param lookInsideBivariantCallback Whether to allow collecting a function's return nodes from
   * a BivariantCallback wrapper.
   */
  function collectFunctionReturn(
    type: ts.TypeNode | undefined,
    lookInsideBivariantCallback = false,
  ): void {
    if (!type) {
      return;
    }

    if (ts.isFunctionTypeNode(type)) {
      returnTypes.add(type.type);
      return;
    }

    if (ts.isParenthesizedTypeNode(type)) {
      collectFunctionReturn(type.type, lookInsideBivariantCallback);
      return;
    }

    if (ts.isUnionTypeNode(type)) {
      type.types.forEach((branch) => collectFunctionReturn(branch, lookInsideBivariantCallback));
      return;
    }

    if (lookInsideBivariantCallback) {
      // Preserve the wrapper's parameter assignability; only the callback return may change.
      const callback = getSingleTypeArgument(type, 'BivariantCallback');

      if (callback) {
        collectFunctionReturn(callback);
      }
    }
  }

  /**
   * Adds returns from allowed methods and callback properties
   * with identifier or string-literal names.
   */
  function collectMemberReturns(
    members: readonly ts.TypeElement[],
    allowed: readonly string[],
  ): void {
    for (const member of members) {
      const name = member.name;

      if (!name || !(ts.isIdentifier(name) || ts.isStringLiteral(name))) {
        continue;
      }

      if (!allowed.includes(name.text)) {
        continue;
      }

      if (ts.isMethodSignature(member) && member.type) {
        returnTypes.add(member.type);
      } else if (ts.isPropertySignature(member)) {
        // We only look inside a BivariantCallback wrapper for the `apply` method
        // since that's the only place we expect the upstream Floating UI code uses it.
        collectFunctionReturn(member.type, name.text === 'apply');
      }
    }
  }

  /**
   * Collects allowed member returns through object types, parentheses, intersections, and Prettify.
   * Other wrappers such as Omit may remove or replace members, so their arguments are not followed.
   */
  function collectObjectMemberReturns(type: ts.TypeNode, allowed: readonly string[]): void {
    if (ts.isTypeLiteralNode(type)) {
      collectMemberReturns(type.members, allowed);
      return;
    }

    if (ts.isIntersectionTypeNode(type)) {
      type.types.forEach((branch) => collectObjectMemberReturns(branch, allowed));
      return;
    }

    if (ts.isParenthesizedTypeNode(type)) {
      collectObjectMemberReturns(type.type, allowed);
      return;
    }

    const object = getSingleTypeArgument(type, 'Prettify');

    if (object) {
      collectObjectMemberReturns(object, allowed);
    }
  }

  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      const reviewed = statement.name && functionContracts.has(statement.name.text);

      if (reviewed && statement.type) {
        returnTypes.add(statement.type);
      }

      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && functionContracts.has(declaration.name.text)) {
          collectFunctionReturn(declaration.type);
        }
      }

      continue;
    }

    if (ts.isTypeAliasDeclaration(statement)) {
      if (functionContracts.has(statement.name.text)) {
        collectFunctionReturn(statement.type);
      }

      const allowed = memberContracts.get(statement.name.text);

      if (allowed) {
        collectObjectMemberReturns(statement.type, allowed);
      }

      continue;
    }

    if (ts.isInterfaceDeclaration(statement)) {
      const allowed = memberContracts.get(statement.name.text);

      if (allowed) {
        collectMemberReturns(statement.members, allowed);
      }
    }
  }

  return returnTypes;
}

/**
 * Rejects remaining async type references, including dotted names and import/typeof queries.
 * This also catches Promise types deliberately left untouched in parameters or nested data.
 */
function assertNoAsyncTypes(file: ts.SourceFile): void {
  function visit(node: ts.Node): void {
    let reference: ts.EntityName | undefined;

    if (ts.isTypeReferenceNode(node)) {
      reference = node.typeName;
    } else if (ts.isImportTypeNode(node)) {
      reference = node.qualifier;
    } else if (ts.isTypeQueryNode(node)) {
      reference = node.exprName;
    }

    const name = reference && (ts.isIdentifier(reference) ? reference.text : reference.right.text);

    if (name && asyncTypeNames.has(name)) {
      throw new Error(
        'Unreviewed asynchronous type in ' + file.fileName + ': ' + node.getText(file),
      );
    }

    ts.forEachChild(node, visit);
  }

  visit(file);
}

/**
 * Makes reviewed return contracts synchronous and redirects references to the generated core.
 * Removes only the validated private Promisable alias; async types elsewhere require review.
 * Ordinary TypeScript void/any assignability is preserved, without special callback restrictions.
 *
 * @param code - Upstream .d.ts or .d.mts source text.
 * @param coreName - Replacement package name for core imports, re-exports, and import types.
 * @param filename - Declaration filename used for parsing and diagnostics.
 * @throws Error - If an alias, binding, or async type lies outside the reviewed contracts.
 */
export function transformDeclarations(
  code: string,
  coreName: string,
  filename = 'input.d.ts',
): string {
  const file = parse(code, filename);
  const alias = findAndValidatePromisableAlias(file);
  const returnTypes = collectReturnTypesToTransform(file);
  const printer = ts.createPrinter();

  const output = printTransform(file, (context) => {
    /**
     * Replaces an outer `Promise<T>` or validated `Promisable<T>` with T.
     * Also processes parentheses and unions; returns other nodes unchanged.
     */
    function unwrapAsyncReturnType(type: ts.TypeNode): ts.TypeNode {
      const promise = matchSingleNameTypeReference(type, 'Promise');
      const promisable = matchSingleNameTypeReference(type, 'Promisable');
      const wrapper = promise ?? promisable;

      if (wrapper) {
        if (wrapper.typeArguments?.length !== 1) {
          throw new Error('Unreviewed asynchronous return type: ' + type.getText(file));
        }

        if (promisable && !alias) {
          throw new Error(
            'Unreviewed Promisable return without a validated alias: ' + type.getText(file),
          );
        }

        // Keep nested async data intact because we don't expect them to contain asynchronous logic.
        // For example, `Promise<{ pending: Promise<Result> }>` must not become `{ pending: Result }`.
        // Final validation will reject if that expectation changes.
        return wrapper.typeArguments[0];
      }

      if (ts.isParenthesizedTypeNode(type)) {
        return context.factory.updateParenthesizedType(type, unwrapAsyncReturnType(type.type));
      }

      if (ts.isUnionTypeNode(type)) {
        const branches = type.types.map(unwrapAsyncReturnType);

        if (branches.every((branch, index) => branch === type.types[index])) {
          return type;
        }

        // Deduplicate only unions changed by unwrapping, e.g. void | Promise<void>.
        // Compare printed types because equal branches can be distinct node objects.
        const unique = new Map(
          branches.map((branch) => [
            printer.printNode(ts.EmitHint.Unspecified, branch, file),
            branch,
          ]),
        );
        const types = [...unique.values()];

        return types.length === 1 ? types[0] : context.factory.createUnionTypeNode(types);
      }

      return type;
    }

    const visit: ts.Visitor = (node) => {
      if (node === alias) {
        return undefined;
      }

      if (isCoreModuleSpecifier(node)) {
        return context.factory.createStringLiteral(coreName);
      }

      // Only selected return node identities are eligible; nested Promise nodes
      // must not become targets simply because traversal reaches them.
      const updated =
        ts.isTypeNode(node) && returnTypes.has(node) ? unwrapAsyncReturnType(node) : node;
      return ts.visitEachChild(updated, visit, context);
    };

    return (source) => ts.visitNode(source, visit) as ts.SourceFile;
  });

  assertNoAsyncTypes(parse(output, filename));
  return output;
}
