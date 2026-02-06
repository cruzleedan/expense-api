# Security Implementation Guide v3.0

## Document Information
- **Version:** 3.0
- **Date:** January 27, 2026
- **Related Document:** SRS v3.0
- **Purpose:** Detailed security implementation specifications
- **Audience:** Development team, security engineers, DevOps

**IMPORTANT NOTE:** This document contains Python/Flask code examples for reference and conceptual understanding. For the actual Hono/TypeScript implementation, refer to `Hono_TypeScript_Implementation_v3.0.md` which contains production-ready code for the project stack (Hono, Node.js, TypeScript, PostgreSQL, JOSE).

---

## 1. Session Management Implementation

### 1.1 Version-Based Token Invalidation

#### Database Schema
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    roles_version INT DEFAULT 1 NOT NULL,
    mfa_enabled BOOLEAN DEFAULT false,
    mfa_secret VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    last_used_at TIMESTAMP,
    user_agent TEXT,
    ip_address INET
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_users_roles_version ON users(id, roles_version);
```

#### Token Generation (Python)
```python
import jwt
import uuid
from datetime import datetime, timedelta
from typing import Dict, List

class TokenService:
    def __init__(self, secret_key: str, access_ttl: int = 900, refresh_ttl: int = 604800):
        self.secret_key = secret_key
        self.access_ttl = access_ttl  # 15 minutes
        self.refresh_ttl = refresh_ttl  # 7 days
        
    def generate_access_token(self, user_id: str, roles: List[str], 
                             roles_version: int, permissions: List[str]) -> str:
        """Generate JWT access token with version."""
        now = datetime.utcnow()
        payload = {
            "jti": str(uuid.uuid4()),
            "sub": user_id,
            "roles": roles,
            "roles_version": roles_version,
            "permissions": permissions,
            "iat": now,
            "exp": now + timedelta(seconds=self.access_ttl),
            "type": "access"
        }
        return jwt.encode(payload, self.secret_key, algorithm="HS256")
    
    def generate_refresh_token(self, user_id: str, user_agent: str, 
                              ip_address: str) -> tuple[str, str]:
        """Generate refresh token and return (token, token_id)."""
        token_id = str(uuid.uuid4())
        now = datetime.utcnow()
        payload = {
            "jti": token_id,
            "sub": user_id,
            "iat": now,
            "exp": now + timedelta(seconds=self.refresh_ttl),
            "type": "refresh"
        }
        token = jwt.encode(payload, self.secret_key, algorithm="HS256")
        
        # Store hash in database
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        db.execute("""
            INSERT INTO refresh_tokens 
            (id, user_id, token_hash, expires_at, user_agent, ip_address)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, (token_id, user_id, token_hash, payload["exp"], user_agent, ip_address))
        
        return token, token_id
    
    def validate_access_token(self, token: str) -> Dict:
        """Validate access token and check version."""
        try:
            payload = jwt.decode(token, self.secret_key, algorithms=["HS256"])
            
            # Check version against database
            user = db.fetch_one(
                "SELECT roles_version FROM users WHERE id = %s",
                (payload["sub"],)
            )
            
            if not user:
                raise ValueError("User not found")
            
            if user["roles_version"] != payload["roles_version"]:
                raise ValueError("Token version mismatch - permissions changed")
            
            return payload
            
        except jwt.ExpiredSignatureError:
            raise ValueError("Token expired")
        except jwt.InvalidTokenError:
            raise ValueError("Invalid token")
```

#### Version Increment on Role Change
```python
def update_user_roles(user_id: str, new_roles: List[str], admin_id: str):
    """Update user roles and increment version to invalidate all sessions."""
    with db.transaction():
        # Increment roles_version
        db.execute("""
            UPDATE users 
            SET roles_version = roles_version + 1,
                updated_at = NOW()
            WHERE id = %s
        """, (user_id,))
        
        # Update role assignments
        db.execute("DELETE FROM user_roles WHERE user_id = %s", (user_id,))
        for role in new_roles:
            db.execute("""
                INSERT INTO user_roles (user_id, role_id)
                SELECT %s, id FROM roles WHERE name = %s
            """, (user_id, role))
        
        # Audit log
        log_audit_event(
            actor_id=admin_id,
            action="user.roles.updated",
            resource_type="user",
            resource_id=user_id,
            changes={"roles": {"to": new_roles}},
            metadata={"invalidated_sessions": True}
        )
        
        # Optional: Notify user
        send_notification(
            user_id=user_id,
            type="security_alert",
            message="Your account permissions have been updated. Please log in again."
        )
```

---

### 1.2 Separation of Duties (SoD) Enforcement

#### Toxic Combination Detection
```python
from typing import Set, List, Tuple

class SoDValidator:
    # Define toxic combinations
    TOXIC_COMBINATIONS = [
        ({"report.edit.all", "report.approve"}, "Can modify and approve reports"),
        ({"report.approve", "report.post"}, "Can bypass financial review"),
        ({"role.create", "role.assign.admin"}, "Can grant admin privileges"),
        ({"user.impersonate", "report.approve"}, "Can impersonate to approve"),
        ({"audit.export", "report.edit.all"}, "Can tamper and hide evidence"),
        ({"workflow.override", "report.approve"}, "Can bypass approval process"),
    ]
    
    def validate_role_permissions(self, permissions: Set[str]) -> List[str]:
        """Check if permission set contains toxic combinations."""
        violations = []
        
        for toxic_set, reason in self.TOXIC_COMBINATIONS:
            if toxic_set.issubset(permissions):
                violations.append(f"SoD Violation: {reason} ({', '.join(toxic_set)})")
        
        return violations
    
    def validate_user_effective_permissions(self, user_id: str) -> List[str]:
        """Check user's effective permissions across all roles."""
        # Get all permissions from all user's roles
        permissions = db.fetch_all("""
            SELECT DISTINCT p.name
            FROM user_roles ur
            JOIN role_permissions rp ON ur.role_id = rp.role_id
            JOIN permissions p ON rp.permission_id = p.id
            WHERE ur.user_id = %s AND ur.active = true
        """, (user_id,))
        
        permission_set = {p["name"] for p in permissions}
        return self.validate_role_permissions(permission_set)
    
    def can_assign_role(self, admin_id: str, role_id: str, target_user_id: str) -> Tuple[bool, str]:
        """Check if admin can assign role without creating SoD violation."""
        # Get target user's current permissions
        current_perms = self._get_user_permissions(target_user_id)
        
        # Get permissions from role being assigned
        new_role_perms = self._get_role_permissions(role_id)
        
        # Check combined permission set
        combined = current_perms | new_role_perms
        violations = self.validate_role_permissions(combined)
        
        if violations:
            return False, f"Cannot assign role: {'; '.join(violations)}"
        
        return True, "OK"
```

#### API Endpoint with SoD Check
```python
@app.patch("/users/{user_id}/roles")
@requires_permission("role.assign")
def assign_user_roles(user_id: str, roles: List[str], admin: User):
    """Assign roles to user with SoD validation."""
    validator = SoDValidator()
    
    # Special check for admin role assignment
    if "admin" in roles and not admin.has_permission("role.assign.admin"):
        raise PermissionDenied("Cannot assign admin role")
    
    # Get permissions for all roles being assigned
    all_permissions = set()
    for role_name in roles:
        role_perms = db.fetch_all("""
            SELECT p.name 
            FROM role_permissions rp
            JOIN permissions p ON rp.permission_id = p.id
            JOIN roles r ON rp.role_id = r.id
            WHERE r.name = %s
        """, (role_name,))
        all_permissions.update(p["name"] for p in role_perms)
    
    # Validate combined permissions
    violations = validator.validate_role_permissions(all_permissions)
    if violations:
        raise BadRequest(f"SoD violations detected: {'; '.join(violations)}")
    
    # Update roles and increment version
    update_user_roles(user_id, roles, admin.id)
    
    return {"message": "Roles updated successfully", "roles": roles}
```

---

### 1.3 Self-Transaction Prevention

#### Self-Approval Check
```python
def can_approve_report(approver_id: str, report_id: str) -> Tuple[bool, str]:
    """Comprehensive check if user can approve report."""
    report = db.fetch_one("""
        SELECT 
            r.user_id as submitter_id,
            r.department_id,
            r.cost_center_id,
            r.amount,
            r.created_at,
            array_agg(ra.actor_id) as previous_actors
        FROM reports r
        LEFT JOIN report_audit ra ON r.id = ra.report_id
        WHERE r.id = %s
        GROUP BY r.id
    """, (report_id,))
    
    if not report:
        return False, "Report not found"
    
    # Check 1: Direct self-approval
    if report["submitter_id"] == approver_id:
        log_security_event("self_approval_attempt", approver_id, report_id)
        return False, "Cannot approve own report"
    
    # Check 2: Previous interaction in workflow
    if approver_id in (report["previous_actors"] or []):
        return False, "Cannot approve report you've already acted on"
    
    # Check 3: Same department/cost center rules
    if report["amount"] > 1000:
        approver_dept = db.fetch_value(
            "SELECT department_id FROM users WHERE id = %s",
            (approver_id,)
        )
        if approver_dept == report["department_id"]:
            return False, "Cannot approve departmental report over $1,000"
    
    # Check 4: Circular approval (last 30 days)
    circular = db.fetch_one("""
        SELECT 1 FROM report_audit ra1
        JOIN report_audit ra2 ON ra1.report_id = ra2.report_id
        JOIN reports r ON ra1.report_id = r.id
        WHERE ra1.actor_id = %s 
        AND ra2.actor_id = %s
        AND r.user_id = %s
        AND ra1.action = 'approve'
        AND ra1.timestamp > NOW() - INTERVAL '30 days'
        LIMIT 1
    """, (approver_id, report["submitter_id"], approver_id))
    
    if circular:
        return False, "Circular approval detected: you recently approved submitter's report"
    
    return True, "OK"


@app.post("/reports/{report_id}/approve")
@requires_permission("report.approve")
def approve_report(report_id: str, comment: str, user: User):
    """Approve report with comprehensive checks."""
    # Check if user can approve
    can_approve, reason = can_approve_report(user.id, report_id)
    if not can_approve:
        log_audit_event(
            actor_id=user.id,
            action="report.approve.denied",
            resource_type="report",
            resource_id=report_id,
            metadata={"denial_reason": reason}
        )
        raise Forbidden(reason)
    
    # Proceed with approval
    workflow_engine.approve_step(report_id, user.id, comment)
    
    return {"message": "Report approved", "report_id": report_id}
```

---

## 2. Enhanced Password Security

### 2.1 Password Requirements

**Implementation:**
- Minimum 12 characters
- Must contain: uppercase, lowercase, number, special character
- Cannot contain username or email
- Cannot be one of common 10,000 passwords
- Cannot match last 5 passwords (password history)

### 2.2 Account Lockout

**Implementation:**
- 5 failed login attempts trigger lockout
- Lockout duration: 15 minutes
- Failed attempts reset on successful login
- Lockout status visible to user with unlock time

### 2.3 OAuth2 Security

**Google OAuth:**
- Validate state parameter to prevent CSRF
- Verify token signature
- Check token expiration
- Validate redirect URI

**Facebook OAuth:**
- Validate state parameter
- Check app secret proof
- Verify token with Facebook
- Handle missing email gracefully

---

## 3. Multi-Factor Authentication (Future Enhancement)

**Note:** MFA is not currently implemented but is planned for a future release. When implemented, it should include:

- **TOTP Support:** Google Authenticator, Authy
- **Backup Codes:** 10 single-use codes
- **Mandatory for Admin/Finance roles**
- **Optional for other roles**
- **Recovery process** with identity verification

**Priority:** High for production deployment with financial data
**Estimated Effort:** 2-3 weeks
**Dependencies:** User notification system, QR code generation library

---

## 4. Separation of Duties (SoD) Enforcement

### 2.1 MFA Setup Flow

```python
import pyotp
import qrcode
import io
import base64

class MFAService:
    def setup_totp(self, user_id: str) -> Dict:
        """Initialize TOTP for user."""
        # Generate secret
        secret = pyotp.random_base32()
        
        # Store encrypted secret
        db.execute("""
            UPDATE users 
            SET mfa_secret = pgp_sym_encrypt(%s, %s),
                mfa_enabled = false  -- Not enabled until verified
            WHERE id = %s
        """, (secret, settings.ENCRYPTION_KEY, user_id))
        
        # Generate QR code
        user = db.fetch_one("SELECT email FROM users WHERE id = %s", (user_id,))
        totp = pyotp.TOTP(secret)
        provisioning_uri = totp.provisioning_uri(
            name=user["email"],
            issuer_name="Expense System"
        )
        
        # Create QR code image
        qr = qrcode.QRCode(version=1, box_size=10, border=5)
        qr.add_data(provisioning_uri)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        
        # Convert to base64
        buffer = io.BytesIO()
        img.save(buffer, format='PNG')
        img_base64 = base64.b64encode(buffer.getvalue()).decode()
        
        # Generate backup codes
        backup_codes = [self._generate_backup_code() for _ in range(10)]
        self._store_backup_codes(user_id, backup_codes)
        
        return {
            "secret": secret,
            "qr_code": f"data:image/png;base64,{img_base64}",
            "backup_codes": backup_codes
        }
    
    def verify_totp_setup(self, user_id: str, code: str) -> bool:
        """Verify TOTP code and enable MFA."""
        secret = db.fetch_value("""
            SELECT pgp_sym_decrypt(mfa_secret::bytea, %s)
            FROM users WHERE id = %s
        """, (settings.ENCRYPTION_KEY, user_id))
        
        if not secret:
            return False
        
        totp = pyotp.TOTP(secret.decode())
        if totp.verify(code, valid_window=1):
            db.execute("""
                UPDATE users SET mfa_enabled = true WHERE id = %s
            """, (user_id,))
            
            log_audit_event(
                actor_id=user_id,
                action="mfa.enabled",
                resource_type="user",
                resource_id=user_id
            )
            return True
        
        return False
    
    def verify_mfa(self, user_id: str, code: str) -> bool:
        """Verify MFA code during login."""
        secret = db.fetch_value("""
            SELECT pgp_sym_decrypt(mfa_secret::bytea, %s)
            FROM users WHERE id = %s AND mfa_enabled = true
        """, (settings.ENCRYPTION_KEY, user_id))
        
        if not secret:
            return False
        
        # Try TOTP verification
        totp = pyotp.TOTP(secret.decode())
        if totp.verify(code, valid_window=1):
            return True
        
        # Try backup code
        return self._verify_backup_code(user_id, code)
    
    def _generate_backup_code(self) -> str:
        """Generate 8-digit backup code."""
        return ''.join(random.choices(string.digits, k=8))
    
    def _store_backup_codes(self, user_id: str, codes: List[str]):
        """Store hashed backup codes."""
        for code in codes:
            code_hash = hashlib.sha256(code.encode()).hexdigest()
            db.execute("""
                INSERT INTO mfa_backup_codes (user_id, code_hash, created_at)
                VALUES (%s, %s, NOW())
            """, (user_id, code_hash))
    
    def _verify_backup_code(self, user_id: str, code: str) -> bool:
        """Verify and consume backup code."""
        code_hash = hashlib.sha256(code.encode()).hexdigest()
        result = db.execute("""
            DELETE FROM mfa_backup_codes
            WHERE user_id = %s AND code_hash = %s AND used_at IS NULL
            RETURNING id
        """, (user_id, code_hash))
        
        if result:
            log_audit_event(
                actor_id=user_id,
                action="mfa.backup_code_used",
                resource_type="user",
                resource_id=user_id
            )
            return True
        
        return False
```

### 2.2 MFA-Protected Login Flow

```python
@app.post("/auth/login")
async def login(username: str, password: str, mfa_code: Optional[str] = None):
    """Login with MFA support."""
    # Verify credentials
    user = authenticate_user(username, password)
    if not user:
        await asyncio.sleep(random.uniform(0.5, 1.5))  # Prevent timing attacks
        raise Unauthorized("Invalid credentials")
    
    # Check if MFA required
    if user.mfa_enabled:
        if not mfa_code:
            return {
                "requires_mfa": True,
                "mfa_token": generate_temp_token(user.id, duration=300)  # 5 min
            }
        
        # Verify MFA code
        mfa_service = MFAService()
        if not mfa_service.verify_mfa(user.id, mfa_code):
            log_security_event("mfa_verification_failed", user.id)
            raise Unauthorized("Invalid MFA code")
    
    # Generate tokens
    token_service = TokenService()
    access_token = token_service.generate_access_token(
        user_id=user.id,
        roles=user.roles,
        roles_version=user.roles_version,
        permissions=user.permissions
    )
    refresh_token, refresh_id = token_service.generate_refresh_token(
        user_id=user.id,
        user_agent=request.headers.get("User-Agent"),
        ip_address=request.client.host
    )
    
    # Update last login
    db.execute("""
        UPDATE users SET last_login_at = NOW() WHERE id = %s
    """, (user.id,))
    
    log_audit_event(
        actor_id=user.id,
        action="auth.login",
        resource_type="session",
        resource_id=refresh_id,
        metadata={
            "ip_address": request.client.host,
            "user_agent": request.headers.get("User-Agent"),
            "mfa_used": user.mfa_enabled
        }
    )
    
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "Bearer",
        "expires_in": 900
    }
