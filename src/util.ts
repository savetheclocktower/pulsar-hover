type AnyFunction = (...args: never[]) => unknown

// A class for setting and clearing a timeout. Handles some of the annoying
// boilerplate.
export class Timer {
  timeout: NodeJS.Timeout | null = null
  // A function to schedule via `setTimeout`. Can take any parameters and
  // return anything.
  handler: AnyFunction
  // How long to wait before running the function once `schedule` is called.
  duration: number

  // The arguments waiting to be passed to the function. If an execution isn't
  // pending, this returns `null`.
  public pendingArgs: unknown[] | null = null

  // Creates a class to manage a deferred function.
  constructor(handler: AnyFunction, duration: number) {
    this.handler = handler
    this.duration = duration
  }

  // Schedules the function to run after the duration specified in the
  // constructor.
  //
  // If it's called again in the interim, the function is rescheduled.
  schedule(...args: unknown[]) {
    this.unschedule()
    this.pendingArgs = args
    this.timeout = setTimeout(
      (...args) => {
        this.handler(...(args as never[]))
        this.timeout = null
        this.pendingArgs = null
      },
      this.duration,
      ...args
    )
  }

  // Whether an action has been scheduled and will run in the future.
  get isPending() {
    return !!this.timeout
  }

  // Unschedules the function from running despite an earlier call to
  // `schedule`.
  //
  // If the function was not scheduled to run, has no effect.
  unschedule() {
    if (!this.timeout) return
    clearTimeout(this.timeout)
    this.timeout = null
  }

  dispose () {
    this.unschedule();
  }
}


// export class Index<TKey, TValue> extends Map<TKey, TValue[]> {
//   add (key: TKey, value: TValue) {
//
//   }
// }
