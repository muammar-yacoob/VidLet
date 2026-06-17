/** Shared process status — written by tools, read by GUI server */
let _status = '';

export function setProcessStatus(status: string): void {
  _status = status;
}

export function getProcessStatus(): string {
  return _status;
}