```

---

## 3. Enhanced Audit Logging

### 3.1 Comprehensive Audit Schema

```sql
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
    timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    
    -- Actor information
    actor_id UUID REFERENCES users(id),
    actor_username VARCHAR(255),
    actor_roles TEXT[],
    ip_address INET,
    user_agent TEXT,
    session_id UUID,
    geolocation JSONB,
    
    -- Action details
    action VARCHAR(255) NOT NULL,
    action_category VARCHAR(100),
    
    -- Resource information
    resource_type VARCHAR(100) NOT NULL,
    resource_id VARCHAR(255),
    resource_version INT,
    
    -- Changes (before/after)
    changes JSONB,
    
    -- Metadata
    metadata JSONB,
    
    -- Integrity
    data_hash VARCHAR(255) NOT NULL,
    chain_hash VARCHAR(255),
    previous_event_id UUID,
    
    -- Compliance flags
    is_sensitive BOOLEAN DEFAULT false,
    retention_years INT DEFAULT 7,
    
    CONSTRAINT fk_previous_event 
        FOREIGN KEY (previous_event_id) 
        REFERENCES audit_log(event_id)
);

CREATE INDEX idx_audit_timestamp ON audit_log(timestamp DESC);
CREATE INDEX idx_audit_actor ON audit_log(actor_id, timestamp DESC);
CREATE INDEX idx_audit_resource ON audit_log(resource_type, resource_id);
CREATE INDEX idx_audit_action ON audit_log(action, timestamp DESC);
CREATE INDEX idx_audit_chain ON audit_log(previous_event_id);
```

### 3.2 Audit Logging Implementation

```python
import hashlib
import json
from typing import Dict, Any, Optional

