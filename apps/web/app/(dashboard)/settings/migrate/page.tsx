"use client";

import React, { useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { hasCapability } from "@/lib/permissions";
import {
  downloadMigrationTemplate,
  migrationPreview,
  migrationImport,
  exportEmployees,
  exportSites,
  exportEmployeeGroups,
  type MigrationPreviewResponse,
  type MigrationImportResult,
} from "@/lib/api";

export default function MigratePage() {
  const { user, token } = useAuth();
  const canCreateTeam = Boolean(user && hasCapability(user, "/employees", "create"));
  const canCreateSites = Boolean(user && hasCapability(user, "/sites", "create"));
  const canExportTeam = Boolean(user && hasCapability(user, "/employees", "export"));
  const canExportSites = Boolean(user && hasCapability(user, "/sites", "export"));
  const canImportAny = canCreateTeam || canCreateSites;
  const canExportAny = canExportTeam || canExportSites;

  const [employeesFile, setEmployeesFile] = useState<File | null>(null);
  const [sitesFile, setSitesFile] = useState<File | null>(null);
  const [groupsFile, setGroupsFile] = useState<File | null>(null);

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
  const [exportGroupsLoading, setExportGroupsLoading] = useState(false);

  const hasFiles = !!(employeesFile || sitesFile || groupsFile);

  const canImport =
    hasFiles &&
    preview &&
    preview.employees.errors.length === 0 &&
    preview.sites.errors.length === 0 &&
    preview.groups.errors.length === 0 &&
    (preview.employees.validCount > 0 ||
      preview.sites.validCount > 0 ||
      preview.groups.validCount > 0);

  const handleDownloadTemplate = useCallback(
    async (type: "employees" | "sites" | "groups") => {
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
      setPreviewError("Upload at least team (employees.csv), sites.csv, or employee groups CSV");
      return;
    }

    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    try {
      const res = await migrationPreview(token, {
        employees: employeesFile ?? undefined,
        sites: sitesFile ?? undefined,
        groups: groupsFile ?? undefined,
      });
      setPreview(res);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Validation failed");
    } finally {
      setPreviewLoading(false);
    }
  }, [token, employeesFile, sitesFile, groupsFile]);

  const handleImport = useCallback(async () => {
    if (!token || !canImport) return;

    setImportLoading(true);
    setImportError(null);
    setImportResult(null);
    try {
      const res = await migrationImport(token, {
        employees: employeesFile ?? undefined,
        sites: sitesFile ?? undefined,
        groups: groupsFile ?? undefined,
      });
      setImportResult(res);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImportLoading(false);
    }
  }, [token, canImport, employeesFile, sitesFile, groupsFile]);

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

  const handleExportGroups = useCallback(async () => {
    if (!token) return;
    setExportError(null);
    setTemplateError(null);
    setExportGroupsLoading(true);
    try {
      await exportEmployeeGroups(token);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExportGroupsLoading(false);
    }
  }, [token]);

  const totalErrors =
    (preview?.employees.errors.length ?? 0) +
    (preview?.sites.errors.length ?? 0) +
    (preview?.groups.errors.length ?? 0);

  return (
    <div>
      <div className="mb-6 flex items-center gap-4">
        <Link
          href="/settings"
          className="text-sm text-security-navy-600 dark:text-security-navy-400 hover:text-security-navy-900 dark:hover:text-white"
        >
          ← Settings
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-security-navy-900 dark:text-white mb-2">
        Bulk Import / Export
      </h1>
      <p className="text-security-navy-600 dark:text-security-navy-400 mb-6">
        Export team, sites, and employee groups to CSV, or upload CSV files to
        import into your company. Download templates, validate, then import.
      </p>

      {(templateError || exportError) && (
        <div className="mb-4 p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-sm border border-red-200 dark:border-red-800/50">
          {templateError || exportError}
        </div>
      )}

      <div className="space-y-6">
        {canExportAny && <section className="bg-white dark:bg-security-navy-800 rounded-sm border border-security-navy-100 dark:border-security-navy-600 p-6">
          <h2 className="text-lg font-semibold text-security-navy-900 dark:text-white mb-4">
            Export
          </h2>
          <p className="text-sm text-security-navy-600 dark:text-security-navy-400 mb-4">
            Download your team members, sites, and employee groups as CSV files. Exported files match the import format for round-trip compatibility.
          </p>
          <div className="flex flex-wrap gap-3">
            {canExportTeam && <button
              type="button"
              onClick={handleExportEmployees}
              disabled={exportEmployeesLoading}
              className="px-4 py-2 text-sm font-medium bg-security-navy-50 dark:bg-security-navy-700 text-security-navy-900 dark:text-white rounded-sm border border-security-navy-100 dark:border-security-navy-600 hover:bg-security-navy-100 dark:hover:bg-security-navy-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {exportEmployeesLoading ? "Exporting..." : "Export team members (employees.csv)"}
            </button>}
            {canExportSites && <button
              type="button"
              onClick={handleExportSites}
              disabled={exportSitesLoading}
              className="px-4 py-2 text-sm font-medium bg-security-navy-50 dark:bg-security-navy-700 text-security-navy-900 dark:text-white rounded-sm border border-security-navy-100 dark:border-security-navy-600 hover:bg-security-navy-100 dark:hover:bg-security-navy-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {exportSitesLoading ? "Exporting..." : "Export sites (sites.csv)"}
            </button>}
            {canExportTeam && <button
              type="button"
              onClick={handleExportGroups}
              disabled={exportGroupsLoading}
              className="px-4 py-2 text-sm font-medium bg-security-navy-50 dark:bg-security-navy-700 text-security-navy-900 dark:text-white rounded-sm border border-security-navy-100 dark:border-security-navy-600 hover:bg-security-navy-100 dark:hover:bg-security-navy-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {exportGroupsLoading ? "Exporting..." : "Export employee groups (CSV)"}
            </button>}
          </div>
        </section>}

        {canImportAny && <section className="bg-white dark:bg-security-navy-800 rounded-sm border border-security-navy-100 dark:border-security-navy-600 p-6">
          <h2 className="text-lg font-semibold text-security-navy-900 dark:text-white mb-4">
            Step 1: Download templates
          </h2>
          <div className="flex flex-wrap gap-3">
            {canCreateTeam && <button
              type="button"
              onClick={() => handleDownloadTemplate("employees")}
              className="px-4 py-2 text-sm font-medium bg-security-navy-50 dark:bg-security-navy-700 text-security-navy-900 dark:text-white rounded-sm border border-security-navy-100 dark:border-security-navy-600 hover:bg-security-navy-100 dark:hover:bg-security-navy-600 transition-colors"
            >
              Download team template (employees.csv)
            </button>}
            {canCreateSites && <button
              type="button"
              onClick={() => handleDownloadTemplate("sites")}
              className="px-4 py-2 text-sm font-medium bg-security-navy-50 dark:bg-security-navy-700 text-security-navy-900 dark:text-white rounded-sm border border-security-navy-100 dark:border-security-navy-600 hover:bg-security-navy-100 dark:hover:bg-security-navy-600 transition-colors"
            >
              Download sites.csv
            </button>}
            {canCreateTeam && <button
              type="button"
              onClick={() => handleDownloadTemplate("groups")}
              className="px-4 py-2 text-sm font-medium bg-security-navy-50 dark:bg-security-navy-700 text-security-navy-900 dark:text-white rounded-sm border border-security-navy-100 dark:border-security-navy-600 hover:bg-security-navy-100 dark:hover:bg-security-navy-600 transition-colors"
            >
              Download employee groups template
            </button>}
          </div>
          <p className="mt-3 text-xs text-security-navy-500 dark:text-security-navy-400">
            The team template includes an instruction row under the headers. Enter names in separate{" "}
            <span className="font-medium">First Name</span> and <span className="font-medium">Last Name</span> columns for
            clean imports.
          </p>
        </section>}

        {canImportAny && <section className="bg-white dark:bg-security-navy-800 rounded-sm border border-security-navy-100 dark:border-security-navy-600 p-6">
          <h2 className="text-lg font-semibold text-security-navy-900 dark:text-white mb-4">
            Step 2: Upload your CSV files
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {canCreateTeam && <FileInput
              label="Team"
              accept=".csv"
              file={employeesFile}
              onChange={setEmployeesFile}
            />}
            {canCreateSites && <FileInput
              label="Sites"
              accept=".csv"
              file={sitesFile}
              onChange={setSitesFile}
            />}
            {canCreateTeam && <FileInput
              label="Employee groups"
              accept=".csv"
              file={groupsFile}
              onChange={setGroupsFile}
            />}
          </div>
          <p className="mt-2 text-xs text-security-navy-500 dark:text-security-navy-400">
            Max 5MB per file. Max 1000 team members, 200 sites, 500 employee groups per import. Groups CSV columns: Name
            (required), Description (optional), Sort Order (optional). Existing group names are skipped on import.
          </p>
        </section>}

        {canImportAny && <section className="bg-white dark:bg-security-navy-800 rounded-sm border border-security-navy-100 dark:border-security-navy-600 p-6">
          <h2 className="text-lg font-semibold text-security-navy-900 dark:text-white mb-4">
            Step 3: Validate and import
          </h2>
          <div className="flex gap-3 mb-4">
            <button
              type="button"
              onClick={handleValidate}
              disabled={!hasFiles || previewLoading}
              className="px-4 py-2 text-sm font-medium bg-security-navy-900 dark:bg-white text-white dark:text-security-navy-900 rounded-sm border border-security-navy-100 dark:border-security-navy-600 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              {previewLoading ? "Validating..." : "Validate"}
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={!canImport || importLoading}
              className="px-4 py-2 text-sm font-medium bg-security-emerald-600 dark:bg-security-emerald-500 text-white rounded-sm border border-security-emerald-700 dark:border-security-emerald-300 hover:bg-security-emerald-700 dark:hover:bg-security-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
                <span className="text-security-navy-600 dark:text-security-navy-400">
                  Team: {preview.employees.validCount} valid
                  {preview.employees.errors.length > 0 && (
                    <span className="text-red-600 dark:text-red-400 ml-1">
                      ({preview.employees.errors.length} errors)
                    </span>
                  )}
                </span>
                <span className="text-security-navy-600 dark:text-security-navy-400">
                  Sites: {preview.sites.validCount} valid
                  {preview.sites.errors.length > 0 && (
                    <span className="text-red-600 dark:text-red-400 ml-1">
                      ({preview.sites.errors.length} errors)
                    </span>
                  )}
                </span>
                <span className="text-security-navy-600 dark:text-security-navy-400">
                  Employee groups: {preview.groups.validCount} valid
                  {preview.groups.errors.length > 0 && (
                    <span className="text-red-600 dark:text-red-400 ml-1">
                      ({preview.groups.errors.length} errors)
                    </span>
                  )}
                </span>
              </div>

              {totalErrors > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-sm border border-security-navy-100 dark:border-security-navy-600">
                  <table className="w-full text-sm">
                    <thead className="bg-security-navy-50 dark:bg-security-navy-800 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2">Row</th>
                        <th className="text-left px-3 py-2">Field</th>
                        <th className="text-left px-3 py-2">Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ...preview.employees.errors.map((e) => ({ ...e, entity: "Team member" })),
                        ...preview.sites.errors.map((e) => ({ ...e, entity: "Site" })),
                        ...preview.groups.errors.map((e) => ({ ...e, entity: "Employee group" })),
                      ].map((e, i) => (
                        <tr key={i} className="border-t border-security-navy-100 dark:border-security-navy-600">
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
            <div className="mt-4 p-4 bg-security-emerald-50 dark:bg-security-emerald-700/20 rounded-sm border border-security-emerald-200 dark:border-security-emerald-700/50">
              <h3 className="font-medium text-security-navy-800 dark:text-security-navy-200 mb-2">Import complete</h3>
              <ul className="text-sm text-security-navy-700 dark:text-security-navy-300 space-y-1">
                <li>Team members created: {importResult.employeesCreated}</li>
                <li>Sites created: {importResult.sitesCreated}</li>
                <li>
                  Employee groups: {importResult.groupsCreated} created
                  {importResult.groupsSkipped > 0
                    ? `, ${importResult.groupsSkipped} skipped (name already exists)`
                    : null}
                </li>
              </ul>
              {importResult.errors.length > 0 && (
                <ul className="mt-2 text-sm text-security-amber-700 dark:text-security-amber-300 space-y-1">
                  {importResult.errors.map((e, i) => (
                    <li key={i}>{e.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>}
        {!canImportAny && !canExportAny && (
          <div className="rounded-sm border border-security-amber-200 bg-security-amber-50 p-4 text-sm text-security-amber-900">
            Team or Sites create/export access is required for bulk migration tools.
          </div>
        )}
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
      <label className="block text-sm font-medium text-security-navy-700 dark:text-security-navy-300 mb-1">
        {label}
      </label>
      <input
        type="file"
        accept={accept}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="block w-full text-sm text-security-navy-600 dark:text-security-navy-400 file:mr-4 file:py-2 file:px-4 file:rounded-sm file:border-0 file:text-sm file:font-medium file:bg-security-navy-50 dark:file:bg-security-navy-700 file:text-security-navy-900 dark:file:text-white hover:file:bg-security-navy-100 dark:hover:file:bg-security-navy-600"
      />
      {file && (
        <p className="mt-1 text-xs text-security-navy-500 dark:text-security-navy-400 truncate">
          {file.name}
        </p>
      )}
    </div>
  );
}
