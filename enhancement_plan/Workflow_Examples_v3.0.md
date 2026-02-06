# Workflow Configuration Examples v3.0

## Document Information
- **Version:** 3.0
- **Date:** January 27, 2026
- **Related Document:** SRS v3.0
- **Purpose:** Real-world workflow configuration patterns and templates

---

## 1. Basic Workflows

### 1.1 Simple Single-Step Approval

**Use Case:** Small purchases under $500 requiring only direct manager approval

```json
{
  "workflow_id": "wf_simple_single",
  "name": "Single Approval - Direct Manager",
  "description": "One-step approval for routine expenses under $500",
  "version": 1,
  "active": true,
  "conditions": {
    "amount_max": 500,
    "expense_categories": ["office_supplies", "meals", "local_transport"]
  },
  "steps": [
    {
      "step_number": 1,
      "name": "Manager Approval",
      "target_type": "relationship",
      "target_value": "direct_manager",
      "required_action": "approve",
      "sla_hours": 48,
      "escalation": {
        "enabled": true,
        "target_type": "relationship",
        "target_value": "skip_level_manager",
        "notify_at_hours": [24, 40],
        "auto_approve_after_hours": null
      },
      "rejection_policy": {
        "requires_comment": true,
        "min_comment_length": 10,
        "requires_category": true,
        "available_categories": [
          "missing_receipt",
          "policy_violation",
          "duplicate_expense",
          "insufficient_detail",
          "budget_unavailable"
        ]
      }
    }
  ],
  "on_return": {
    "policy": "hard_restart",
    "clear_approvals": true,
    "notify_previous_approvers": true
  }
}
```

---

### 1.2 Two-Tier Approval

**Use Case:** Mid-range expenses ($500-$5,000) requiring manager and finance approval

```json
{
  "workflow_id": "wf_two_tier",
  "name": "Two-Tier Approval - Manager + Finance",
  "description": "Two-step approval for moderate expenses",
  "version": 2,
  "active": true,
  "conditions": {
    "amount_min": 500,
    "amount_max": 5000,
    "expense_categories": ["*"]
  },
  "steps": [
    {
      "step_number": 1,
      "name": "Manager Review",
      "target_type": "relationship",
      "target_value": "direct_manager",
      "required_action": "approve",
      "sla_hours": 48,
      "escalation": {
        "enabled": true,
        "target_type": "relationship",
        "target_value": "skip_level_manager",
        "notify_at_hours": [36],
        "auto_approve_after_hours": null
      }
    },
    {
      "step_number": 2,
      "name": "Finance Verification",
      "target_type": "role",
      "target_value": "finance",
      "required_action": "approve",
      "sla_hours": 72,
      "escalation": {
        "enabled": true,
        "target_type": "role",
        "target_value": "finance_director",
        "notify_at_hours": [48, 60],
        "auto_approve_after_hours": null
      },
      "validation_rules": [
        {
          "field": "attachments",
          "condition": "count_min",
          "value": 1,
          "error_message": "At least one receipt required for amounts over $500"
        },
        {
          "field": "business_purpose",
          "condition": "not_empty",
          "error_message": "Detailed business purpose required"
        }
      ]
    }
  ],
  "on_return": {
    "policy": "hard_restart",
    "clear_approvals": true,
    "notify_previous_approvers": true
  }
}
```

---

## 2. Complex Multi-Path Workflows

### 2.1 Amount-Based Routing

**Use Case:** Different approval paths based on expense amount