class AuditLogger:
    def log_event(self, 
                  actor_id: str,
                  action: str,
                  resource_type: str,
                  resource_id: str,
                  changes: Optional[Dict] = None,
                  metadata: Optional[Dict] = None,
                  ip_address: Optional[str] = None,
                  user_agent: Optional[str] = None,
                  session_id: Optional[str] = None) -> str:
        """Log audit event with integrity chain."""
        
        # Get actor details
        actor = db.fetch_one("""
            SELECT username, 
                   array_agg(r.name) as roles
            FROM users u
            LEFT JOIN user_roles ur ON u.id = ur.user_id
            LEFT JOIN roles r ON ur.role_id = r.id
            WHERE u.id = %s
            GROUP BY u.username
        """, (actor_id,))
        
        # Get previous event for chain
        previous_event = db.fetch_one("""
            SELECT event_id, chain_hash
            FROM audit_log
            ORDER BY timestamp DESC
            LIMIT 1
        """)
        
        # Prepare event data
        event_id = str(uuid.uuid4())
        timestamp = datetime.utcnow()
        
        # Calculate data hash
        hash_input = {
            "event_id": event_id,
            "timestamp": timestamp.isoformat(),
            "actor_id": actor_id,
            "action": action,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "changes": changes,
            "metadata": metadata
        }
        data_hash = hashlib.sha256(
            json.dumps(hash_input, sort_keys=True).encode()
        ).hexdigest()
        
        # Calculate chain hash
        if previous_event:
            chain_input = f"{previous_event['chain_hash']}|{data_hash}"
        else:
            chain_input = data_hash
        chain_hash = hashlib.sha256(chain_input.encode()).hexdigest()
        
        # Determine sensitivity
        sensitive_actions = [
            "user.delete", "role.assign.admin", "audit.export",
            "emergency.access", "user.impersonate", "system.restore"
        ]
        is_sensitive = action in sensitive_actions
        
        # Insert audit log
        db.execute("""
            INSERT INTO audit_log (
                event_id, timestamp, actor_id, actor_username, actor_roles,
                ip_address, user_agent, session_id,
                action, resource_type, resource_id,
                changes, metadata,
                data_hash, chain_hash, previous_event_id,
                is_sensitive
            ) VALUES (
                %s, %s, %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s,
                %s, %s,
                %s, %s, %s,
                %s
            )
        """, (
            event_id, timestamp, actor_id, actor["username"], actor["roles"],
            ip_address, user_agent, session_id,
            action, resource_type, resource_id,
            json.dumps(changes) if changes else None,
            json.dumps(metadata) if metadata else None,
            data_hash, chain_hash,
            previous_event["event_id"] if previous_event else None,
            is_sensitive
        ))
        
        return event_id
    
    def verify_chain_integrity(self, start_date: datetime, end_date: datetime) -> Dict:
        """Verify audit log chain integrity for date range."""
        events = db.fetch_all("""
            SELECT event_id, data_hash, chain_hash, previous_event_id
            FROM audit_log
            WHERE timestamp BETWEEN %s AND %s
            ORDER BY timestamp ASC
        """, (start_date, end_date))
        
        results = {
            "total_events": len(events),
            "verified": 0,
            "violations": []
        }
        
        previous_hash = None
        for event in events:
            expected_chain_input = f"{previous_hash}|{event['data_hash']}" if previous_hash else event['data_hash']
            expected_chain_hash = hashlib.sha256(expected_chain_input.encode()).hexdigest()
            
            if event["chain_hash"] == expected_chain_hash:
                results["verified"] += 1
            else:
                results["violations"].append({
                    "event_id": event["event_id"],
                    "expected_hash": expected_chain_hash,
                    "actual_hash": event["chain_hash"]
                })
            
            previous_hash = event["chain_hash"]
        
        return results
