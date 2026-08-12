# `@vetryn/core`

This package defines Vetryn's strict, versioned repository evidence contracts and pure validation rules. It performs
no network, filesystem, provider SDK, AST, or GitHub I/O.

OpenRouter model catalog entries expose `modelAuthor`, derived from the namespace before the first slash in the
canonical model ID. That field describes authorship only; it is never execution-provider or privacy evidence.
Call sites instead own a strict `routePolicy` containing one reviewed OpenRouter provider slug, disabled fallbacks,
required parameter support, denied data collection, and required ZDR.

Complete `CandidateRun` artifacts must bind that exact route policy and a redacted `routeObservation` derived from
opt-in OpenRouter router metadata. The observation records every reported provider/model/status attempt and one
selected provider/model. Validation requires exactly one successful attempt per declared request to reconcile with
the selection, request and attempt ordinals to be complete, and the selected model and provider slug to match policy.
For complete runs, request coverage must equal candidate case count times evaluator repetitions. Router attempts
and evaluator repetitions remain separate units. Missing, contradictory, or stale route evidence cannot support a
recommendation.

Failed or incomplete runs may retain bounded failed attempts with `selectedProvider: null`. A complete run, or any
observation containing a successful attempt, cannot use a null selection.

This is an incompatible pre-release contract migration from `providerPolicy` and catalog `provider`. Regenerate
checked-in manifests, catalog snapshots, and candidate-run fixtures before evaluation.
