# Implementation Roadmap v3.0

## Document Information
- **Version:** 3.0
- **Date:** January 27, 2026
- **Related Document:** SRS v3.0
- **Purpose:** Week-by-week implementation plan
- **Audience:** Development team, project managers, stakeholders

---

## Executive Summary

This roadmap outlines the 4-week implementation plan for upgrading the expense management system from v2.2 to v3.0. The upgrade introduces critical security enhancements, compliance features, and workflow improvements required for enterprise deployment.

**Key Milestones:**
- Week 1: Security foundations and session management
- Week 2: Workflow engine enhancements
- Week 3: Compliance and audit features
- Week 4: Testing, hardening, and production deployment

**Resource Requirements:**
- 3 Backend Engineers
- 1 Security Engineer
- 1 DevOps Engineer
- 1 QA Engineer
- 1 Technical Writer

**Risk Level:** Medium-High (architectural changes to authentication)

---

## Pre-Implementation Phase (Week 0)

### Environment Preparation

**Infrastructure Setup:**
```yaml
Development Environment:
  - Runtime: Node.js 20+
  - Framework: Hono with OpenAPIHono (Zod)
  - Language: TypeScript 5+
  - Database: PostgreSQL 15+ with pgcrypto extension
  - Cache: Redis 7+
  - JWT Library: JOSE
  - Password Hashing: @node-rs/argon2
  - Message Queue: RabbitMQ or AWS SQS (for background jobs)
  - Storage: S3-compatible object storage (for attachments)

Staging Environment:
  - Mirror of production configuration
  - Test data seeded (1000 users, 10000 reports)
  - Load testing tools configured (k6 or Artillery)

Production Prep:
  - Database migration dry-run (node-pg-migrate)
  - Rollback procedures documented
  - Monitoring dashboards configured (Prometheus/Grafana)
```

**Team Onboarding:**
- [ ] Security requirements training (2 hours)
- [ ] Architecture review session (3 hours)
- [ ] Code review standards alignment (1 hour)
- [ ] Tool setup and access provisioning

**Code Freeze:**
- [ ] Feature freeze on v2.2 codebase
- [ ] Create v3.0 development branch
- [ ] Setup CI/CD pipeline for v3.0

---

## Week 1: Security Foundations

**Goal:** Implement core security infrastructure without disrupting existing functionality

### Day 1-2: Session Management Overhaul

**Tasks:**
1. **Database Schema Updates**
   ```sql
   -- Run migration scripts
   ALTER TABLE users ADD COLUMN roles_version INT DEFAULT 1;
   CREATE TABLE refresh_tokens (...);
   CREATE INDEX idx_users_roles_version ON users(id, roles_version);
   ```

2. **Token Service Implementation**
   - [ ] Implement version-based JWT generation
   - [ ] Add roles_version to token payload
   - [ ] Create token validation with version check
   - [ ] Implement refresh token rotation

3. **Testing**
   - [ ] Unit tests for token generation/validation
   - [ ] Integration tests for version mismatch handling
   - [ ] Load testing (1000 tokens/sec)

**Acceptance Criteria:**
- ✅ Tokens include roles_version claim
- ✅ Version mismatch returns 401 with clear message
- ✅ Refresh token rotation works correctly
- ✅ Performance: Token validation <10ms

**Owner:** Backend Team Lead  
**Reviewer:** Security Engineer

---

### Day 3-4: Separation of Duties (SoD)

**Tasks:**
1. **SoD Validator Implementation**
   - [ ] Define toxic permission combinations in config
   - [ ] Implement permission set validator
   - [ ] Add pre-assignment SoD check
   - [ ] Add runtime SoD validation

2. **Role Management API Updates**
   - [ ] Add SoD check to role creation endpoint
   - [ ] Add SoD check to role assignment endpoint
   - [ ] Return detailed violation messages
   - [ ] Add admin override capability (logged)

3. **Testing**
   - [ ] Unit tests for all toxic combinations
   - [ ] Integration tests for role assignment
   - [ ] Test admin override flow

**Acceptance Criteria:**
- ✅ All 6 toxic combinations detected
- ✅ Role assignment fails with clear error
- ✅ Admin override requires justification
- ✅ All checks logged in audit trail

**Owner:** Senior Backend Engineer  
**Reviewer:** Security Engineer

---

### Day 5: Self-Transaction Prevention

