import { LudereMcpError } from './errors.mjs';

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(value, expected) {
  if (Array.isArray(expected)) return expected.some((type) => matchesType(value, type));
  if (expected === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'integer') return Number.isInteger(value);
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (expected === 'null') return value === null;
  return typeof value === expected;
}

function collectErrors(value, schema, at, errors) {
  if (!schema || typeof schema !== 'object') return;
  if (schema.oneOf) {
    const branches = schema.oneOf.map((branch) => {
      const branchErrors = [];
      collectErrors(value, branch, at, branchErrors);
      return branchErrors;
    });
    if (branches.filter((branch) => branch.length === 0).length !== 1) {
      errors.push(`${at} must match exactly one allowed shape`);
    }
  }
  if (schema.anyOf) {
    const matches = schema.anyOf.some((branch) => {
      const branchErrors = [];
      collectErrors(value, branch, at, branchErrors);
      return branchErrors.length === 0;
    });
    if (!matches) errors.push(`${at} must match an allowed shape`);
  }
  if (schema.allOf) for (const branch of schema.allOf) collectErrors(value, branch, at, errors);
  if (schema.const !== undefined && !Object.is(value, schema.const)) errors.push(`${at} must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((entry) => Object.is(value, entry))) errors.push(`${at} must be one of ${schema.enum.map((entry) => JSON.stringify(entry)).join(', ')}`);
  if (schema.type && !matchesType(value, schema.type)) {
    errors.push(`${at} must be ${Array.isArray(schema.type) ? schema.type.join(' or ') : schema.type}, received ${valueType(value)}`);
    return;
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${at} must contain at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${at} must contain at most ${schema.maxLength} characters`);
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) errors.push(`${at} has an invalid format`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at} must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at} must be at most ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${at} must contain at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${at} must contain at most ${schema.maxItems} items`);
    if (schema.uniqueItems) {
      const keys = value.map((entry) => JSON.stringify(entry));
      if (new Set(keys).size !== keys.length) errors.push(`${at} must not contain duplicate items`);
    }
    if (schema.items) value.forEach((entry, index) => collectErrors(entry, schema.items, `${at}[${index}]`, errors));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties || {};
    const propertyCount = Object.keys(value).length;
    if (schema.minProperties !== undefined && propertyCount < schema.minProperties) errors.push(`${at} must contain at least ${schema.minProperties} properties`);
    if (schema.maxProperties !== undefined && propertyCount > schema.maxProperties) errors.push(`${at} must contain at most ${schema.maxProperties} properties`);
    for (const required of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, required)) errors.push(`${at}.${required} is required`);
    }
    for (const [key, entry] of Object.entries(value)) {
      if (properties[key]) collectErrors(entry, properties[key], `${at}.${key}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${at}.${key} is not allowed`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        collectErrors(entry, schema.additionalProperties, `${at}.${key}`, errors);
      }
    }
  }
}

export function validateSchema(value, schema, label = 'arguments') {
  const errors = [];
  collectErrors(value, schema, label, errors);
  if (errors.length) {
    throw new LudereMcpError('INVALID_ARGUMENTS', 'Tool arguments did not match the advertised JSON schema.', { errors });
  }
  return value;
}
