# Ad hoc implementation plans

Factory's universal planning workflow may write reviewed, timestamped Markdown plans here for repository
maintenance that is outside the locked OSS V1 task DAG. Product implementation still starts from an explicit
task in `product/plans/oss-v1/` and a packet produced by `pnpm --silent task:compile -- TASK-ID`.

An ad hoc plan cannot rewrite V1 scope, acceptance criteria, task state, or product truth. If work belongs in
the V1 DAG, update its canonical JSON through reviewed planning work instead.
