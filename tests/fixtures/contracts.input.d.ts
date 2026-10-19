/*
 * Examples of code and their expected transformation.
 * contracts.input.d.ts contains the original code and contracts.expected.d.ts contains
 * the code after applying our transformer.
 *
 * The examples here are not arbitrary. They mimic the same types of code patterns
 * using in Floating UI's source code. Checking these patterns helps ensure
 * that we are correctly transforming Floating UI's source code.
 *
 * ../declarations.test.ts transforms the input and compares the entire result with the
 * expected file after printing and formatting. Comments are included, so keep shared
 * comments (including this one) identical.
 */
import type { Coords } from '@floating-ui/core';
export type { Placement } from '@floating-ui/core';

type Promisable<Value> = Value /* comments must not affect alias matching */ | Promise<Value>;

type Prettify<T> = { [K in keyof T]: T[K] } & {};

// Method syntax preserves upstream's bivariant parameter checking.
type BivariantCallback<T extends (...args: any[]) => any> = {
  bivariance(...args: Parameters<T>): ReturnType<T>;
}['bivariance'];

export interface Result {
  readonly x: number;
}

// Duplicate branches are intentional: unrelated unions must remain untouched.
export type Unchanged = number | number;

// Name colliding with Object.prototype must not be mistaken for a reviewed contract.
export interface toString {
  readonly value: string;
}

export type Imported = import('@floating-ui/core').Coords;

export type ComputePosition = <T extends Result>(
  reference: T,
  optional?: boolean,
) => Promise<Readonly<T>>;

export declare const computePosition: ComputePosition;

export declare function detectOverflow(value: Result): Promise<number>;

export declare function detectOverflow(value: string): Promise<string>;

export interface Platform {
  getElementRects: <T extends Result>(element: T) => Promisable<T>;

  readonly getDimensions?: ((element: Result) => Promisable<readonly [number, number]>) | undefined;

  isRTL(element: Result): Promisable<boolean>;

  data: {
    readonly nested: Coords;
  };
}

export type Middleware = Prettify<
  {
    options?: {
      readonly value: string;
    };
  } & {
    name: string;

    fn(state: Result): Promisable<Result>;
  }
>;

export type SizeOptions = Prettify<
  Omit<
    {
      // Omit removes this property; only the apply callback below should be affected by our transformer.
      apply: string;
    },
    'apply'
  > & {
    apply?: BivariantCallback<(args: Result) => void | Promise<void>> | undefined;
  }
>;
