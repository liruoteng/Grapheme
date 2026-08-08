  // Reconstructed from specops26-paper8.pdf using the clean-acmart Typst template.
  // The original source was not embedded in the PDF. Text and metadata are
  // recovered from the rendered document; the pipeline figure is editable Typst.

  #import "@preview/clean-acmart:0.0.1": acmart, acmart-ccs, acmart-keywords, acmart-ref, to-string

  #let title = text(
    font: "Linux Libertine",
    size: 20pt,
    weight: "bold",
  )[
    SpecGen: Automated Specification Synthesis from Codebases via Multi-Phase LLM Analysis
  ]
  #let authors = (
    (
      name: [Anonymous Author(s)],
      email: [],
    ),
  )
  #let affiliations = (
    (
      name: [Anonymous Institution],
    ),
  )
  #let conference = (
    name: [Proceedings of ACM Conference],
    short: [Conference '26],
    year: [2026],
    date: [2026],
    venue: [Washington, DC, USA],
  )
  #let doi = "https://doi.org/10.1145/nnnnnnn.nnnnnnn"
  #let ccs = (
    (
      generic: [Software and its engineering],
      specific: ([Requirements analysis], [Documentation]),
    ),
  )
  #let keywords = ("specification synthesis", "code analysis", "LLM", "documentation generation", "traceability")

// Review-style manuscript line numbers. In the two-column layout Typst places
// the first column's numbers on the left and the second column's on the right.
#set par.line(
  numbering: n => text(
    size: 0.7em,
    fill: rgb("#ff0000"),
  )[#n],
  number-margin: start,
  number-align: auto,
  number-clearance: 4pt,
  numbering-scope: "document",
)

#show: acmart.with(
  title: title,
  authors: authors,
  affiliations: affiliations,
  font-size: 10pt,
  conference: conference,
  doi: doi,
  copyright: "cc",
  // Submission/review mode enables anonymous submission metadata.
  review: [\#001],
)

// ACM tables place their captions above the tabular material.
#show figure.where(kind: table): set figure.caption(position: top)
#show figure.where(kind: table): set text(size: 7pt)
#show figure.caption: set text(size: 7pt)
#show raw: set text(size: 6pt)
#show bibliography: set text(size: 7pt)
#show bibliography: set par(leading: .1em, spacing: 0pt, first-line-indent: 0pt)

