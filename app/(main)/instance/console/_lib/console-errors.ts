const CONSOLE_IN_USE_PATTERNS = [
  'already in use',
  'already connected',
  'console is busy',
  'console busy',
  'connection is busy',
  'websocket is already connected',
  'used by another client',
];

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function isConsoleAlreadyInUseError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  return CONSOLE_IN_USE_PATTERNS.some((pattern) => message.includes(pattern));
}

export function getConsoleConnectionFailureMessage(error: unknown) {
  if (isConsoleAlreadyInUseError(error)) {
    return 'The console is already open in another browser or client.';
  }

  const message = getErrorMessage(error);
  return message || 'The console failed to connect.';
}
