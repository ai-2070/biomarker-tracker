// Requests to the dashboard's server. A refused request throws an Error with the server's own message
// ("Unknown agent"), or the status when there is none.
import { apiUrl, requestHeaders } from './connection.ts';
import type { Query } from './connection.ts';

export interface ApiOptions {
  method?: string;
  /** Sent as JSON. */
  body?: unknown;
  /** Sent as it is (a file), instead of body. */
  raw?: Blob;
  query?: Query;
}

/** The answer's JSON (or its text, when it isn't JSON). */
function parse(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

const errorOf = (data: unknown, fallback: string): Error => {
  const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' && data.error ? data.error : fallback;
  return new Error(message);
};

// The JSON the server sent back. T is what the caller expects: GET<Agent[]>('/agents').
export async function api<T = unknown>(path: string, { method = 'GET', body, raw, query }: ApiOptions = {}): Promise<T> {
  const type = raw ? 'application/octet-stream' : body !== undefined ? 'application/json' : null;
  const res = await fetch(apiUrl(path, query), {
    method,
    headers: { ...requestHeaders(), ...(type ? { 'content-type': type } : {}) },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const data = parse(await res.text());
  if (!res.ok) throw errorOf(data, `${res.status} ${res.statusText}`);
  return data as T;
}
export const GET = <T = unknown>(p: string): Promise<T> => api<T>(p);
export const POST = <T = unknown>(p: string, body: unknown = {}): Promise<T> => api<T>(p, { method: 'POST', body });
export const PUT = <T = unknown>(p: string, body: unknown = {}): Promise<T> => api<T>(p, { method: 'PUT', body });
export const DEL = <T = unknown>(p: string): Promise<T> => api<T>(p, { method: 'DELETE' });

/** fetch with the dashboard's headers, for callers that read the answer themselves (the chat stream).
 *  Takes a full address, as the AI SDK hands it over. */
export const serverFetch = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> =>
  fetch(input, { ...init, headers: { ...requestHeaders(), ...Object.fromEntries(new Headers(init.headers).entries()) } });

/** A file from the server as it is (a 3D model, an image to copy), by the address apiUrl or fileUrl gave. */
export async function fetchFile(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return res;
}

export interface UploadOptions {
  query?: Query;
  /** Bytes sent so far. */
  onProgress?: (sent: number) => void;
  /** Stops the upload; it then fails with "Cancelled". */
  signal?: AbortSignal;
}

/** POSTs a file as the raw body, with progress (fetch can't report upload progress), and reads the JSON answer. */
export function upload<T = unknown>(path: string, file: Blob, { query, onProgress, signal }: UploadOptions = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelled'));
    const xhr = new XMLHttpRequest();
    const stop = () => xhr.abort();
    signal?.addEventListener('abort', stop, { once: true });
    const end = () => signal?.removeEventListener('abort', stop);
    xhr.open('POST', apiUrl(path, query));
    for (const [k, v] of Object.entries(requestHeaders())) xhr.setRequestHeader(k, v);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    if (onProgress) xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      end();
      const data = parse(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300 && data && typeof data === 'object') resolve(data as T);
      else reject(errorOf(data, `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => (end(), reject(new Error('Upload failed: the dashboard could not be reached.')));
    xhr.onabort = () => (end(), reject(new Error('Cancelled')));
    xhr.send(file);
  });
}