// Match the tighter ACM two-column paragraph rhythm.
#set text(weight: 450)
#set par(spacing: 0pt)
#show heading.where(level: 1): set block(above: 10pt, below: 4pt)
#show heading.where(level: 2): set block(above: 6pt, below: 2pt)

  = Abstract
  We present SpecGen, a system that automatically synthesizes structured specification documents from source code repositories. SpecGen operates through a multi-phase pipeline: it first constructs a code graph capturing file dependencies and definitions, then runs specialized analyzers (requirements, architecture, API, testing) that produce intermediate analysis results each linked back to source code snippets, and finally generates multiple documentation artifacts---system overviews, developer guides, usage documentation, and formal specifications. All analysis results maintain full traceability to their originating code locations. The system provides semantic search and hierarchical navigation over generated specifications, supports multi-repository relationship analysis for complex systems, and integrates with coding agents to enable specification-driven development workflows. We describe the architecture, demonstrate its application to real-world codebases, and discuss how specification synthesis from code can close the specification gap in modern software engineering.

  #v(5pt)
  #acmart-ccs(ccs)
  #v(5pt)
  #acmart-keywords(keywords)
  #acmart-ref(to-string(title), authors, conference, doi)

  = Introduction
  Modern software systems frequently suffer from a specification gap---the disconnect between what is implemented in code and what is documented as intended behavior @ernst2002empirical. Legacy systems accumulate undocumented design decisions, implicit contracts, and architectural patterns that exist only in source code. As systems evolve, documentation drifts from implementation, and new developers face steep onboarding curves---studies show developers spend 58--70% of their time on comprehension activities @xia2018measuring. This gap is particularly problematic in the era of AI-assisted development, where coding agents require precise specifications to generate correct code @chen2021evaluating, and AI-powered tools have amplified productivity by an order of magnitude @peng2023impact ---resulting in rapidly expanding codebases that lack the organic design rationale of human-written code @vaithilingam2022expectation.

  The consequences of this specification gap are compounding. Without accurate specifications, coding agents hallucinate requirements and produce code that is syntactically correct but semantically wrong. New developers joining a team must reverse-engineer system behavior from implementation, a process that takes weeks or months for complex systems. And when specifications do exist as static documents, they drift from the implementation within days of being written, becoming misleading rather than helpful.

  We present SpecGen, a system that addresses this gap by automatically synthesizing specification documents from source code through a multi-phase pipeline combining static code analysis with LLM reasoning. Unlike approaches that require manual annotation or rely solely on code comments, SpecGen extracts requirements, architectural patterns, API contracts, and behavioral specifications directly from implementation code. Our central hypothesis is that specifications can be effectively reconstructed from implementation code through multi-phase LLM analysis, provided that each phase preserves explicit traceability to source artifacts.

  This traceability-preserving decomposition yields three compounding benefits: (1) human validation via concrete code evidence, (2) incremental maintenance by identifying exactly which specifications are invalidated by a code change, and (3) transformation of specifications into queryable, agent-consumable knowledge that actively constrains downstream development tasks.

  Our key contributions are:
  #enum(
    [A multi-phase specification synthesis pipeline that progressively constructs code graphs, extracts traceable analysis results, and generates structured documentation artifacts.],
    [Full provenance traceability where every synthesized specification element maintains an explicit link to its originating source code location, enabling verification and incremental maintenance.],
    [An integrated Model Context Protocol (MCP) server that exposes generated specifications as tool-accessible context for coding agents, enabling specification-driven development without manual retrieval.],
    [Multi-repository collection analysis that synthesizes unified architectural views across distributed microservice systems spanning multiple codebases.],
    [A comprehensive evaluation on 9 production repositories demonstrating 94.7% sentence-level accuracy and 96.4% section-level recall across three document types.],
  )

  = Related Work
  == Program Comprehension
  Program comprehension research has studied how developers build mental models of unfamiliar code @vonmayrhauser1995program. Feature location @dit2013feature and concept assignment @biggerstaff1994program, @rajlich2002role map high-level concepts to code regions but do not produce specification documents and require manual domain annotation. Knowledge-based approaches provide frameworks for understanding code intent but cannot scale to modern codebases without automation. SpecGen automates the extraction of these conceptual mappings by leveraging LLMs as a substitute for the domain expertise traditionally required.

  == Code Documentation Generation
  Documentation generation has progressed from template-based Javadoc generators @sridhara2010towards, @mcburney2014automatic through information-retrieval approaches to neural methods. Early neural approaches used sequence-to-sequence models for code summarization @iyer2016summarizing, @hu2018deep, while more recent work employs pre-trained models like CodeBERT @feng2020codebert and CodeT5 @wang2021codet5 for generating natural language descriptions. However, these approaches typically operate at the function or file level, producing isolated summaries rather than coherent system-level documentation. Recent LLM-based tools @khan2022automatic, @ahmed2024fewshot, @contextlabs2023autodoc operate at repository scale but generate flat documentation without an intermediate analysis layer or traceability links. SpecGen's multi-phase pipeline---separating code graph construction, analysis, and document synthesis---enables structured specifications that existing single-pass approaches cannot produce.

  == LLM-Based Code Understanding
  Large language models have demonstrated remarkable capabilities in code understanding, from bug detection and program repair @xia2023automated, @zhang2024autocoderovers to issue resolution @jimenez2024swebench and code review @li2022automating. Retrieval-augmented generation (RAG) approaches @lewis2020retrieval, @gao2023rag combine LLMs with external knowledge retrieval, paralleling SpecGen's architecture of precomputing a searchable knowledge base from analysis results. However, existing tools are designed for transient, conversational interactions---answering a question and discarding context. SpecGen differs by producing durable specification artifacts that persist, evolve alongside the codebase, and serve as a shared source of truth for both humans and coding agents.

