# Permission Registry v3.0

## Document Information
- **Version:** 3.0
- **Date:** January 27, 2026
- **Related Document:** SRS v3.0
- **Purpose:** Complete reference of all system permissions

---

## 1. Permission Structure

### 1.1 Naming Convention
```
resource.action[.scope]
```

- **Resource:** The entity being accessed (report, role, user, workflow)
- **Action:** The operation being performed (create, view, edit, delete)
- **Scope:** Optional modifier (own, team, all, admin)

### 1.2 Wildcard Support
- `*` matches any value in that segment
- `report.*` grants all report permissions
- `*.view.*` grants all view permissions across resources
- Use wildcards with caution to prevent privilege escalation

### 1.3 Permission Inheritance
Permissions follow a hierarchical structure:
```
report.*
  ├── report.create
  ├── report.view.*
  │   ├── report.view.own
  │   ├── report.view.team
  │   └── report.view.all
  ├── report.edit.*
  │   ├── report.edit.own
  │   └── report.edit.all
  └── report.delete.*
```

Granting `report.view.*` automatically includes `report.view.own`, `report.view.team`, and `report.view.all`.

---

## 2. Core Permissions

### 2.1 Report Management

#### Creation & Editing
| Permission | Description | Default Roles | Risk Level |
|:-----------|:------------|:--------------|:-----------|
| `report.create` | Create new expense reports | Employee, Approver, Finance | Low |
| `report.edit.own` | Edit own draft or returned reports | Employee | Low |
| `report.edit.team` | Edit subordinate reports (managers only) | Approver | Medium |
| `report.edit.all` | Edit any report regardless of owner | Admin | **High** |
| `report.delete.own` | Delete own draft reports | Employee | Low |
| `report.delete.all` | Delete any report | Admin | **High** |

#### Viewing
| Permission | Description | Default Roles | Risk Level |
|:-----------|:------------|:--------------|:-----------|
| `report.view.own` | View own reports | Employee, Approver, Finance | Low |
| `report.view.team` | View reports from direct subordinates | Approver | Medium |
| `report.view.department` | View all reports in same department | Department Head | Medium |
| `report.view.all` | View all reports organization-wide | Finance, Auditor, Admin | High |
| `report.view.archived` | View archived reports (>3 years old) | Finance, Auditor | Medium |

#### Workflow Actions
| Permission | Description | Default Roles | Risk Level |
|:-----------|:------------|:--------------|:-----------|
| `report.submit` | Submit reports for approval | Employee | Low |
| `report.withdraw` | Withdraw submitted reports | Employee | Low |
| `report.approve` | Approve reports at current workflow step | Approver | **High** |
| `report.reject` | Reject reports permanently | Approver | **High** |
| `report.return` | Return reports for correction | Approver | Medium |
| `report.reassign` | Reassign approver for a report | Admin | Medium |
| `report.force_approve` | Approve report bypassing workflow | Super Admin | **Critical** |

#### Financial Operations
| Permission | Description | Default Roles | Risk Level |
|:-----------|:------------|:--------------|:-----------|
| `report.post` | Post approved reports to accounting system | Finance | **High** |
| `report.unpost` | Reverse a posted report | Finance Director | **Critical** |
| `report.export` | Export report data to CSV/Excel | Finance, Auditor | Medium |
| `report.export.financial` | Export financial data including sensitive info | Finance Director | High |

### 2.2 Role & Permission Management

#### Role Operations
| Permission | Description | Default Roles | Risk Level |
|:-----------|:------------|:--------------|:-----------|
| `role.create` | Create new custom roles | Admin | High |
| `role.view` | View role definitions and permissions | Admin | Low |
| `role.edit` | Modify existing role permissions | Admin | **High** |
| `role.delete` | Delete custom roles | Admin | High |
| `role.assign` | Assign roles to users (except Admin) | Admin | **High** |
| `role.assign.admin` | Assign Admin role to users | Super Admin | **Critical** |
| `role.assign.finance` | Assign Finance role to users | Super Admin | **Critical** |

#### Permission Operations
| Permission | Description | Default Roles | Risk Level |
|:-----------|:------------|:--------------|:-----------|
| `permission.view` | View permission registry | Admin | Low |
| `permission.create` | Add custom permissions to registry | Super Admin | **Critical** |
| `permission.edit` | Modify permission definitions | Super Admin | **Critical** |
| `permission.delete` | Remove permissions from registry | Super Admin | **Critical** |

