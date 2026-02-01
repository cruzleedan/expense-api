-- Seed Users for Expense API
-- Password for all test users: "password" (hashed with salt)

-- Insert test users
INSERT INTO users (id, email, username, first_name, last_name, password_hash, is_active, manager_id, is_verified) VALUES
('00000000-0000-4000-a000-000000000001', 'superadmin@test.local', 'superadmin@test.local', 'Alice', 'SuperAdmin', '245ccb6487995defe2513b38751b1f29:3cf8fb23a091832d063ec9c9b68f5432e2a49d171286085290349337fe71906338b61b9ff7706c746ad1123e75ee519a6669750d433989b141422d876377ff2e', true, NULL, true),
('00000000-0000-4000-a000-000000000002', 'admin@test.local', 'admin@test.local', 'Bob', 'Administrator', '245ccb6487995defe2513b38751b1f29:3cf8fb23a091832d063ec9c9b68f5432e2a49d171286085290349337fe71906338b61b9ff7706c746ad1123e75ee519a6669750d433989b141422d876377ff2e', true, NULL, true),
('00000000-0000-4000-a000-000000000003', 'finance@test.local', 'finance@test.local', 'Carol', 'Finance', '245ccb6487995defe2513b38751b1f29:3cf8fb23a091832d063ec9c9b68f5432e2a49d171286085290349337fe71906338b61b9ff7706c746ad1123e75ee519a6669750d433989b141422d876377ff2e', true, NULL, true),
('00000000-0000-4000-a000-000000000004', 'manager@test.local', 'manager@test.local', 'David', 'Manager', '245ccb6487995defe2513b38751b1f29:3cf8fb23a091832d063ec9c9b68f5432e2a49d171286085290349337fe71906338b61b9ff7706c746ad1123e75ee519a6669750d433989b141422d876377ff2e', true, NULL, true),
('00000000-0000-4000-a000-000000000005', 'employee@test.local', 'employee@test.local', 'Emma', 'Employee', '245ccb6487995defe2513b38751b1f29:3cf8fb23a091832d063ec9c9b68f5432e2a49d171286085290349337fe71906338b61b9ff7706c746ad1123e75ee519a6669750d433989b141422d876377ff2e', true, '00000000-0000-4000-a000-000000000004', true),
('00000000-0000-4000-a000-000000000006', 'employee2@test.local', 'employee2@test.local', 'Frank', 'Worker', '245ccb6487995defe2513b38751b1f29:3cf8fb23a091832d063ec9c9b68f5432e2a49d171286085290349337fe71906338b61b9ff7706c746ad1123e75ee519a6669750d433989b141422d876377ff2e', true, '00000000-0000-4000-a000-000000000004', true),
('00000000-0000-4000-a000-000000000007', 'auditor@test.local', 'auditor@test.local', 'Grace', 'Auditor', '245ccb6487995defe2513b38751b1f29:3cf8fb23a091832d063ec9c9b68f5432e2a49d171286085290349337fe71906338b61b9ff7706c746ad1123e75ee519a6669750d433989b141422d876377ff2e', true, NULL, true),
('00000000-0000-4000-a000-000000000008', 'inactive@test.local', 'inactive@test.local', 'Henry', 'Inactive', '245ccb6487995defe2513b38751b1f29:3cf8fb23a091832d063ec9c9b68f5432e2a49d171286085290349337fe71906338b61b9ff7706c746ad1123e75ee519a6669750d433989b141422d876377ff2e', false, '00000000-0000-4000-a000-000000000004', true),
('00000000-0000-4000-a000-000000000009', 'multirole@test.local', 'multirole@test.local', 'Isabel', 'Hybrid', '245ccb6487995defe2513b38751b1f29:3cf8fb23a091832d063ec9c9b68f5432e2a49d171286085290349337fe71906338b61b9ff7706c746ad1123e75ee519a6669750d433989b141422d876377ff2e', true, NULL, true)
ON CONFLICT (id) DO NOTHING;

-- Assign roles to users
INSERT INTO user_roles (user_id, role_id)
SELECT '00000000-0000-4000-a000-000000000001', id FROM roles WHERE name = 'super_admin'
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT '00000000-0000-4000-a000-000000000002', id FROM roles WHERE name = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT '00000000-0000-4000-a000-000000000003', id FROM roles WHERE name = 'finance'
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT '00000000-0000-4000-a000-000000000004', id FROM roles WHERE name = 'approver'
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT '00000000-0000-4000-a000-000000000005', id FROM roles WHERE name = 'employee'
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT '00000000-0000-4000-a000-000000000006', id FROM roles WHERE name = 'employee'
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT '00000000-0000-4000-a000-000000000007', id FROM roles WHERE name = 'auditor'
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT '00000000-0000-4000-a000-000000000008', id FROM roles WHERE name = 'employee'
ON CONFLICT DO NOTHING;

-- multirole user has both approver and finance roles
INSERT INTO user_roles (user_id, role_id)
SELECT '00000000-0000-4000-a000-000000000009', id FROM roles WHERE name = 'approver'
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT '00000000-0000-4000-a000-000000000009', id FROM roles WHERE name = 'finance'
ON CONFLICT DO NOTHING;
