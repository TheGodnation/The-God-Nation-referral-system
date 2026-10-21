import type { Request } from 'express';

// ---------------------------------------------------------------------------
// Automatic Mobile Money payments for leadership books — ready, but off.
//
// Today every book payment is MANUAL: the member pays by MTN / Orange
// Mobile Money to the numbers in Admin → Library, types the transaction ID,
// and the central admin confirms it. When the ministry signs with a payment
// company (Campay, NotchPay, CinetPay, ...), that company's connection is
// written as one PaymentProvider below and switched on with environment
// variables on the server — never stored in the database:
//
//   PAYMENT_PROVIDER         the provider's name below (e.g. "campay")
//   PAYMENT_API_KEY / PAYMENT_API_SECRET   the keys the company gives
//   PAYMENT_WEBHOOK_SECRET   to check that notifications really come from it
//
// The company is given our notification address:
//   https://thegodnationacademy.org/api/payments/webhook
// Everything around it (the "Pay now" button, pending payments, opening
// the next book on confirmation) already works with any provider.
// ---------------------------------------------------------------------------

export interface PaymentRequest {
  /** Our own reference, sent to the provider and echoed back. */
  reference: string;
  amount: number;
  currency: 'XAF';
  /** The member's Mobile Money number, international format. */
  phone: string;
  description: string;
}

export interface PaymentStarted {
  /** The provider's own id for this payment. */
  providerRef: string;
}

export interface PaymentNotification {
  providerRef: string;
  status: 'CONFIRMED' | 'FAILED';
}

export interface PaymentProvider {
  name: string;
  /** Asks the provider to charge the member's phone (they approve on it). */
  requestPayment(req: PaymentRequest): Promise<PaymentStarted>;
  /** Checks a webhook really comes from the provider and reads it; null = not genuine. */
  readNotification(req: Request): Promise<PaymentNotification | null>;
}

const providers = new Map<string, PaymentProvider>();

/** Adds a provider (each company's connection registers itself here). */
export function registerPaymentProvider(provider: PaymentProvider) {
  providers.set(provider.name, provider);
}

/** The provider switched on by PAYMENT_PROVIDER, or null when payments are manual only. */
export function activePaymentProvider(): PaymentProvider | null {
  const name = (process.env.PAYMENT_PROVIDER || '').trim().toLowerCase();
  return (name && providers.get(name)) || null;
}

export function automaticPaymentsEnabled(): boolean {
  return activePaymentProvider() !== null;
}