```

---

## 4. Input Validation & Sanitization

### 4.1 Request Validation

```python
from pydantic import BaseModel, validator, constr, confloat
from typing import List, Optional
from datetime import date

class CreateReportRequest(BaseModel):
    title: constr(min_length=3, max_length=200)
    description: constr(max_length=2000)
    amount: confloat(gt=0, le=1000000)
    currency: constr(regex=r'^[A-Z]{3}$')
    expense_category: str
    expense_date: date
    business_purpose: constr(min_length=10, max_length=1000)
    attachments: Optional[List[str]] = []
    
    @validator('expense_date')
    def validate_date(cls, v):
        if v > date.today():
            raise ValueError('Expense date cannot be in the future')
        if v < date.today().replace(year=date.today().year - 2):
            raise ValueError('Expense date cannot be more than 2 years old')
        return v
    
    @validator('expense_category')
    def validate_category(cls, v):
        valid_categories = [
            'meals', 'travel', 'lodging', 'entertainment',
            'office_supplies', 'equipment', 'software', 'services'
        ]
        if v not in valid_categories:
            raise ValueError(f'Invalid category. Must be one of: {valid_categories}')
        return v
    
    @validator('attachments')
    def validate_attachments(cls, v):
        if len(v) > 10:
            raise ValueError('Maximum 10 attachments allowed')
        return v


