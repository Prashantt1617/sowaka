/** A refusal with its HTTP status; the lifecycle routes answer it as `{ error }`. */
export class LifecycleError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'LifecycleError';
  }
}
