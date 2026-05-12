-- Clears Prisma migration history (does not drop application tables).
-- Use when switching to the squashed baseline or removing a stuck failed row
-- together with other orphaned migration names. Backup the database first.
--
-- After this, from apps/api:
--   Empty schema:  npx prisma migrate deploy
--   Schema already matches schema.prisma:  npm run db:migrate:resolve-baseline-applied
TRUNCATE TABLE "_prisma_migrations";