### 2.3 User Management

| Permission | Description | Default Roles | Risk Level |
|:-----------|:------------|:--------------|:-----------|
| `user.create` | Create new user accounts | Admin | Medium |
| `user.view` | View user profile information | Admin, Approver | Low |
| `user.view.sensitive` | View sensitive user data (salary, SSN) | HR Admin | **High** |
| `user.edit` | Edit user profiles | Admin | Medium |
| `user.edit.own` | Edit own profile | All Users | Low |
| `user.deactivate` | Deactivate user accounts | Admin | High |
| `user.delete` | Permanently delete user accounts | Super Admin | **Critical** |
| `user.impersonate` | Log in as another user for support | Super Admin | **Critical** |
| `user.reset_password` | Reset user passwords | Admin | Medium |
| `user.unlock` | Unlock locked accounts | Admin | Low |

### 2.4 Workflow Management

| Permission | Description | Default Roles | Risk Level |
|:-----------|:------------|:--------------|:-----------|
| `workflow.create` | Create new approval workflows | Admin | Medium |
| `workflow.view` | View workflow definitions | Admin, Approver | Low |
| `workflow.edit` | Modify workflow steps and rules | Admin | High |
| `workflow.delete` | Delete workflows | Admin | High |
| `workflow.assign` | Assign workflows to departments/types | Admin | Medium |
| `workflow.test` | Test workflows without affecting real reports | Admin | Low |
| `workflow.migrate` | Force-migrate in-flight reports to new workflow | Admin | **High** |
| `workflow.override` | Override workflow rules for specific report | Super Admin | **Critical** |

### 2.5 Audit & Compliance

| Permission | Description | Default Roles | Risk Level |
|:-----------|:------------|:--------------|:-----------|
| `audit.view` | View audit log entries | Auditor, Admin | Medium |
| `audit.view.all` | View all audit logs including admin actions | Auditor | High |
| `audit.export` | Export audit logs to external files | Auditor | Medium |
| `audit.analyze` | Run analytics on audit data | Auditor | Medium |
| `audit.archive` | Archive old audit logs (>7 years) | Super Admin | Medium |
| `compliance.view` | View compliance reports | Auditor, Admin | Medium |
| `compliance.generate` | Generate compliance reports | Auditor | Medium |
| `compliance.certify` | Sign off on compliance certifications | Compliance Officer | **High** |

### 2.6 Analytics & Reporting

| Permission | Description | Default Roles | Risk Level |
|:-----------|:------------|:--------------|:-----------|
| `analytics.view` | View dashboards and reports | Finance, Admin, Approver | Low |
| `analytics.view.sensitive` | View sensitive metrics (user spending patterns) | Finance Director | Medium |
| `analytics.export` | Export analytics data | Finance, Auditor | Medium |
| `analytics.create` | Create custom reports and dashboards | Admin | Low |
| `analytics.schedule` | Schedule automated report delivery | Admin | Low |

### 2.7 System Configuration

| Permission | Description | Default Roles | Risk Level |
|:-----------|:------------|:--------------|:-----------|
| `system.configure` | Modify system settings | Super Admin | **Critical** |
| `system.view_logs` | View system error and access logs | Admin | Medium |
| `system.backup` | Initiate system backups | Admin | Medium |
| `system.restore` | Restore from backups | Super Admin | **Critical** |
| `system.integrate` | Configure integrations (accounting, HR) | Admin | High |
| `system.api_keys` | Manage API keys and webhooks | Admin | High |
| `system.notification` | Configure email/SMS notification settings | Admin | Low |
| `system.maintenance` | Enable maintenance mode | Super Admin | High |

### 2.8 Attachment Management

| Permission | Description | Default Roles | Risk Level |
|:-----------|:------------|:--------------|:-----------|
| `attachment.upload` | Upload receipt attachments | Employee | Low |
| `attachment.view.own` | View own report attachments | Employee | Low |
| `attachment.view.all` | View all attachments | Finance, Auditor | Medium |
| `attachment.delete.own` | Delete own attachments (draft reports only) | Employee | Low |
| `attachment.delete.all` | Delete any attachment | Admin | High |
| `attachment.download` | Download attachments | Employee, Approver, Finance | Low |

---

## 3. Special Permissions

### 3.1 Emergency Access

