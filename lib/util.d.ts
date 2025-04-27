type AnyFunction = (...args: never[]) => unknown;
export declare class Timer {
    timeout: NodeJS.Timeout | null;
    handler: AnyFunction;
    duration: number;
    pendingArgs: unknown[] | null;
    constructor(handler: AnyFunction, duration: number);
    schedule(...args: unknown[]): void;
    get isPending(): boolean;
    unschedule(): void;
    dispose(): void;
}
export {};
