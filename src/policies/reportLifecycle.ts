import { ConflictError, ForbiddenError } from '../types/index.js';

export type ReportLifecycleState =
  | 'draft'
  | 'submitted'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'returned'
  | 'posted'
  | 'paid';

export type ReportLifecycleAction =
  | 'edit'
  | 'submit'
  | 'withdraw'
  | 'approve'
  | 'reject'
  | 'return'
  | 'revise'
  | 'correct'
  | 'post'
  | 'pay';

export interface ReportTransition {
  permission: string;
  sources: readonly ReportLifecycleState[];
  target: ReportLifecycleState | 'next_workflow_step' | 'unchanged';
  actor: 'owner' | 'current_approver' | 'finance';
}

/** Authoritative lifecycle matrix used by command services and API documentation. */
export const REPORT_TRANSITIONS: Record<ReportLifecycleAction, ReportTransition> = {
  edit: { permission: 'report.edit.own', sources: ['draft', 'returned'], target: 'unchanged', actor: 'owner' },
  submit: { permission: 'report.submit', sources: ['draft', 'returned'], target: 'submitted', actor: 'owner' },
  withdraw: { permission: 'report.withdraw', sources: ['submitted', 'pending'], target: 'draft', actor: 'owner' },
  approve: { permission: 'report.approve', sources: ['submitted', 'pending'], target: 'next_workflow_step', actor: 'current_approver' },
  reject: { permission: 'report.reject', sources: ['submitted', 'pending'], target: 'rejected', actor: 'current_approver' },
  return: { permission: 'report.return', sources: ['submitted', 'pending'], target: 'returned', actor: 'current_approver' },
  revise: { permission: 'report.submit', sources: ['rejected'], target: 'draft', actor: 'owner' },
  correct: { permission: 'report.correct', sources: ['approved'], target: 'returned', actor: 'current_approver' },
  post: { permission: 'report.post', sources: ['approved'], target: 'posted', actor: 'finance' },
  pay: { permission: 'report.pay', sources: ['posted'], target: 'paid', actor: 'finance' },
};

export function assertExpectedVersion(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new ConflictError(
      `Stale report version: expected ${expected}, current version is ${actual}`
    );
  }
}

export function assertReportTransition(
  action: ReportLifecycleAction,
  currentState: string
): void {
  const transition = REPORT_TRANSITIONS[action];
  if (!transition.sources.includes(currentState as ReportLifecycleState)) {
    throw new ConflictError(`Cannot ${action} report in ${currentState} status`);
  }
}

export function assertAccountingSeparationOfDuties(params: {
  actorId: string;
  submitterId: string;
  postedBy?: string | null;
  action: 'post' | 'pay';
}): void {
  if (params.actorId === params.submitterId) {
    throw new ForbiddenError('The report submitter cannot post or pay their own report');
  }
  if (params.action === 'pay' && params.postedBy === params.actorId) {
    throw new ForbiddenError('The same actor cannot both post and pay a report');
  }
}
