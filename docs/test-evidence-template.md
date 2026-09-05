# Test evidence template

Copy this template into an issue, pull request, or task record for each manual, platform-dependent, or model-backed test. Do not record a planned command as an executed result.

~~~text
Test ID:
Date and executor:
Repository, branch, and commit SHA:
Uncommitted changes:
Evidence level: S / U / I / W / L / H
Operating system, browser, display scale, and toolchain:
Preconditions and non-sensitive fixture:
Exact command or manual steps:
Expected result:
Observed result:
Exit code and test count:
Result: PASS / FAIL / SKIP / NOT RUN
Logs, screenshot, or recording location:
Limitations or failure cause:
Cleanup:
Reviewer:
~~~

Evidence levels are defined in [the development plan](../harness-plugins%20task.md#73-证据等级). S is static or build evidence, U is unit or component evidence, I is cross-component integration evidence, W is Windows-machine evidence, L is a real-model result, and H is a human-task result.
