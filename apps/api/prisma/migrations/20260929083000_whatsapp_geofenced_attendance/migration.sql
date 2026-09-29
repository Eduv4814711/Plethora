-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN "submissionLat" DOUBLE PRECISION,
ADD COLUMN "submissionLon" DOUBLE PRECISION,
ADD COLUMN "distanceMeters" INTEGER,
ADD COLUMN "geofenceRadiusMeters" INTEGER,
ADD COLUMN "withinGeofence" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "validationStatus" TEXT NOT NULL DEFAULT 'VERIFIED',
ADD COLUMN "whatsappMessageId" TEXT,
ADD COLUMN "whatsappNumber" TEXT,
ADD COLUMN "rejectionReason" TEXT;
