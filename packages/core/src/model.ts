/**
 * OneTaxonomy record types (schema version 1). Plain, JSON-serializable data:
 * no classes, no Dates (ISO strings), no Maps. See docs/architecture/data-schema.md.
 */

export const SCHEMA_VERSION = 1 as const

/** An opaque, stable internal identifier. Never a scientific name. */
export type Id = string

/** An identifier in a source's own namespace, e.g. `{ source: 'col', id: '4QHKG' }`. */
export type ExternalId = { source: Id; id: string }

/** Where a record came from. */
export type Provenance = {
  source: Id
  /** The record's identifier in that source, if it has one. */
  externalId?: string
  /** ISO date-time of import or retrieval. */
  retrievedAt?: string
  note?: string
}

/** A data source supplied by the project owner (OneTaxonomy never chooses one). */
export type Source = {
  id: Id
  title: string
  citation?: string
  url?: string
  /** License of the source data (independent of OneTaxonomy's software license). */
  license?: string
  retrievedAt?: string
  /** The source's own version or release label. */
  externalVersion?: string
  provenance?: string
  /** Fixture or teaching data that must not be cited as science. */
  illustrative?: boolean
}

export type NameStatus = 'accepted' | 'synonym' | 'misapplied' | 'provisional' | 'unknown'

/** A name string with its authorship: distinct from the taxon (concept) it is used for. */
export type ScientificName = {
  id: Id
  name: string
  authorship?: string
  externalIds?: ExternalId[]
}

/** How a name is used for a concept in a given source. */
export type NameUsage = { name: Id; status: NameStatus; source?: Id }

export type CommonName = { name: string; locale: string; source?: Id }

/**
 * A taxon concept: a circumscription of organisms according to a source. Two
 * sources with different circumscriptions are two concepts, even with the same name.
 */
export type TaxonConcept = {
  id: Id
  /** The accepted name usage in the concept's source. */
  acceptedName: Id
  usages?: NameUsage[]
  /** Rank as stated by the source (free text: ranks differ between codes and sources). */
  rank?: string
  externalIds?: ExternalId[]
  commonNames?: CommonName[]
  provenance?: Provenance
}

/** One concept's place in a classification. `parent: null` makes it a root. */
export type Placement = { concept: Id; parent: Id | null; provenance?: Provenance }

/**
 * A named, versioned taxonomic hierarchy (a tree or forest of concepts) as stated
 * by its sources. It records accepted placements, not common ancestry.
 */
export type Classification = {
  id: Id
  title: string
  version: string
  sources: Id[]
  placements: Placement[]
}

/** Units for branch lengths. Only time units allow time-scaled layouts. */
export type LengthUnit = 'substitutions-per-site' | 'changes' | 'Ma' | 'ka' | 'years' | 'unspecified'
export const TIME_UNITS: readonly LengthUnit[] = ['Ma', 'ka', 'years']

export type Support = { value: number; method?: string }

export type LifeStatus = 'extant' | 'extinct' | 'unknown'

export type PhyloNode = {
  id: Id
  /** Display label from the source (e.g. a Newick tip label). Not an identity. */
  label?: string
  /**
   * Explicit links to taxon concepts. Empty or absent = unmapped (never guessed).
   * A terminal may stand for a sample, population or unnamed lineage.
   */
  concepts?: Id[]
  support?: Support
  /** Further support values for this node from other methods, such as paired SH-aLRT and UFBoot. `support` stays the primary one. */
  additionalSupport?: Support[]
  status?: LifeStatus
  /** Age of the node in the phylogeny's time unit, where the hypothesis is time-calibrated. */
  age?: { value: number; min?: number; max?: number }
  annotations?: Record<string, unknown>
}

/** A directed edge parent → child, with optional length in the phylogeny's unit. */
export type PhyloEdge = { id: Id; parent: Id; child: Id; length?: number; support?: Support }

/**
 * A phylogenetic hypothesis: named, versioned, cited. May be a forest; may hold
 * polytomies. In an unrooted hypothesis the edge directions are only the storage
 * orientation and carry no ancestry.
 */
export type Phylogeny = {
  id: Id
  title: string
  version: string
  sources: Id[]
  citation?: string
  rooted: boolean
  /**
   * How the root was chosen, when it was chosen by someone after import. `rerootPhylogeny`
   * and `midpointRoot` set `method` (`outgroup`, `midpoint`), the outgroup's node ids and
   * the record it was made from.
   */
  rooting?: { method: string; note?: string; outgroup?: Id[]; from?: { id: Id; version: string } }
  lengthUnit?: LengthUnit
  /** Whether internal node ages are calibrated in a time unit. */
  timeCalibrated?: boolean
  /** Sampling relative to the group studied (affects what absence of a taxon means). */
  sampling?: 'complete' | 'partial' | 'unknown'
  nodes: PhyloNode[]
  edges: PhyloEdge[]
}

export type TaxonProfile = {
  concept: Id
  summary?: string
  status?: LifeStatus
  geography?: string
  morphology?: string
  ecology?: string
  media?: { url: string; caption?: string; license?: string; credit?: string }[]
  citations?: string[]
  /** Plugin/application extension data, namespaced by the consumer. */
  extensions?: Record<string, unknown>
}

/**
 * Observed character states for concepts, from one cited source (e.g. "Reproduction:
 * oviparous / viviparous"). Only stated values: OneTaxonomy never infers ancestral or
 * missing states here (inferred states are a separate, labelled method; see limitations).
 */
export type TraitSet = {
  id: Id
  title: string
  source: Id
  states: { id: Id; label: string; color?: string }[]
  values: { concept: Id; state: Id; note?: string }[]
}

/** An immutable, versioned dataset. */
export type DatasetSnapshot = {
  schemaVersion: typeof SCHEMA_VERSION
  id: Id
  version: string
  createdAt: string
  /** sha256 of the canonical JSON of the snapshot without `checksum` (set by `sealSnapshot`). */
  checksum?: string
  sources: Source[]
  names: ScientificName[]
  concepts: TaxonConcept[]
  classifications: Classification[]
  phylogenies: Phylogeny[]
  profiles?: TaxonProfile[]
  traits?: TraitSet[]
  /**
   * Set when this snapshot was made from another one: extracted by a curated selection (`selection`), or made by a
   * curator accepting a proposal (`proposal`).
   */
  derivedFrom?: { snapshot: Id; version: string; checksum?: string; selection?: { id: Id; version: string }; proposal?: AcceptedProposal }
}

/**
 * The proposal a snapshot version was made from: whose it was, who accepted it, the classification version it was
 * drawn over and the concepts it moved. `author` and `acceptedBy` are whatever the caller gave: a name, or an id that
 * stands for the person. They are sealed with the snapshot and can't be taken out later, so where people may later ask
 * to be forgotten, give an id that means nothing on its own. The title is the author's own words and is sealed too.
 */
export type AcceptedProposal = {
  id: Id
  title: string
  author: string
  acceptedBy: string
  classification: { id: Id; version: string }
  moved: Id[]
}
