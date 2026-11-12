export { oneTaxonomy } from './plugin.js'
export { snapshotsCollection, viewsCollection } from './collections.js'
export { allowed, createAccess, manageAccess, readAccess, roleOf, tenantOf } from './access.js'
export {
  ancestorsOf,
  coverageOf,
  descendantsOf,
  exportSnapshot,
  loadSnapshot,
  mrcaOf,
  searchNames,
  SnapshotIntegrityError,
  type ApiResult,
  type CoverageBody,
  type CoverageQuery,
  type SnapshotExport,
  type HierarchyQuery,
  type HierarchyRef,
  type MrcaQuery,
  type NodeItem,
  type SearchHit,
  type SearchQuery,
  type SnapshotRef,
  type TraversalBody,
} from './api.js'
export { optionsOf, resolveOptions, type AccessCallback, type ImportOptions, type OneTaxonomyPluginOptions, type ProposalOptions, type ResolvedOptions, type TenantId } from './types.js'
export { projectedView, exportView, type ProjectionBody, type ViewExport, type ViewRef, type ViewSource } from './views-api.js'
export {
  checkImportSettings,
  importsCollection,
  IMPORT_FORMATS,
  runImport,
  type ImportDiagnostic,
  type ImportFormat,
  type ImportJobSummary,
  type ImportPhase,
  type ImportSettings,
  type ImportStatus,
} from './imports.js'
export { summarizeSnapshot, type SnapshotStatus, type SnapshotSummary, type SourceSummary } from './summary.js'
export {
  acceptProposal,
  declineProposal,
  PERSON_ID,
  previewProposal,
  proposalChecksum,
  proposalsCollection,
  type ProposalAcceptance,
  type ProposalDecision,
  type ProposalPreview,
  type ProposalRef,
  type ProposalStatus,
} from './proposals.js'
