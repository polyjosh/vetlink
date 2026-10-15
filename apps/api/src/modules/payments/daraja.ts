import { GatewayError, type PaymentsGateway, type StkQueryResult } from './gateway.js';

/**
 * Safaricom Daraja M-Pesa Express (STK push) client.
 * Endpoints and fields follow the Daraja v3 API docs: OAuth `GET /oauth/v1/generate`,
 * `POST /mpesa/stkpush/v1/processrequest`, `POST /mpesa/stkpushquery/v1/query`.
 */
export interface DarajaConfig {
  env: 'sandbox' | 'live';
  consumerKey: string;
  consumerSecret: string;
  /** PayBill shortcode (BusinessShortCode and PartyB). */
  shortcode: string;
  passkey: string;
  /** Public HTTPS URL Daraja posts results to (carries the webhook token). */
  callbackUrl: string;
  fetch?: typeof fetch;
  now?: () => Date;
}

const HOSTS = {
  sandbox: 'https://sandbox.safaricom.co.ke',
  // Production host per the Daraja docs' STK push endpoint; confirm on the portal at go-live.
  live: 'https://api.safaricom.co.ke',
} as const;

const TIMEOUT_MS = 10_000;
/** Refresh the OAuth token this long before Daraja says it expires. */
const TOKEN_MARGIN_MS = 60_000;

/** Daraja timestamps are Kenyan local time (EAT, UTC+3, no daylight saving): YYYYMMDDHHmmss. */
export function darajaTimestamp(now: Date): string {
  const eat = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return eat.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

export function darajaPassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
}

interface StkPushResponse {
  MerchantRequestID?: string;
  CheckoutRequestID?: string;
  ResponseCode?: string | number;
  ResponseDescription?: string;
  errorCode?: string;
  errorMessage?: string;
}

interface StkQueryResponse {
  ResponseCode?: string | number;
  ResultCode?: string | number;
  ResultDesc?: string;
  errorCode?: string;
  errorMessage?: string;
}

export function darajaGateway(config: DarajaConfig): PaymentsGateway {
  const host = HOSTS[config.env];
  const http = config.fetch ?? fetch;
  const now = config.now ?? (() => new Date());
  let token: { value: string; expiresAt: number } | null = null;

  async function call<T>(path: string, init: RequestInit): Promise<{ status: number; body: T }> {
    const res = await http(`${host}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text();
    let body: T;
    try {
      body = JSON.parse(text) as T;
    } catch {
      throw new GatewayError(`Daraja ${path} answered ${res.status} with a non-JSON body`);
    }
    return { status: res.status, body };
  }

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt - TOKEN_MARGIN_MS > now().getTime()) return token.value;
    const basic = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
    const { status, body } = await call<{ access_token?: string; expires_in?: string | number }>(
      '/oauth/v1/generate?grant_type=client_credentials',
      { method: 'GET', headers: { Authorization: `Basic ${basic}` } },
    );
    if (status !== 200 || !body.access_token) {
      throw new GatewayError(`Daraja OAuth failed (${status})`);
    }
    token = {
      value: body.access_token,
      expiresAt: now().getTime() + Number(body.expires_in ?? 3599) * 1000,
    };
    return token.value;
  }

  async function post<T>(path: string, payload: object) {
    return call<T>(path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  }

  function credentials() {
    const timestamp = darajaTimestamp(now());
    return {
      BusinessShortCode: config.shortcode,
      Password: darajaPassword(config.shortcode, config.passkey, timestamp),
      Timestamp: timestamp,
    };
  }

  return {
    async stkPush(req) {
      const { status, body } = await post<StkPushResponse>('/mpesa/stkpush/v1/processrequest', {
        ...credentials(),
        TransactionType: 'CustomerPayBillOnline',
        Amount: req.amount,
        PartyA: req.phone,
        PartyB: config.shortcode,
        PhoneNumber: req.phone,
        CallBackURL: config.callbackUrl,
        AccountReference: req.accountReference.slice(0, 12),
        TransactionDesc: req.description.slice(0, 13),
      });
      if (
        status !== 200 ||
        String(body.ResponseCode) !== '0' ||
        !body.CheckoutRequestID ||
        !body.MerchantRequestID
      ) {
        throw new GatewayError(
          `STK push not accepted (${status} ${body.errorCode ?? body.ResponseCode ?? ''})`,
        );
      }
      return {
        checkoutRequestId: body.CheckoutRequestID,
        merchantRequestId: body.MerchantRequestID,
      };
    },

    async query(checkoutRequestId): Promise<StkQueryResult> {
      const { status, body } = await post<StkQueryResponse>('/mpesa/stkpushquery/v1/query', {
        ...credentials(),
        CheckoutRequestID: checkoutRequestId,
      });
      // While the customer has not answered, Daraja rejects the query (not a final result).
      if (status !== 200 || String(body.ResponseCode) !== '0' || body.ResultCode === undefined) {
        return { state: 'processing' };
      }
      return {
        state: 'final',
        result: {
          checkoutRequestId,
          resultCode: Number(body.ResultCode),
          resultDesc: body.ResultDesc ?? '',
        },
      };
    },
  };
}
