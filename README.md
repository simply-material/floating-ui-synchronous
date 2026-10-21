# Synchronous Floating UI For The Web

A repackaging of Floating UI's DOM and core packages to expose synchronous instead of asynchronous positioning APIs.

## How does it work?

This repository transforms Floating UI DOM and Core packages to remove their asynchronous behavior and then publishes
the results as new packages. The transformation uses the TypeScript compiler to parse and modify the original code
to remove its asynchronous behavior. This is feasible because Floating UI's DOM and core packages do not actually
rely on asynchronous behavior. Therefore, we don't need a general asynchronous to synchronous transformer.
Instead, the transformer converts only the asynchronous parts the library actually uses.

We also guard against unexpected usage. If the source code ever updates to use asynchronous constructs not expected by
our transformer, an error is thrown we'd need to make updates to the transformer to handle these new cases. However,
that's unlikely to happen given _why_ the API is asynchronous in the first place. Read on to learn more.

## History

[Floating UI](https://github.com/floating-ui/floating-ui) is a set of popular JavaScript libraries for positioning
elements across different platforms. Currently, there are two officially supported platforms:

- [Floating UI DOM](https://www.npmjs.com/package/@floating-ui/dom)
- [Floating UI React Native](https://www.npmjs.com/package/@floating-ui/react-native)

Both of these libraries rely on the [core](https://www.npmjs.com/package/@floating-ui/core) library.
When Floating UI was created, its core APIs were designed to be asynchronous. This was because, at the time,
React Native developers needed to use asynchronous APIs for layout and positioning. However, this meant
that the Floating UI DOM library must also use these asynchronous APIs--even though the web's layout and positioning
are synchronous on the web.

Making Floating UI synchronous for the browser has been explored a few times recently:

- [Feature request: Synchronous API for position solving](https://github.com/floating-ui/floating-ui/issues/2418)
- [Pull request by the maintainer to split the library into synchronous and async versions at build time (closed)](https://github.com/floating-ui/floating-ui/pull/3343)
- [Pull request by the maintainer to split the library into synchronous and async versions at runtime (merged)](https://github.com/floating-ui/floating-ui/pull/3344)

That second pull request was merged into the `next` branch for version 2 for Floating UI.
However, version 2 is [no longer planned](https://github.com/floating-ui/floating-ui/issues/3260#issuecomment-3896726479).

## Asynchronous Positioning: Does it make sense today?

Interestingly, no. At least for web browsers and React Native. We already mentioned how layout and positioning was
always synchronous on the web. React Native, however, recently updated its architecture to give synchronous access
to the native layer. This new architecture was [introduced in version 0.76 on October 23rd, 2024](https://reactnative.dev/blog/2024/10/23/the-new-architecture-is-here).
It was also the default for new applications. A year later, version 0.82 on October 8, 2025, made the new architecture
_mandatory_ for applications. So there's little reason for Floating UI to be asynchronous today, except for maintaining
backwards compatibility older React Native versions.

## Contributing

This repository has one clear purpose: transform the published DOM and core Floating UI packages to remove their
asynchronous behavior / APIs, and then publish their transformed versions. Importantly, the packages should behave
exactly the same, offering the same features (and bugs!) as the original versions. This repository is not a
traditional fork. Contributions will not be accepted for adding new features or fixing bugs to the original source.
In those cases, you should contribute to the original Floating UI packages. Contributions will only be considered
for how the repository:

- Transforms the original packages.
- Publishes the transformed packages.
- Tests and verifies the transformed packages.

See:

- [MAINTAINER.md](https://github.com/simply-material/floating-ui-synchronous/blob/main/MAINTAINER.md) for information on how to navigate and work with the repository.
- [RELEASING.md](https://github.com/simply-material/floating-ui-synchronous/blob/main/RELEASING.md) for an overview of the release flow.
- [TYPESCRIPT_AST.md](https://github.com/simply-material/floating-ui-synchronous/blob/main/TYPESCRIPT_AST.md) for an introduction to TypeScript's abstract syntax tree API.
