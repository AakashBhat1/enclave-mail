import type { IpcResult } from '../types/index';

/** Turns an IpcResult into a value or a thrown Error with the main process's readable message. */
export async function unwrap<T>(pending: Promise<IpcResult<T>>): Promise<T> {
  const res = await pending;
  if (!res.success) throw new Error(res.error ?? 'Something went wrong.');
  return res.data as T;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}
