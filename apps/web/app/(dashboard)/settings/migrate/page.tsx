"use client";

import React, { useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import {
  downloadMigrationTemplate,
  migrationPreview,
  migrationImport,
  migrationAdminBulkCreate,
  exportEmployees,
  exportSites,
  type MigrationPreviewResponse,
  type MigrationImportResult,
} from "@/lib/api";

export default function MigratePage() {
  const { user, token } = useAuth();
  const isAdmin = user?.role === "admin";

  const [companiesFile, setCompaniesFile] = useState<File | null>(null);
  const [employeesFile, setEmployeesFile] = useState<File | null>(null);
  const [sitesFile, setSitesFile] = useState<File | null>(null);

  const [preview, setPreview] = useState<MigrationPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [importResult, setImportResult] = useState<MigrationImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importLoading, setImportLoading] = useState(false);

  const [templateError, setTemplateError] = useState<string | null>(null);

  const [exportError, setExportError] = useState<string | null>(null);
  const [exportEmployeesLoading, setExportEmployeesLoading] = useState(false);
  const [exportSitesLoading, setExportSitesLoading] = useState(false);

  const hasFiles = !!(employeesFile || sitesFile || (isAdmin && companiesFile));

  const canImport =
    hasFiles &&
    preview &&
    preview.companies.errors.length === 0 &&
    preview.employees.errors.length === 0 &&
    preview.sites.errors.length === 0 &&
    (preview.employees.validCount > 0 || preview.sites.validCount > 0 || (isAdmin && preview.companies.validCount > 0));

  const handleDownloadTemplate = useCallback(
    async (type: "company" | "employees" | "sites") => {
      if (!token) return;
      setTemplateError(null);
      setExportError(null);
      try {
        await downloadMigrationTemplate(token, type);
      } catch (err) {
        setTemplateError(err instanceof Error ? err.message : "Download failed");
      }
    },
    [token]
  );

  const handleValidate = useCallback(async () => {
    if (!token) return;
    if (!hasFiles) {
      setPreviewError(
        isAdmin
          ? "Upload companies.csv and/or team (employees.csv), sites.csv"
          : "Upload at least team (employees.csv) or sites.csv"
      );
      return;
    }

    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    try {
      const res = await migrationPreview(token, {
        companies: companiesFile ?? undefined,
        employees: employeesFile ?? undefined,
        sites: sitesFile ?? undefined,
      });
      setPreview(res);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Validation failed");
    } finally {
      setPreviewLoading(false);
    }
  }, [token, isAdmin, companiesFile, employeesFile, sitesFile]);

  const handleImport = useCallback(async () => {
    if (!token || !canImport) return;

    setImportLoading(true);
    setImportError(null);
    setImportResult(null);
    try {
      if (isAdmin && companiesFile) {
        const res = await migrationAdminBulkCreate(token, {
          companies: companiesFile,
          employees: employeesFile ?? undefined,
          sites: sitesFile ?? undefined,
        });
        setImportResult(res);
      } else {
        const res = await migrationImport(token, {
          employees: employeesFile ?? undefined,
          sites: sitesFile ?? undefined,
        });
        setImportResult(res);
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImportLoading(false);
    }
  }, [token, canImport, isAdmin, companiesFile, employeesFile, sitesFile]);

  const handleExportEmployees = useCallback(async () => {
    if (!token) return;
    setExportError(null);
    setTemplateError(null);
    setExportEmployeesLoading(true);
    try {
      await exportEmployees(token);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExportEmployeesLoading(false);
    }
  }, [token]);

  const handleExportSites = useCallback(async () => {
    if (!token) return;
    setExportError(null);
    setTemplateError(null);
    setExportSitesLoading(true);
    try {
      await exportSites(token);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExportSitesLoading(false);
    }
  }, [token]);

  const totalErrors =
    (preview?.companies.errors.length ?? 0) +
    (preview?.employees.errors.length ?? 0) +
    (preview?.sites.errors.length ?? 0);

  return (
    <div>
      <div className="mb-6 flex items-center gap-4">
        <Link
          href="/settings"
          className="text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
        >
          ← Settings
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-neutral-800 dark:text-white mb-2">
        Bulk Import / Export
      </h1>
      <p className="text-neutral-600 dark:text-neutral-400 mb-6">
        {isAdmin
          ? "Export team and sites to CSV, or upload CSV files to create multiple companies with team and sites. Download templates, validate, then import."
          : "Export team and sites to CSV, or upload CSV files to import team and sites into your company. Download templates, validate, then import."}
      </p>

      {(templateError || exportError) && (
        <div className="mb-4 p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-sm border border-red-200 dark:border-red-800/50">
          {templateError || exportError}
        </div>
      )}

      <div className="space-y-6">
        <section className="bg-white dark:bg-neutral-800 rounded-sm border border-black dark:border-white p-6">
          <h2 className="text-lg font-semibold text-neutral-800 dark:text-white mb-4">
            Export
          </h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
            Download your team members and sites as CSV files. Exported files match the import format for round-trip compatibility.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleExportEmployees}
              disabled={exportEmployeesLoading}
              className="px-4 py-2 text-sm font-medium bg-neutral-100 dark:bg-neutral-700 text-neutral-800 dark:text-white rounded-sm border border-black dark:border-white hover:bg-neutral-200 dark:hover:bg-neutral-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {exportEmployeesLoading ? "Exporting..." : "Export team members (employees.csv)"}
            </button>
            <button
              type="button"
              onClick={handleExportSites}
              disabled={exportSitesLoading}
              className="px-4 py-2 text-sm font-medium bg-neutral-100 dark:bg-neutral-700 text-neutral-800 dark:text-white rounded-sm border border-black dark:border-white hover:bg-neutral-200 dark:hover:bg-neutral-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {exportSitesLoading ? "Exporting..." : "Export sites (sites.csv)"}
            </button>
          </div>
        </section>

        <section className="bg-white dark:bg-neutral-800 rounded-sm border border-black dark:border-white p-6">
          <h2 className="text-lg font-semibold text-neutral-800 dark:text-white mb-4">
            Step 1: Download templates
          </h2>
          <div className="flex flex-wrap gap-3">
            {isAdmin && (
              <button
                type="button"
                onClick={() => handleDownloadTemplate("company")}
                className="px-4 py-2 text-sm font-medium bg-neutral-100 dark:bg-neutral-700 text-neutral-800 dark:text-white rounded-sm border border-black dark:border-white hover:bg-neutral-200 dark:hover:bg-neutral-600 transition-colors"
              >
                Download companies.csv
              </button>
            )}
            <button
              type="button"
              onClick={() => handleDownloadTemplate("employees")}
              className="px-4 py-2 text-sm font-medium bg-neutral-100 dark:bg-neutral-700 text-neutral-800 dark:text-white rounded-sm border border-black dark:border-white hover:bg-neutral-200 dark:hover:bg-neutral-600 transition-colors"
            >
              Download team template (employees.csv)
            </button>
            <button
              type="button"
              onClick={() => handleDownloadTemplate("sites")}
              className="px-4 py-2 text-sm font-medium bg-neutral-100 dark:bg-neutral-700 text-neutral-800 dark:text-white rounded-sm border border-black dark:border-white hover:bg-neutral-200 dark:hover:bg-neutral-600 transition-colors"
            >
              Download sites.csv
            </button>
          </div>
        </section>

        <section className="bg-white dark:bg-neutral-800 rounded-sm border border-black dark:border-white p-6">
          <h2 className="text-lg font-semibold text-neutral-800 dark:text-white mb-4">
            Step 2: Upload your CSV files
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {isAdmin && (
              <FileInput
                label="Companies (required for admin)"
                accept=".csv"
                file={companiesFile}
                onChange={setCompaniesFile}
              />
            )}
            <FileInput
              label="Team"
              accept=".csv"
              file={employeesFile}
              onChange={setEmployeesFile}
            />
            <FileInput
              label="Sites"
              accept=".csv"
              file={sitesFile}
              onChange={setSitesFile}
            />
          </div>
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
            Max 5MB per file. Max 1000 team members, 200 sites per import.
          </p>
        </section>

        <section className="bg-white dark:bg-neutral-800 rounded-sm border border-black dark:border-white p-6">
          <h2 className="text-lg font-semibold text-neutral-800 dark:text-white mb-4">
            Step 3: Validate and import
          </h2>
          <div className="flex gap-3 mb-4">
            <button
              type="button"
              onClick={handleValidate}
              disabled={!hasFiles || previewLoading}
              className="px-4 py-2 text-sm font-medium bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 rounded-sm border border-black dark:border-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              {previewLoading ? "Validating..." : "Validate"}
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={!canImport || importLoading}
              className="px-4 py-2 text-sm font-medium bg-green-600 dark:bg-green-500 text-white rounded-sm border border-green-700 dark:border-green-400 hover:bg-green-700 dark:hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {importLoading ? "Importing..." : "Import"}
            </button>
          </div>

          {previewError && (
            <div className="mb-4 p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-sm border border-red-200 dark:border-red-800/50">
              {previewError}
            </div>
          )}

          {importError && (
            <div className="mb-4 p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-sm border border-red-200 dark:border-red-800/50">
              {importError}
            </div>
          )}

          {preview && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-4 text-sm">
                <span className="text-neutral-600 dark:text-neutral-400">
                  Companies: {preview.companies.validCount} valid
                  {preview.companies.errors.length > 0 && (
                    <span className="text-red-600 dark:text-red-400 ml-1">
                      ({preview.companies.errors.length} errors)
                    </span>
                  )}
                </span>
                <span className="text-neutral-600 dark:text-neutral-400">
                  Team: {preview.employees.validCount} valid
                  {preview.employees.errors.length > 0 && (
                    <span className="text-red-600 dark:text-red-400 ml-1">
                      ({preview.employees.errors.length} errors)
                    </span>
                  )}
                </span>
                <span className="text-neutral-600 dark:text-neutral-400">
                  Sites: {preview.sites.validCount} valid
                  {preview.sites.errors.length > 0 && (
                    <span className="text-red-600 dark:text-red-400 ml-1">
                      ({preview.sites.errors.length} errors)
                    </span>
                  )}
                </span>
              </div>

              {totalErrors > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-sm border border-black dark:border-white">
                  <table className="w-full text-sm">
                    <thead className="bg-neutral-100 dark:bg-neutral-800 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2">Row</th>
                        <th className="text-left px-3 py-2">Field</th>
                        <th className="text-left px-3 py-2">Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ...preview.companies.errors.map((e) => ({ ...e, entity: "Company" })),
                        ...preview.employees.errors.map((e) => ({ ...e, entity: "Team member" })),
                        ...preview.sites.errors.map((e) => ({ ...e, entity: "Site" })),
                      ].map((e, i) => (
                        <tr key={i} className="border-t border-black dark:border-white">
                          <td className="px-3 py-2">{e.row}</td>
                          <td className="px-3 py-2">{e.entity}.{e.field}</td>
                          <td className="px-3 py-2 text-red-600 dark:text-red-400">{e.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {importResult && (
            <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 rounded-sm border border-green-200 dark:border-green-800/50">
              <h3 className="font-medium text-green-800 dark:text-green-200 mb-2">Import complete</h3>
              <ul className="text-sm text-green-700 dark:text-green-300 space-y-1">
                {importResult.companiesCreated > 0 && (
                  <li>Companies created: {importResult.companiesCreated}</li>
                )}
                <li>Team members created: {importResult.employeesCreated}</li>
                <li>Sites created: {importResult.sitesCreated}</li>
              </ul>
              {importResult.errors.length > 0 && (
                <ul className="mt-2 text-sm text-amber-700 dark:text-amber-300 space-y-1">
                  {importResult.errors.map((e, i) => (
                    <li key={i}>{e.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function FileInput({
  label,
  accept,
  file,
  onChange,
}: {
  label: string;
  accept: string;
  file: File | null;
  onChange: (f: File | null) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
        {label}
      </label>
      <input
        type="file"
        accept={accept}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="block w-full text-sm text-neutral-600 dark:text-neutral-400 file:mr-4 file:py-2 file:px-4 file:rounded-sm file:border-0 file:text-sm file:font-medium file:bg-neutral-100 dark:file:bg-neutral-700 file:text-neutral-800 dark:file:text-white hover:file:bg-neutral-200 dark:hover:file:bg-neutral-600"
      />
      {file && (
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400 truncate">
          {file.name}
        </p>
      )}
    </div>
  );
}
