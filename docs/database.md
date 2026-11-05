# D1 and Drizzle

Account persistence uses the stable Drizzle ORM D1 driver. Its typed tables live
in `backend/modules/account/persistence/schema.ts`; repositories use the query
builder for selects, inserts, updates, deletes and conditional upserts. Domain
models and application ports stay independent of the ORM.

The platform owns the D1 client and error translation, without importing module
schemas. A small parameterized `sql` expression increments MCP counters inside
the database, so concurrent requests cannot lose accepted increments. Disconnected
connections remain blocked until explicitly enabled or forgotten.

## Change the schema

1. Edit the owning module's `persistence/schema.ts`. New modules use the same
   path convention; `backend/drizzle.config.ts` discovers those schema files.
2. From the repository root, generate an ordered SQL migration and its snapshot:

   ```sh
   pnpm run db:generate --name add_example_field
   ```

3. Review the SQL in `migrations/`, including data backfills, indexes and foreign
   keys. SQLite table rebuilds need particular care with referenced rows and
   `ON DELETE CASCADE`; use a custom migration when the generated SQL would not
   preserve existing data.
4. Apply to the local D1 database and verify:

   ```sh
   pnpm run db:migrate
   pnpm run ci
   ```

5. Commit the schema, SQL, `migrations/meta` snapshots and journal together.
   Deployment applies the SQL through the existing Wrangler migration step.

Generation needs no Cloudflare credentials. `pnpm run db:check` validates
snapshot history; tests check the Account schema against its latest snapshot,
the migrated SQLite structure, and its uniqueness, foreign-key, length and
counter constraints. Add equivalent behavior coverage for new modules.

Wrangler is the only migration runner, both locally and in CI/CD. Do not mix
`drizzle-kit migrate` or `push` with this migration history. Generating a file
does not apply it. The Terraform approval gate covers infrastructure resources;
SQL migrations still follow the application deployment workflow.

## Existing databases

`0001_accounts.sql` is unchanged. `meta/0001_snapshot.json` and the journal adopt
that existing schema as Drizzle's baseline; no new SQL is needed merely to use
the ORM. The next generated migration starts at `0002`. Existing Wrangler
`d1_migrations` records remain authoritative, so an existing database does not
recreate its tables or need a second migration ledger.

The baseline models equivalent legacy constraints. In particular, the original
username uniqueness constraint uses a SQLite auto-index, while Drizzle describes
it as a named unique index. Changing that constraint requires reviewing and
adapting the generated SQL instead of assuming that named index already exists.
The tests compare actual index keys and constraint behavior for both schemas.

Use the official [Drizzle D1 driver documentation](https://orm.drizzle.team/docs/sqlite/connect-cloudflare-d1)
and [migration generation guide](https://orm.drizzle.team/docs/drizzle-kit-generate)
for query and schema APIs. This template pins stable package versions; examples
for a prerelease version may expose different APIs.
