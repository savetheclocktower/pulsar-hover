declare module 'marked' {

  // Thrown together to describe the exact surface area of the `marked` API we
  // use.
  //
  // When Pulsar upgrades to Electron 30+, we can upgrade our `marked` version
  // and consume a proper .d.ts.

  /**
   * Compiles markdown to HTML asynchronously.
   */
  export declare function marked(
    src: string,
    options: MarkedOptions,
    callback: (error?: Error, html: string) => unknown
  ): void;
  export declare function marked(
    src: string,
    callback: (error?: Error, html: string) => unknown
  ): void;

  export interface MarkedOptions {
    breaks?: boolean;
    highlight?: (code: string, lang: string, callback: (error?: Error | null, result: string) => void) => void;
  }

  export declare namespace marked {
  	var setOptions: (options: MarkedOptions) => typeof marked;
  	var parse: typeof marked;
  }
  export declare const setOptions: (options: MarkedOptions) => typeof marked;
  export declare const parse: typeof marked;
  export {};
}
