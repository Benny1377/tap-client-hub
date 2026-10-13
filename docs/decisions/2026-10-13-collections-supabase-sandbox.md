# Decision: Separate Supabase sandbox for Collections integration

Status: **Approved in principle by the client; provisioning details pending.**

## Context

Collections Phase 2 and the planned Phase 3 integration require a safe shared environment for developer review and end-to-end testing. The current local Supabase harness is intentionally synthetic and isolated; the hosted production project must not be used for routine feature validation.

## Decision

The client approved creating a separate Supabase project to serve as a non-production sandbox. This approval is for an isolated sandbox project only. It does not authorize production migration application, copying production client data, enabling automation, configuring a live email provider, or sending real client communications.

The sandbox should use synthetic or explicitly approved sanitized data, separate credentials and secrets, and a clearly named non-production deployment target. Migrations must first pass local reset/tests, then be reviewed and applied to the sandbox through the normal migration workflow. Production remains a separate release target and requires its own explicit approval.

## Provisioning details still required

- Supabase organization and project owner.
- Project name and region/data-residency choice.
- Billing/plan confirmation and expected lifecycle (persistent QA sandbox or temporary).
- Named users/roles with access; least privilege and MFA are required.
- Secret storage and rotation owner; do not put keys in Git, handoffs, or client-side configuration.
- Data policy confirmation. Default: synthetic fixtures only; no production database clone or client PII.
- Whether the project is for Phase 2 migration verification only or shared Phase 3 integration testing too. Email delivery remains disabled until separately approved.

## Consequences and controls

- The local Docker harness remains the fastest deterministic test layer; the sandbox adds shared Supabase integration confidence, not a replacement for local tests.
- Sandbox migrations may be applied only after local validation and code review; hosted production migration status stays unchanged until release approval.
- Keep API URL/keys isolated by environment. Use sandbox-only credentials and never reuse production credentials.
- Disable outbound email, scheduled jobs, and other external side effects by default. Any provider sandbox/test-recipient action needs separate owner approval and synthetic content.
- Monitor project spend and remove access when no longer needed. Do not create the project until organization, region, owner, and billing details are confirmed.

## Approval record

- Client approval: communicated by project owner on 2026-10-13.
- Project owner confirmation of provisioning details: pending.
- Provisioning status: not created by this change.
- Revisit when: the Phase 2 integration branches are reviewed or Phase 3 testing is ready to use a shared environment.
