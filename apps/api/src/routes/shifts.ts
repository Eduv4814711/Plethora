/**
 * Shifts routes moved to `modules/rostering`.
 * Re-export preserves existing import paths during migration.
 */
export { rosteringRoutes, shiftsRoutes } from "../modules/rostering/rostering.routes.js";
