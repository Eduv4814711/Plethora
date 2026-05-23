# AWS S3 Storage

Plethora uploads (logos, task attachments, academy documents) go through a single storage layer that supports **local disk** (development and EFS-backed ECS) and **Amazon S3** (production).

Implementation: [`apps/api/src/lib/storage.ts`](../apps/api/src/lib/storage.ts)

Related: [`AWS_ENVIRONMENT_VARIABLES.md`](AWS_ENVIRONMENT_VARIABLES.md)

---

## Environment variables

| Variable | Required when | Description |
|----------|---------------|-------------|
| `STORAGE_DRIVER` | No | `local` (default) or `s3` |
| `AWS_REGION` | `STORAGE_DRIVER=s3` | Region for the S3 client (e.g. `af-south-1`) |
| `S3_BUCKET_NAME` | `STORAGE_DRIVER=s3` | Target bucket |
| `S3_PUBLIC_BASE_URL` | Recommended for S3 | Public base URL (e.g. CloudFront `https://cdn.example.com`) used in `getPublicUrl` |
| `UPLOADS_DIR` | Local only | Writable directory; default `./uploads` under API cwd |

When `STORAGE_DRIVER=s3`, the ECS **task role** must allow `s3:PutObject`, `s3:DeleteObject`, and `s3:GetObject` on the bucket prefix. Do not put AWS access keys in environment variables.

Templates: [`apps/api/.env.aws.example`](../apps/api/.env.aws.example)

---

## Storage API

| Method | Purpose |
|--------|---------|
| `uploadFile({ key, body, contentType? })` | Write object |
| `deleteFile(key)` | Remove object |
| `getPublicUrl(key)` | Browser URL (`/uploads/...` local, CDN/S3 URL in production) |
| `getSignedUrl(key, expiresInSeconds?)` | Presigned GET for private buckets (S3 only) |
| `getAssetUrl(key, { proxied? })` | Value stored/returned to clients |
| `resolveKeyFromUrl(url)` | Map stored URL back to object key for deletes |

Object keys are POSIX-style paths without a leading slash, e.g.:

- `logos/{uuid}.png`
- `tasks/{companyId}/{taskId}/{uuid}.pdf`
- `academy/{companyId}/{studentId}/{uuid}.pdf`
- `academy/instructors/{companyId}/{instructorId}/{uuid}.pdf`

---

## Audit: upload handling in the API

### Writes to storage

| Location | Content | DB field |
|----------|---------|----------|
| [`routes/uploads.ts`](../apps/api/src/routes/uploads.ts) | Company logos | Returned as `url` (company `logoUrl`) |
| [`routes/task-attachments.ts`](../apps/api/src/routes/task-attachments.ts) | Task files | `TaskAttachment.url` |
| [`routes/academy/student-documents.ts`](../apps/api/src/routes/academy/student-documents.ts) | Student docs | `StudentDocument.storagePath` |
| [`routes/academy/instructors.ts`](../apps/api/src/routes/academy/instructors.ts) | Instructor docs | `AcademyInstructorDocument.fileUrl` |

### Reads / serving

| Location | Behavior |
|----------|----------|
| [`app.ts`](../apps/api/src/app.ts) | `@fastify/static` at `/uploads/` when `STORAGE_DRIVER=local` |
| S3 + `S3_PUBLIC_BASE_URL` | Files served from CDN/S3; API does not proxy bytes |
| Web client | `/api/uploads/...` rewrite (local) or absolute HTTPS URLs (S3) |

### Deletes

| Location | Behavior |
|----------|----------|
| [`routes/task-attachments.ts`](../apps/api/src/routes/task-attachments.ts) | Hard delete attachment + `storage.deleteFile` |
| [`routes/settings.ts`](../apps/api/src/routes/settings.ts) | Logo cleanup on factory reset |
| Academy document routes | Soft delete only (files retained) |

### PDFs and generated attachments (unchanged)

These are **generated in memory** and streamed in HTTP responses or WhatsApp — not stored via the upload storage layer:

| Location | Output |
|----------|--------|
| [`services/payslip-pdf.service.ts`](../apps/api/src/services/payslip-pdf.service.ts) | Payslip PDF buffer |
| [`services/roster-pdf.service.ts`](../apps/api/src/services/roster-pdf.service.ts) | Roster PDF buffer |
| [`routes/payroll.ts`](../apps/api/src/routes/payroll.ts) | Payslip / payroll export PDFs |
| [`whatsapp/services/handler.service.ts`](../apps/api/src/whatsapp/services/handler.service.ts) | Payslip/roster PDFs to WhatsApp |
| [`routes/migrations.ts`](../apps/api/src/routes/migrations.ts) | CSV/template downloads from repo templates |

---

## Local vs S3 behavior

### `STORAGE_DRIVER=local` (default)

- Files written under `UPLOADS_DIR` (default `apps/api/uploads`).
- Served by Fastify static middleware at `/uploads/`.
- Logo upload response: `/api/uploads/logos/{file}` (Next.js proxy).
- Task attachment URL: `/uploads/tasks/...` (web prefixes `/api`).
- Matches existing Railway / Docker volume / EFS workflows.

### `STORAGE_DRIVER=s3`

- Files uploaded with `@aws-sdk/client-s3` (`PutObjectCommand`).
- Static middleware **disabled**; use `S3_PUBLIC_BASE_URL` (CloudFront or public bucket) for reads.
- Stored URLs are absolute HTTPS links from `getAssetUrl`.
- Private buckets: use `getSignedUrl` in future download endpoints if needed.

---

## ECS recommendations

| Scenario | Config |
|----------|--------|
| Single API task, quick cutover | `STORAGE_DRIVER=local` + EFS mount at `UPLOADS_DIR` |
| Multi-replica / durable production | `STORAGE_DRIVER=s3` + bucket + CloudFront |
| Migration from local to S3 | Sync `uploads/` prefix to bucket, then flip `STORAGE_DRIVER`; existing DB URLs may need a one-time backfill for absolute URLs |

---

## IAM policy example (task role)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:DeleteObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET/*"
    }
  ]
}
```

---

## Development

```bash
# Default — local disk
npm run dev:api

# Test S3 locally (use a dev bucket + task/user credentials via standard AWS env)
STORAGE_DRIVER=s3 \
AWS_REGION=af-south-1 \
S3_BUCKET_NAME=plethora-dev-uploads \
S3_PUBLIC_BASE_URL=https://plethora-dev-uploads.s3.af-south-1.amazonaws.com \
npm run dev:api
```

Do not commit `.env` files containing bucket names with production data or any credentials.
