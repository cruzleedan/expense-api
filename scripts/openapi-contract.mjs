import { isDeepStrictEqual } from 'node:util';

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
  }
  return value;
}

export function openapiContract(document) {
  return sorted({
    openapi: document.openapi, paths: document.paths, components: document.components,
    security: document.security, servers: document.servers,
  });
}

export function assertContractParity(contract, baseline) {
  if (!isDeepStrictEqual(contract, baseline)) {
    throw new Error('Generated OpenAPI contract changed. Review compatibility before explicitly refreshing the baseline.');
  }
}

export function assertInternalReferences(value) {
  if (!value || typeof value !== 'object') return;
  if (typeof value.$ref === 'string' && !value.$ref.startsWith('#/')) {
    throw new Error('OpenAPI references must be internal to the generated document');
  }
  for (const nested of Object.values(value)) assertInternalReferences(nested);
}
