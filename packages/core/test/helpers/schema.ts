import { validateSchemaDefinition, type SchemaDefinition } from '../../src/index.js';
import { nativeRegexEngine } from './native-regex-engine.js';

/** Builds a validated schema from column shorthand, failing loudly on a bad test definition. */
export function makeSchema(columns: Record<string, unknown>[]): SchemaDefinition {
  const result = validateSchemaDefinition({ name: 'Test', columns }, nativeRegexEngine);
  if (!result.ok) throw new Error(`invalid test schema: ${JSON.stringify(result.issues)}`);
  return result.schema;
}