```json
{
  "workflow_id": "wf_amount_tiered",
  "name": "Tiered Approval by Amount",
  "description": "Dynamic routing based on expense amount",
  "version": 1,
  "active": true,
  "routing_logic": "amount_based",
  "paths": [
    {
      "path_id": "path_small",
      "name": "Small Expenses (<$100)",
      "conditions": {
        "amount_max": 100
      },
      "steps": [
        {
          "step_number": 1,
          "name": "Auto-Approve",
          "target_type": "system",
          "target_value": "auto_approve",
          "sla_hours": 1
        }
      ]
    },
    {
      "path_id": "path_medium",
      "name": "Medium Expenses ($100-$1,000)",
      "conditions": {
        "amount_min": 100,
        "amount_max": 1000
      },
      "steps": [
        {
          "step_number": 1,
          "name": "Manager Approval",
          "target_type": "relationship",
          "target_value": "direct_manager",
          "sla_hours": 48
        }
      ]
    },
    {
      "path_id": "path_large",
      "name": "Large Expenses ($1,000-$10,000)",
      "conditions": {
        "amount_min": 1000,
        "amount_max": 10000
      },
      "steps": [
        {
          "step_number": 1,
          "name": "Manager Approval",
          "target_type": "relationship",
          "target_value": "direct_manager",
          "sla_hours": 48
        },
        {
          "step_number": 2,
          "name": "Finance Approval",
          "target_type": "role",
          "target_value": "finance",
          "sla_hours": 72
        },
        {
          "step_number": 3,
          "name": "Department Head Approval",
          "target_type": "relationship",
          "target_value": "department_head",
          "sla_hours": 96
        }
      ]
    },
    {
      "path_id": "path_very_large",
      "name": "Very Large Expenses (>$10,000)",
      "conditions": {
        "amount_min": 10000
      },
      "steps": [
        {
          "step_number": 1,
          "name": "Manager Pre-Approval",
          "target_type": "relationship",
          "target_value": "direct_manager",
          "sla_hours": 24
        },
        {
          "step_number": 2,
          "name": "Finance Director Review",
          "target_type": "role",
          "target_value": "finance_director",
          "sla_hours": 72
        },
        {
          "step_number": 3,
          "name": "Department Head Approval",
          "target_type": "relationship",
          "target_value": "department_head",
          "sla_hours": 96
        },
        {
          "step_number": 4,
          "name": "CFO Approval",
          "target_type": "role",
          "target_value": "cfo",
          "sla_hours": 120
        }
      ]
    }
  ]
}
```

---

### 2.2 Category-Based Routing

**Use Case:** Different workflows for travel, equipment, and services

```json
{
  "workflow_id": "wf_category_based",
  "name": "Category-Specific Workflows",
  "description": "Route based on expense category",
  "version": 1,
  "active": true,
  "routing_logic": "category_based",
  "paths": [
    {
      "path_id": "path_travel",
      "name": "Travel Expenses",
      "conditions": {
        "expense_categories": ["flights", "hotels", "car_rental", "per_diem"]
      },
      "steps": [
        {
          "step_number": 1,
          "name": "Manager Approval",
          "target_type": "relationship",
          "target_value": "direct_manager",
          "sla_hours": 48
        },
        {
          "step_number": 2,
          "name": "Travel Coordinator Review",
          "target_type": "role",
          "target_value": "travel_coordinator",
          "sla_hours": 24,
          "validation_rules": [
            {
              "field": "policy_compliance",
              "condition": "check_travel_policy",
              "error_message": "Travel does not comply with corporate policy"
            }
          ]
        },
        {
          "step_number": 3,
          "name": "Finance Approval",
          "target_type": "role",
          "target_value": "finance",
          "sla_hours": 72,
          "skip_if": {
            "field": "amount",
            "condition": "less_than",
            "value": 500
          }
        }
      ]
    },
    {
      "path_id": "path_equipment",
      "name": "Equipment Purchases",
      "conditions": {
        "expense_categories": ["computers", "software", "hardware", "furniture"]
      },
      "steps": [
        {
          "step_number": 1,
          "name": "Manager Approval",
          "target_type": "relationship",
          "target_value": "direct_manager",
          "sla_hours": 48
        },
        {
          "step_number": 2,
          "name": "IT Approval",
          "target_type": "role",
          "target_value": "it_procurement",
          "sla_hours": 72,
          "validation_rules": [
            {
              "field": "vendor",
              "condition": "in_approved_list",
              "error_message": "Vendor not in approved IT vendor list"
            }
          ]
        },
        {
          "step_number": 3,
          "name": "Finance Approval",
          "target_type": "role",
          "target_value": "finance",
          "sla_hours": 96,
          "required_if": {
            "field": "amount",
            "condition": "greater_than",
            "value": 1000
          }
        }
      ]
    },
    {
      "path_id": "path_services",
      "name": "Professional Services",
      "conditions": {
        "expense_categories": ["consulting", "legal", "contractor", "training"]
      },
      "steps": [
        {
          "step_number": 1,
          "name": "Manager Approval",
          "target_type": "relationship",
          "target_value": "direct_manager",
          "sla_hours": 48
        },
        {
          "step_number": 2,
          "name": "Department Head Budget Approval",
          "target_type": "relationship",
          "target_value": "department_head",
          "sla_hours": 72
        },
        {
          "step_number": 3,
          "name": "Legal Review",
          "target_type": "role",
          "target_value": "legal",
          "sla_hours": 120,
          "required_if": {
            "field": "requires_contract",
            "condition": "equals",
            "value": true
          }
        },
        {
          "step_number": 4,
          "name": "Finance Approval",
          "target_type": "role",
          "target_value": "finance",
          "sla_hours": 96
        }
      ]
    }
  ]
}
```

