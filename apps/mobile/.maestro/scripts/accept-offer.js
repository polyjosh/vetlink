// Maestro runScript (runs on the host): the seed vet accepts the newest offer through the API, so
// one device can play the farmer. Needs the dev stack with OTP_FIXED_CODE (default 123456).
const api = API_URL || 'http://localhost:4000';
const otp = OTP || '123456';
const headers = { 'Content-Type': 'application/json' };

http.post(`${api}/v1/auth/otp/request`, { headers, body: JSON.stringify({ phone: '0700000002' }) });
const login = json(
  http.post(`${api}/v1/auth/otp/verify`, {
    headers,
    body: JSON.stringify({ phone: '0700000002', code: otp, device: { platform: 'android' } }),
  }).body,
);
const auth = { ...headers, Authorization: `Bearer ${login.accessToken}` };
const offers = json(http.get(`${api}/v1/vets/me/offers`, { headers: auth }).body);
const offer = offers[0];
if (!offer) throw new Error('no offer for the seed vet');
const res = http.post(`${api}/v1/bookings/${offer.bookingId}/offers/${offer.offerId}/accept`, {
  headers: auth,
  body: '{}',
});
if (res.status !== 200) throw new Error(`accept failed: ${res.status}`);
output.bookingId = offer.bookingId;