**Tasks:**
1. **Self-Approval Logic**
   - [ ] Implement direct self-approval check
   - [ ] Implement circular approval detection
   - [ ] Implement same-entity check
   - [ ] Implement temporal separation check

2. **API Integration**
   - [ ] Add checks to approval endpoint
   - [ ] Return appropriate error codes
   - [ ] Log all prevention events

3. **Testing**
   - [ ] Test all 4 prevention scenarios
   - [ ] Test edge cases (manager changes, dept transfers)
   - [ ] Performance testing on large org hierarchy

**Acceptance Criteria:**
- ✅ 100% prevention of self-approval
- ✅ Circular approval detected within 30 days
- ✅ Same-entity check works for dept/cost center
- ✅ All attempts logged with context

**Owner:** Backend Engineer  
**Reviewer:** Backend Team Lead

---

## Week 2: Workflow Engine Enhancements

**Goal:** Upgrade workflow engine with versioning, conditional routing, and SLA management

### Day 6-7: Workflow Versioning

**Tasks:**
1. **Database Schema**
   ```sql
   CREATE TABLE workflow_versions (...);
   CREATE TABLE report_workflow_snapshots (...);
   ALTER TABLE reports ADD COLUMN workflow_snapshot_id UUID;
   ```

2. **Workflow Locking**
   - [ ] Capture workflow snapshot on report submission
   - [ ] Store snapshot with report
   - [ ] Implement version resolution logic
   - [ ] Add migration endpoint for in-flight reports

3. **Testing**
   - [ ] Test workflow changes don't affect in-flight
   - [ ] Test force migration with approval
   - [ ] Test rollback scenarios

**Acceptance Criteria:**
- ✅ Submitted reports locked to workflow version
- ✅ Workflow updates don't orphan reports
- ✅ Migration tool works correctly
- ✅ Audit trail captures migrations

**Owner:** Backend Team Lead  
**Reviewer:** Senior Backend Engineer

---

### Day 8-9: SLA & Escalation Engine

**Tasks:**
1. **SLA Tracking**
   - [ ] Add SLA fields to workflow steps
   - [ ] Implement SLA timer service
   - [ ] Create escalation notification system
   - [ ] Add auto-approve logic for low-value

2. **Notification System**
   - [ ] Email notifications at 50%, 75%, 90%
   - [ ] SMS for urgent escalations
   - [ ] Dashboard alerts for approvers
   - [ ] Manager notifications on auto-approve

3. **Testing**
   - [ ] Test SLA calculations
   - [ ] Test escalation triggers
   - [ ] Test auto-approve thresholds
   - [ ] Load test notification system

**Acceptance Criteria:**
- ✅ SLA tracked for all workflow steps
- ✅ Escalations trigger at correct times
- ✅ Auto-approve works for <$100 after 48h
- ✅ Notifications sent reliably

**Owner:** Backend Engineer  
**Reviewer:** Backend Team Lead

---

### Day 10: Conditional Routing Implementation

**Tasks:**
1. **Routing Engine**
   - [ ] Implement amount-based routing
   - [ ] Implement category-based routing
   - [ ] Implement conditional skip logic
   - [ ] Add validation for routing rules

2. **Workflow Builder UI** (if applicable)
   - [ ] Add routing configuration UI
   - [ ] Add condition builder
   - [ ] Add workflow visualization

3. **Testing**
   - [ ] Test all routing scenarios from examples
   - [ ] Test edge cases (boundary values)
   - [ ] Test performance with complex rules

**Acceptance Criteria:**
- ✅ Amount-based routing works correctly
- ✅ Category-based routing works correctly
- ✅ Skip conditions evaluated properly
- ✅ Workflow builder generates valid JSON

**Owner:** Senior Backend Engineer  
**Reviewer:** Backend Team Lead

---

## Week 3: Compliance & Audit

**Goal:** Implement comprehensive audit logging and compliance features

### Day 11-12: Enhanced Audit Logging

**Tasks:**
1. **Database Schema**
   ```sql
   CREATE TABLE audit_log (...);
   CREATE INDEX idx_audit_timestamp ON audit_log(timestamp DESC);
   -- Add all indexes from schema
   ```

2. **Audit Logger Implementation**
   - [ ] Implement chain hash calculation
   - [ ] Add before/after value tracking
   - [ ] Capture IP, user agent, geolocation
   - [ ] Implement integrity verification

3. **Integration**
   - [ ] Add audit logging to all state changes
   - [ ] Add audit logging to admin actions
   - [ ] Add audit logging to security events
   - [ ] Create audit log viewer API

