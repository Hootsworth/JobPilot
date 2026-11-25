import type { ExtensionMessage } from './messaging';

export function isContextInvalidatedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /extension context invalidated|cannot read properties of undefined/i.test(msg);
}

export function isExtensionContextValid(): boolean {
  try {
    return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

export async function safeSendRuntimeMessage<T = unknown>(
  message: ExtensionMessage
): Promise<T | null> {
  if (!isExtensionContextValid()) return null;
  try {
    if (typeof chrome.runtime?.sendMessage !== 'function') {
      return null;
    }
    return (await chrome.runtime.sendMessage(message)) as T;
  } catch {
    return null;
  }
}
