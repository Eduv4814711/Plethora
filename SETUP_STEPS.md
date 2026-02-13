# Plethora – Setup Steps (Quick Reference)

## What's Already Done

- Environment configured (`apps/api/.env`, `apps/web/.env.local`)
- Database creation script (`scripts/create-db.sql`)
- `@fastify/helmet` downgraded for Fastify 4 compatibility

## Next Steps (In Order)

### 1. PostgreSQL

Ensure PostgreSQL is installed and running. Create the database:

```bash
psql -U postgres -c "CREATE DATABASE plethora;"
```

Update `apps/api/.env` if your credentials differ from `postgres`/`postgres`.

### 2. Apply Schema and Seed

```bash
npm run db:push
npm run db:seed
```

### 3. Start the Application

**Terminal 1 – API:**
```bash
npm run dev:api
```
API: http://localhost:3001

**Terminal 2 – Web:**
```bash
npm run dev:web
```
Web: http://localhost:3000

### 4. Login

- URL: http://localhost:3000  
- Email: `admin@quickbopha.com`  
- Password: `admin123`
