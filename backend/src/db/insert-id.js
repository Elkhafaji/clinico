/**
 * Insert a row and return its auto-generated id across Knex clients.
 * PostgreSQL intentionally returns no rows for insert() unless RETURNING is requested;
 * MySQL and SQLite return the generated id directly.
 */
export async function insertAndGetId(query) {
  const client = query?.client?.config?.client;
  const result = await (client === 'pg' || client === 'postgresql' ? query.returning('id') : query);
  const first = Array.isArray(result) ? result[0] : result;
  const rawId = first && typeof first === 'object' ? first.id ?? first.ID : first;
  if (rawId == null) throw new Error('The insert did not return a generated id.');
  const numericId = Number(rawId);
  return Number.isSafeInteger(numericId) ? numericId : rawId;
}
