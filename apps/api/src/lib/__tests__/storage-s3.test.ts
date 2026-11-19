import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { S3Client } from "@aws-sdk/client-s3";
import { createS3StorageService } from "../storage.js";
import { parseEnv } from "../env.js";

describe("S3 storage driver", () => {
  it("uploads, deletes, and streams objects with normalized keys", async () => {
    const send = vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      if (command.constructor.name === "GetObjectCommand") {
        return {
          Body: Readable.from(Buffer.from("hello-s3")),
          ContentLength: 8,
        };
      }
      return {};
    });

    const mockClient = { send } as unknown as S3Client;
    const s3 = createS3StorageService({
      bucket: "plethora-uploads-test",
      region: "af-south-1",
      client: mockClient,
    });

    expect(s3.driver).toBe("s3");

    await s3.uploadFile({
      key: "/incidents/comp-1/inc-1/photo.png",
      body: Buffer.from("png-bytes"),
      contentType: "image/png",
    });

    expect(send).toHaveBeenCalledTimes(1);
    const putCall = send.mock.calls[0]![0];
    expect(putCall.input).toMatchObject({
      Bucket: "plethora-uploads-test",
      Key: "incidents/comp-1/inc-1/photo.png",
      ContentType: "image/png",
    });

    expect(s3.getAssetUrl("incidents/comp-1/inc-1/photo.png")).toBe(
      "/uploads/incidents/comp-1/inc-1/photo.png"
    );
    expect(s3.resolveKeyFromUrl("/uploads/incidents/comp-1/inc-1/photo.png")).toBe(
      "incidents/comp-1/inc-1/photo.png"
    );
    expect(s3.resolveKeyFromUrl("https://cdn.example.com/uploads/logos/a.png")).toBe(
      "logos/a.png"
    );

    const streamRes = await s3.getObjectStream!("incidents/comp-1/inc-1/photo.png");
    expect(streamRes?.contentLength).toBe(8);

    await s3.deleteFile("incidents/comp-1/inc-1/photo.png");
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("returns null when S3 object does not exist", async () => {
    const send = vi.fn(async () => {
      const err = new Error("NoSuchKey");
      err.name = "NoSuchKey";
      throw err;
    });
    const s3 = createS3StorageService({
      bucket: "plethora-uploads-test",
      region: "af-south-1",
      client: { send } as unknown as S3Client,
    });

    const res = await s3.getObjectStream!("documents/missing.pdf");
    expect(res).toBeNull();
  });

  it("validates S3 and AI env configuration", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/plethora",
        JWT_SECRET: "a-very-long-random-jwt-secret-key-at-least-32-chars",
        JWT_REFRESH_SECRET: "another-long-random-refresh-secret-key-32-chars",
        CORS_ORIGIN: "https://plethora.quickbophasecurity.co.za",
        STORAGE_DRIVER: "s3",
      })
    ).toThrow(/AWS_S3_BUCKET is required/);

    const parsed = parseEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/plethora",
      JWT_SECRET: "a-very-long-random-jwt-secret-key-at-least-32-chars",
      JWT_REFRESH_SECRET: "another-long-random-refresh-secret-key-32-chars",
      CORS_ORIGIN: "https://plethora.quickbophasecurity.co.za",
      STORAGE_DRIVER: "s3",
      AWS_S3_BUCKET: "plethora-uploads-prod",
      AI_ENABLED: "true",
    });

    expect(parsed.storage.driver).toBe("s3");
    expect(parsed.storage.region).toBe("af-south-1");
    expect(parsed.ai.enabled).toBe(true);
    expect(parsed.ai.model).toBe("llama3.3:3b");
    expect(parsed.ai.baseUrl).toBe("http://ollama.plethora.local:11434");
  });
});
