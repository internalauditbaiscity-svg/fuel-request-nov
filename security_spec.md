# Firestore Security Specification — Bais City Fuel Requisition & Fleet System

## 1. Data Invariants
1. **Strict Environment Isolation**: `envId` MUST be `'live'` or `'sandbox'`.
2. **Identity Integrity**: Every document created by a user MUST assert `ownerId == request.auth.uid` (or `actorUid == request.auth.uid` for audit logs) and `request.auth.token.email_verified == true`.
3. **RBAC Privilege Escalation Prevention**: Non-admin users cannot create or modify `/admins/{userId}` or elevate their own `role` in `/users/{userId}`. Only elevated administrators (`isAdmin()`) can assign elevated roles or edit/delete user accounts in `/users/{userId}`. Verified Google users may only create their own `/users/{ownUid}` document either by claiming an active Admin-provisioned `/invites/{emailId}` matching their verified email and exact assigned role/permissions, or as an unprivileged `'requester'` with `canEdit == false`, `canDelete == false`, and `canSwitchToLive == false`.
4. **Departmental Isolation**: Requesters and department heads can only read/list Work Plans and Trip Tickets belonging to their assigned `department` (unless the user has city-wide oversight role: `admin`, `approver`, `gso_dispenser`, or `auditor`).
5. **Single-Dispense Terminal Lock**: Once a `TripTicket` transitions to `dispensed` (`servedOnce == true`), non-admin users cannot re-dispense or alter dispensed/forfeited liters.
6. **GSO Adjustment Verification**: Inventory shrinkage/overage adjustments can only be marked `verified` by an `admin` or `gso_dispenser` with a non-empty `digitalVerificationCode`.
7. **Live Data Deletion Protection**: Deleting records in `live` environment is strictly restricted to `isAdmin()`. Sandbox purge (`sandbox` environment deletes) is permitted to `isAdmin()` (or authenticated operators in `sandbox`).

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Read/Write**: Any request with `request.auth == null` on `/environments/live/workPlans/wp1`.
2. **Unverified Email Spoof**: Request where `request.auth.token.email == 'internalaudit.baiscity@gmail.com'` but `request.auth.token.email_verified == false`.
3. **Self-Privilege Escalation on Create**: Non-admin user creating `/users/{ownUid}` with `role: 'admin'`.
4. **Admin Collection Tampering**: Non-admin user creating `/admins/{ownUid}`.
5. **Shadow / Ghost Field Injection**: Creating a `WorkPlan` with an undeclared field `bypassApproval: true`.
6. **ID Poisoning**: Creating `/environments/live/workPlans/invalid$id_with_1500_chars...` failing `isValidId()`.
7. **Identity Spoofing**: Creating a `WorkPlan` with `ownerId: 'someone-elses-uid'` while signed in as `userA`.
8. **Cross-Department Query Scraping**: Department requester from `City Health Office` listing `/environments/live/workPlans` without matching `resource.data.department` (or attempting to read `City Engineering Office` plan).
9. **Unauthorized Re-Dispensing**: GSO Dispenser attempting to update a `TripTicket` where `existing().servedOnce == true`.
10. **Non-Admin Delete on Live**: Standard requester attempting `delete` on `/environments/live/workPlans/wp1`.
11. **Value Poisoning on Update**: Approver updating `approvedLiters` to a negative number (`-50`) or string (`"fifty"`).
12. **Audit Log Mutation**: Any non-admin attempting `update` or `delete` on `/environments/live/auditLogs/log1`.
