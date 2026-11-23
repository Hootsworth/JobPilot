import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function enforceStrictObjects(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(enforceStrictObjects);
  }
  if (!isRecord(node)) return node;

  const copy: JsonRecord = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === '$schema') continue;
    copy[k] = enforceStrictObjects(v);
  }

  if (copy['type'] === 'object') {
    if (!('additionalProperties' in copy)) {
      copy['additionalProperties'] = false;
    }
    if (isRecord(copy['properties'])) {
      // OpenAI strict json_schema requires all property keys in `required`
      const propKeys = Object.keys(copy['properties']);
      if (propKeys.length > 0) {
        copy['required'] = propKeys;
      }
    }
  }
  return copy;
}

export function zodToOpenAiJsonSchema(
  schema: z.ZodTypeAny,
  name: string
): { name: string; strict: boolean; schema: JsonRecord } {
  const raw = zodToJsonSchema(schema, {
    $refStrategy: 'none',
    target: 'jsonSchema7'
  }) as JsonRecord;

  const strictSchema = enforceStrictObjects(raw) as JsonRecord;
  return {
    name,
    strict: true,
    schema: strictSchema
  };
}

export function zodToStandardJsonSchema(schema: z.ZodTypeAny): JsonRecord {
  const raw = zodToJsonSchema(schema, {
    $refStrategy: 'none',
    target: 'jsonSchema7'
  }) as JsonRecord;
  delete raw['$schema'];
  return raw;
}

const GEMINI_TYPE_MAP: Record<string, string> = {
  object: 'OBJECT',
  array: 'ARRAY',
  string: 'STRING',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN'
};

function sanitizeForGemini(node: unknown): JsonRecord | undefined {
  if (!isRecord(node)) return undefined;
  const out: JsonRecord = {};

  if (Array.isArray(node['anyOf'])) {
    const nonNull = node['anyOf'].filter(
      (item) => !(isRecord(item) && item['type'] === 'null')
    );
    const hasNull = nonNull.length < node['anyOf'].length;
    if (nonNull.length >= 1) {
      const first = sanitizeForGemini(nonNull[0]);
      if (first) {
        if (hasNull) first['nullable'] = true;
        if (typeof node['description'] === 'string') {
          first['description'] = node['description'];
        }
        return first;
      }
    }
  }

  const rawType = node['type'];
  if (typeof rawType === 'string') {
    const mapped = GEMINI_TYPE_MAP[rawType.toLowerCase()];
    if (mapped) out['type'] = mapped;
  } else if (Array.isArray(rawType)) {
    const nonNullTypes = rawType.filter((t): t is string => typeof t === 'string' && t !== 'null');
    if (rawType.includes('null')) out['nullable'] = true;
    const primary = nonNullTypes[0];
    if (primary) {
      const mapped = GEMINI_TYPE_MAP[primary.toLowerCase()];
      if (mapped) out['type'] = mapped;
    }
  }

  if (typeof node['description'] === 'string' && node['description'].length > 0) {
    out['description'] = node['description'];
  }

  if (Array.isArray(node['enum'])) {
    out['enum'] = node['enum'].filter((v) => typeof v === 'string');
  }

  if (isRecord(node['properties'])) {
    const cleanProps: JsonRecord = {};
    for (const [key, propVal] of Object.entries(node['properties'])) {
      const cleaned = sanitizeForGemini(propVal);
      if (cleaned && Object.keys(cleaned).length > 0) {
        cleanProps[key] = cleaned;
      }
    }
    if (Object.keys(cleanProps).length > 0) {
      out['properties'] = cleanProps;
      if (Array.isArray(node['required'])) {
        const filteredReq = node['required'].filter(
          (r): r is string => typeof r === 'string' && r in cleanProps
        );
        if (filteredReq.length > 0) {
          out['required'] = filteredReq;
        }
      }
    } else if (out['type'] === 'OBJECT') {
      // Gemini rejects OBJECT schemas without properties unless omitted or string-encoded
      out['type'] = 'OBJECT';
    }
  }

  if (node['items'] !== undefined) {
    const itemSchema = sanitizeForGemini(node['items']);
    if (itemSchema && Object.keys(itemSchema).length > 0) {
      out['items'] = itemSchema;
    } else {
      out['items'] = { type: 'STRING' };
    }
  }

  if (!out['type']) {
    if (out['properties']) out['type'] = 'OBJECT';
    else if (out['items']) out['type'] = 'ARRAY';
    else out['type'] = 'STRING';
  }

  return out;
}

export function zodToGeminiResponseSchema(schema: z.ZodTypeAny): JsonRecord {
  const jsonSchema = zodToStandardJsonSchema(schema);
  return sanitizeForGemini(jsonSchema) ?? { type: 'OBJECT' };
}

export function extractJsonPayload(rawText: string): string {
  const trimmed = rawText.trim();
  if (!trimmed) return '';

  // Strip ```json ... ``` or ``` ... ``` fences
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  // Direct JSON object or array
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    return trimmed;
  }

  // Fallback: locate outer braces/brackets
  const firstObj = trimmed.indexOf('{');
  const firstArr = trimmed.indexOf('[');
  const start =
    firstObj === -1
      ? firstArr
      : firstArr === -1
        ? firstObj
        : Math.min(firstObj, firstArr);

  if (start === -1) return trimmed;

  const openChar = trimmed[start];
  const closeChar = openChar === '{' ? '}' : ']';
  const end = trimmed.lastIndexOf(closeChar);
  if (end > start) {
    return trimmed.slice(start, end + 1);
  }
  return trimmed;
}

export function formatZodErrors(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      return `- ${path}: ${issue.message} (code=${issue.code})`;
    })
    .join('\n');
}