4. **Testing**
   - [ ] Test chain integrity verification
   - [ ] Test tamper detection
   - [ ] Performance test (10000 events/sec)
   - [ ] Storage test (1M+ events)

**Acceptance Criteria:**
- ✅ All actions logged with full context
- ✅ Chain integrity verifiable
- ✅ Before/after values captured
- ✅ Performance <5ms per log entry

**Owner:** Backend Team Lead  
**Reviewer:** Security Engineer

---

### Day 13-14: OAuth2 & Enhanced Authentication

**Tasks:**
1. **Google OAuth Integration**
   - [ ] Implement OAuth2 flow for Google
   - [ ] Handle callback and token exchange
   - [ ] Find or create user from OAuth data
   - [ ] Link OAuth accounts to existing users

2. **Facebook OAuth Integration**
   - [ ] Implement OAuth2 flow for Facebook
   - [ ] Handle callback and token exchange
   - [ ] Handle missing email scenarios
   - [ ] Account linking logic

3. **Session Management**
   - [ ] Implement active sessions tracking
   - [ ] Add session listing endpoint
   - [ ] Add session revocation endpoint
   - [ ] Enforce concurrent session limits

4. **Enhanced Password Security**
   - [ ] Implement account lockout (5 failed attempts)
   - [ ] Add password complexity requirements
   - [ ] Implement password reset flow
   - [ ] Add password history (prevent reuse)

5. **Testing**
   - [ ] Test OAuth flows for both providers
   - [ ] Test account linking scenarios
   - [ ] Test session limit enforcement
   - [ ] Test lockout mechanisms

**Acceptance Criteria:**
- ✅ Google OAuth works end-to-end
- ✅ Facebook OAuth works end-to-end
- ✅ OAuth accounts can link to existing emails
- ✅ Session limits enforced per user
- ✅ Account lockout after 5 failed attempts
- ✅ Password requirements enforced

**Owner:** Backend Engineer  
**Reviewer:** Security Engineer

---

### Day 15: Compliance Features

**Tasks:**
1. **Data Retention**
   - [ ] Implement retention policies
   - [ ] Add archival service
   - [ ] Add anonymization for GDPR
   - [ ] Add data export API

2. **Access Reviews**
   - [ ] Implement 90-day review scheduler
   - [ ] Generate access review reports
   - [ ] Add manager confirmation flow
   - [ ] Implement auto-revocation

3. **Compliance Reports**
   - [ ] SOX compliance report
   - [ ] GDPR compliance report
   - [ ] ISO 27001 access review report
   - [ ] PCI-DSS audit log report

4. **Testing**
   - [ ] Test retention policies
   - [ ] Test anonymization
   - [ ] Test access review flow
   - [ ] Generate sample compliance reports

**Acceptance Criteria:**
- ✅ Retention policies enforced
- ✅ GDPR anonymization works
- ✅ Access reviews generated quarterly
- ✅ Compliance reports accurate

**Owner:** Backend Engineer  
**Reviewer:** Compliance Officer (if available)

---

## Week 4: Testing & Production Deployment

**Goal:** Comprehensive testing, security hardening, and production rollout

### Day 16-17: Security Testing

**Tasks:**
1. **Penetration Testing**
   - [ ] OWASP Top 10 testing
   - [ ] SQL injection testing
   - [ ] XSS testing
   - [ ] CSRF testing
   - [ ] Session hijacking tests
   - [ ] Privilege escalation tests

2. **Security Audit**
   - [ ] Code review by security team
   - [ ] Dependency vulnerability scan
   - [ ] Configuration review
   - [ ] Secrets management audit

3. **Remediation**
   - [ ] Fix critical vulnerabilities
   - [ ] Fix high-priority issues
   - [ ] Document remaining risks

**Acceptance Criteria:**
- ✅ No critical vulnerabilities
- ✅ <3 high-priority issues
- ✅ All OWASP Top 10 mitigated
- ✅ Security sign-off obtained

**Owner:** Security Engineer  
**Reviewer:** CISO

---

### Day 18: Performance & Load Testing

**Tasks:**
1. **Performance Benchmarks**
   - [ ] API response time (<200ms p95)
   - [ ] Token generation (<10ms)
   - [ ] Audit logging (<5ms)
   - [ ] Database query optimization

