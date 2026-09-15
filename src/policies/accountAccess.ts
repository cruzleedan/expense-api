export interface TokenEligibleAccount {
  is_active: boolean;
  is_verified: boolean;
}

export function canReceiveNormalTokens(
  account: TokenEligibleAccount | null | undefined
): boolean {
  return !!account?.is_active && !!account.is_verified;
}