#figure(
  table(
      columns: (1.35fr, .8fr, .55fr, .8fr, .5fr, .5fr),
      align: (left, left, center, center, center, center),
      inset: (x: 4pt, y: 2.5pt),
      stroke: (x, y) => if y == 0 { (top: .6pt, bottom: .6pt) } else if y == 6 { (bottom: .6pt) } else { none },
      table.header([*Approach*], [*Scope*], [*Trace.*], [*Multi-repo*], [*Agent*], [*Static*]),
      [Daikon @ernst2007daikon], [Invariant], [✓], [--], [--], [--],
      [CodeBERT @feng2020codebert], [Function], [--], [--], [--], [✓],
      [Autodoc @contextlabs2023autodoc], [Repository], [--], [--], [--], [✓],
      [SWE-agent @jimenez2024swebench], [Task], [--], [--], [✓], [✓],
      [IR Tracing @guo2017semantically], [Link], [✓], [--], [--], [✓],
      [SpecGen], [System], [✓], [✓], [✓], [✓],
    ),
    caption: [Comparison with representative approaches.],
  ) <tab:comparison>

  = System Architecture
  SpecGen operates as a pipeline with five distinct phases, each producing artifacts that feed subsequent phases. @fig:pipeline illustrates the flow.

  #figure(
    image("figures/figure1.png", width: 100%),
    placement: top,
    caption: [The SpecGen generation pipeline.],
  ) <fig:pipeline>

  == Phase 1: Source Ingestion
  The system ingests source packages from Git repositories or package managers, computing diffs between revisions to enable progressive generation---reusing prior analysis for unchanged portions. A structured file filtering pipeline excludes irrelevant content through five sequential stages: (1) repository-native `.gitignore` rules with full semantics including negation patterns, (2) user-defined glob patterns from a per-package config file that extend defaults, (3) built-in defaults covering build artifacts, dependency folders, and generated files, (4) binary file detection by extension, and (5) a 50KB per-file size threshold. Dependency manifests are explicitly preserved despite general exclusions. Configuration is read from the git object store for consistency; validation failures degrade gracefully rather than blocking.

  == Phase 2: Code Graph Generation
  A hybrid approach combining tree-sitter static parsing @brunsfeld2018treesitter with LLM-based analysis constructs a structured code graph containing definitions (functions, classes, interfaces), dependency relationships (imports, call graphs), and LLM-generated file summaries. The system supports TypeScript/JavaScript, Java, Kotlin, and Python. Files are topologically sorted by dependencies, enabling analyzers to process in dependency order for cross-file reasoning. Artifacts are persisted to S3 under `packageName/branch/revisionId/` and lazily loaded by downstream phases.

  == Phase 3: Multi-Analyzer Code Analysis
  Five specialized analyzers run over the code graph in topological order:

  - *Requirements*: Functional/non-functional requirements implied by implementation.
  - *Architecture*: Design patterns, layering decisions, and structural conventions.
  - *API*: Endpoints, request/response schemas, and error-handling contracts.
  - *Testing*: Test patterns, coverage characteristics, and assertion strategies.
  - *UI*: Component hierarchies, interaction patterns, and state management.

  Each result carries a traceability link to source code. Listing analysis shows a real Architecture analysis result extracted from a production codebase, identifying a repository pattern with dependency injection.

  #figure (
    raw(```json
  {
    "id": "ARCH-087",
    "analyzerType": "technical-architecture",
    "title": "Ordered Guard Chain Pattern for Spec Generation Eligibility",
    "confidence": "high",
    "description": "Sequential eligibility checks before DB record creation. Backlog-first prevents duplicates...",
    "technicalDecisions": {
      "rationale": "Guards ordered cheapest to most expensive...",
      "tradeoffs": ["BENEFIT: Backlog-first prevents orphaned DB records", "COST: Sequential guards increase latency for passing items"]
    },
    "definitionReferences": [{
      "definitionName": "buildPackageSpecRequest",
      "filePath": "src/automation/executor/requests/spec-request-builder.ts",
      "relevanceScore": 0.95
    }]
  }
  ```, lang: "json", block: true),
    caption: [Real analysis result (ARCH-087) with traceability, extracted from a production system.],
  ) <lst:analysis>

  Results carry stable identifiers persisting across regeneration cycles (e.g., ARCH-081 identifies the repository pattern across 14 source files; API-079 documents the knowledge base data source manager interface). Each result includes structured fields for technical decisions, rationale, tradeoffs, risks, assumptions, and explicitly flagged unknowns---areas where static analysis cannot determine behavior. Results are deduplicated across files and aggregated into a hierarchical index organized by type and category. The system produces four generation outcomes---Success, Boosted, Skipped, and Failed---enabling fine-grained observability with each skip reason emitted as a stable metric dimension.

  == Phase 4: Document Generation
  Document generation employs a ReAct (Reasoning + Acting) agent pattern @yao2023react, where the LLM iteratively reasons about what information to include, queries the analysis index and code graph, and synthesizes coherent documentation sections. The phase produces multiple complementary artifacts:

  - *System Overview*: High-level architecture with Mermaid diagrams showing service interactions, data flows, and component relationships.
  - *Specification*: Detailed behavioral specifications with traceability to code, covering functional requirements, non-functional constraints, and design decisions.
  - *Developer Docs*: Implementation patterns, concurrency models, initialization strategies, and error-handling conventions for contributors.
  - *Usage Guide*: End-user-oriented documentation for system consumers.
  - *API Guide*: Endpoint documentation with request/response schemas and authentication, generated conditionally when APIs are detected.

  Each generated document explicitly marks areas where static analysis cannot determine behavior with structured `UNKNOWN` annotations, preserving intellectual honesty about inference limits. Documents reference analysis results by their stable identifiers (e.g., "see [[ARCH-081, ARCH-118]]"), enabling bidirectional navigation between specifications and underlying evidence.

  == Phase 5: Knowledge Synchronization
  Generated specifications are synchronized to Amazon Bedrock Knowledge Bases through a batched ingestion pipeline. Files accumulate in active batches until a size threshold or 30-minute TTL triggers sealing; a singleton orchestrator promotes batches through PENDING $arrow.r$ INGESTING $arrow.r$ COMPLETED states, subject to a cap of 10 concurrent data sources per KB. Content is indexed using semantic chunking (breakpoint percentile 85, maximum 450 tokens) with a foundation-model parsing step for complex documents.

  The synchronized knowledge layer provides four search modes: (1) semantic search against dedicated package and collection KBs, with Cohere Rerank v3.5 and cross-KB deduplication by content identity; (2) unified search with intent classification, where queries are classified as name, question, or concept with min-max normalization before blending; (3) agentic search, using in-memory BM25 ranking over analyzer catalogs followed by LLM-based reranking for recently generated content; and (4) AI-generated answers, where a synthesis endpoint produces concise natural-language answers from retrieved documents. Each revision tracks sync status through a five-state lifecycle (NOT_READY $arrow.r$ READY $arrow.r$ IN_PROGRESS $arrow.r$ SUCCEEDED/FAILED), with ETA estimation based on empirical throughput from the last 100 completed batches.

  = Key Design Decisions
  *Traceability as First-Class Concern.* Every specification element links back to its source code, enabling: (1) developer validation against concrete evidence, (2) incremental regeneration when code changes invalidate specific specifications, and (3) agent grounding from high-level specifications to implementation details.

  *Progressive Generation.* Diff-based analysis reuses artifacts for unchanged code graph portions, reducing generation time by 60--80% for typical incremental changes.

  *Multi-Repository Collections.* SpecGen supports collection generation: loading individual package specifications, analyzing cross-package dependencies, and synthesizing unified architecture overviews---enabling coherent specification views across microservice boundaries.

  *Agent Integration.* Structured JSON artifacts with traceability metadata enable coding agents to retrieve specifications via semantic search, navigate from requirements to implementation patterns, and validate generated code against behavioral contracts---positioning specifications as living constraints rather than static documents.

  = Preliminary Evaluation
  We evaluated SpecGen on 9 production repositories spanning API services, scheduling systems, AI agent connectors, orchestration services, and SDK clients, generating 27 documents total (3 types per repository).

  *Methodology.* Domain experts reviewed generated documents and provided sentence-level feedback identifying inaccurate claims. We compute: (1) Accuracy as the fraction of sentences without factual errors, (2) Precision at the sentence level (identical to accuracy in our annotation scheme), (3) Recall at the section level, measuring the fraction of sections without missing critical information, and (4) BERT Score comparing generated text against expert-written reference specifications where available. @tab:evaluation summarizes results across all 27 generated documents.

  #figure(
    table(
      columns: (1.35fr, .65fr, .65fr, .65fr, .65fr),
      align: (left, right, right, right, right),
      inset: (x: 4pt, y: 2.5pt),
      stroke: (x, y) => if y == 0 { (top: .6pt, bottom: .6pt) } else if y == 4 { (bottom: .6pt) } else { none },
      table.header([*Document Type*], [*Accuracy*], [*Precision*], [*Recall*], [*BERT*]),
      [System Overview], [0.904], [0.904], [0.964], [0.946],
      [Developer Docs], [0.972], [0.972], [0.955], [0.948],
      [Specification], [0.965], [0.965], [0.972], [0.979],
      [*Overall Mean*], [*0.947*], [*0.947*], [*0.964*], [*0.958*],
    ),
    caption: [Evaluation results by document type across 9 repositories. Values are means across repositories.],
  ) <tab:evaluation>

  SpecGen achieves a mean accuracy of 0.953 across all documents, with Specification documents performing highest (mean 0.969) due to their grounding in concrete code evidence. Section-level recall averages 0.970, indicating that the system rarely omits critical topics. System Overviews have the lowest accuracy (0.904) due to cross-file architectural reasoning uncertainty, while Developer Docs and Specifications achieve greater than 0.96 by grounding in local code patterns. Three repositories achieved perfect 1.0 accuracy on some document types. BERT Scores consistently exceed 0.9, indicating strong semantic alignment even where minor factual issues exist.

  = Conclusion
  SpecGen demonstrates that traceable, multi-phase specification synthesis from code is practical at scale---achieving 94.7% accuracy across production repositories while positioning specifications as living, agent-consumable artifacts rather than static documents.

  #pagebreak()
  #bibliography("specops26-paper8.bib", title: "References", full: true, style: "association-for-computing-machinery")
