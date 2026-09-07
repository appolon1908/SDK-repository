export class InboundEventError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "InboundEventError";
  }
}
