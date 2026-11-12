'use client'

/**
 * The plugin's admin panels. Payload loads them through its import map; a host doesn't import them itself.
 * Everything here runs in the browser and talks to the site's own API as the signed-in person.
 */
export { ImportPanel, ProposalPanel, SnapshotPanel, ViewPanel, type PanelProps } from './wired.js'
export { ImportPanelView, IMPORT_STATUS, isStale, stepStates, type ImportJob, type ImportPanelViewProps } from './ImportPanelView.js'
export { ProposalPanelView, PROPOSAL_STATUS, type ProposalDecisionInfo, type ProposalPanelViewProps } from './ProposalPanelView.js'
export { SnapshotPanelView, SNAPSHOT_STATUS, type SnapshotPanelViewProps } from './SnapshotPanelView.js'
export { ViewPanelView, VIEW_STATUS, whyNotPublishable, type SavedView, type ViewPanelViewProps } from './ViewPanelView.js'
export { RequestError } from './http.js'
export type { Act, Loadable, Outcome } from './ui.js'