class ApproveReportRequest(BaseModel):
    comment: constr(min_length=10, max_length=500)
    
    @validator('comment')
    def sanitize_comment(cls, v):
        # Remove potentially dangerous characters
        import re
        sanitized = re.sub(r'[<>\"\'&]', '', v)
        return sanitized.strip()
```

### 4.2 File Upload Validation

```python
import magic
from pathlib import Path

class FileValidator:
    ALLOWED_TYPES = {
        'application/pdf': ['.pdf'],
        'image/jpeg': ['.jpg', '.jpeg'],
        'image/png': ['.png'],
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']
    }
    
    MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
    
    def validate_file(self, file: UploadFile) -> tuple[bool, str]:
        """Validate uploaded file."""
        # Check file size
        file.file.seek(0, 2)
        size = file.file.tell()
        file.file.seek(0)
        
        if size > self.MAX_FILE_SIZE:
            return False, f"File too large. Maximum size: {self.MAX_FILE_SIZE / 1024 / 1024}MB"
        
        # Check MIME type
        mime = magic.from_buffer(file.file.read(2048), mime=True)
        file.file.seek(0)
        
        if mime not in self.ALLOWED_TYPES:
            return False, f"Invalid file type: {mime}"
        
        # Check file extension
        ext = Path(file.filename).suffix.lower()
        if ext not in self.ALLOWED_TYPES[mime]:
            return False, f"File extension {ext} doesn't match type {mime}"
        
        # Scan for viruses (using ClamAV)
        if not self._scan_virus(file):
            return False, "File failed virus scan"
        
        return True, "OK"
    
    def _scan_virus(self, file: UploadFile) -> bool:
        """Scan file for viruses using ClamAV."""
        import pyclamd
        cd = pyclamd.ClamdUnixSocket()
        
        # Scan file
        result = cd.scan_stream(file.file.read())
        file.file.seek(0)
        
        return result is None  # None means no virus found
    
    def strip_metadata(self, file_path: str, mime_type: str):
        """Remove EXIF and other metadata from files."""
        if mime_type.startswith('image/'):
            from PIL import Image
            img = Image.open(file_path)
            
            # Remove EXIF data
            data = list(img.getdata())
            image_without_exif = Image.new(img.mode, img.size)
            image_without_exif.putdata(data)
            image_without_exif.save(file_path)
