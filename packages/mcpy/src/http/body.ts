import { ErrorCode } from "../enums.js";
import { ProviderFailure } from "../errors.js";

/** Read a response body as text, aborting once it exceeds maxBytes. */
export async function readTextCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw tooLarge(maxBytes);
  }
  if (!res.body) return "";

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge(maxBytes);
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

function tooLarge(maxBytes: number): ProviderFailure {
  return new ProviderFailure(ErrorCode.TooLarge, `response body exceeds ${maxBytes} bytes`);
}
