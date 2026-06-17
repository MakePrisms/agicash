import { describe, expect, test } from 'bun:test';
import { parseCashuPaymentRequest } from './payment-request';

describe('isCashuPaymentRequest', () => {
  test('returns true for valid cashu payment request', () => {
    expect(
      parseCashuPaymentRequest(
        'creqApWF0gaNhdGVub3N0cmFheKlucHJvZmlsZTFxeTI4d3VtbjhnaGo3dW45ZDNzaGp0bnl2OWtoMnVld2Q5aHN6OW1od2RlbjV0ZTB3ZmprY2N0ZTljdXJ4dmVuOWVlaHFjdHJ2NWhzenJ0aHdkZW41dGUwZGVoaHh0bnZkYWtxcWd5ZGFxeTdjdXJrNDM5eWtwdGt5c3Y3dWRoZGh1NjhzdWNtMjk1YWtxZWZkZWhrZjBkNDk1Y3d1bmw1YWeBgmFuYjE3YWloYjdhOTAxNzZhYQphdWNzYXRhbYF4Imh0dHBzOi8vbm9mZWVzLnRlc3RudXQuY2FzaHUuc3BhY2U=',
      ).valid,
    ).toBe(true);
  });

  test('returns false for invalid cashu payment request', () => {
    expect(parseCashuPaymentRequest('invalid').valid).toBe(false);
  });
});