---

## 3. Special Use Cases

### 3.1 International Travel Workflow

**Use Case:** Additional compliance for international travel expenses

```json
{
  "workflow_id": "wf_international_travel",
  "name": "International Travel Approval",
  "description": "Enhanced workflow for international travel with compliance checks",
  "version": 1,
  "active": true,
  "conditions": {
    "expense_categories": ["international_flights", "foreign_hotels"],
    "custom_fields": {
      "destination_country": "not_null"
    }
  },
  "steps": [
    {
      "step_number": 1,
      "name": "Pre-Travel Approval",
      "target_type": "relationship",
      "target_value": "direct_manager",
      "sla_hours": 72,
      "required_documents": ["travel_justification", "itinerary"]
    },
    {
      "step_number": 2,
      "name": "Compliance Review",
      "target_type": "role",
      "target_value": "compliance_officer",
      "sla_hours": 48,
      "validation_rules": [
        {
          "field": "destination_country",
          "condition": "not_in_restricted_list",
          "error_message": "Travel to this country requires additional approval"
        },
        {
          "field": "visa_status",
          "condition": "valid",
          "error_message": "Valid visa or entry permit required"
        }
      ]
    },
    {
      "step_number": 3,
      "name": "Finance Pre-Approval",
      "target_type": "role",
      "target_value": "finance",
      "sla_hours": 72,
      "skip_if": {
        "field": "amount",
        "condition": "less_than",
        "value": 2000
      }
    },
    {
      "step_number": 4,
      "name": "Post-Travel Reconciliation",
      "target_type": "role",
      "target_value": "finance",
      "sla_hours": 120,
      "triggered_by": "report_submission",
      "required_documents": ["receipts", "expense_log"],
      "validation_rules": [
        {
          "field": "actual_vs_estimated",
          "condition": "variance_within",
          "value": 20,
          "unit": "percent",
          "error_message": "Actual expenses exceed estimated by more than 20%"
        }
      ]
    }
  ],
  "on_return": {
    "policy": "soft_restart",
    "clear_approvals": false,
    "resume_from_step": "last_incomplete"
  }
}
```

---

### 3.2 Emergency Expense Workflow

**Use Case:** Expedited approval for emergency situations