| Permission | Description | Usage | Risk Level |
|:-----------|:------------|:------|:-----------|
| `emergency.access` | Bypass normal access controls temporarily | Break-glass scenarios only | **Critical** |
| `emergency.override` | Override workflow and approval requirements | System outages | **Critical** |

**Emergency Access Requirements:**
- Requires second-factor authentication
- Automatically logged and flagged
- Triggers immediate notification to compliance team
- Access auto-expires after 1 hour
- Requires post-incident review and documentation

### 3.2 Delegation Permissions

| Permission | Description | Usage | Risk Level |
|:-----------|:------------|:------|:-----------|
| `delegate.approve` | Delegate approval authority to another user | Manager on vacation | Medium |
| `delegate.view` | Delegate view access temporarily | Covering for colleague | Low |

**Delegation Rules:**
- Maximum delegation period: 30 days
- Delegator remains accountable
- All delegated actions logged with both identities
- Delegator can revoke at any time

---

## 4. Toxic Permission Combinations (PROHIBITED)

These permission combinations MUST be prevented by the system:

### 4.1 Approval Fraud Prevention
```
❌ report.edit.all + report.approve
   Risk: Modify reports then approve them
   
❌ report.create + report.approve + report.post
   Risk: Create fraudulent reports and complete entire cycle

❌ user.impersonate + report.approve
   Risk: Impersonate others to approve reports
```

### 4.2 Financial Control Separation
```
❌ report.approve + report.post
   Risk: Bypass financial review process
   
❌ report.edit.all + report.post
   Risk: Modify posted reports after approval

❌ workflow.override + report.approve
   Risk: Bypass approval requirements
```

### 4.3 Privilege Escalation Prevention
```
❌ role.create + role.assign.admin
   Risk: Grant oneself admin privileges
   
❌ permission.create + role.edit
   Risk: Create new permissions and grant to self

❌ user.impersonate + role.assign
   Risk: Impersonate admin to grant roles
```

### 4.4 Audit Integrity Protection
```
❌ audit.export + report.edit.all
   Risk: Cover tracks after unauthorized edits
   
❌ audit.archive + audit.view.all
   Risk: Hide incriminating audit entries

❌ system.backup + user.delete
   Risk: Delete evidence then restore selective backup
```

---

## 5. Permission Groups (Pre-Defined)

### 5.1 Basic Employee
```
- report.create
- report.edit.own
- report.view.own
- report.delete.own
- report.submit
- report.withdraw
- attachment.upload
- attachment.view.own
- attachment.delete.own
- attachment.download
- user.edit.own
```

### 5.2 Team Manager (Approver)
```
[Includes Basic Employee permissions +]
- report.view.team
- report.approve
- report.reject
- report.return
- user.view (subordinates only)
- delegate.approve
- delegate.view
```

### 5.3 Finance Specialist
```
- report.view.all
- report.post
- report.export
- attachment.view.all
- attachment.download
- analytics.view
- analytics.export
- audit.view (report-related only)
```

### 5.4 Auditor
```
- report.view.all
- report.view.archived
- attachment.view.all
- audit.view.all
- audit.export
- audit.analyze
- compliance.view
- compliance.generate
- analytics.view
```

### 5.5 System Administrator
```
[Includes all above permissions EXCEPT:]
- role.assign.admin
- role.assign.finance
- permission.create/edit/delete
- user.delete
- system.restore
- emergency.override
- workflow.override

[Admin can grant themselves these if needed, but action is logged]
```

### 5.6 Super Administrator
```
[ALL PERMISSIONS]
- Assigned only via database
- Cannot be granted through UI
- All actions logged and flagged for review
- Requires MFA on every action
```

---

## 6. Permission Validation Rules

### 6.1 Runtime Checks
Every API request must validate:

1. **User Authentication:** Valid, non-expired token
2. **Session Version:** Token `roles_version` matches database
3. **Permission Existence:** User has required permission(s)
4. **Scope Validation:** Permission scope matches resource ownership
5. **SoD Compliance:** No toxic permission combinations active
6. **Self-Transaction:** User not acting on own report (approval)
7. **Temporal Separation:** User didn't touch report earlier in workflow

### 6.2 Database Schema

