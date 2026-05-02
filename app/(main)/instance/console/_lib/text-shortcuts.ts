import type { ConsoleShortcutId } from './shortcuts';

const TEXT_SHORTCUT_SEQUENCES: Record<ConsoleShortcutId, string> = {
  'ctrl-alt-delete': '\u001b[3;7~',
  'alt-tab': '\u001b\t',
  'alt-f4': '\u001b[1;3S',
  // There is no broadly reliable encoding for Ctrl+Alt+1 over a raw terminal byte stream.
  // We fall back to the more widely understood Alt+1 form as a best-effort approximation.
  'ctrl-alt-1': '\u001b1',
  'ctrl-alt-f2': '\u001b[1;7Q',
  'ctrl-alt-f3': '\u001b[1;7R',
  'ctrl-alt-f4': '\u001b[1;7S',
};

export function getTextConsoleShortcutSequence(shortcut: ConsoleShortcutId) {
  return TEXT_SHORTCUT_SEQUENCES[shortcut];
}