2. **Load Testing**
   - [ ] 1000 concurrent users
   - [ ] 10000 reports/hour submission
   - [ ] 50000 API requests/minute
   - [ ] SLA escalation at scale

3. **Stress Testing**
   - [ ] Find breaking points
   - [ ] Test failover scenarios
   - [ ] Test recovery procedures

**Acceptance Criteria:**
- ✅ p95 response time <200ms
- ✅ System stable at 1000+ concurrent users
- ✅ No memory leaks over 24h test
- ✅ Graceful degradation under load

**Owner:** DevOps Engineer  
**Reviewer:** Backend Team Lead

---

### Day 19: Integration & E2E Testing

**Tasks:**
1. **End-to-End Workflows**
   - [ ] Complete report submission to posting
   - [ ] Multi-step approval workflows
   - [ ] Emergency expense workflow
   - [ ] International travel workflow
   - [ ] Rejection and return flows

2. **Integration Testing**
   - [ ] Email notification system
   - [ ] SMS notifications
   - [ ] File upload/storage
   - [ ] External API integrations

3. **User Acceptance Testing (UAT)**
   - [ ] Employee role testing
   - [ ] Approver role testing
   - [ ] Finance role testing
   - [ ] Admin role testing

**Acceptance Criteria:**
- ✅ All workflows complete successfully
- ✅ Integrations work reliably
- ✅ UAT sign-off from each role
- ✅ No critical bugs in UAT

**Owner:** QA Engineer  
**Reviewer:** Product Manager

---

### Day 20: Production Deployment

**Pre-Deployment Checklist:**
- [ ] Staging environment fully tested
- [ ] Database migration scripts validated
- [ ] Rollback procedure documented and tested
- [ ] Monitoring and alerts configured
- [ ] Incident response team on standby
- [ ] Communication plan ready
- [ ] Backup taken immediately before migration

**Deployment Steps:**

**Phase 1: Database Migration (2 hours)**
```bash
# 1. Maintenance mode ON
curl -X POST https://api.example.com/admin/maintenance/enable

# 2. Final backup
pg_dump production_db > backup_pre_v3.0.sql

# 3. Run migrations
psql production_db < migrations/v3.0_schema.sql

# 4. Verify migration
psql production_db -c "SELECT version FROM schema_versions ORDER BY applied_at DESC LIMIT 1;"
```

**Phase 2: Application Deployment (1 hour)**
```bash
# 1. Deploy new version (blue-green)
./deploy.sh v3.0 --strategy blue-green

# 2. Health checks
curl https://api.example.com/health

# 3. Smoke tests
npm run smoke-tests

# 4. Switch traffic to new version
./switch_traffic.sh --to blue --percentage 10

# 5. Monitor for 15 minutes
# 6. Gradually increase to 100%
```

**Phase 3: Post-Deployment Verification (30 minutes)**
- [ ] All health checks passing
- [ ] Error rate <0.1%
- [ ] Response times within SLA
- [ ] Audit logs being generated
- [ ] No security alerts
- [ ] Critical workflows tested in production

**Phase 4: User Communication (ongoing)**
- [ ] Email to all users about v3.0 features
- [ ] Admin training session scheduled
- [ ] Documentation updated
- [ ] Support team briefed on changes

**Rollback Trigger Criteria:**
- Error rate >1%
- Critical workflow failure
- Data corruption detected
- Security vulnerability discovered
- Performance degradation >50%

**Rollback Procedure:**
```bash
# 1. Switch traffic back to old version
./switch_traffic.sh --to green --percentage 100

# 2. Restore database if necessary
psql production_db < backup_pre_v3.0.sql

# 3. Investigate issue
# 4. Fix and retry deployment
```

**Owner:** DevOps Engineer  
**Incident Commander:** CTO

---

## Post-Deployment Phase (Days 21-30)

### Week 4+ Monitoring & Stabilization

**Daily Activities:**
- Monitor error rates and performance metrics
- Review security alerts
- Check audit log integrity
- Respond to user feedback
- Address minor bugs

**Weekly Activities:**
- Security incident review
- Performance optimization
- User training sessions
- Documentation updates

**Success Metrics:**
- Uptime >99.9%
- p95 response time <200ms
- Zero security incidents
- User satisfaction score >4/5
- <10 support tickets per day

---

## Risk Management

### High-Priority Risks

