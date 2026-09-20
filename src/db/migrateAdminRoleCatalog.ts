import { closePool } from './client.js';
import { migrateAdministratorRoleCatalog } from '../services/roleCatalog.service.js';
import { ValidationError } from '../types/index.js';

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !['--dry-run', '--apply'].includes(args[0]))) {
    throw new ValidationError('Usage: db:migrate-admin-catalog [--dry-run|--apply]');
  }
  const result = await migrateAdministratorRoleCatalog({
    apply: args[0] === '--apply',
    operatorLabel: process.env.RBAC_MIGRATION_OPERATOR,
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Administrator catalog migration failed');
  process.exitCode = 1;
} finally {
  await closePool();
}
