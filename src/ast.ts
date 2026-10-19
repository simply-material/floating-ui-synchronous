import ts from 'typescript';

// See ../TYPESCRIPT_AST.md for AST terminology and TypeScript API details.

/**
 * Parses implementation or declaration text with parent links for AST traversal.
 * Throws on syntax errors; semantic type checking belongs to the consumer tests.
 *
 * @param code The source text to parse
 * @param filename - Determines the parser's file kind and labels diagnostics.
 */
export function parse(code: string, filename: string): ts.SourceFile {
  const file = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true);

  // The parser exposes these diagnostics at runtime but omits them from SourceFile's public type, hence the type-casts.
  const { parseDiagnostics } = file as ts.SourceFile & {
    parseDiagnostics: readonly ts.Diagnostic[];
  };

  if (parseDiagnostics.length) {
    const message = ts.flattenDiagnosticMessageText(parseDiagnostics[0].messageText, '\n');
    throw new Error(filename + ': ' + message);
  }

  return file;
}

/**
 * Applies an AST transform and returns syntax-checked source with LF line endings.
 */
export function printTransform(
  file: ts.SourceFile,
  factory: ts.TransformerFactory<ts.SourceFile>,
): string {
  const result = ts.transform(file, [factory]);

  try {
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
    const code = printer.printFile(result.transformed[0]);

    parse(code, file.fileName);
    return code;
  } finally {
    result.dispose();
  }
}

/**
 * Identifies upstream core references in imports, re-exports, and declaration import types.
 * Ordinary strings with the same text are not module references and must stay unchanged.
 */
export function isCoreModuleSpecifier(node: ts.Node): node is ts.StringLiteral {
  if (!ts.isStringLiteral(node) || node.text !== '@floating-ui/core') {
    return false;
  }

  const parent = node.parent;

  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) {
    return parent.moduleSpecifier === node;
  }

  // In a type like import('@floating-ui/core').Middleware, the AST nesting is
  // ImportType -> LiteralType -> StringLiteral. The import type is therefore
  // the string node's grandparent, and its argument is the LiteralType wrapper.
  if (ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent)) {
    return parent.parent.argument === parent;
  }

  // In import Core = require('@floating-ui/core'), the string's direct parent
  // is an ExternalModuleReference node.
  return ts.isExternalModuleReference(parent);
}