```sql
-- Permission Registry
CREATE TABLE permissions (
    id UUID PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    category VARCHAR(100),
    risk_level VARCHAR(20), -- low, medium, high, critical
    requires_mfa BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW(),
    deprecated_at TIMESTAMP NULL
);

-- Role-Permission Mapping
CREATE TABLE role_permissions (
    role_id UUID REFERENCES roles(id),
    permission_id UUID REFERENCES permissions(id),
    granted_at TIMESTAMP DEFAULT NOW(),
    granted_by UUID REFERENCES users(id),
    PRIMARY KEY (role_id, permission_id)
);

-- User Effective Permissions (Materialized View)
CREATE MATERIALIZED VIEW user_effective_permissions AS
SELECT 
    ur.user_id,
    rp.permission_id,
    p.name as permission_name,
    COUNT(DISTINCT ur.role_id) as granted_by_roles
FROM user_roles ur
JOIN role_permissions rp ON ur.role_id = rp.role_id
JOIN permissions p ON rp.permission_id = p.id
WHERE ur.active = true
GROUP BY ur.user_id, rp.permission_id, p.name;

-- Refresh on role/permission changes
CREATE INDEX idx_user_permissions ON user_effective_permissions(user_id, permission_name);
```

### 6.3 Caching Strategy
- Cache user permissions in Redis with 5-minute TTL
- Cache key: `user:{user_id}:permissions:v{roles_version}`
- Invalidate on role assignment/removal
- Fallback to database if cache miss

---

## 7. Custom Permission Guidelines

### 7.1 When to Create Custom Permissions
- New feature requires fine-grained access control
- Existing permissions too broad for specific use case
- Compliance requirements demand explicit permission tracking

### 7.2 Naming Conventions
```
✅ GOOD:
- travel.approve.international
- vendor.create.preferred
- budget.override.quarterly

❌ BAD:
- misc_permission
- admin_special
- temp_access_123
```

### 7.3 Custom Permission Approval Process
1. **Request:** Submit justification and risk assessment
2. **Review:** Security team evaluates necessity
3. **Super Admin Approval:** Super Admin creates permission
4. **Documentation:** Add to this registry with description
5. **Audit:** Track usage for 90 days to validate need

---

## 8. Permission Audit Requirements

### 8.1 Quarterly Permission Review
All permissions granted to users must be reviewed every 90 days:

**Review Process:**
1. System generates report of all user permissions
2. Managers review and confirm necessity
3. Unconfirmed permissions flagged for removal
4. After 14 days, unconfirmed permissions auto-revoked
5. Revocations logged in audit trail

### 8.2 High-Risk Permission Monitoring
Permissions marked as **High** or **Critical** trigger:
- Real-time logging of all actions
- Weekly usage reports to compliance team
- Mandatory justification for first use
- 30-day re-certification requirement

### 8.3 Unused Permission Cleanup
- Permissions unused for 180 days flagged for review
- Deprecated permissions removed after 1-year notice period
- Custom permissions with zero usage deleted after 90 days

---

## 9. Migration Plan

### 9.1 From v2.2 to v3.0
**Breaking Changes:**
- `report.view` split into `report.view.own`, `report.view.team`, `report.view.all`
- New toxic combination checks may block existing role configurations

**Migration Steps:**
1. Audit all existing roles for toxic combinations
2. Remediate flagged roles before upgrade
3. Run permission mapping script:
   ```sql
   -- Map old permissions to new granular permissions
   UPDATE role_permissions 
   SET permission_id = (SELECT id FROM permissions WHERE name = 'report.view.all')
   WHERE permission_id = (SELECT id FROM permissions WHERE name = 'report.view')
   AND role_id IN (SELECT id FROM roles WHERE name IN ('Admin', 'Finance'));
   
   UPDATE role_permissions 
   SET permission_id = (SELECT id FROM permissions WHERE name = 'report.view.own')
   WHERE permission_id = (SELECT id FROM permissions WHERE name = 'report.view')
   AND role_id IN (SELECT id FROM roles WHERE name = 'Employee');
   ```
4. Increment all users' `roles_version` to invalidate old tokens
5. Notify users of permission changes

---

## Appendices

### Appendix A: Permission Risk Matrix
See separate document: `Permission_Risk_Matrix_v3.0.xlsx`

### Appendix B: SQL Migration Scripts
See separate document: `Permission_Migration_Scripts_v3.0.sql`

### Appendix C: API Permission Requirements
See separate document: `API_Reference_v3.0.md` (Section 2.2)

---

**Document End**