```json
{
  "workflow_id": "wf_emergency",
  "name": "Emergency Expense Approval",
  "description": "Fast-track workflow for urgent business needs",
  "version": 1,
  "active": true,
  "conditions": {
    "custom_fields": {
      "is_emergency": true
    }
  },
  "steps": [
    {
      "step_number": 1,
      "name": "Emergency Approval",
      "target_type": "hybrid",
      "target_value": {
        "role": "approver",
        "relationship": "direct_manager"
      },
      "sla_hours": 4,
      "notification": {
        "method": "sms_and_email",
        "priority": "urgent"
      },
      "escalation": {
        "enabled": true,
        "target_type": "relationship",
        "target_value": "skip_level_manager",
        "notify_at_hours": [2],
        "auto_approve_after_hours": 8
      },
      "required_fields": [
        "emergency_justification",
        "estimated_amount",
        "expected_completion_date"
      ]
    },
    {
      "step_number": 2,
      "name": "Finance Post-Review",
      "target_type": "role",
      "target_value": "finance",
      "sla_hours": 48,
      "triggered_by": "report_submission",
      "validation_rules": [
        {
          "field": "actual_amount",
          "condition": "not_exceed_estimated_by",
          "value": 50,
          "unit": "percent",
          "action_if_fail": "require_explanation"
        }
      ]
    }
  ],
  "audit_requirements": {
    "requires_post_approval_review": true,
    "review_deadline_days": 30,
    "review_by": "audit_committee"
  }
}
```

---

### 3.3 Recurring Expense Workflow

**Use Case:** Streamlined approval for pre-approved recurring expenses

```json
{
  "workflow_id": "wf_recurring",
  "name": "Recurring Expense Fast-Track",
  "description": "Simplified workflow for pre-approved recurring expenses",
  "version": 1,
  "active": true,
  "conditions": {
    "custom_fields": {
      "is_recurring": true,
      "has_standing_approval": true
    }
  },
  "steps": [
    {
      "step_number": 1,
      "name": "Automated Validation",
      "target_type": "system",
      "target_value": "auto_validate",
      "sla_hours": 1,
      "validation_rules": [
        {
          "field": "amount",
          "condition": "within_approved_range",
          "reference_field": "standing_approval_amount",
          "variance_allowed": 10,
          "unit": "percent"
        },
        {
          "field": "vendor",
          "condition": "matches",
          "reference_field": "standing_approval_vendor"
        },
        {
          "field": "frequency",
          "condition": "complies_with_schedule",
          "reference_field": "standing_approval_frequency"
        }
      ],
      "on_validation_fail": {
        "action": "route_to_manual_approval",
        "notify": "direct_manager"
      },
      "on_validation_pass": {
        "action": "auto_approve",
        "notify": "finance"
      }
    },
    {
      "step_number": 2,
      "name": "Quarterly Review",
      "target_type": "relationship",
      "target_value": "direct_manager",
      "sla_hours": 168,
      "triggered_by": "quarterly_schedule",
      "review_scope": "all_recurring_expenses_last_quarter"
    }
  ],
  "standing_approval_renewal": {
    "frequency": "annual",
    "requires_re_approval_by": "department_head",
    "notification_days_before": 30
  }
}
```

---

## 4. Advanced Features

### 4.1 Parallel Approval Workflow

**Use Case:** Multiple approvers must approve simultaneously

```json
{
  "workflow_id": "wf_parallel",
  "name": "Parallel Multi-Approver",
  "description": "Requires concurrent approval from multiple parties",
  "version": 1,
  "active": true,
  "conditions": {
    "amount_min": 50000
  },
  "steps": [
    {
      "step_number": 1,
      "name": "Manager Approval",
      "target_type": "relationship",
      "target_value": "direct_manager",
      "sla_hours": 48
    },
    {
      "step_number": 2,
      "name": "Parallel Approval Group",
      "execution_mode": "parallel",
      "required_approvals": "all",
      "sub_steps": [
        {
          "sub_step_id": "2a",
          "name": "Finance Director Approval",
          "target_type": "role",
          "target_value": "finance_director",
          "sla_hours": 72
        },
        {
          "sub_step_id": "2b",
          "name": "Department Head Approval",
          "target_type": "relationship",
          "target_value": "department_head",
          "sla_hours": 72
        },
        {
          "sub_step_id": "2c",
          "name": "Legal Review",
          "target_type": "role",
          "target_value": "legal",
          "sla_hours": 96
        }
      ]
    },
    {
      "step_number": 3,
      "name": "CFO Final Approval",
      "target_type": "role",
      "target_value": "cfo",
      "sla_hours": 120
    }
  ]
}
```