```

---

## 5. Rate Limiting

### 5.1 Redis-Based Rate Limiter

```python
import redis
from datetime import datetime, timedelta

class RateLimiter:
    def __init__(self, redis_client: redis.Redis):
        self.redis = redis_client
    
    def check_rate_limit(self, 
                        identifier: str,
                        limit: int,
                        window_seconds: int,
                        action: str = "api") -> tuple[bool, dict]:
        """
        Check if request is within rate limit.
        Returns (allowed, headers)
        """
        key = f"rate_limit:{action}:{identifier}"
        now = datetime.utcnow()
        window_start = now - timedelta(seconds=window_seconds)
        
        # Remove old entries
        self.redis.zremrangebyscore(key, 0, window_start.timestamp())
        
        # Count requests in window
        request_count = self.redis.zcard(key)
        
        # Check limit
        if request_count >= limit:
            # Get oldest request to calculate reset time
            oldest = self.redis.zrange(key, 0, 0, withscores=True)
            if oldest:
                reset_time = oldest[0][1] + window_seconds
                return False, {
                    "X-RateLimit-Limit": str(limit),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(int(reset_time)),
                    "Retry-After": str(int(reset_time - now.timestamp()))
                }
        
        # Add current request
        self.redis.zadd(key, {str(now.timestamp()): now.timestamp()})
        self.redis.expire(key, window_seconds)
        
        return True, {
            "X-RateLimit-Limit": str(limit),
            "X-RateLimit-Remaining": str(limit - request_count - 1),
            "X-RateLimit-Reset": str(int((now + timedelta(seconds=window_seconds)).timestamp()))
        }


