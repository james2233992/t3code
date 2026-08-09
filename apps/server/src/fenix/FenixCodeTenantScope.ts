export interface FenixCodeTenantScope {
  readonly companyId: number;
  readonly userId: number;
}

export function isValidFenixCodeTenantScope(
  scope: FenixCodeTenantScope | null | undefined,
): scope is FenixCodeTenantScope {
  return (
    scope !== null &&
    scope !== undefined &&
    Number.isSafeInteger(scope.companyId) &&
    Number.isSafeInteger(scope.userId) &&
    scope.companyId > 0 &&
    scope.userId > 0
  );
}