---

### 4.2 Majority Vote Workflow

**Use Case:** Approval by majority of a group

```json
{
  "workflow_id": "wf_majority_vote",
  "name": "Committee Majority Vote",
  "description": "Requires majority approval from designated committee",
  "version": 1,
  "active": true,
  "conditions": {
    "expense_categories": ["capital_expenditure"],
    "amount_min": 100000
  },
  "steps": [
    {
      "step_number": 1,
      "name": "Executive Committee Vote",
      "target_type": "committee",
      "target_value": "executive_committee",
      "execution_mode": "voting",
      "voting_rules": {
        "threshold": "majority",
        "quorum_required": 5,
        "voting_period_hours": 168,
        "allow_delegation": true,
        "anonymous": false
      },
      "committee_members": [
        {"role": "ceo"},
        {"role": "cfo"},
        {"role": "coo"},
        {"role": "vp_engineering"},
        {"role": "vp_sales"},
        {"role": "vp_product"},
        {"role": "general_counsel"}
      ],
      "escalation": {
        "enabled": true,
        "action_on_quorum_fail": "notify_ceo",
        "action_on_tie": "ceo_deciding_vote"
      }
    }
  ]
}
```

---

### 4.3 Conditional Skip Steps

**Use Case:** Skip certain approvals based on conditions

```json
{
  "workflow_id": "wf_conditional_skip",
  "name": "Smart Skip Workflow",
  "description": "Dynamically skip steps based on conditions",
  "version": 1,
  "active": true,
  "steps": [
    {
      "step_number": 1,
      "name": "Manager Approval",
      "target_type": "relationship",
      "target_value": "direct_manager",
      "sla_hours": 48
    },
    {
      "step_number": 2,
      "name": "Budget Approval",
      "target_type": "role",
      "target_value": "budget_controller",
      "sla_hours": 72,
      "skip_conditions": [
        {
          "field": "has_budget_allocation",
          "condition": "equals",
          "value": true
        },
        {
          "field": "within_allocated_budget",
          "condition": "equals",
          "value": true
        }
      ]
    },
    {
      "step_number": 3,
      "name": "Department Head Approval",
      "target_type": "relationship",
      "target_value": "department_head",
      "sla_hours": 96,
      "skip_conditions": [
        {
          "operator": "OR",
          "conditions": [
            {
              "field": "amount",
              "condition": "less_than",
              "value": 1000
            },
            {
              "field": "manager_is_department_head",
              "condition": "equals",
              "value": true
            }
          ]
        }
      ]
    },
    {
      "step_number": 4,
      "name": "Finance Approval",
      "target_type": "role",
      "target_value": "finance",
      "sla_hours": 72
    }
  ]
}
```

---

## 5. Workflow Testing & Validation

### 5.1 Test Workflow Configuration

