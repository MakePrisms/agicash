export type MeasureOperationFn = <T>(
  name: string,
  operation: () => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
) => Promise<T>;

let _measureOperation: MeasureOperationFn = (_name, op) => op();

export function setMeasureOperation(fn: MeasureOperationFn): void {
  _measureOperation = fn;
}

export function measureOperation<T>(
  name: string,
  operation: () => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  return _measureOperation(name, operation, attributes);
}