| Risk | Probability | Impact | Mitigation | Owner |
|:-----|:-----------|:-------|:-----------|:------|
| Session invalidation breaks user sessions | High | High | Phased rollout, clear communication | Backend Lead |
| Performance degradation under load | Medium | High | Load testing, caching strategy | DevOps |
| Security vulnerability discovered | Low | Critical | Security audit, bug bounty | Security Eng |
| Data migration failure | Low | Critical | Dry runs, backup/restore tested | DevOps |
| Workflow changes break in-flight reports | Medium | Medium | Versioning, migration tool | Backend Lead |
| MFA lockout for Admin users | Medium | High | Recovery procedures, backup codes | Security Eng |

### Medium-Priority Risks

| Risk | Probability | Impact | Mitigation | Owner |
|:-----|:-----------|:-------|:-----------|:------|
| Integration failures (email, SMS) | Medium | Medium | Fallback mechanisms, monitoring | Backend Eng |
| Audit log storage growth | High | Low | Archival strategy, compression | DevOps |
| User adoption resistance | Medium | Medium | Training, documentation | Product Mgr |
| Third-party dependency issues | Low | Medium | Dependency scanning, alternatives | Backend Lead |

---

## Success Criteria

### Technical Success Criteria
- [ ] All acceptance criteria met for each phase
- [ ] Zero critical bugs in production
- [ ] Performance SLAs met (p95 <200ms)
- [ ] Security audit passed
- [ ] 99.9% uptime in first month

### Business Success Criteria
- [ ] All users successfully migrated
- [ ] <5% increase in support tickets
- [ ] Compliance requirements met
- [ ] Stakeholder sign-off obtained
- [ ] User satisfaction >4/5

### Compliance Success Criteria
- [ ] SOX compliance verified
- [ ] GDPR compliance verified
- [ ] ISO 27001 controls implemented
- [ ] PCI-DSS requirements met
- [ ] Audit trail complete and tamper-proof

---

## Resource Allocation

### Team Allocation (Person-Weeks)

| Role | Week 1 | Week 2 | Week 3 | Week 4 | Total |
|:-----|:-------|:-------|:-------|:-------|:------|
| Backend Team Lead | 1.0 | 1.0 | 1.0 | 0.5 | 3.5 |
| Senior Backend Eng | 1.0 | 1.0 | 0.5 | 0.5 | 3.0 |
| Backend Engineer | 1.0 | 1.0 | 1.0 | 0.5 | 3.5 |
| Security Engineer | 0.5 | 0.25 | 0.5 | 1.0 | 2.25 |
| DevOps Engineer | 0.25 | 0.25 | 0.25 | 1.0 | 1.75 |
| QA Engineer | 0.25 | 0.5 | 0.5 | 1.0 | 2.25 |
| Technical Writer | 0.0 | 0.0 | 0.5 | 0.5 | 1.0 |
| **Total** | **4.0** | **4.0** | **4.25** | **5.0** | **17.25** |

### Budget Estimate

| Category | Cost | Notes |
|:---------|:-----|:------|
| Development Labor | $100,000 | 17.25 person-weeks @ $5,800/week |
| Security Audit | $15,000 | Third-party penetration testing |
| Infrastructure | $5,000 | Staging environment for 1 month |
| Tools & Licenses | $2,000 | Testing tools, monitoring |
| Training | $3,000 | User training materials |
| Contingency (20%) | $25,000 | Risk mitigation |
| **Total** | **$150,000** | |

---

## Communication Plan

### Stakeholder Updates

**Weekly Status Reports:**
- Sent every Friday at 5 PM
- Include: Progress, blockers, risks
- Recipients: CTO, Product Manager, Team Leads

**Daily Standups:**
- 15-minute sync at 9:30 AM
- Team members, blockers, plan for day

**Phase Gate Reviews:**
- End of each week
- Demo to stakeholders
- Go/no-go decision for next phase

### User Communication

**Pre-Launch (Week 3):**
- Email announcement of v3.0
- Feature highlights
- Timeline and expected downtime

**Launch Day:**
- Maintenance window notification
- Real-time status updates
- Support contact information

**Post-Launch:**
- "What's new" email
- Training resources
- Feedback survey

---

## Appendices

### Appendix A: Detailed Task Breakdown
See project management tool (Jira/Asana) for granular task breakdown

### Appendix B: Test Plans
See separate document: `Test_Plan_v3.0.md`

### Appendix C: Deployment Runbooks
See separate document: `Deployment_Runbook_v3.0.md`

### Appendix D: Training Materials
See separate document: `User_Training_Guide_v3.0.md`

---

**Document End**
