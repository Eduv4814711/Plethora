"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getDocument, type ManagedDocument } from "@/lib/msr-api";
import { AlertBanner, Spinner, Button } from "@/components/ui";
import { DocumentWorkspace } from "@/components/documents/DocumentWorkspace";

export default function DocumentWorkspacePage() {
  const { token } = useAuth();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params?.id as string;
  const initialVersionId = searchParams?.get("versionId") || undefined;

  const [document, setDocument] = useState<ManagedDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDocument = useCallback(async () => {
    if (!token || !id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getDocument(token, id);
      setDocument(data);
    } catch (err: any) {
      setError(err?.message || "Failed to load document");
      setDocument(null);
    } finally {
      setLoading(false);
    }
  }, [token, id]);

  useEffect(() => {
    fetchDocument();
  }, [fetchDocument]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-security-navy-600">
        <Spinner className="w-8 h-8 text-security-navy-800" />
        <p className="text-sm font-medium">Loading Document Workspace...</p>
      </div>
    );
  }

  if (error || !document) {
    return (
      <div className="max-w-2xl mx-auto mt-12 p-6 bg-white rounded-security-lg border border-security-navy-200 shadow-sm">
        <h1 className="text-lg font-bold text-security-navy-900 mb-2">
          Document Unavailable
        </h1>
        <AlertBanner variant="error" className="mb-4">
          {error || "The requested document could not be found or access has been restricted."}
        </AlertBanner>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={fetchDocument}>
            Try Again
          </Button>
          <Link href="/documents">
            <Button variant="primary">Return to Document Library</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <DocumentWorkspace
      document={document}
      token={token!}
      initialVersionId={initialVersionId}
      onDocumentUpdated={(updated) => setDocument(updated)}
    />
  );
}
