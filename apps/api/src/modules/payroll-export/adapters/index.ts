import type {
  AdapterRenderResult,
  ExportBatchContext,
  NormalizedExportLine,
} from "./adapter.types.js";
import { renderSageBusinessCloudZa } from "./sage-business-cloud-za.adapter.js";
import { renderSageVip } from "./sage-vip.adapter.js";
import { renderSage300People } from "./sage-300-people.adapter.js";
import { renderGenericCsv } from "./generic-csv.adapter.js";
import { renderJsonWebhook } from "./json-webhook.adapter.js";

export * from "./adapter.types.js";

export function renderPayrollExport(
  context: ExportBatchContext,
  lines: NormalizedExportLine[]
): AdapterRenderResult {
  switch (context.provider) {
    case "SAGE_BUSINESS_CLOUD_ZA":
      return renderSageBusinessCloudZa(context, lines);
    case "SAGE_VIP":
      return renderSageVip(context, lines);
    case "SAGE_300_PEOPLE":
      return renderSage300People(context, lines);
    case "GENERIC_CSV":
      return renderGenericCsv(context, lines);
    case "JSON_WEBHOOK":
      return renderJsonWebhook(context, lines);
  }
}
