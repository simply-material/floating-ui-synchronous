# TypeScript AST Glossary

Defines the terminology necessary to understand [ast.ts](src/ast.ts), [transform.ts](src/transform.ts),
and [declarations.ts](src/declarations.ts).

Working with an Abstract Syntax Tree (AST) can be pretty intimidating.
This guide is meant for those who are comfortable with TypeScript, but haven't worked with an AST using
the TypeScript compiler (or who need a refresher).

- [Essential Concepts](#essential-concepts)
- [Shared Compiler Operations](#shared-compiler-operations)
- [Implementation Syntax](#implementation-syntax)
- [Declaration Syntax](#declaration-syntax)

Start with Essential Concepts, then use the sections below as a reference while reading code.

| Source file                            | Suggested reading                                                                                                                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ast.ts](src/ast.ts)                   | [Node Properties and Methods](#node-properties-and-methods), [Printing](#printing), and [Imports and Exports](#imports-and-exports).                                                                  |
| [transform.ts](src/transform.ts)       | [Visitors and Transformers](#visitors-and-transformers), [Traversal Methods](#traversal-methods), [Modifiers and Tokens](#modifiers-and-tokens), and [Implementation Syntax](#implementation-syntax). |
| [declarations.ts](src/declarations.ts) | [Names and Literals](#names-and-literals), [Visitors and Transformers](#visitors-and-transformers), [NodeFactory Methods](#nodefactory-methods), and [Declaration Syntax](#declaration-syntax).       |

## Essential Concepts

- A **node** represents a piece of code such as an identifier, declaration, or type annotation.
  `Node` is the common base type for these objects.
- An **AST**, or abstract syntax tree, is the tree of nodes produced by parsing code.
  A node's children represent the smaller pieces inside it.
- A **declaration** introduces something, such as `type Result = ...` or `function calculate()`.
  A **reference** uses a name that has been declared, such as `Result` in `Promise<Result>`.
- A `Statement` represents a statement in a source file, such as a variable statement or
  function declaration. TypeScript also represents type aliases and interfaces as statements.
- An `Expression` represents an expression such as `Promise`, `object.value`, or `calculate()`.
  In `export default Promise`, `Promise` is an expression, even though it names a constructor.
- `TypeNode` (`isTypeNode`): Any node representing type syntax. It describes how a type is _written_;
  it is not a resolved type from TypeScript's type checker.
- A **type parameter** is a name declared by a generic, such as `T` in `type Box<T> = ...`.
  A **type argument** is a type supplied when using that generic, such as `Result` in `Box<Result>`.
- A **type guard** checks a node's shape and narrows its TypeScript type. For example,
  `isTypeReferenceNode(node)` narrows the node's type to a `TypeReferenceNode`, letting us access
  `node.typeName` safely. It does not check whether that name exists or whether its type arguments are valid.
  The `is...` methods listed beside node types below accept a `Node` and return a boolean
  that narrows it to the corresponding type when true.
- **Node identity** means the particular node object. Two occurrences of `Promise<Result>`
  have different identities even when their text is identical. Selecting one node object
  does not select every occurrence of the same text.
- A **visitor** is a callback called with a node. Traversal means walking the tree and calling
  that callback for its nodes. A visitor does not automatically visit a node's children.
- A **transformation** produces a tree with selected nodes replaced or removed. A printer
  turns that tree back into source text.

## Shared Compiler Operations

### Node Properties and Methods

- `kind`: A value of type `SyntaxKind` identifying the node's shape, such as
  `SyntaxKind.Identifier` or `SyntaxKind.TypeReference`.
- `parent`: A value of type `Node` referring to the enclosing node. Passing true for
  `createSourceFile`'s `setParentNodes` argument enables parent links for parsed children.
  Comparing `node.parent === file` checks whether the declaration is directly in the source file
  rather than inside a namespace or another node.
  The root source file itself has no parent at runtime.
- `getText(sourceFile?: SourceFile): string`: Returns the node's original source text,
  excluding leading whitespace and comments. The optional `sourceFile` supplies the source text.
  It reads the _original_ source; use a printer for newly created or transformed nodes.

### Names and Literals

- `Identifier` (`isIdentifier`): A node for a single name, such as `Promise`, `Result`, or `T`.
  Its `text` property is the name as a string. Identifiers occur in declarations,
  expressions, and type references.
- `QualifiedName`: A node for a dotted name in type syntax, such as `globalThis.Promise`
  or `Namespace.Inner.Result`. Its `right` property is the final `Identifier`,
  here `Promise` or `Result`. A qualified name has no `text` property of its own.
- `EntityName`: Either an `Identifier` or a `QualifiedName`.
  Check `isIdentifier` before reading `text`; for a qualified name, `right.text`
  gives the final name.
- `StringLiteral` (`isStringLiteral`): A node for a quoted string, such as `"fn"` or `'@floating-ui/core'`.
  Its `text` property is the string value without quotes. A quoted property name such as
  `"fn"` is a different node kind from the identifier `fn`.
- `ModuleName`: The name of a namespace or ambient module. An identifier names a namespace
  such as `namespace Helpers {}`; a string names a module such as `declare module "external" {}`.
- `ModuleExportName`: An `Identifier` or a `StringLiteral` used in import/export names.
  Both forms have a string `text` property.
- `PropertyName`: The type of a member's name. Relevant forms for declaration-member selection
  are `Identifier`, such as `fn`, and `StringLiteral`, such as `"fn"`.
  TypeScript also permits other forms.
- `NoSubstitutionTemplateLiteral`: A template literal with no `${...}` expressions, such as
  `` `value` ``. It is a separate node kind from `StringLiteral`.
- `StringLiteralLike` (`isStringLiteralLike`): Either a `StringLiteral` or a `NoSubstitutionTemplateLiteral`.
  Both have a string `text` property. A template containing `${...}` is not included.
- `NumericLiteral` (`isNumericLiteral`): A numeric literal node, such as `0` or `42`.
  Its `text` property is a string; for the literal in `void 0`, it is `'0'`.
- `MemberName`: The name after the dot in a property access, such as `getDimensions`
  in `platform.getDimensions`. Its `text` property supplies the name as a string.

### Functions and Variables

- `FunctionDeclaration` (`isFunctionDeclaration`): A declaration such as
  `declare function detectOverflow(state: State): Promise<Result>`.
  It also represents an implemented function such as `function calculate() { return 1; }`.
  Its `name` is an `Identifier | undefined`, and its `type` is the return `TypeNode | undefined`.
- `VariableStatement` (`isVariableStatement`): A statement such as `declare const computePosition: () => Promise<Result>`.
  Its `declarationList` is a `VariableDeclarationList`.
- `VariableDeclarationList`: The list of variables in a variable statement.
  Its `declarations` is a `NodeArray<VariableDeclaration>`. A statement such as
  `declare const first: string, second: number` contains two declarations.
- `VariableDeclaration` (`isVariableDeclaration`): One variable from that list. Its `name` is a `BindingName`, and its
  `type` is the whole `TypeNode | undefined` after the colon. A function-valued variable's
  annotation is a function type, rather than just that function's return type.
- `BindingName`: The name introduced by a variable binding. The simple-name form is an
  `Identifier`, selected with `isIdentifier`. Destructuring forms are not expanded here.

### Imports and Exports

- `ImportDeclaration` (`isImportDeclaration`): An import statement, such as `import { computePosition } from 'external'`.
  Its `moduleSpecifier` is an `Expression`, normally a `StringLiteral` for the package name.
- `ExportDeclaration` (`isExportDeclaration`): An export list or re-export, such as `export { computePosition } from 'external'`.
  Its `moduleSpecifier` is an `Expression | undefined`. A local `export { computePosition }`
  has no module specifier.
- `ExternalModuleReference` (`isExternalModuleReference`): The `require('external')` part of an import-equals declaration.
  Its `expression` is an `Expression`, normally the string literal for the module name.
  It is a different node from an ordinary `require('external')` function call.
- `ImportSpecifier` (`isImportSpecifier`): One named import, such as `Original as Local` in
  `import { Original as Local } from 'external'`. Its `name` is the local `Identifier`, `Local`.
- `ImportClause` (`isImportClause`): The binding part of an import, such as `Default, { Other }` in
  `import Default, { Other } from 'external'`. Its `name` is the default import's
  `Identifier | undefined`. Named imports are separate `ImportSpecifier` nodes.
- `NamespaceImport` (`isNamespaceImport`): The `* as Helpers` part of `import * as Helpers from 'external'`.
  Its `name` is the local `Identifier`, `Helpers`.
- `ImportEqualsDeclaration` (`isImportEqualsDeclaration`): A declaration such as `import Helpers = require('external')`
  or `import Helpers = Namespace.Helpers`. Its `name` is the local `Identifier`, `Helpers`.
- `ExportSpecifier` (`isExportSpecifier`): One entry in an export list, such as `Promisable as PublicResult` in
  `export { Promisable as PublicResult }`. Its `name` is the exported `ModuleExportName`,
  `PublicResult`; its `propertyName` is the original `ModuleExportName | undefined`, `Promisable`.
  Without `as`, `propertyName` is absent and `name` supplies both names.
- `ExportAssignment` (`isExportAssignment`): An export such as `export default Promisable` or `export = Promisable`.
  Its `expression` is an `Expression`, here the identifier `Promisable`.

Declaration import types such as `import('external').Result` use an
[ImportTypeNode](#other-type-nodes-and-their-properties), not an `ImportDeclaration`.

### Modifiers and Tokens

- `SyntaxKind`: An enum identifying node and token kinds. Its members are named numeric values.
- `SyntaxKind.ExportKeyword`: Identifies the `export` token.
  `modifier.kind === SyntaxKind.ExportKeyword` checks whether an alias has an export modifier.
- `SyntaxKind.AsyncKeyword`: Identifies the `async` modifier. Removing this token from a
  function's modifier list leaves its other modifiers in place.
- `SyntaxKind.ImportKeyword`: Identifies the `import` expression in a dynamic import call,
  such as `import('external')`.
- `Modifier`: A keyword modifier, such as `async` or `export`. Its `kind` identifies the keyword.
- `ModifierLike`: An item in a declaration's modifier list. It can represent a keyword modifier
  or a decorator. The relevant keyword checks examine its `kind`; decorator details are omitted.
- `AwaitKeyword` and `AsteriskToken`: Token types for `await` and `*`, respectively.
  They mark async loops and generators as described under
  [Loops, Generators, and Function-Like Checks](#loops-generators-and-function-like-checks).
- `HasModifiers`: The category of nodes whose syntax supports modifiers.
  Membership does not mean a particular node actually has modifiers.
- `canHaveModifiers(node: Node): node is HasModifiers`: Checks that category and narrows
  the node so it can be passed to `getModifiers`.
- `getModifiers(node: HasModifiers): readonly Modifier[] | undefined`: Returns the node's
  keyword modifiers, excluding decorators. The result is undefined when none are present.

### Visitors and Transformers

- `Visitor`: The transformation callback type. With its default type arguments,
  it accepts a `Node` and returns `VisitResult<Node | undefined>`.
- `VisitResult<T>`: The result type returned by a transformation visitor. The forms used here
  are a node or undefined. Returning the original node keeps it; returning another node
  replaces it. Returning undefined removes a node from an optional or list position,
  such as an alias in a source file's statements or an `async` modifier.
  A required child cannot simply be removed.
- `Transformer<T>`: A function with the signature `(node: T) => T`, where `T` extends `Node`.
  A `Transformer<SourceFile>` takes a `SourceFile` and returns a `SourceFile`.
- `TransformerFactory<T>`: A function with the signature
  `(context: TransformationContext) => Transformer<T>`. It receives the transformation
  context and returns the function that will transform a node of type `T`.
- `TransformationContext`: The context supplied by TypeScript while transforming a tree.
  Its `factory` property has type `NodeFactory`.
- `NodeFactory`: The object containing methods for creating or updating AST nodes.
  Its methods return node objects, not source strings.

### Traversal Methods

- `forEachChild<T>(node, cbNode)`: Examines a node's immediate children.
  `node` is a `Node`; `cbNode` has type `(node: Node) => T | undefined`.
  In this call form, child arrays are visited item by item.
  The method stops if a callback returns a truthy value, returning that value; otherwise
  it returns undefined. Its return type is `T | undefined`.
  A callback can recurse with `forEachChild` to walk descendants. Returned nodes are not
  used as replacements by this method.
- `visitEachChild<T>(node, visitor, context): T`: Applies a visitor to the immediate children
  and returns the parent, rebuilt if a child changed. `T` extends `Node`, `visitor` is a
  `Visitor`, and `context` is a `TransformationContext | undefined`.
  It does not call the visitor on the parent itself. Calling this method from inside
  the visitor continues traversal into descendants.
- `visitNode(node, visitor)`: Calls the visitor on the supplied node. With a `Node` and a
  default `Visitor`, the resulting type is `Node | undefined`.
  It does not automatically visit children. The visitor can do that using `visitEachChild`.

### NodeFactory Methods

- `createStringLiteral(text: string): StringLiteral`: Creates a string literal node.
- `updateParenthesizedType(node: ParenthesizedTypeNode, type: TypeNode): ParenthesizedTypeNode`:
  Keeps the parentheses and supplies a new inner type. It returns the original node if the
  inner node is unchanged; otherwise it returns an updated node.
- `createUnionTypeNode(types: readonly TypeNode[]): UnionTypeNode`: Creates a union from the
  supplied type nodes, such as `Result | undefined`.

### Printing

In some places, you'll see the use of printer-related methods. These methods take an object of AST nodes
to convert them back into source strings, typically used to verify the transformation result.

## Implementation Syntax

### Functions and Object Members

- `FunctionExpression` (`isFunctionExpression`): A function used as an expression, such as
  `const calculate = async function named() {}`. Its `name` is an `Identifier | undefined`;
  in this example it is `named`, while `calculate` belongs to the surrounding variable declaration.
- `ArrowFunction`: A function such as `async () => calculate()`. It has no function name
  of its own. In `const calculate = () => 1`, the name belongs to the variable declaration.
- `MethodDeclaration` (`isMethodDeclaration`): A method such as `async calculate() {}` inside a class or object.
  Its `name` is a `PropertyName`. Unlike a `MethodSignature`, it can have an implementation.
- `PropertyAssignment` (`isPropertyAssignment`): An object entry such as `calculate: async () => 1`.
  Its `name` is a `PropertyName`, here the identifier `calculate`.
  The assignment and its child function are separate nodes.

### Calls, Accesses, and Await Operands

- `UnaryExpression`: A base interface for expression shapes allowed as unary operands,
  including calls, property accesses, and other unary expressions. The `expression` property
  of both `AwaitExpression` and `VoidExpression` has this type.
- `LeftHandSideExpression`: A base interface used for call targets and the object being
  accessed in a property access. It includes identifiers, property accesses, and calls.
  Despite the name, membership does not mean an expression can be assigned to.
- `AwaitExpression` (`isAwaitExpression`): An expression such as `await platform.getDimensions(element)`.
  Its `expression` is the `UnaryExpression` after `await`, here a `CallExpression`.
  Replacing the await node with its operand removes the `await` syntax.
- `CallExpression` (`isCallExpression`): A call such as `platform.getDimensions(element)`.
  Its `expression` is the `LeftHandSideExpression` being called, here the property access
  `platform.getDimensions`. Its `arguments` is a `NodeArray<Expression>`, here containing
  `element`. The target and its arguments are separate children.
- `PropertyAccessExpression` (`isPropertyAccessExpression`): An access using a dot, such as `platform.getDimensions`.
  Its `expression` is the `LeftHandSideExpression` before the dot, here `platform`.
  Its `name` is a `MemberName`, here the identifier `getDimensions`.
  This is an expression node, unlike a `QualifiedName` used in type syntax.
- `ElementAccessExpression` (`isElementAccessExpression`): An access using brackets, such as `platform['getDimensions']`.
  Its `expression` is the `LeftHandSideExpression` before the brackets.
  Its `argumentExpression` is the `Expression` inside them, here a `StringLiteral`.
  For `platform[methodName]`, it is an identifier; the node does not tell us that variable's value.
- `ParenthesizedExpression` (`isParenthesizedExpression`): An expression wrapped in parentheses, such as `(calculate())`.
  Its `expression` is the inner `Expression`. It differs from a `ParenthesizedTypeNode`,
  which wraps type syntax.
- `ConditionalExpression` (`isConditionalExpression`): An expression such as `condition ? first() : second()`.
  Its `condition`, `whenTrue`, and `whenFalse` properties are all of type `Expression`.
  The two result branches are distinct from the condition used to choose between them.
- `VoidExpression` (`isVoidExpression`): An expression such as `void 0`, which evaluates its operand and produces
  undefined. Its `expression` is a `UnaryExpression`, here a `NumericLiteral`.
  It is unrelated to the `void` keyword type used in a return annotation.
- `ImportExpression`: The `import` expression used as the target of a dynamic import call.
  In `import('external')`, the outer node is a `CallExpression` whose `expression.kind`
  is `SyntaxKind.ImportKeyword`. This is not an `ImportDeclaration` or an `ImportTypeNode`.

### Loops, Generators, and Function-Like Checks

- `ForOfStatement` (`isForOfStatement`): A loop such as `for (const item of items) {}` or
  `for await (const item of items) {}`. Its `awaitModifier` is an `AwaitKeyword | undefined`,
  present only for the second form.
- `YieldExpression` (`isYieldExpression`): A generator expression such as `yield value` or `yield* values`.
- `SignatureDeclaration`: The type selected by `isFunctionLike`. It includes executable
  functions and type signatures such as `FunctionTypeNode`.
- `isFunctionLike(node: Node | undefined): node is SignatureDeclaration`: Checks for that
  category. Despite the name, it does not guarantee an executable function or a function body.
- `asteriskToken`: An optional `AsteriskToken` on executable function forms, such as
  `function* calculate() {}`. Its presence marks a generator.
  Some `SignatureDeclaration` forms do not have this property, so an `isFunctionLike`
  check alone is not enough to read it; `'asteriskToken' in node` checks for the property.

## Declaration Syntax

### TypeReferenceNode Properties

- `TypeReferenceNode` (`isTypeReferenceNode`): A type referred to by name. It is a more specific kind of `TypeNode`.
  Examples include `Result`, `T`, `Promise<Result>`, `Readonly<Result>`, and
  `globalThis.Promise<Result>`. `T` may refer to a generic parameter; `Result` might instead
  refer to an interface or type alias. The node alone does not tell us which declaration it means.
  Keyword types such as `void` are not type references.
- `typeName`: An `EntityName` representing the name before any type arguments.
  In `Promise<Result>`, it is the `Identifier` for `Promise`.
- `typeArguments`: A `NodeArray<TypeNode> | undefined` containing the types inside `<...>`.
  In `Promise<Result>`, the first argument is the `TypeReferenceNode` for `Result`.
  In `Promise<{ width: number }>`, it is a `TypeLiteralNode` instead.

### Other Type Nodes and Their Properties

- `LiteralTypeNode` (`isLiteralTypeNode`): A type written as a literal, such as `"left"` in `type Side = "left"`.
  Its `literal` property contains the literal node. In `import('external').Result`,
  the import's `argument` is a `LiteralTypeNode` containing the module's `StringLiteral`.
  This extra layer explains why the module string's grandparent is the import type.
- `UnionTypeNode` (`isUnionTypeNode`): A type with alternatives separated by `|`, such as `T | Promise<T>`.
  Its `types` property is a `NodeArray<TypeNode>` containing those alternatives in source order.
- `IntersectionTypeNode` (`isIntersectionTypeNode`): A type combining types with `&`, such as
  `Omit<Original, 'fn'> & { fn(): Result }`. Its `types` property is a `NodeArray<TypeNode>`
  containing the combined types in source order.
- `ParenthesizedTypeNode` (`isParenthesizedTypeNode`): A type inside parentheses, such as `(T | undefined)`.
  Its `type` property is the inner `TypeNode`, here the union `T | undefined`.
- `TypeLiteralNode` (`isTypeLiteralNode`): An inline object type, such as `{ width: number; fn(): Result }`.
  Its `members` property is a `NodeArray<TypeElement>` containing the properties and signatures.
- `FunctionTypeNode` (`isFunctionTypeNode`): A function written as a type, such as `(state: State) => Promise<Result>`.
  Its `type` property is the return `TypeNode`, here `Promise<Result>`.
- `ImportTypeNode` (`isImportTypeNode`): A type obtained through an import expression, such as
  `import('external').Promise<Result>`. Its `qualifier` is an `EntityName | undefined`
  representing the name after the import. A bare `import('external')` has no qualifier.
  Its `argument` is the `TypeNode` for `'external'`, and its type arguments contain `Result`.
- `TypeQueryNode` (`isTypeQueryNode`): A type obtained using `typeof`, such as `typeof Promise`.
  Its `exprName` is an `EntityName`, here the identifier `Promise`. This describes the
  type of value, such as the Promise constructor, rather than a `Promise<Result>` instance.

### TypeAliasDeclaration and TypeParameterDeclaration Properties

- `TypeAliasDeclaration` (`isTypeAliasDeclaration`): A declaration such as `type Promisable<T> = T | Promise<T>`.
- `TypeAliasDeclaration.name`: An `Identifier`, here `Promisable`.
- `TypeAliasDeclaration.type`: The `TypeNode` after `=`, here the union `T | Promise<T>`.
- `TypeAliasDeclaration.typeParameters`: A `NodeArray<TypeParameterDeclaration> | undefined`
  containing the generic parameters declared by the alias, here just `T`.
- `TypeAliasDeclaration.modifiers`: A `NodeArray<ModifierLike> | undefined` containing modifiers
  attached to the declaration, such as `export` or `declare`.
- `TypeParameterDeclaration` (`isTypeParameterDeclaration`): One declared generic parameter, such as `T` or `T extends Element`.
- `TypeParameterDeclaration.name`: An `Identifier` containing the parameter's name.
- `TypeParameterDeclaration.constraint`: A `TypeNode | undefined` for an `extends` constraint.
  In `T extends Element`, it is the node for `Element`.
- `TypeParameterDeclaration.default`: A `TypeNode | undefined` for a default type.
  In `T = Element`, it is the node for `Element`.

### Interfaces, Classes, and Namespaces

- `InterfaceDeclaration` (`isInterfaceDeclaration`): A declaration such as `interface Platform { getDimensions(): Size }`.
  Its `name` is an `Identifier`, and its `members` is a `NodeArray<TypeElement>`.
- `ClassDeclaration` (`isClassDeclaration`): A declaration such as `class Promise {}`. Its `name` is an
  `Identifier | undefined`; an anonymous `export default class {}` has no name.
- `ModuleDeclaration` (`isModuleDeclaration`): A namespace or ambient module declaration, such as
  `namespace Helpers {}` or `declare module "external" {}`. Its `name` is a `ModuleName`.

### Object Type Members

- `TypeElement`: The base type for members of interfaces and object types.
  Its `name` property is a `PropertyName | undefined`. Not every member has a name.
- `MethodSignature` (`isMethodSignature`): A method declaration inside an object type or interface, such as
  `fn(state: State): Promise<Result>`. Its `name` is a `PropertyName`, and its `type`
  is the return annotation, of type `TypeNode | undefined`.
- `PropertySignature` (`isPropertySignature`): A property declaration inside an object type or interface, such as
  `fn: (state: State) => Promise<Result>`. Its `name` is a `PropertyName`, and its `type`
  is the property's entire `TypeNode | undefined`. For this example it is a `FunctionTypeNode`,
  so another `.type` access is needed to reach the return annotation.