# Middleware implementation
@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    """Apply rate limiting to requests."""
    limiter = RateLimiter(redis_client)
    
    # Get identifier (user ID or IP)
    identifier = request.state.user.id if hasattr(request.state, 'user') else request.client.host
    
    # Different limits for different endpoints
    if request.url.path.startswith("/auth/"):
        limit, window = 5, 900  # 5 requests per 15 minutes
    else:
        limit, window = 100, 60  # 100 requests per minute
    
    allowed, headers = limiter.check_rate_limit(identifier, limit, window)
    
    if not allowed:
        return JSONResponse(
            status_code=429,
            content={"error": "Rate limit exceeded"},
            headers=headers
        )
    
    response = await call_next(request)
    
    # Add rate limit headers
    for key, value in headers.items():
        response.headers[key] = value
    
    return response
```

---

## 6. Encryption

### 6.1 Data at Rest Encryption

```python
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2
import base64

class EncryptionService:
    def __init__(self, master_key: str):
        # Derive encryption key from master key
        kdf = PBKDF2(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b'expense_system_salt',  # In production, use random salt per environment
            iterations=100000,
        )
        key = base64.urlsafe_b64encode(kdf.derive(master_key.encode()))
        self.cipher = Fernet(key)
    
    def encrypt(self, data: str) -> str:
        """Encrypt sensitive data."""
        return self.cipher.encrypt(data.encode()).decode()
    
    def decrypt(self, encrypted_data: str) -> str:
        """Decrypt sensitive data."""
        return self.cipher.decrypt(encrypted_data.encode()).decode()


# Usage in database operations
def store_sensitive_field(user_id: str, field_name: str, value: str):
    """Store encrypted sensitive field."""
    encryption = EncryptionService(settings.MASTER_KEY)
    encrypted_value = encryption.encrypt(value)
    
    db.execute(f"""
        UPDATE users 
        SET {field_name}_encrypted = %s 
        WHERE id = %s
    """, (encrypted_value, user_id))
```

---

## Appendices

### Appendix A: Security Testing Checklist
- [ ] Penetration testing (OWASP Top 10)
- [ ] SQL injection testing
- [ ] XSS testing
- [ ] CSRF protection verification
- [ ] Session hijacking prevention
- [ ] Rate limiting effectiveness
- [ ] MFA bypass attempts
- [ ] Privilege escalation testing
- [ ] Audit log tampering tests
- [ ] Encryption strength validation

### Appendix B: Security Monitoring
- Failed login attempts (>5 in 15 min)
- MFA failures (>3 consecutive)
- SoD violation attempts
- Self-approval attempts
- Unusual API patterns
- Geographic anomalies
- Token version mismatches
- Audit chain integrity failures

### Appendix C: Incident Response Plan
See separate document: `Security_Incident_Response_v3.0.md`

---

**Document End**
