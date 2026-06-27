import type { PumpClassification } from "@screener/db";

const PREFIX = "classify:";

export function encodeClassificationCallback(
  classification: PumpClassification,
  pumpId: string,
): string {
  const data = `${PREFIX}${classification}:${pumpId}`;
  if (Buffer.byteLength(data, "utf8") > 64) {
    throw new Error(`callback_data exceeds Telegram 64-byte limit (${data.length} chars)`);
  }
  return data;
}

export function parseClassificationCallback(
  data: string,
): { classification: PumpClassification; pumpId: string } | null {
  if (!data.startsWith(PREFIX)) return null;

  const rest = data.slice(PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep === -1) return null;

  const classification = rest.slice(0, sep);
  const pumpId = rest.slice(sep + 1);
  if (classification !== "pump" && classification !== "dump" && classification !== "none") {
    return null;
  }
  if (!pumpId) return null;

  return { classification, pumpId };
}

export function classificationLabel(classification: PumpClassification): string {
  switch (classification) {
    case "pump":
      return "Pump";
    case "dump":
      return "Dump";
    case "none":
      return "None";
  }
}

export function buildClassificationKeyboard(pumpId: string) {
  return {
    inline_keyboard: [
      [
        { text: "📈 Pump", callback_data: encodeClassificationCallback("pump", pumpId) },
        { text: "📉 Dump", callback_data: encodeClassificationCallback("dump", pumpId) },
        { text: "⚪ None", callback_data: encodeClassificationCallback("none", pumpId) },
      ],
    ],
  };
}
