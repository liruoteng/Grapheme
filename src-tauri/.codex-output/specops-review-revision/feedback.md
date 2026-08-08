SpecOps 2026 Paper #8 Reviews and Comments
===========================================================================
Paper #8 SpecGen: Automated Specification Synthesis from Codebases via
Multi-Phase LLM Analysis


Review #8A
===========================================================================

Overall merit
-------------
5. Strong accept

Reviewer expertise
------------------
3. Knowledgeable

Paper summary
-------------
This paper uses LLMs to automatically generate structured specification documents from source code repositories. Their tool is called SpecGen and they have demonstrated a detailed preliminary evaluation of the approach. Overall this paper was well-written and easy to follow, I think it will make a welcome addition to SpecOps and create interesting discussion at the event. I include some relatively minor comments for the authors in the next box.

Comments for authors
--------------------
- line 94: how often do you anticipate having to redo the human validation step as repositories continuously evolve?
  - **[MATERIAL GAP]** Author input is needed on the actual revalidation cadence or observed frequency. The revision can explain that traceability scopes review to elements linked to changed code, but the supplied material contains no empirical cadence.
- Table 1 is running into the margin
  - **[ADDRESSED]** Narrowed the columns and reduced horizontal cell padding.
- Figure 1: what do the arrows and colors represent? Include this detail in the caption.
  - **[ADDRESSED]** Expanded the caption to define the primary-flow arrows, regeneration loop, phase colors, intermediate outputs, and downstream consumers.
- line 134: expertise *that is* traditionally
  - **[ADDRESSED]** Added “that is.”
- line 240: what is "S3"?
  - **[ADDRESSED]** Expanded the first occurrence to “Amazon Simple Storage Service (S3).”
- line 365: line running into the margin
  - **[ADDRESSED]** Broke the long JSON `tradeoffs` array across multiple lines.



Review #8B
===========================================================================

Overall merit
-------------
3. Weak accept

Reviewer expertise
------------------
4. Expert

Paper summary
-------------
The paper presents SpecGen, a deployed system that reverse-engineers specification documents from source code. A five-phase pipeline ingests a repository, builds a code graph (tree-sitter parsing plus LLM file summaries, topologically ordered by dependencies), runs five specialized analyzers (requirements, architecture, API, testing, UI) whose results carry links back to file and line ranges, then a ReAct agent composes several document types, and the output is synced into a searchable knowledge base exposed to coding agents through an MCP server. Every synthesized element is supposed to keep a stable identifier and a provenance link to the code that justifies it, enabling human validation, incremental regeneration, and agent grounding. A preliminary evaluation on nine production repositories has domain experts mark inaccurate sentences in the generated documents, reporting high sentence-level accuracy and section-level recall.

Comments for authors
--------------------
I enjoyed reading this. The problem is real and well matched to this venue, and the system clearly exists and runs on production code rather than being a paper design. My concerns are mostly about what the evaluation can actually support.

**Strengths:**

- The motivation lands. Specification drift and coding agents consuming stale or missing specs is exactly the problem this community cares about, and framing specifications as living, agent-consumable artifacts rather than static documents is the right way to think about it.

- Making traceability and uncertainty first-class is the paper's best idea. Stable identifiers that persist across regenerations, per-result source links and confidence ratings shown on a real production artifact. Syncing the specs into a searchable knowledge base that coding agents query over MCP is also a good idea.

- The engineering description is concrete for four pages, down to filtering stages, batch lifecycles, and observable generation outcomes. This reads like a system that is actually operated, which for me is worth something.

**Weaknesses:**

- The abstract promises formal specifications but nothing in the system is formal in the accepted sense: there is no specification language, no semantics, and nothing a checker could consume; the artifacts are structured natural-language documents. I would either drop the word or, more interestingly, target a formal fragment where confidence is high. The same softening applies to "static code analysis" in the introduction, which in the paper amounts to syntactic parsing and call-graph extraction rather than any semantic analysis. 
  - **[ADDRESSED]** Replaced “formal specifications” with “structured natural-language specifications” and softened “static code analysis” to “syntax-based repository analysis.”

- The central hypothesis, that multi-phase analysis with preserved traceability is what makes spec reconstruction work, is never actually tested: no single-pass baseline, no phase ablation, so the numbers cannot separate the architecture from the underlying model. The traceability links, the stated differentiator, are also never checked for correctness; fluent text with wrong anchors would score perfectly here.
  - **[ADDRESSED]** Reframed the hypothesis as a design premise and added explicit limitations covering the absence of a single-pass baseline, phase ablations, and trace-link correctness evaluation.

- Some numbers in the prose contradict Table 2 (the overall means differ, and the prose names a different best document type on accuracy), so at least one set is wrong. Precision is admitted to be identical to accuracy yet gets its own column, and the "domain experts" are never counted or described, with no agreement statistics.
  - **[PARTLY ADDRESSED]** Reconciled the prose with Table 2 and removed the redundant Precision column.
  - **[MATERIAL GAP]** Author input is needed for the number and qualifications of evaluators, annotation overlap, and any inter-rater agreement statistic. The revision explicitly acknowledges that agreement is not reported.


**Questions:**

- How would you measure fidelity of the generated specs to the code itself, contradictions and coverage gaps, rather than relying on expert sentence marking? Probe-based approaches (see https://arxiv.org/abs/2605.17246) derive question-answer pairs from the code and would test exactly what your traceability design promises. I would recommend adding a discussion of this to the paper.
  - **[ADDRESSED]** Added a future-evaluation discussion of code-derived fidelity probes, contradiction rates, coverage gaps, and separate trace-link verification.

- How do the extracted "requirements" differ from the "behavioral specifications"? Both are mined from the same code, so a bug in the implementation gets documented as intended behavior. Have you seen this in practice?
  - **[PARTLY ADDRESSED]** Clarified that Requirements are analyzer-level implementation-implied obligations, while Specification documents synthesize requirements with contracts and design decisions. The revision now states that neither establishes stakeholder intent and that implementation defects may be reproduced.
  - **[MATERIAL GAP]** Author input is needed on whether this failure mode has been observed in practice and, if so, how often.

- Which model does the pipeline use, and what does a full generation cost for one repository?
  - **[MATERIAL GAP]** Author input is needed for the exact model/provider and version, pricing basis, representative repository size, token usage, and end-to-end generation cost. No supported values are present in the supplied paper or bibliography.



Review #8C
===========================================================================

Overall merit
-------------
4. Accept

Reviewer expertise
------------------
4. Expert

Paper summary
-------------
# MetaReview

Thank you for submitting your paper to SpecOps 2026. The reviewers enjoyed reading the paper and appreciated the technical ideas in the paper. The PC recommends acceptance. Congratulations!
