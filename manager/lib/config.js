'use strict';

const HEADER = '[/Script/Pal.PalGameWorldSettings]';

function splitTopLevel(text, delimiter = ',') {
  const parts = [];
  let current = '';
  let depth = 0;
  let quoted = false;
  let escaped = false;

  for (const char of text) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quoted) {
      current += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if (!quoted) {
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      if (char === delimiter && depth === 0) {
        parts.push(current.trim());
        current = '';
        continue;
      }
    }
    current += char;
  }
  if (current.trim() || text.endsWith(delimiter)) parts.push(current.trim());
  return parts;
}

function findEquals(text) {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && quoted) {
      escaped = true;
      continue;
    }
    if (char === '"') quoted = !quoted;
    if (!quoted) {
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      if (char === '=' && depth === 0) return i;
    }
  }
  return -1;
}

function unquote(raw) {
  return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function parseValue(raw) {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) return unquote(value);
  if (value.startsWith('(') && value.endsWith(')')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevel(inner).map((item) => {
      const token = item.trim();
      return token.startsWith('"') && token.endsWith('"') ? unquote(token) : token;
    });
  }
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) return Number(value);
  return value;
}

function extractOptionBody(text) {
  const marker = 'OptionSettings=(';
  const start = text.indexOf(marker);
  if (start < 0) throw new Error('OptionSettings block is missing.');
  const bodyStart = start + marker.length;
  let depth = 1;
  let quoted = false;
  let escaped = false;
  for (let i = bodyStart; i < text.length; i += 1) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && quoted) {
      escaped = true;
      continue;
    }
    if (char === '"') quoted = !quoted;
    if (!quoted) {
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      if (depth === 0) return text.slice(bodyStart, i);
    }
  }
  throw new Error('OptionSettings block is not closed.');
}

function parseConfig(text) {
  if (!text.includes(HEADER)) throw new Error('PalWorldSettings.ini header is invalid.');
  const body = extractOptionBody(text);
  const entries = splitTopLevel(body).filter(Boolean).map((part) => {
    const equals = findEquals(part);
    if (equals < 1) throw new Error(`Invalid setting entry: ${part}`);
    const key = part.slice(0, equals).trim();
    const raw = part.slice(equals + 1).trim();
    return { key, raw, value: parseValue(raw) };
  });
  const values = Object.fromEntries(entries.map((entry) => [entry.key, entry.value]));
  return { entries, values };
}

function quote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function coerceValue(value, field) {
  const type = field.type;
  if (type === 'toggle') {
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === 'True' || value === 1) return true;
    if (value === 'false' || value === 'False' || value === 0) return false;
    throw new Error(`${field.label} must be on or off.`);
  }
  if (type === 'number') {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`${field.label} must be a number.`);
    if (field.integer && !Number.isInteger(parsed)) throw new Error(`${field.label} must be a whole number.`);
    if (field.min !== undefined && parsed < field.min) throw new Error(`${field.label} must be at least ${field.min}.`);
    if (field.max !== undefined && parsed > field.max) throw new Error(`${field.label} must be at most ${field.max}.`);
    return parsed;
  }
  if (type === 'select') {
    const parsed = String(value);
    if (!field.options.includes(parsed)) throw new Error(`${field.label} has an invalid choice.`);
    return parsed;
  }
  if (type === 'multiselect') {
    const parsed = Array.isArray(value) ? value.map(String) : [];
    const invalid = parsed.find((item) => !field.options.includes(item));
    if (invalid) throw new Error(`${field.label} contains an invalid choice: ${invalid}.`);
    if (!parsed.length) throw new Error(`${field.label} needs at least one platform.`);
    return parsed;
  }
  if (type === 'stringlist') {
    if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
    return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  }
  return String(value ?? '');
}

function serializeValue(value, field) {
  if (field.type === 'toggle') return value ? 'True' : 'False';
  if (field.type === 'number') {
    if (field.integer) return String(Math.trunc(value));
    const decimals = field.decimals ?? 6;
    return Number(value).toFixed(decimals);
  }
  if (field.type === 'select') return field.quoted ? quote(value) : String(value);
  if (field.type === 'multiselect') return `(${value.map(String).join(',')})`;
  if (field.type === 'stringlist') return value.length ? `(${value.map(quote).join(',')})` : '()';
  return quote(value);
}

function buildConfig(values, schema, order) {
  const fields = new Map(schema.map((field) => [field.key, field]));
  const unknown = Object.keys(values).filter((key) => !fields.has(key));
  if (unknown.length) throw new Error(`Unknown setting(s): ${unknown.join(', ')}`);
  const entries = order.map((key) => {
    const field = fields.get(key);
    if (!field) throw new Error(`Schema is missing ${key}.`);
    const coerced = coerceValue(values[key], field);
    return `${key}=${serializeValue(coerced, field)}`;
  });
  return `${HEADER}\nOptionSettings=(${entries.join(',')})\n`;
}

module.exports = {
  HEADER,
  buildConfig,
  coerceValue,
  extractOptionBody,
  parseConfig,
  parseValue,
  serializeValue,
  splitTopLevel,
};