```json
{
  "workflow_id": "wf_test_suite",
  "name": "Test Workflow",
  "description": "For testing purposes only",
  "version": 1,
  "active": false,
  "test_mode": true,
  "test_scenarios": [
    {
      "scenario_id": "test_happy_path",
      "name": "Happy Path - All Approvals",
      "test_data": {
        "amount": 1500,
        "category": "travel",
        "submitter": "test_employee_1",
        "direct_manager": "test_manager_1"
      },
      "expected_steps": [1, 2],
      "expected_approvers": ["test_manager_1", "finance_user_1"],
      "expected_duration_max_hours": 120
    },
    {
      "scenario_id": "test_rejection",
      "name": "Manager Rejection",
      "test_data": {
        "amount": 2000,
        "category": "equipment",
        "submitter": "test_employee_2",
        "direct_manager": "test_manager_2"
      },
      "inject_action": {
        "step": 1,
        "action": "reject",
        "comment": "Test rejection scenario"
      },
      "expected_final_status": "rejected"
    },
    {
      "scenario_id": "test_escalation",
      "name": "SLA Escalation",
      "test_data": {
        "amount": 3000,
        "category": "services",
        "submitter": "test_employee_3",
        "direct_manager": "test_manager_3"
      },
      "simulate_delay_hours": 72,
      "expected_escalation_to": "skip_level_manager"
    }
  ]
}
```

### 5.2 Workflow Validation Checklist

Before activating a workflow, validate:

- [ ] All target roles exist in the system
- [ ] All target relationships can be resolved
- [ ] No circular dependencies in steps
- [ ] SLA times are reasonable
- [ ] Escalation targets are valid
- [ ] Required fields exist in report schema
- [ ] Validation rules use valid operators
- [ ] No toxic permission combinations in approvers
- [ ] Test scenarios pass successfully
- [ ] Documentation updated

---

## 6. Migration & Versioning

### 6.1 Workflow Version Update

```json
{
  "workflow_id": "wf_standard_v2",
  "name": "Standard Approval Workflow",
  "version": 2,
  "active": true,
  "deprecated_version": 1,
  "change_log": [
    {
      "version": 2,
      "date": "2026-01-15",
      "changes": [
        "Added Finance approval step for amounts >$1000",
        "Reduced Manager SLA from 72h to 48h",
        "Added attachment validation rule"
      ],
      "migration_strategy": "soft",
      "affects_in_flight": false
    }
  ],
  "steps": [
    // ... new workflow definition
  ]
}
```

### 6.2 In-Flight Report Migration

```json
{
  "migration_id": "mig_20260115_001",
  "source_workflow_id": "wf_standard_v1",
  "target_workflow_id": "wf_standard_v2",
  "migration_date": "2026-01-15T00:00:00Z",
  "strategy": "opt_in",
  "options": {
    "preserve_completed_steps": true,
    "re_notify_pending_approvers": true,
    "grace_period_hours": 168
  },
  "affected_reports": [
    {
      "report_id": "rpt_123",
      "current_step": 1,
      "migration_action": "continue_on_v1"
    },
    {
      "report_id": "rpt_456",
      "current_step": 2,
      "migration_action": "migrate_to_v2"
    }
  ]
}
```

---

## Appendices

### Appendix A: Field Reference
Available fields for conditions and validation:
- `amount` - Expense amount
- `currency` - Currency code
- `expense_categories` - Array of category names
- `department` - Submitter's department
- `location` - Submitter's location
- `cost_center` - Cost center code
- `submitter_level` - Employee level/grade
- `vendor` - Vendor name
- `has_budget_allocation` - Boolean
- `within_allocated_budget` - Boolean
- `requires_contract` - Boolean
- `is_recurring` - Boolean
- `is_emergency` - Boolean
- `destination_country` - Country code for travel

### Appendix B: Condition Operators
- `equals`, `not_equals`
- `greater_than`, `less_than`, `greater_than_or_equal`, `less_than_or_equal`
- `in`, `not_in`, `contains`, `not_contains`
- `matches` (regex), `not_matches`
- `is_null`, `not_null`, `is_empty`, `not_empty`

### Appendix C: Relationship Types
- `direct_manager` - Immediate supervisor
- `skip_level_manager` - Manager's manager
- `department_head` - Head of department
- `division_head` - Division leader
- `same_department` - Users in same department
- `same_cost_center` - Users in same cost center

---

**Document End**
